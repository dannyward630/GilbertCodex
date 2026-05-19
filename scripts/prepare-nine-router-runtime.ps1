param(
  [string]$PackageVersion = $env:GILBERT_9ROUTER_VERSION,
  [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($PackageVersion)) {
  $PackageVersion = "latest"
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$workRoot = Join-Path $repoRoot ".tools\9router"
$packageRoot = Join-Path $workRoot "package"
$resourceRoot = if ([string]::IsNullOrWhiteSpace($OutputDir)) {
  Join-Path $repoRoot "src-tauri\resources\9router"
} else {
  $OutputDir
}
$nodeResourceDir = Join-Path $resourceRoot "node"
$packageResourceDir = Join-Path $resourceRoot "package"

function Get-ProgramPath {
  param([string[]]$Names)

  foreach ($name in $Names) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($command -and $command.Source) {
      return $command.Source
    }
  }

  throw "Could not find any of: $($Names -join ', ')"
}

function Invoke-LoggedCommand {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory
  )

  Write-Host "Running: $FilePath $($Arguments -join ' ')"
  Push-Location -LiteralPath $WorkingDirectory
  try {
    & $FilePath @Arguments
    $exitCode = if ($LASTEXITCODE -is [int]) { $LASTEXITCODE } else { 0 }
  } finally {
    Pop-Location
  }

  if ($exitCode -ne 0) {
    throw "Command failed with exit code ${exitCode}: $FilePath $($Arguments -join ' ')"
  }
}

New-Item -ItemType Directory -Force -Path $workRoot | Out-Null

if (Test-Path $packageRoot) {
  Remove-Item -LiteralPath $packageRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $packageRoot | Out-Null

$npmPath = Get-ProgramPath @("npm.cmd", "npm")
$nodePath = Get-ProgramPath @("node.exe", "node")
$nodeDir = Split-Path -Parent $nodePath

Invoke-LoggedCommand -FilePath $npmPath -Arguments @("install", "--omit=dev", "--prefix", $packageRoot, "9router@$PackageVersion") -WorkingDirectory $repoRoot

$installedPackageDir = Join-Path $packageRoot "node_modules\9router"
$cliPath = Join-Path $installedPackageDir "cli.js"
if (!(Test-Path $cliPath)) {
  throw "The installed 9Router package did not contain cli.js at $cliPath"
}

if (Test-Path $resourceRoot) {
  Get-ChildItem -LiteralPath $resourceRoot -Force |
    Where-Object { $_.Name -ne "README.md" } |
    Remove-Item -Recurse -Force
} else {
  New-Item -ItemType Directory -Force -Path $resourceRoot | Out-Null
}

New-Item -ItemType Directory -Force -Path $nodeResourceDir | Out-Null
New-Item -ItemType Directory -Force -Path $packageResourceDir | Out-Null

Copy-Item -LiteralPath $nodePath -Destination (Join-Path $nodeResourceDir (Split-Path -Leaf $nodePath)) -Force
Get-ChildItem -LiteralPath $nodeDir -Filter "*.dll" -File -ErrorAction SilentlyContinue |
  ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $nodeResourceDir $_.Name) -Force
  }

Copy-Item -LiteralPath (Join-Path $packageRoot "node_modules") -Destination $packageResourceDir -Recurse -Force
Copy-Item -LiteralPath (Join-Path $packageRoot "package-lock.json") -Destination (Join-Path $packageResourceDir "package-lock.json") -Force -ErrorAction SilentlyContinue

$installedPackageJson = Get-Content -Raw (Join-Path $installedPackageDir "package.json") | ConvertFrom-Json
$metadata = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  nodePath = (Join-Path "node" (Split-Path -Leaf $nodePath))
  packageName = "9router"
  requestedVersion = $PackageVersion
  resolvedVersion = $installedPackageJson.version
  entrypoint = "package/node_modules/9router/cli.js"
}

$metadata | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 (Join-Path $resourceRoot "bundle-metadata.json")

Write-Host "Prepared bundled 9Router runtime $($installedPackageJson.version) at $resourceRoot"
