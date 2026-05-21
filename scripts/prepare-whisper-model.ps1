param(
  [string]$ModelUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
  [string]$ExpectedSha1 = "137c40403d78fd54d454da0f9bd998f78703390c"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$modelDir = Join-Path $repoRoot "resources\models\whisper"
$modelPath = Join-Path $modelDir "ggml-base.en.bin"
$tempPath = "$modelPath.tmp"

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

New-Item -ItemType Directory -Force -Path $modelDir | Out-Null

if (Test-Path $modelPath) {
  $existingHash = Get-FileHashHex -Path $modelPath -Algorithm SHA1
  if ($existingHash -eq $ExpectedSha1.ToLowerInvariant()) {
    Write-Host "Whisper base.en model is already present and verified:"
    Write-Host $modelPath
    exit 0
  }

  Write-Host "Existing model hash did not match; replacing it."
}

if (Test-Path $tempPath) {
  Remove-Item -LiteralPath $tempPath -Force
}

Write-Host "Downloading Whisper base.en model..."
Write-Host $ModelUrl
Invoke-WebRequest -Uri $ModelUrl -OutFile $tempPath

$downloadHash = Get-FileHashHex -Path $tempPath -Algorithm SHA1
if ($downloadHash -ne $ExpectedSha1.ToLowerInvariant()) {
  Remove-Item -LiteralPath $tempPath -Force
  throw "Downloaded model SHA1 mismatch. Expected $ExpectedSha1 but got $downloadHash."
}

Move-Item -LiteralPath $tempPath -Destination $modelPath -Force
Write-Host "Whisper base.en model downloaded and verified:"
Write-Host $modelPath
