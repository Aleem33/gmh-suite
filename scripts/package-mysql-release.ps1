param(
  [string]$Version = '3.2.0',
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$frontendZip = Join-Path $repo "gmh-hostinger-subdomain-v$Version.zip"
$backendZip = Join-Path $repo "gmh-hostinger-backend-v$Version.zip"
$stageRoot = Join-Path $env:TEMP "gmh-suite-$Version-package"

if (-not $SkipBuild) {
  Push-Location $repo
  try { npm run build } finally { Pop-Location }
}

if (Test-Path $stageRoot) { Remove-Item -LiteralPath $stageRoot -Recurse -Force }
New-Item -ItemType Directory -Path $stageRoot | Out-Null

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
function New-ZipFromDirectory([string]$Source, [string]$Destination) {
  if (Test-Path $Destination) { Remove-Item -LiteralPath $Destination -Force }
  $sourceRoot = (Resolve-Path -LiteralPath $Source).Path.TrimEnd('\')
  $archive = [System.IO.Compression.ZipFile]::Open(
    $Destination,
    [System.IO.Compression.ZipArchiveMode]::Create
  )
  try {
    Get-ChildItem -LiteralPath $sourceRoot -Recurse -File -Force | ForEach-Object {
      $entryName = $_.FullName.Substring($sourceRoot.Length + 1).Replace('\', '/')
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $archive,
        $_.FullName,
        $entryName,
        [System.IO.Compression.CompressionLevel]::Optimal
      ) | Out-Null
    }
  } finally {
    $archive.Dispose()
  }
}

New-ZipFromDirectory (Join-Path $repo 'dist') $frontendZip

$backendStage = Join-Path $stageRoot 'backend'
New-Item -ItemType Directory -Path $backendStage | Out-Null
Get-ChildItem -LiteralPath (Join-Path $repo 'backend') -Force | Where-Object {
  $_.Name -notin @('.env', '.env.hostinger', '.phpunit.cache')
} | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $backendStage -Recurse -Force
}
New-ZipFromDirectory $backendStage $backendZip

$requiredFrontend = @('.htaccess', 'index.html', 'logo.png', 'assets', 'api')
foreach ($entry in $requiredFrontend) {
  if (-not (Test-Path (Join-Path $repo "dist\$entry"))) { throw "Frontend package is missing $entry" }
}

Write-Host "Created $frontendZip"
Write-Host "Created $backendZip"
