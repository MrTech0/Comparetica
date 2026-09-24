#requires -Version 5.1

<#
.SYNOPSIS
    Comparetica - Instalación y configuración automatizada del entorno de desarrollo en Windows.

.DESCRIPTION
    Este script prepara una máquina Windows desde cero para el desarrollo de Comparetica (Tauri v2 + Rust + Node.js):
      - Eleva privilegios automáticamente conservando el directorio de trabajo actual.
      - Comprueba la disponibilidad de Windows Package Manager (winget).
      - Instala o asegura Git, Node.js LTS, pnpm y Microsoft Edge WebView2 Runtime mediante winget.
      - Comprueba e instala Visual Studio Build Tools con soporte de C++ (MSVC / NativeDesktop).
      - Instala y configura Rustup con la toolchain stable-x86_64-pc-windows-msvc de forma desatendida.
      - Refresca el PATH en memoria expandiendo variables de entorno (%USERPROFILE%).
      - Configura las dependencias del proyecto (pnpm install) y los hooks de Git (.githooks).
      - Muestra el diagnóstico de herramientas instaladas e instrucciones para arrancar en modo DEV.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
#>

[CmdletBinding()]
param(
    [switch]$SkipRepoInstall,
    [switch]$NonInteractive
)

$ErrorActionPreference = "Stop"

# --------------------------------------------------
# Funciones auxiliares de formato y salida
# --------------------------------------------------

function Write-Step {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host ""
    Write-Host "==================================================" -ForegroundColor Cyan
    Write-Host " $Message" -ForegroundColor Cyan
    Write-Host "==================================================" -ForegroundColor Cyan
}

function Write-Info {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Gray
}

function Write-Success {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Warn {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host "[AVISO] $Message" -ForegroundColor Yellow
}

function Write-Err {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Test-Command {
    param([Parameter(Mandatory = $true)][string]$Command)
    return $null -ne (Get-Command $Command -ErrorAction SilentlyContinue)
}

function Refresh-Path {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $combined = [Environment]::ExpandEnvironmentVariables("$machinePath;$userPath")

    # Asegurar rutas comunes de herramientas de desarrollo
    $extraPaths = @(
        "$env:USERPROFILE\.cargo\bin",
        "$env:LOCALAPPDATA\pnpm",
        "$env:APPDATA\npm",
        "$env:ProgramFiles\Git\cmd",
        "$env:ProgramFiles\nodejs"
    )

    $currentList = $combined -split ';' | Where-Object { [string]::IsNullOrWhiteSpace($_) -eq $false }
    foreach ($extra in $extraPaths) {
        if ((Test-Path $extra) -and ($currentList -notcontains $extra)) {
            $combined += ";$extra"
        }
    }

    $env:Path = $combined
}

function Install-WithWinget {
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][string]$Name,
        [string]$CommandCheck = "",
        [string]$Override = ""
    )

    # 1. Comprobación rápida en PATH para evitar esperas innecesarias
    if ($CommandCheck -and (Test-Command $CommandCheck)) {
        Write-Success "$Name ya está disponible en PATH ($CommandCheck)."
        return
    }

    Write-Host "Comprobando $Name mediante winget..." -ForegroundColor Yellow

    $installed = winget list --id $Id --accept-source-agreements 2>$null
    if ($LASTEXITCODE -eq 0 -and ($installed -join "`n") -match [regex]::Escape($Id)) {
        Write-Success "$Name ya está instalado según winget."
        return
    }

    # WebView2 Runtime en Windows también puede estar provisto y registrado bajo Microsoft.Edge
    if ($Id -eq "Microsoft.EdgeWebView2Runtime") {
        $edgeInstalled = winget list --id "Microsoft.Edge" --accept-source-agreements 2>$null
        if ($LASTEXITCODE -eq 0 -and ($edgeInstalled -join "`n") -match "Microsoft\.Edge") {
            Write-Success "$Name ya está disponible a través de Microsoft Edge según winget."
            return
        }
    }

    Write-Host "Instalando $Name mediante winget..." -ForegroundColor Yellow

    $wingetArgs = @(
        "install",
        "--id", $Id,
        "--exact",
        "--source", "winget",
        "--accept-source-agreements",
        "--accept-package-agreements",
        "--disable-interactivity"
    )

    if ($Override) {
        $wingetArgs += @("--override", $Override)
    }

    & winget @wingetArgs

    if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335189) {
        throw "No se pudo instalar $Name mediante winget (Código de salida: $LASTEXITCODE)."
    }

    Write-Success "$Name instalado correctamente."
}

function Test-VsCppInstalled {
    $vswherePath = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vswherePath) {
        $vcInstall = & $vswherePath -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
        if ($vcInstall -and (Test-Path $vcInstall)) {
            return $true
        }
    }

    if (Test-Command "cl.exe") {
        return $true
    }

    return $false
}

