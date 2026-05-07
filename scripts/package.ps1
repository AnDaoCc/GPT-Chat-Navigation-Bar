$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$dist = Join-Path $root "dist"
$release = Join-Path $root "release"
$zipPath = Join-Path $release "conversation-navigator.zip"
$unpackedZipPath = Join-Path $release "conversation-navigator-unpacked.zip"
$crxPath = Join-Path $release "conversation-navigator.crx"
$pemPath = Join-Path $release "conversation-navigator.pem"
$unpackedFolder = Join-Path $release "conversation-navigator-unpacked"

if (-not (Test-Path (Join-Path $dist "manifest.json"))) {
  throw "dist/manifest.json was not found. Run npm run build first."
}

New-Item -ItemType Directory -Force -Path $release | Out-Null
Remove-Item -Force -ErrorAction SilentlyContinue $zipPath, $unpackedZipPath, $crxPath
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $unpackedFolder

Compress-Archive -Path (Join-Path $dist "*") -DestinationPath $zipPath -Force
New-Item -ItemType Directory -Force -Path $unpackedFolder | Out-Null
Copy-Item -Recurse -Force (Join-Path $dist "*") $unpackedFolder
Compress-Archive -Path $unpackedFolder -DestinationPath $unpackedZipPath -Force

$chromeCandidates = @(@(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
) | Where-Object { $_ -and (Test-Path $_) })

if ($chromeCandidates.Count -gt 0) {
  $chrome = [string]$chromeCandidates[0]
  $generatedCrx = "$dist.crx"
  $generatedPem = "$dist.pem"

  Remove-Item -Force -ErrorAction SilentlyContinue $generatedCrx
  if (-not (Test-Path $pemPath)) {
    Remove-Item -Force -ErrorAction SilentlyContinue $generatedPem
    & $chrome --pack-extension="$dist" | Out-Null
    if (Test-Path $generatedPem) {
      Move-Item -Force $generatedPem $pemPath
    }
  } else {
    & $chrome --pack-extension="$dist" --pack-extension-key="$pemPath" | Out-Null
  }

  if (Test-Path $generatedCrx) {
    Move-Item -Force $generatedCrx $crxPath
  }
}

Write-Host "Created $zipPath"
Write-Host "Created $unpackedFolder"
Write-Host "Created $unpackedZipPath"
if (Test-Path $crxPath) {
  Write-Host "Created $crxPath"
  Write-Host "Google Chrome Stable can block local CRX installs. Use Load unpacked with $unpackedFolder when that happens."
  Write-Host "Keep $pemPath if you want future CRX builds to keep the same extension ID."
} else {
  Write-Host "Chrome was not found, so CRX packaging was skipped."
}
