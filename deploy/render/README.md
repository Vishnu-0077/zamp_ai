# Deploying on Render (free plan)

One Render web service runs everything in one container:

- **Caddy** listens on Render's `$PORT`, serves the built dashboard (`frontend/dist`)
  and forwards the API paths to the backend, adding `X-API-Key` server-side, which is
  the same job the Vite proxy does locally.
- **uvicorn** runs `backend.main:app` with the background worker on `127.0.0.1:8000`.
- **Tesseract** is installed for scanned invoices.

Files: `render.yaml` (Blueprint), `deploy/render/Dockerfile`, `deploy/render/Caddyfile`,
`deploy/render/start.sh`. Local development (`./run.sh`) does not use any of them.

## Free-plan behaviour

- The service sleeps after 15 minutes without traffic. An uptime pinger hitting
  `/health` every 5 minutes keeps it awake.
- The disk is temporary. A restart or redeploy clears processed cases, audit history,
  uploaded POs and the approved-invoices Excel. The test inbox is part of the image and
  always comes back.
- Every push to `main` redeploys automatically (`autoDeploy: true`), which also clears
  the data. Avoid pushing while someone is grading.

## Setup

1. Sign in at <https://render.com> with GitHub.
2. **New → Blueprint**, pick this repository, keep the branch `main`.
3. When asked, paste `GEMINI_API_KEY` and `GROQ_API_KEY`, then **Deploy Blueprint**.
4. Wait for the build to show **Live** (the first build takes about 5–10 minutes). The
   URL is shown at the top of the service page, e.g. `https://zamp-ai.onrender.com`.
5. At <https://uptimerobot.com> (free), add an **HTTP(s)** monitor for
   `https://<your-service>.onrender.com/health` with a **5-minute** interval.

## Changing settings later

Service → **Environment** in the Render dashboard. Saving restarts the service.
