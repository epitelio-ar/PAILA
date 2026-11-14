#!/usr/bin/env bash
# Arma "sockseek con freno" para Mac (lo mismo que armar.ps1 en Windows: sockseek 3.0.6 + Soulseek.NET 10.0.2 + freno.patch),
# para Apple Silicon (osx-arm64) o Intel (osx-x64). Lo usa el armado para Mac en GitHub (.github/workflows/mac.yml).
# Uso: bash armar.sh <osx-arm64|osx-x64> <carpeta de salida> [carpeta de trabajo]
# Necesita el SDK de .NET 10 y git. Deja <salida>/sockseek (versión 3.0.6-napia.2, no necesita instalar .NET; comprimido por
# dentro, porque el .dmg no lo comprime tanto como el instalador de Windows). Ver LEEME.md.
set -euo pipefail
rid="${1:?Falta el procesador: osx-arm64 u osx-x64}"
salida="$(mkdir -p "${2:?Falta la carpeta de salida}" && cd "$2" && pwd)"
trabajo="${3:-$HOME/sockseek-freno-$rid}"
parche="$(cd "$(dirname "$0")" && pwd)/freno.patch"
mkdir -p "$trabajo"
cd "$trabajo"

bajar() { # url carpeta raíz
  rm -rf "$2"
  curl -fsSL "$1" -o "$2.tar.gz"
  tar xzf "$2.tar.gz"
  mv "$3" "$2"
  rm "$2.tar.gz"
}
# Versiones fijas: el parche está hecho sobre estas.
bajar 'https://codeload.github.com/fiso64/sockseek/tar.gz/refs/tags/v3.0.6' sockseek sockseek-3.0.6
bajar 'https://codeload.github.com/jpdillingham/Soulseek.NET/tar.gz/refs/tags/10.0.2' Soulseek.NET Soulseek.NET-10.0.2

git apply --ignore-whitespace --whitespace=nowarn "$parche"

export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
dotnet restore sockseek/Sockseek.HelpGenerator/Sockseek.HelpGenerator.csproj
dotnet publish sockseek/Sockseek.Cli/Sockseek.Cli.csproj -c Release -f net10.0 -r "$rid" -o publicado \
  -p:VersionSuffix=napia.2 -p:PublishSingleFile=true -p:PublishTrimmed=false -p:DebugType=embedded \
  -p:IncludeSymbolsInSingleFile=false -p:OpenApiGenerateDocuments=false -p:EnableCompressionInSingleFile=true --self-contained=true
cp publicado/sockseek "$salida/sockseek"
chmod +x "$salida/sockseek"
echo "Listo: $salida/sockseek"
