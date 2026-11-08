#!/usr/bin/env bash
# Start the backend with free-tier providers only (Gemini + Groq).
# Keys are read from ~/.config/zamp/<provider>.key and never printed.
# Run from anywhere: ./backend/start.sh
# Any variable already exported in your shell wins over these defaults.
set -euo pipefail
cd "$(dirname "$0")/.."

KEY_DIR="${ZAMP_KEY_DIR:-$HOME/.config/zamp}"

load_key() {  # load_key <ENV_VAR> <file>
  local var=$1 file="$KEY_DIR/$2"
  if [[ -n "${!var:-}" ]]; then
    echo "  $var: set from environment"
  elif [[ -s "$file" ]]; then
    export "$var=$(<"$file")"
    echo "  $var: loaded from $file"
  else
    echo "  $var: NOT SET ($file missing), its models will be skipped"
  fi
}

echo "Provider keys:"
load_key GEMINI_API_KEY gemini.key
load_key GROQ_API_KEY groq.key

# Paid OpenAI is never used by this script: every model below names a free provider,
# and OPENAI_API_KEY is cleared so an unprefixed model cannot silently bill it.
unset OPENAI_API_KEY OPENAI_BASE_URL

export BACKEND_API_KEY="${BACKEND_API_KEY:-dev-app-key}"
export EXTRACTION_MODEL="${EXTRACTION_MODEL:-gemini:gemini-3.5-flash}"
export EXTRACTION_FALLBACK_MODELS="${EXTRACTION_FALLBACK_MODELS:-groq:openai/gpt-oss-120b,gemini:gemini-3-flash-preview,gemini:gemini-3.5-flash-lite,groq:qwen/qwen3.8-27b}"
export EXTRACTION_PROVIDER_RETRIES="${EXTRACTION_PROVIDER_RETRIES:-3}"
export EXTRACTION_RETRY_BACKOFF_SECONDS="${EXTRACTION_RETRY_BACKOFF_SECONDS:-5}"
export RESET_ON_START="${RESET_ON_START:-true}"

echo "Model chain: $EXTRACTION_MODEL,$EXTRACTION_FALLBACK_MODELS"
echo "Reset processed cases on start: $RESET_ON_START (run with RESET_ON_START=false to keep them)"

exec ./zamp_venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 1
