#!/usr/bin/env bash
set -e

# ==============================================================================
# AccessMap - Linux Startup Script
# Starts: GraphHopper (Docker) + Backend (Spring Boot) + Frontend (Vite)
#
# Usage:
#   ./start.sh            Start everything
#   ./start.sh --stop     Stop all running services
#   ./start.sh --status   Check status of services and ports
#   ./start.sh --logs     Follow backend & frontend logs
#   ./start.sh --no-wait  Do not wait for GraphHopper to finish downloading/indexing
#   ./start.sh --no-docker Skip GraphHopper/Docker (backend + frontend only)
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
RUN_DIR="$SCRIPT_DIR/.run"
LOG_DIR="$SCRIPT_DIR/logs"

mkdir -p "$RUN_DIR" "$LOG_DIR"

info() { echo -e "\033[1;36m==>\033[0m \033[1m$*\033[0m"; }
warn() { echo -e "\033[1;33m!! \033[0m $*"; }
fail() { echo -e "\033[1;31mXX \033[0m $*"; exit 1; }
ok()   { echo -e "\033[1;32mOK \033[0m $*"; }

check_port() {
    local port="$1"
    (timeout 1 bash -c "cat < /dev/null > /dev/tcp/127.0.0.1/$port") 2>/dev/null && return 0
    if command -v nc >/dev/null 2>&1; then
        nc -z 127.0.0.1 "$port" 2>/dev/null && return 0
    fi
    if command -v curl >/dev/null 2>&1; then
        curl -s -o /dev/null -m 1 "http://127.0.0.1:$port" 2>/dev/null && return 0
    fi
    return 1
}

wait_port() {
    local port="$1"
    local name="$2"
    local timeout_sec="$3"
    local start_time
    start_time=$(date +%s)

    info "Waiting for $name to be ready on port $port (timeout: ${timeout_sec}s)..."
    while true; do
        if check_port "$port"; then
            ok "$name is responding on port $port"
            return 0
        fi
        local now
        now=$(date +%s)
        local elapsed=$((now - start_time))
        if [ "$elapsed" -ge "$timeout_sec" ]; then
            warn "$name did not respond within ${timeout_sec}s on port $port (continuing anyway)"
            return 1
        fi
        sleep 3
    done
}

get_docker_compose() {
    if docker compose version >/dev/null 2>&1; then
        echo "docker compose"
    elif command -v docker-compose >/dev/null 2>&1; then
        echo "docker-compose"
    else
        echo ""
    fi
}

# ----------------- Stop Command -----------------
stop_services() {
    info "Stopping AccessMap services..."

    # 1. Frontend
    if [ -f "$RUN_DIR/frontend.pid" ]; then
        local fpid
        fpid=$(cat "$RUN_DIR/frontend.pid" 2>/dev/null || true)
        if [ -n "$fpid" ] && kill -0 "$fpid" 2>/dev/null; then
            info "Stopping frontend process (PID $fpid)..."
            kill "$fpid" 2>/dev/null || true
        fi
        rm -f "$RUN_DIR/frontend.pid"
    fi
    pkill -f "vite.*3000" 2>/dev/null || true

    # 2. Backend
    if [ -f "$RUN_DIR/backend.pid" ]; then
        local bpid
        bpid=$(cat "$RUN_DIR/backend.pid" 2>/dev/null || true)
        if [ -n "$bpid" ] && kill -0 "$bpid" 2>/dev/null; then
            info "Stopping backend process (PID $bpid)..."
            kill "$bpid" 2>/dev/null || true
        fi
        rm -f "$RUN_DIR/backend.pid"
    fi
    pkill -f "spring-boot:run" 2>/dev/null || true
    pkill -f "com.accessmap.AccessMapApplication" 2>/dev/null || true

    # 3. GraphHopper / Docker
    local dc
    dc=$(get_docker_compose)
    if [ -n "$dc" ]; then
        info "Stopping GraphHopper container..."
        (cd "$SCRIPT_DIR" && $dc stop graphhopper 2>/dev/null) || true
    fi

    ok "All AccessMap services stopped."
    exit 0
}