function Get-VsDisplayName {
    $vswherePath = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vswherePath) {
        $name = & $vswherePath -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property displayName 2>$null | Select-Object -First 1
        if ($name) { return $name }
        $anyName = & $vswherePath -products * -property displayName 2>$null | Select-Object -First 1
        if ($anyName) { return $anyName }
    }
    return "Visual Studio"
}

# --------------------------------------------------
# 1. Comprobación y auto-elevación de privilegios
# --------------------------------------------------

Write-Step "Comprobando permisos de Administrador"

$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Warn "Se requieren privilegios de administrador para instalar paquetes del sistema."
    Write-Warn "Relanzando el script con elevación (UAC) conservando la carpeta actual..."

    $currentDir = (Get-Location).Path
    $arguments = "-ExecutionPolicy Bypass -NoProfile -File `"$PSCommandPath`""
    if ($SkipRepoInstall) { $arguments += " -SkipRepoInstall" }
    if ($NonInteractive) { $arguments += " -NonInteractive" }

    Start-Process `
        -FilePath "powershell.exe" `
        -ArgumentList $arguments `
        -WorkingDirectory $currentDir `
        -Verb RunAs

    exit
}

Write-Success "Ejecutando con privilegios de Administrador."

# --------------------------------------------------
# 2. Comprobación de winget
# --------------------------------------------------

Write-Step "Comprobando Windows Package Manager (winget)"

if (-not (Test-Command "winget")) {
    throw @"
winget no está disponible en este equipo.

Por favor, instala o actualiza 'App Installer' desde Microsoft Store:
  https://aka.ms/getwinget
y vuelve a ejecutar este script.
"@
}

Write-Success "winget está disponible y listo para su uso."

# --------------------------------------------------
# 3. Herramientas base: Git, Node.js LTS, pnpm
# --------------------------------------------------

Write-Step "Herramientas de Control de Versiones y JavaScript"

Install-WithWinget `
    -Id "Git.Git" `
    -Name "Git" `
    -CommandCheck "git"

Install-WithWinget `
    -Id "OpenJS.NodeJS.LTS" `
    -Name "Node.js LTS" `
    -CommandCheck "node"

Refresh-Path

Install-WithWinget `
    -Id "pnpm.pnpm" `
    -Name "pnpm" `
    -CommandCheck "pnpm"

Refresh-Path

# --------------------------------------------------
# 4. Microsoft Edge WebView2 Runtime
# --------------------------------------------------

Write-Step "Microsoft Edge WebView2 Runtime (Motor UI de Tauri)"

Install-WithWinget `
    -Id "Microsoft.EdgeWebView2Runtime" `
    -Name "Microsoft Edge WebView2 Runtime"

# --------------------------------------------------
# 5. Visual Studio Build Tools + C++ (MSVC)
# --------------------------------------------------

Write-Step "Visual Studio Build Tools + C++ (MSVC)"

if (Test-VsCppInstalled) {
    $vsName = Get-VsDisplayName
    Write-Success "$vsName con herramientas de compilación C++ (MSVC) ya está disponible."
}
else {
    Write-Host "Instalando Visual Studio Build Tools con soporte C++ (Workload NativeDesktop)..." -ForegroundColor Yellow
    Write-Info "Esta descarga de Microsoft puede tardar unos minutos en completarse."

    $vsBuildToolsId = "Microsoft.VisualStudio.BuildTools"
    $overrideArgs = "--wait --passive --add Microsoft.VisualStudio.Workload.NativeDesktop --includeRecommended"

    winget install `
        --id $vsBuildToolsId `
        --exact `
        --source winget `
        --accept-source-agreements `
        --accept-package-agreements `
        --override $overrideArgs

    if ($LASTEXITCODE -ne 0) {
        throw "No se pudo instalar/configurar Visual Studio Build Tools (Código de salida: $LASTEXITCODE)."
    }

    Write-Success "Visual Studio Build Tools con C++ configurado correctamente."
}

# --------------------------------------------------
# 6. Rustup + Toolchain MSVC
# --------------------------------------------------

Write-Step "Rust (Rustup y toolchain stable-msvc)"

