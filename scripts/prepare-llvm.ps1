param(
  [string]$Version = "22.1.0",
  [string]$ExpectedSha256 = "2dd6a6c990865f98766dec58cce1cbfba48e5affc0098e5b1fff96c2f1d23e81"
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$downloadsDir = Join-Path $repoRoot ".tools\downloads"
$llvmRoot = Join-Path $repoRoot ".tools\llvm"
$archiveName = "clang+llvm-$Version-x86_64-pc-windows-msvc.tar.xz"
$archivePath = Join-Path $downloadsDir $archiveName
$extractDir = Join-Path $llvmRoot "clang+llvm-$Version-x86_64-pc-windows-msvc"
$downloadUrl = "https://github.com/llvm/llvm-project/releases/download/llvmorg-$Version/$archiveName"

function Test-LlvmReady([string]$Path) {
  return (Test-Path (Join-Path $Path "bin\libclang.dll")) -and
    (Test-Path (Join-Path $Path "bin\clang.exe"))
}

function Get-FileHashHex([string]$Path, [string]$Algorithm) {
  $resolvedPath = (Resolve-Path -LiteralPath $Path).Path
  $stream = [System.IO.File]::OpenRead($resolvedPath)
  try {
    $hasher = switch ($Algorithm.ToUpperInvariant()) {
      "SHA1" { [System.Security.Cryptography.SHA1]::Create() }
      "SHA256" { [System.Security.Cryptography.SHA256]::Create() }
      default { throw "Unsupported hash algorithm: $Algorithm" }
    }

    try {
      return ([BitConverter]::ToString($hasher.ComputeHash($stream)) -replace "-", "").ToLowerInvariant()
    } finally {
      $hasher.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

New-Item -ItemType Directory -Force $downloadsDir | Out-Null
New-Item -ItemType Directory -Force $llvmRoot | Out-Null

if (Test-LlvmReady $extractDir) {
  Write-Host "LLVM $Version already prepared at $extractDir"
  exit 0
}

if (-not (Test-Path $archivePath)) {
  Write-Host "Downloading LLVM $Version from $downloadUrl"
  Invoke-WebRequest -Uri $downloadUrl -OutFile $archivePath
}

$hash = Get-FileHashHex -Path $archivePath -Algorithm SHA256
if ($hash -ne $ExpectedSha256.ToLowerInvariant()) {
  throw "LLVM archive hash mismatch. Expected $ExpectedSha256 but got $hash for $archivePath"
}

$stagingDir = Join-Path $llvmRoot ".extracting-$Version"
if (Test-Path $stagingDir) {
  Remove-Item -LiteralPath $stagingDir -Recurse -Force
}
New-Item -ItemType Directory -Force $stagingDir | Out-Null

Write-Host "Extracting LLVM $Version to $llvmRoot"
tar -xf $archivePath -C $stagingDir
if ($LASTEXITCODE -ne 0) {
  throw "LLVM extraction exited with code $LASTEXITCODE"
}

$extracted = Get-ChildItem -Path $stagingDir -Directory |
  Where-Object { Test-LlvmReady $_.FullName } |
  Select-Object -First 1

if (-not $extracted) {
  throw "LLVM extraction finished, but libclang.dll was not found."
}

if (Test-Path $extractDir) {
  Remove-Item -LiteralPath $extractDir -Recurse -Force
}

Move-Item -LiteralPath $extracted.FullName -Destination $extractDir
Remove-Item -LiteralPath $stagingDir -Recurse -Force

if (-not (Test-LlvmReady $extractDir)) {
  throw "LLVM $Version install finished, but required files were not found under $extractDir"
}

Write-Host "LLVM $Version is ready at $extractDir"
