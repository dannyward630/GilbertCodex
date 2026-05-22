param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Command
)

$ErrorActionPreference = "Stop"

if (-not $Command -or $Command.Count -eq 0) {
  throw "No command was provided. Example: scripts/run-native-whisper-command.ps1 cargo check --features offline-dictation"
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Find-LibClangPath {
  if ($env:LIBCLANG_PATH -and (Test-Path (Join-Path $env:LIBCLANG_PATH "libclang.dll"))) {
    return $env:LIBCLANG_PATH
  }

  $localLlvmRoot = Join-Path $repoRoot ".tools\llvm"
  if (Test-Path $localLlvmRoot) {
    $localLibClang = Get-ChildItem -Path $localLlvmRoot -Recurse -Filter "libclang.dll" -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($localLibClang) {
      return $localLibClang.DirectoryName
    }
  }

  $knownLocations = @(
    "C:\Program Files\LLVM\bin",
    "C:\Program Files (x86)\LLVM\bin",
    "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\Llvm\x64\bin"
  )

  foreach ($location in $knownLocations) {
    if (Test-Path (Join-Path $location "libclang.dll")) {
      return $location
    }
  }

  return $null
}

function Find-VcVarsPath {
  $vswhere = "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe"
  if (Test-Path $vswhere) {
    $installPath = & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath |
      Select-Object -First 1
    if ($installPath) {
      $candidate = Join-Path $installPath "VC\Auxiliary\Build\vcvars64.bat"
      if (Test-Path $candidate) {
        return $candidate
      }
    }
  }

  $defaultPath = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
  if (Test-Path $defaultPath) {
    return $defaultPath
  }

  return $null
}

function Find-VulkanSdkPath {
  if ($env:VULKAN_SDK -and (Test-Path (Join-Path $env:VULKAN_SDK "Lib\vulkan-1.lib"))) {
    return $env:VULKAN_SDK
  }

  $localSdkRoot = Join-Path $repoRoot ".tools\vulkan-sdk"
  if (Test-Path $localSdkRoot) {
    $localSdk = Get-ChildItem -Path $localSdkRoot -Directory -ErrorAction SilentlyContinue |
      Where-Object { Test-Path (Join-Path $_.FullName "Lib\vulkan-1.lib") } |
      Select-Object -First 1
    if ($localSdk) {
      return $localSdk.FullName
    }
  }

  $knownRoots = @("C:\VulkanSDK", "C:\Program Files\VulkanSDK", "C:\Program Files (x86)\VulkanSDK")
  foreach ($root in $knownRoots) {
    if (-not (Test-Path $root)) {
      continue
    }

    $sdk = Get-ChildItem -Path $root -Directory -ErrorAction SilentlyContinue |
      Where-Object { Test-Path (Join-Path $_.FullName "Lib\vulkan-1.lib") } |
      Sort-Object Name -Descending |
      Select-Object -First 1
    if ($sdk) {
      return $sdk.FullName
    }
  }

  return $null
}

function ConvertTo-CmdArgument([string]$Value) {
  if ($Value -notmatch '[\s"&|<>^]') {
    return $Value
  }

  return '"' + ($Value -replace '"', '\"') + '"'
}

$libClangPath = Find-LibClangPath
if (-not $libClangPath) {
  throw "Could not find libclang.dll. Install LLVM or extract the official LLVM Windows archive under .tools\llvm."
}

$joinedCommand = $Command -join " "

if ($joinedCommand -match "offline-dictation-cuda") {
  if (-not $env:CUDA_PATH -or -not (Test-Path (Join-Path $env:CUDA_PATH "lib\x64\cudart.lib"))) {
    throw "CUDA dictation builds require NVIDIA CUDA Toolkit and CUDA_PATH. Install CUDA Toolkit, restart the shell, then retry this command."
  }
}

if (-not $env:CARGO_TARGET_DIR) {
  $driveRoot = [System.IO.Path]::GetPathRoot($repoRoot)
  $shortTargetDir = Join-Path $driveRoot "gcn"
  try {
    New-Item -ItemType Directory -Force $shortTargetDir | Out-Null
  } catch {
    throw "Could not create $shortTargetDir for the native Whisper build. Set CARGO_TARGET_DIR to a very short writable path, then retry."
  }
  $env:CARGO_TARGET_DIR = $shortTargetDir
}

if (-not $env:CMAKE_GENERATOR -and (Get-Command ninja.exe -ErrorAction SilentlyContinue)) {
  $env:CMAKE_GENERATOR = "Ninja"
}

if (-not $env:CARGO_BUILD_JOBS) {
  $env:CARGO_BUILD_JOBS = "1"
}

function Set-DefaultProcessEnv([string]$Name, [string]$Value) {
  if (-not [Environment]::GetEnvironmentVariable($Name, "Process")) {
    [Environment]::SetEnvironmentVariable($Name, $Value, "Process")
  }
}

$portableGgmlEnv = @(
  @{ Name = "SOURCE_DATE_EPOCH"; Value = "1" },
  @{ Name = "GGML_NATIVE"; Value = "OFF" },
  @{ Name = "GGML_SSE42"; Value = "OFF" },
  @{ Name = "GGML_AVX"; Value = "OFF" },
  @{ Name = "GGML_AVX2"; Value = "OFF" },
  @{ Name = "GGML_FMA"; Value = "OFF" },
  @{ Name = "GGML_F16C"; Value = "OFF" },
  @{ Name = "GGML_BMI2"; Value = "OFF" },
  @{ Name = "GGML_AVX_VNNI"; Value = "OFF" },
  @{ Name = "GGML_AVX512"; Value = "OFF" },
  @{ Name = "GGML_AVX512_VBMI"; Value = "OFF" },
  @{ Name = "GGML_AVX512_VNNI"; Value = "OFF" },
  @{ Name = "GGML_AVX512_BF16"; Value = "OFF" }
)

foreach ($entry in $portableGgmlEnv) {
  Set-DefaultProcessEnv $entry.Name $entry.Value
}

if ($joinedCommand -match "offline-dictation-(gpu|vulkan)") {
  $vulkanSdkPath = Find-VulkanSdkPath
  if (-not $vulkanSdkPath) {
    throw "Universal GPU dictation builds require the Vulkan SDK and VULKAN_SDK. Run npm run dictation:vulkan-sdk, install Vulkan SDK, or extract it under .tools\vulkan-sdk, then retry this command."
  }
  $env:VULKAN_SDK = $vulkanSdkPath
}

$vcvarsPath = Find-VcVarsPath
if (-not $vcvarsPath) {
  throw "Could not find Visual Studio C++ vcvars64.bat. Install Visual Studio Build Tools with the C++ workload."
}

$commandLine = ($Command | ForEach-Object { ConvertTo-CmdArgument $_ }) -join " "
$batchCommand = 'set "LIBCLANG_PATH=' + $libClangPath + '" && '
if ($env:VULKAN_SDK) {
  $batchCommand += 'set "VULKAN_SDK=' + $env:VULKAN_SDK + '" && '
}
if ($env:CARGO_TARGET_DIR) {
  $batchCommand += 'set "CARGO_TARGET_DIR=' + $env:CARGO_TARGET_DIR + '" && '
}
if ($env:CMAKE_GENERATOR) {
  $batchCommand += 'set "CMAKE_GENERATOR=' + $env:CMAKE_GENERATOR + '" && '
}
if ($env:CARGO_BUILD_JOBS) {
  $batchCommand += 'set "CARGO_BUILD_JOBS=' + $env:CARGO_BUILD_JOBS + '" && '
}
foreach ($entry in $portableGgmlEnv) {
  $value = [Environment]::GetEnvironmentVariable($entry.Name, "Process")
  if ($value) {
    $batchCommand += 'set "' + $entry.Name + '=' + $value + '" && '
  }
}
$batchCommand += 'call "' + $vcvarsPath + '" >nul && ' + $commandLine

cmd.exe /d /s /c $batchCommand
exit $LASTEXITCODE
