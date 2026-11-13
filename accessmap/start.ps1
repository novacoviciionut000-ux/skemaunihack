# AccessMap - porneste tot proiectul: GraphHopper (Docker) + backend (Spring Boot) + frontend (Vite)
# Utilizare (din folderul accessmap):
#   .\start.ps1            porneste tot
#   .\start.ps1 -Stop      opreste GraphHopper si inchide ferestrele backend/frontend
#   .\start.ps1 -NoWait    nu mai asteapta ca GraphHopper sa fie gata
param(
    [switch]$Stop,
    [switch]$NoWait
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
function Fail($msg) { Write-Host "XX  $msg" -ForegroundColor Red; exit 1 }

function Wait-Port($port, $name, $timeoutSec) {
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Test-NetConnection localhost -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue) {
            Info "$name raspunde pe portul $port"
            return $true
        }
        Start-Sleep -Seconds 5
    }
    Write-Host "!!  $name nu raspunde inca pe portul $port (continui oricum)" -ForegroundColor Yellow
    return $false
}

# ---------- Stop ----------
if ($Stop) {
    Info 'Opresc GraphHopper...'
    Push-Location $root; docker compose stop graphhopper; Pop-Location
    Get-Process powershell, pwsh -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowTitle -like 'AccessMap*' } |
        Stop-Process -Force
    Info 'Oprit.'
    exit 0
}

# ---------- Verificari ----------
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail 'Docker nu e instalat / nu e in PATH.' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue))    { Fail 'Node.js/npm nu e instalat / nu e in PATH.' }
if (-not (Test-Path $mvnw) -and -not (Get-Command mvn -ErrorAction SilentlyContinue)) {
    Fail "Nu gasesc Maven wrapper-ul ($mvnw) si nici comanda 'mvn' nu e in PATH."
}

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
            "$env:LOCALAPPDATA\Programs\Eclipse Adoptium\*"
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
    Info "JAVA_HOME = $env:JAVA_HOME"
}

docker info *> $null
if ($LASTEXITCODE -ne 0) { Fail 'Docker nu ruleaza. Porneste Docker Desktop si incearca din nou.' }

# ---------- 1. GraphHopper ----------
Info 'Pornesc GraphHopper (prima data: descarca harta + construieste graful, ~10-20 min)...'
Push-Location $root
docker compose up -d graphhopper
Pop-Location
if (-not $NoWait) { Wait-Port 8989 'GraphHopper' 1800 | Out-Null }

# ---------- 2. Backend ----------
Info 'Pornesc backend-ul (Spring Boot, :8080) intr-o fereastra noua...'
$backendCmd = "`$host.UI.RawUI.WindowTitle='AccessMap backend'; `$env:JAVA_HOME='$env:JAVA_HOME'; Set-Location '$backendDir'; & '$mvnw' -f pom.xml spring-boot:run"
Start-Process powershell -ArgumentList '-NoExit', '-Command', $backendCmd

# ---------- 3. Frontend ----------
if (-not (Test-Path (Join-Path $frontendDir 'node_modules'))) {
    Info 'Instalez dependintele frontend (npm install)...'
    Push-Location $frontendDir; npm install; Pop-Location
}
Info 'Pornesc frontend-ul (Vite, :3000) intr-o fereastra noua...'
$frontendCmd = "`$host.UI.RawUI.WindowTitle='AccessMap frontend'; Set-Location '$frontendDir'; npm run dev"
Start-Process powershell -ArgumentList '-NoExit', '-Command', $frontendCmd

# ---------- 4. Browser ----------
if (Wait-Port 8080 'Backend' 180) { }
Wait-Port 3000 'Frontend' 60 | Out-Null
Start-Process 'http://localhost:3000'

Info 'Gata! Frontend: http://localhost:3000 | Backend: http://localhost:8080 | GraphHopper: http://localhost:8989'
Info 'Pentru oprire: .\start.ps1 -Stop'