# ----------------- Status Command -----------------
status_services() {
    info "AccessMap Status Check:"
    echo "=================================================="

    local dc
    dc=$(get_docker_compose)
    if [ -n "$dc" ] && docker info >/dev/null 2>&1; then
        echo "Docker containers:"
        (cd "$SCRIPT_DIR" && $dc ps)
    else
        echo "Docker: Not running or docker compose not found."
    fi
    echo ""

    if check_port 8989; then
        ok "GraphHopper : http://localhost:8989 (RUNNING)"
    else
        warn "GraphHopper : http://localhost:8989 (NOT RESPONDING)"
    fi

    if check_port 8080; then
        ok "Backend     : http://localhost:8080 (RUNNING)"
    else
        warn "Backend     : http://localhost:8080 (NOT RESPONDING)"
    fi

    if check_port 3000; then
        ok "Frontend    : http://localhost:3000 (RUNNING)"
    else
        warn "Frontend    : http://localhost:3000 (NOT RESPONDING)"
    fi
    echo "=================================================="
    exit 0
}

# ----------------- Logs Command -----------------
follow_logs() {
    info "Following backend and frontend logs (Ctrl+C to exit)..."
    touch "$LOG_DIR/backend.log" "$LOG_DIR/frontend.log"
    tail -f -n 30 "$LOG_DIR/backend.log" "$LOG_DIR/frontend.log"
}

# Parse CLI arguments
STOP=0
NOWAIT=0
NODOCKER=0

for arg in "$@"; do
    case "$arg" in
        --stop|-Stop|-stop|stop)
            STOP=1
            ;;
        --status|-Status|-status|status)
            status_services
            ;;
        --logs|-Logs|-logs|logs)
            follow_logs
            ;;
        --no-wait|-NoWait|--nowait)
            NOWAIT=1
            ;;
        --no-docker|-NoDocker|--nodocker)
            NODOCKER=1
            ;;
        --help|-h)
            echo "Usage: ./start.sh [--stop] [--status] [--logs] [--no-wait] [--no-docker]"
            exit 0
            ;;
        *)
            warn "Unknown parameter: $arg"
            ;;
    esac
done

if [ "$STOP" -eq 1 ]; then
    stop_services
fi

# ==============================================================================
# Pre-flight Checks
# ==============================================================================
info "Checking environment and dependencies..."

