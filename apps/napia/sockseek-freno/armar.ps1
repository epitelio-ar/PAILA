# Arma "sockseek con freno" (sockseek 3.0.6 + Soulseek.NET 10.0.2 + freno.patch) en una carpeta de trabajo.
# Uso: powershell -ExecutionPolicy Bypass -File armar.ps1 [-Trabajo C:\carpeta]
# Necesita el SDK de .NET 10 (winget install Microsoft.DotNet.SDK.10) y git (para aplicar el parche).
# Deja sockseek.exe (3.0.6-napia.2) en <Trabajo>\publicado. Ver LEEME.md.
# (una carpeta de ruta corta: con más de 260 caracteres el armado de .NET falla)
param([string]$Trabajo = (Join-Path $env:USERPROFILE 'sockseek-freno'))
$ErrorActionPreference = 'Stop'
$parche = Join-Path $PSScriptRoot 'freno.patch'
New-Item -ItemType Directory -Force $Trabajo | Out-Null
Set-Location $Trabajo

function Bajar($url, $carpeta, $raiz) {
  if (Test-Path $carpeta) { Remove-Item -Recurse -Force $carpeta }
  Invoke-WebRequest $url -OutFile "$carpeta.tar.gz"
  tar xzf "$carpeta.tar.gz"
  Rename-Item $raiz $carpeta
  Remove-Item "$carpeta.tar.gz"
}
# Versiones fijas: el parche está hecho sobre estas.
Bajar 'https://codeload.github.com/fiso64/sockseek/tar.gz/refs/tags/v3.0.6' 'sockseek' 'sockseek-3.0.6'
Bajar 'https://codeload.github.com/jpdillingham/Soulseek.NET/tar.gz/refs/tags/10.0.2' 'Soulseek.NET' 'Soulseek.NET-10.0.2'

git apply --ignore-whitespace --whitespace=nowarn $parche
if ($LASTEXITCODE -ne 0) { throw 'No se pudo aplicar freno.patch' }

$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'; $env:DOTNET_NOLOGO = '1'
dotnet restore sockseek/Sockseek.HelpGenerator/Sockseek.HelpGenerator.csproj
dotnet publish sockseek/Sockseek.Cli/Sockseek.Cli.csproj -c Release -f net10.0 -r win-x64 -o publicado `
  -p:VersionSuffix=napia.2 -p:PublishSingleFile=true -p:PublishTrimmed=false -p:DebugType=embedded `
  -p:IncludeSymbolsInSingleFile=false -p:OpenApiGenerateDocuments=false --self-contained=true
if ($LASTEXITCODE -ne 0) { throw 'No se pudo armar sockseek' }
& (Join-Path $Trabajo 'publicado\sockseek.exe') --version
