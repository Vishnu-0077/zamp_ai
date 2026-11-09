#!/usr/bin/env bash
# One command to run the whole app locally: checks and installs what is missing,
# starts the backend (via backend/start.sh), waits until it is healthy, then
# starts the dashboard. Ctrl+C stops both.
#
#   ./run.sh                          fresh start (processed cases are reset)
#   RESET_ON_START=false ./run.sh     keep the cases from the previous run
#   ./run.sh --share                  also publish the dashboard on a public
#                                     https://*.trycloudflare.com link (Cloudflare quick tunnel)
set -euo pipefail
cd "$(dirname "$0")"
ROOT=$PWD

SHARE="${SHARE:-false}"
for arg in "$@"; do
  case "$arg" in
    --share) SHARE=true ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) printf 'Unknown option: %s (try --help)\n' "$arg" >&2; exit 2 ;;
  esac
done

BACKEND_PORT=8000
FRONTEND_PORT=5173
KEY_DIR="${ZAMP_KEY_DIR:-$HOME/.config/zamp}"

say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- environment
# Only Gemini and Groq are used. Clear OpenAI settings and drop leftover README
# placeholders (your-model-id, sk-...) or unprefixed model IDs: these override
# start.sh's defaults and make every case fail with PROCESSING_ERROR.
unset OPENAI_API_KEY OPENAI_BASE_URL

if [[ -n "${EXTRACTION_MODEL:-}" && ! "$EXTRACTION_MODEL" =~ ^(gemini|groq): ]]; then
  warn "Ignoring EXTRACTION_MODEL='$EXTRACTION_MODEL' (not a gemini:/groq: model); using the default chain."
  unset EXTRACTION_MODEL
fi
if [[ -n "${EXTRACTION_FALLBACK_MODELS:-}" ]]; then
  IFS=',' read -ra entries <<< "$EXTRACTION_FALLBACK_MODELS"
  for m in "${entries[@]}"; do
    m="${m// /}"
    if [[ -n "$m" && ( ! "$m" =~ ^(gemini|groq): || "$m" == *your-* ) ]]; then
      warn "Ignoring EXTRACTION_FALLBACK_MODELS (contains '$m'); using the default chain."
      unset EXTRACTION_FALLBACK_MODELS
      break
    fi
  done
fi

# Both processes must share the same application key.
export BACKEND_API_KEY="${BACKEND_API_KEY:-dev-app-key}"

# ---------------------------------------------------------------- prerequisites
say "Checking prerequisites"

command -v python3 >/dev/null || die "python3 not found. Install Python 3.11+."

if ! command -v npm >/dev/null && [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
fi
command -v npm >/dev/null || die "npm not found. Install Node.js 20+."

command -v tesseract >/dev/null \
  || warn "tesseract not found: scanned invoices will stop with OCR_UNAVAILABLE (sudo apt-get install -y tesseract-ocr)."

found_key=false
for p in gemini groq; do
  var="${p^^}_API_KEY"
  if [[ -n "${!var:-}" || -s "$KEY_DIR/$p.key" ]]; then found_key=true; fi
done
$found_key || warn "No Gemini or Groq key in $KEY_DIR: every case will stop with EXTRACTION_NOT_CONFIGURED. See README → Quick start → Save your API keys."

for port in "$BACKEND_PORT" "$FRONTEND_PORT"; do
  if ss -ltnH "sport = :$port" 2>/dev/null | grep -q .; then
    die "Port $port is already in use. Stop whatever is running there (an earlier backend or 'npm run dev') and retry."
  fi
done

# ---------------------------------------------------------------- dependencies
if [[ "$SHARE" == true ]] && ! command -v cloudflared >/dev/null; then
  if [[ ! -x "$HOME/.local/bin/cloudflared" ]]; then
    case "$(uname -m)" in
      x86_64|amd64) cf_arch=amd64 ;;
      aarch64|arm64) cf_arch=arm64 ;;
      *) die "cloudflared not found. Install it: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" ;;
    esac
    say "Downloading cloudflared to ~/.local/bin (one time, no sudo)"
    mkdir -p "$HOME/.local/bin"
    curl -fsSL -o "$HOME/.local/bin/cloudflared.part" \
      "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$cf_arch" \
      || die "Could not download cloudflared; check your internet connection."
    chmod +x "$HOME/.local/bin/cloudflared.part"
    mv "$HOME/.local/bin/cloudflared.part" "$HOME/.local/bin/cloudflared"
  fi
  export PATH="$HOME/.local/bin:$PATH"