# 1. Java check
if [ -z "$JAVA_HOME" ]; then
    if command -v java >/dev/null 2>&1; then
        JAVA_BIN="$(readlink -f "$(command -v java)")"
        export JAVA_HOME="$(dirname "$(dirname "$JAVA_BIN")")"
    else
        for cand in /usr/lib/jvm/java-21* /usr/lib/jvm/java-17* /usr/lib/jvm/*; do
            if [ -d "$cand" ] && [ -x "$cand/bin/java" ]; then
                export JAVA_HOME="$cand"
                break
            fi
        done
    fi
fi

if [ -z "$JAVA_HOME" ] || [ ! -x "$JAVA_HOME/bin/java" ]; then
    fail "Java not found! Please install OpenJDK 17 or 21 (e.g. sudo apt install openjdk-17-jdk) and set JAVA_HOME."
fi
info "JAVA_HOME = $JAVA_HOME ($("$JAVA_HOME/bin/java" -version 2>&1 | head -n 1))"

# 2. Node & npm check
if ! command -v npm >/dev/null 2>&1; then
    fail "Node.js / npm not found! Please install Node.js 18+ (https://nodejs.org)."
fi
info "Node.js = $(node -v), npm = $(npm -v)"

# 3. Maven wrapper check
MVNW=""
if [ -f "$BACKEND_DIR/mvnw" ]; then
    MVNW="$BACKEND_DIR/mvnw"
elif [ -f "$ROOT_DIR/backend/mvnw" ]; then
    MVNW="$ROOT_DIR/backend/mvnw"
elif command -v mvn >/dev/null 2>&1; then
    MVNW="mvn"
else
    fail "Maven wrapper not found in $BACKEND_DIR or $ROOT_DIR/backend, and 'mvn' is not installed."
fi

if [ "$MVNW" != "mvn" ]; then
    chmod +x "$MVNW"
fi
info "Maven runner = $MVNW"

# 4. Frontend verification (fix cross-platform esbuild and symlinks if needed)
if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    info "Installing frontend dependencies (npm install)..."
    (cd "$FRONTEND_DIR" && npm install)
fi

# Ensure Linux esbuild binary exists (in case repository committed Windows esbuild.exe)
if [ ! -f "$FRONTEND_DIR/node_modules/@esbuild/linux-x64/bin/esbuild" ]; then
    warn "Missing @esbuild/linux-x64 binary (Windows node_modules detected). Fixing esbuild for Linux..."
    (cd "$FRONTEND_DIR" && npm rebuild esbuild 2>/dev/null || npm install --prefer-offline 2>/dev/null || true)
fi

# Ensure vite executable permission
if [ -f "$FRONTEND_DIR/node_modules/.bin/vite" ]; then
    chmod +x "$FRONTEND_DIR/node_modules/.bin/vite" 2>/dev/null || true
fi

# 5. Docker check
DC=$(get_docker_compose)
DOCKER_READY=0
if [ "$NODOCKER" -eq 1 ]; then
    info "Skipping Docker as requested (--no-docker)."
elif [ -z "$DC" ]; then
    warn "Neither 'docker compose' nor 'docker-compose' found. GraphHopper will be skipped."
else
    if docker info >/dev/null 2>&1; then
        DOCKER_READY=1
    else
        warn "Docker daemon is not running. Start Docker ('sudo systemctl start docker') to run GraphHopper."
        warn "Continuing without GraphHopper..."
    fi
fi

# ==============================================================================
# 1. Start GraphHopper (Docker)
# ==============================================================================
if [ "$DOCKER_READY" -eq 1 ]; then
    info "Starting GraphHopper (port :8989)..."
    info "(Note: first run downloads Romania map + builds graph cache, which can take 10-20 min)"
    (cd "$SCRIPT_DIR" && $DC up -d graphhopper)

    if [ "$NOWAIT" -ne 1 ]; then
        wait_port 8989 "GraphHopper" 1800 || true
    fi
fi

# ==============================================================================
# 2. Start Backend (Spring Boot)
# ==============================================================================
if check_port 8080; then
    warn "Port 8080 is already in use. Assuming backend is already running."
else
    info "Starting backend (Spring Boot, port :8080)..."
    info "Logs will be written to: $LOG_DIR/backend.log"
    cd "$BACKEND_DIR"
    export JAVA_HOME="$JAVA_HOME"
    nohup setsid "$MVNW" spring-boot:run > "$LOG_DIR/backend.log" 2>&1 < /dev/null &
    BACKEND_PID=$!
    disown "$BACKEND_PID" 2>/dev/null || true
    echo "$BACKEND_PID" > "$RUN_DIR/backend.pid"
    cd "$SCRIPT_DIR"

    wait_port 8080 "Backend" 120 || true
fi

# ==============================================================================
# 3. Start Frontend (Vite)
# ==============================================================================
if check_port 3000; then
    warn "Port 3000 is already in use. Assuming frontend is already running."
else
    info "Starting frontend (Vite, port :3000)..."
    info "Logs will be written to: $LOG_DIR/frontend.log"
    cd "$FRONTEND_DIR"
    nohup setsid npm run dev > "$LOG_DIR/frontend.log" 2>&1 < /dev/null &
    FRONTEND_PID=$!
    disown "$FRONTEND_PID" 2>/dev/null || true
    echo "$FRONTEND_PID" > "$RUN_DIR/frontend.pid"
    cd "$SCRIPT_DIR"

    wait_port 3000 "Frontend" 60 || true
fi

# ==============================================================================
# 4. Open in Browser (if desktop environment available)
# ==============================================================================
if [ -n "$DISPLAY$WAYLAND_DISPLAY" ] && command -v xdg-open >/dev/null 2>&1; then
    info "Opening frontend in default browser..."
    xdg-open "http://localhost:3000" >/dev/null 2>&1 &
fi

# ==============================================================================
# Summary
# ==============================================================================
echo ""
info "AccessMap is starting/ready!"
echo "--------------------------------------------------------"
echo "  Frontend   : http://localhost:3000"
echo "  Backend    : http://localhost:8080"
echo "  GraphHopper: http://localhost:8989"
echo "--------------------------------------------------------"
echo "  Backend logs : tail -f $LOG_DIR/backend.log"
echo "  Frontend logs: tail -f $LOG_DIR/frontend.log"
echo ""
echo "  Check status : ./start.sh --status"
echo "  Stop all     : ./start.sh --stop"
echo "--------------------------------------------------------"
