$ErrorActionPreference = 'Stop'

$Version = '3.0.0'
$PluginDir = $PSScriptRoot
$RootDir = Split-Path -Parent $PluginDir
$OutputPath = Join-Path $RootDir "bom_engine_plugin_v$Version.rbz"
$StagingDir = Join-Path ([System.IO.Path]::GetTempPath()) "bom-engine-rbz-$([guid]::NewGuid())"
$ZipPath = [System.IO.Path]::ChangeExtension($OutputPath, '.zip')

try {
    New-Item -ItemType Directory -Path $StagingDir | Out-Null
    Copy-Item -LiteralPath (Join-Path $PluginDir 'bom_engine_loader.rb') -Destination $StagingDir
    Copy-Item -LiteralPath (Join-Path $PluginDir 'bom_engine') -Destination $StagingDir -Recurse
    $TestsPath = Join-Path $StagingDir 'bom_engine\tests'
    if (Test-Path -LiteralPath $TestsPath) {
        Remove-Item -LiteralPath $TestsPath -Recurse -Force
    }
    if (Test-Path -LiteralPath $ZipPath) {
        Remove-Item -LiteralPath $ZipPath -Force
    }
    if (Test-Path -LiteralPath $OutputPath) {
        Remove-Item -LiteralPath $OutputPath -Force
    }
    Compress-Archive -Path (Join-Path $StagingDir '*') -DestinationPath $ZipPath -CompressionLevel Optimal
    Move-Item -LiteralPath $ZipPath -Destination $OutputPath
    Write-Output "Built: $OutputPath"
} finally {
    if (Test-Path -LiteralPath $StagingDir) {
        Remove-Item -LiteralPath $StagingDir -Recurse -Force
    }
}
