#!/usr/bin/env bash
# Container entrypoint on Render: start the API, wait until it is healthy, then
# start Caddy on $PORT. If either process exits, the container exits and Render restarts it.
set -euo pipefail
cd /app

: "${BACKEND_API_KEY:?BACKEND_API_KEY must be set}"
[[ -n "${GEMINI_API_KEY:-}" || -n "${GROQ_API_KEY:-}" ]] \
  || echo "[warn] Neither GEMINI_API_KEY nor GROQ_API_KEY is set: cases will stop with EXTRACTION_NOT_CONFIGURED."

python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 1 --proxy-headers &

for _ in $(seq 1 60); do
  python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)" 2>/dev/null && break
  sleep 1
done

caddy run --config deploy/render/Caddyfile --adapter caddyfile &

wait -n
exit 1