fi

if [[ ! -x zamp_venv/bin/python ]]; then
  say "Creating Python environment (zamp_venv)"
  python3 -m venv zamp_venv
fi
if ! zamp_venv/bin/python -c 'import fastapi, uvicorn, langchain_openai, pymupdf, openpyxl' 2>/dev/null; then
  say "Installing backend dependencies"
  zamp_venv/bin/python -m pip install -q -r backend/requirements.txt
fi

if [[ ! -d frontend/node_modules ]]; then
  say "Installing dashboard dependencies"
  (cd frontend && npm install --no-fund --no-audit)
fi

# ---------------------------------------------------------------- start
pids=()
cleanup() {
  trap - INT TERM EXIT
  echo
  say "Stopping backend and dashboard"
  for pid in "${pids[@]}"; do kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM   # Ctrl+C: exit, and the EXIT trap stops both

# Each process runs in its own process group so the whole tree can be stopped.
say "Starting backend on http://127.0.0.1:$BACKEND_PORT"
setsid ./backend/start.sh > >(sed -u 's/^/[backend]  /') 2>&1 &
pids+=($!)
backend_pid=$!

say "Waiting for the backend to become healthy"
for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:$BACKEND_PORT/health" >/dev/null 2>&1; then break; fi
  kill -0 "$backend_pid" 2>/dev/null || die "Backend exited during startup; see the [backend] lines above."
  sleep 1
done
curl -fsS "http://127.0.0.1:$BACKEND_PORT/health" >/dev/null 2>&1 || die "Backend did not become healthy within 90 s."

if [[ "$SHARE" == true ]]; then
  # The dev server sends ~100 unminified modules (react-dom alone is 3 MB),
  # which takes minutes over a tunnel. Share the optimised build instead.
  say "Building the dashboard for sharing"
  (cd frontend && npm run build) 2>&1 | sed -u 's/^/[frontend] /'
  [[ ${PIPESTATUS[0]} -eq 0 ]] || die "Dashboard build failed; see the [frontend] lines above."
  frontend_cmd=preview
else
  frontend_cmd=dev
fi
say "Starting dashboard on http://localhost:$FRONTEND_PORT"
(cd frontend && exec setsid npm run "$frontend_cmd" -- --port "$FRONTEND_PORT" --strictPort) \
  > >(sed -u 's/^/[frontend] /') 2>&1 &
pids+=($!)
frontend_pid=$!
# Wait until the dashboard answers so the tunnel never serves a 502.
for _ in $(seq 1 30); do
  curl -fsS -o /dev/null "http://localhost:$FRONTEND_PORT/" 2>/dev/null && break
  kill -0 "$frontend_pid" 2>/dev/null || die "Dashboard exited during startup; see the [frontend] lines above."
  sleep 1
done

public_url=""
if [[ "$SHARE" == true ]]; then
  say "Opening a Cloudflare quick tunnel"
  mkdir -p runtime
  tunnel_log=runtime/cloudflared.log
  setsid cloudflared tunnel --no-autoupdate --url "http://localhost:$FRONTEND_PORT" > "$tunnel_log" 2>&1 &
  pids+=($!)
  tunnel_pid=$!
  for _ in $(seq 1 30); do
    public_url=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$tunnel_log" | head -1 || true)
    [[ -n "$public_url" ]] && break
    kill -0 "$tunnel_pid" 2>/dev/null || break
    sleep 1
  done
  [[ -n "$public_url" ]] || die "The tunnel did not start; see $tunnel_log."
fi

cat <<EOF

  Dashboard   http://localhost:$FRONTEND_PORT
  API docs    http://127.0.0.1:$BACKEND_PORT/docs
  Health      http://127.0.0.1:$BACKEND_PORT/health
EOF
if [[ -n "$public_url" ]]; then
  cat <<EOF

  Public link $public_url
              Anyone with this link can use the dashboard (upload, approve,
              reset) while this script runs. It changes on every --share start.
EOF
fi
cat <<EOF

  Press Ctrl+C to stop.

EOF

# If either process stops, stop the other one too.
wait -n "${pids[@]}" || true
warn "A process exited; shutting everything down."