if (Test-Command "rustup") {
    Write-Success "rustup ya está instalado."
}
else {
    Write-Host "Instalando Rustup mediante winget de forma desatendida..." -ForegroundColor Yellow
    Install-WithWinget `
        -Id "Rustlang.Rustup" `
        -Name "Rustup" `
        -Override "-y --default-toolchain stable-msvc"

    Refresh-Path
}

if (-not (Test-Command "rustup")) {
    $cargoBin = "$env:USERPROFILE\.cargo\bin"
    if (Test-Path "$cargoBin\rustup.exe") {
        $env:Path = "$cargoBin;$env:Path"
    }
}

if (-not (Test-Command "rustup")) {
    throw @"
rustup se instaló pero no se encuentra en el PATH de la sesión actual.
Por favor, abre una nueva ventana de PowerShell y vuelve a ejecutar:
  .\scripts\setup-windows.ps1
"@
}

Write-Host "Asegurando toolchain stable-msvc por defecto..." -ForegroundColor Yellow
& rustup default stable-msvc

if ($LASTEXITCODE -ne 0) {
    throw "No se pudo configurar la toolchain stable-msvc en rustup."
}

Write-Success "Toolchain stable-msvc configurada correctamente."

Refresh-Path

# --------------------------------------------------
# 7. Inicialización del repositorio Comparetica
# --------------------------------------------------

Write-Step "Inicialización del repositorio Comparetica"

$repoRoot = $PSScriptRoot
if (Test-Path "$repoRoot\..\package.json") {
    $repoRoot = (Resolve-Path "$repoRoot\..").Path
}

$isComparetica = (Test-Path "$repoRoot\package.json") -and `
    ((Get-Content "$repoRoot\package.json" -Raw -ErrorAction SilentlyContinue) -match '"name":\s*"comparetica"')

if ($isComparetica -and -not $SkipRepoInstall) {
    Write-Info "Repositorio Comparetica detectado en: $repoRoot"

    Push-Location $repoRoot
    try {
        if (Test-Command "pnpm") {
            Write-Host "Instalando dependencias npm con pnpm..." -ForegroundColor Yellow
            & pnpm install
            if ($LASTEXITCODE -eq 0) {
                Write-Success "Dependencias de Node.js instaladas correctamente."
            } else {
                Write-Warn "pnpm install finalizó con código: $LASTEXITCODE."
            }

            Write-Host "Configurando Git hooks locales (.githooks)..." -ForegroundColor Yellow
            & git config core.hooksPath .githooks
            Write-Success "Git hooks (.githooks) configurados."
        }
        else {
            Write-Warn "pnpm no estuvo disponible para instalar dependencias del repositorio."
        }
    }
    finally {
        Pop-Location
    }
}
else {
    Write-Info "Omitiendo instalación de dependencias del repositorio."
}

# --------------------------------------------------
# 8. Diagnóstico del entorno
# --------------------------------------------------

Write-Step "Diagnóstico y comprobación del entorno"

Write-Host ""
Write-Host "Git:" -ForegroundColor Yellow
if (Test-Command "git") { & git --version } else { Write-Err "Git no encontrado." }

Write-Host ""
Write-Host "Node.js:" -ForegroundColor Yellow
if (Test-Command "node") { & node --version } else { Write-Err "Node.js no encontrado." }

Write-Host ""
Write-Host "pnpm:" -ForegroundColor Yellow
if (Test-Command "pnpm") { & pnpm --version } else { Write-Err "pnpm no encontrado." }

Write-Host ""
Write-Host "Rust (rustc):" -ForegroundColor Yellow
if (Test-Command "rustc") { 
    & rustc --version
    & rustc -vV | Select-String "host:"
} else { 
    Write-Err "rustc no encontrado." 
}

Write-Host ""
Write-Host "Cargo:" -ForegroundColor Yellow
if (Test-Command "cargo") { & cargo --version } else { Write-Err "cargo no encontrado." }

Write-Host ""
Write-Host "Compilador C++ MSVC (cl.exe):" -ForegroundColor Yellow
$cl = Get-Command "cl.exe" -ErrorAction SilentlyContinue
if ($cl) {
    Write-Success $cl.Source
} else {
    Write-Info "cl.exe no está en el PATH de la sesión estándar (comportamiento normal en Windows)."
    Write-Info "Tauri y Cargo localizan MSVC automáticamente mediante vswhere y el registro."
}

Write-Host ""
Write-Host "Enlazador MSVC (link.exe):" -ForegroundColor Yellow
$link = Get-Command "link.exe" -ErrorAction SilentlyContinue
if ($link) {
    Write-Success $link.Source
} else {
    Write-Info "link.exe no está en el PATH de la sesión estándar (comportamiento normal en Windows)."
}

# --------------------------------------------------
# 9. Instrucciones finales
# --------------------------------------------------

$vsDisplayName = Get-VsDisplayName

Write-Step "¡Configuración del entorno completada!"

Write-Host @"

El entorno de desarrollo para Comparetica está listo para programar.

COMANDOS PARA DESARROLLO EN COMPARETICA:
  Desde la carpeta del proyecto puedes ejecutar:

    pnpm run tauri dev     -> Inicia la aplicación en modo desarrollo (Hot-Reload)
    pnpm test              -> Ejecuta la suite de pruebas unitarias

NOTA PARA VISUAL STUDIO:
  Si necesitas trabajar directamente con las herramientas de línea de comandos de C++,
  puedes abrir desde el menú Inicio:
    'Developer PowerShell for $vsDisplayName'

"@ -ForegroundColor Green
