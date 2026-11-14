# AccessMap - porneste tot proiectul: GraphHopper (Docker) + backend (Spring Boot) + frontend (Vite)
# Utilizare (din folderul radacina sau accessmap):
#   .\start.bat            porneste tot
#   .\start.bat -NoDocker  porneste backend + frontend fara sa ceara Docker
#   .\start.bat -Stop      opreste serviciile
param(
    [switch]$Stop,
    [switch]$NoWait,
    [switch]$NoDocker
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$backendDir = Join-Path $root 'backend'
$frontendDir = Join-Path $root 'frontend'

$mvnw = Join-Path $backendDir 'mvnw.cmd'
if (-not (Test-Path $mvnw)) {
    $mvnw = Join-Path $root '..\backend\mvnw.cmd'
}

function Info($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Warn($msg) { Write-Host "!!  $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "XX  $msg" -ForegroundColor Red; exit 1 }

function Wait-Port($port, $name, $timeoutSec) {
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Test-NetConnection localhost -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue) {
            Info "$name raspunde pe portul $port"
            return $true
        }
        Start-Sleep -Seconds 3
    }
    Warn "$name nu raspunde inca pe portul $port (continui oricum)"
    return $false
}

# ---------- Stop ----------
if ($Stop) {
    Info 'Opresc GraphHopper...'
    Push-Location $root
    try { docker compose stop graphhopper } catch {}
    Pop-Location
    Get-Process powershell, pwsh -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowTitle -like 'AccessMap*' } |
        Stop-Process -Force
    Info 'Toate procesele au fost oprite.'
    exit 0
}

# ---------- Verificari de baza ----------
if (-not (Get-Command npm -ErrorAction SilentlyContinue) -and -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    Fail 'Node.js / npm nu este instalat sau nu se afla in PATH.'
}

if (-not (Test-Path $mvnw) -and -not (Get-Command mvn -ErrorAction SilentlyContinue)) {
    Fail "Nu gasesc Maven wrapper-ul ($mvnw) si nici comanda 'mvn' nu e in PATH."
}

# Detectare automata JAVA_HOME
if (-not $env:JAVA_HOME) {
    if (Get-Command java -ErrorAction SilentlyContinue) {
        try {
            $javaCmd = (Get-Command java).Source
            $javaDir = Split-Path (Split-Path $javaCmd -Parent) -Parent
            if (Test-Path (Join-Path $javaDir "bin\java.exe")) {
                $env:JAVA_HOME = $javaDir
            }
        } catch {}
    }
    if (-not $env:JAVA_HOME) {
        $candidatePaths = @(
            "$HOME\.jdks\*",
            "$env:ProgramFiles\Java\*",
            "$env:ProgramFiles\Eclipse Adoptium\*",
            "${env:ProgramFiles(x86)}\Java\*",
            "$env:LOCALAPPDATA\Programs\Eclipse Adoptium\*",
            "D:\App\PyCharm*\jbr",
            "D:\App\CLion*\jbr",
            "$env:SystemDrive\App\PyCharm*\jbr",
            "$env:SystemDrive\App\CLion*\jbr"
        )
        $jdk = Get-ChildItem $candidatePaths -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name | Select-Object -Last 1
        if ($jdk) { $env:JAVA_HOME = $jdk.FullName }
    }
    if (-not $env:JAVA_HOME) {
        if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
            Fail 'JAVA_HOME nu e setat si comanda java nu a fost gasita.'
        }
    }
}
if ($env:JAVA_HOME) {
    Info "JAVA_HOME detectat = $env:JAVA_HOME"
}

# ---------- 1. GraphHopper (Optional daca Docker nu este pornit) ----------
$hasDocker = $false
if (-not $NoDocker -and (Get-Command docker -ErrorAction SilentlyContinue)) {
    try {
        docker info *> $null
        if ($LASTEXITCODE -eq 0) {
            $hasDocker = $true
        }
    } catch {}
}

if ($hasDocker) {
    Info 'Pornesc GraphHopper (Docker)...'
    Push-Location $root
    try {
        docker compose up -d graphhopper
    } catch {
        Warn 'GraphHopper nu a putut fi pornit prin Docker. Continui cu backend si frontend.'
    }
    Pop-Location
    if (-not $NoWait -and $hasDocker) {
        Wait-Port 8989 'GraphHopper' 30 | Out-Null
    }
} else {
    Warn 'Docker Desktop nu ruleaza sau nu a fost gasit. Sarim peste GraphHopper!'
    Warn 'Autentificarea, baza de date Supabase si interfata web vor functiona normal.'
}

# ---------- 2. Backend (Spring Boot :8080) ----------
Info 'Pornesc backend-ul (Spring Boot pe portul 8080) intr-o fereastra dedicata...'
$backendCmd = "`$host.UI.RawUI.WindowTitle='AccessMap Backend (:8080)'; `$env:JAVA_HOME='$env:JAVA_HOME'; Set-Location '$backendDir'; & '$mvnw' -f pom.xml spring-boot:run"
Start-Process powershell -ArgumentList '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $backendCmd

# ---------- 3. Frontend (Vite :3000) ----------
if (-not (Test-Path (Join-Path $frontendDir 'node_modules'))) {
    Info 'Instalez dependintele frontend (npm install)...'
    Push-Location $frontendDir; cmd /c npm install; Pop-Location
}

# Verificare si reparare automata esbuild pentru Windows
$winEsbuild = Join-Path $frontendDir 'node_modules\@esbuild\win32-x64\esbuild.exe'
if (-not (Test-Path $winEsbuild)) {
    Warn 'Lipseste binarul esbuild pentru Windows. Il configurez automat...'
    Push-Location $frontendDir
    try { cmd /c npm rebuild esbuild } catch {}
    if (-not (Test-Path $winEsbuild)) {
        try { cmd /c npm install --save-optional @esbuild/win32-x64@0.18.20 } catch {}
    }
    Pop-Location
}

Info 'Pornesc frontend-ul (Vite pe portul 3000) intr-o fereastra dedicata...'
$frontendCmd = "`$host.UI.RawUI.WindowTitle='AccessMap Frontend (:3000)'; Set-Location '$frontendDir'; cmd /c npm run dev"
Start-Process powershell -ArgumentList '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $frontendCmd

# ---------- 4. Asteptare si deschidere Browser ----------
Info 'Astept pornirea serviciilor...'
$backendReady = Wait-Port 8080 'Backend' 60
$frontendReady = Wait-Port 3000 'Frontend' 30

Start-Process 'http://localhost:3000'

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "   AccessMap este gata de utilizare!" -ForegroundColor Green
Write-Host "   - Frontend UI:  http://localhost:3000" -ForegroundColor Cyan
Write-Host "   - Backend API:  http://localhost:8080" -ForegroundColor Cyan
if ($hasDocker) {
    Write-Host "   - GraphHopper:  http://localhost:8989" -ForegroundColor Cyan
}
Write-Host "   Pentru oprire: .\start.bat -Stop" -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Green
Write-Host ""
