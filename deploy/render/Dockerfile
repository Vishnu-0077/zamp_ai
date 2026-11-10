# Render deployment: one container that serves the built dashboard and the API.
# Caddy listens on Render's $PORT, serves frontend/dist, and forwards API paths to
# uvicorn on 127.0.0.1:8000 with the X-API-Key header added server-side (the same
# job the Vite proxy does locally). Local development (./run.sh) does not use this.

# ---- 1. Build the dashboard
FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- 2. Caddy binary
FROM caddy:2.8.4 AS caddy

# ---- 3. Runtime: Python backend + Tesseract + Caddy
FROM python:3.12-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
COPY --from=caddy /usr/bin/caddy /usr/local/bin/caddy
COPY . .
COPY --from=web /web/dist /app/frontend/dist
RUN chmod +x deploy/render/start.sh \
 && useradd --create-home invoice \
 && mkdir -p /app/backend/runtime \
 && chown -R invoice:invoice /app/backend/runtime
USER invoice
ENV PORT=10000 \
    XDG_DATA_HOME=/home/invoice/.local/share \
    XDG_CONFIG_HOME=/home/invoice/.config
EXPOSE 10000
CMD ["deploy/render/start.sh"]
