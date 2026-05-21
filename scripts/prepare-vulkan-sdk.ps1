param(
  [string]$Version = "1.4.350.0",
  [string]$ExpectedSha256 = "855b27ba05d2d8119c5114c5d4ff870ca38f2c632b11e1bb9923b9b7e6ecfe7b"
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$downloadsDir = Join-Path $repoRoot ".tools\downloads"
$sdkRoot = Join-Path $repoRoot ".tools\vulkan-sdk\$Version"
$installerName = "vulkansdk-windows-X64-$Version.exe"
$installerPath = Join-Path $downloadsDir $installerName
$downloadUrl = "https://sdk.lunarg.com/sdk/download/$Version/windows/$installerName"

function Test-VulkanSdkReady([string]$Path) {
  return (Test-Path (Join-Path $Path "Lib\vulkan-1.lib")) -and
    (Test-Path (Join-Path $Path "Include\vulkan\vulkan.h")) -and
    (Test-Path (Join-Path $Path "Bin\glslc.exe"))
}

New-Item -ItemType Directory -Force $downloadsDir | Out-Null

if (Test-VulkanSdkReady $sdkRoot) {
  Write-Host "Vulkan SDK $Version already prepared at $sdkRoot"
  exit 0
}

if (-not (Test-Path $installerPath)) {
  Write-Host "Downloading Vulkan SDK $Version from $downloadUrl"
  Invoke-WebRequest -Uri $downloadUrl -OutFile $installerPath
}

$hash = (Get-FileHash $installerPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($hash -ne $ExpectedSha256.ToLowerInvariant()) {
  throw "Vulkan SDK hash mismatch. Expected $ExpectedSha256 but got $hash for $installerPath"
}

New-Item -ItemType Directory -Force (Split-Path $sdkRoot) | Out-Null
Write-Host "Installing Vulkan SDK $Version to $sdkRoot"
& $installerPath --root $sdkRoot --accept-licenses --default-answer --confirm-command install copy_only=1
if ($LASTEXITCODE -ne 0) {
  throw "Vulkan SDK installer exited with code $LASTEXITCODE"
}

if (-not (Test-VulkanSdkReady $sdkRoot)) {
  throw "Vulkan SDK install finished, but required build files were not found under $sdkRoot"
}

Write-Host "Vulkan SDK $Version is ready at $sdkRoot"
