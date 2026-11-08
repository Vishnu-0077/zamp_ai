# Invoice review frontend

React + TypeScript single-page app for the invoice processing backend in
`../backend`. It covers the whole reviewer workflow:

| Screen | Route | Backend endpoints |
| --- | --- | --- |
| Dashboard | `/` | `/api/v1/stats`, `/api/v1/cases`, `/health` |
| Cases (filter, paginate, live refresh) | `/cases` | `/api/v1/cases` |
| Case detail: findings, extraction with evidence, PDF side-by-side, correction, retry, checks, page text/OCR, audit trail, policy snapshot | `/cases/:id` | `/api/v1/cases/{id}`, `/document`, `/audit`, `/corrections`, `/retry` |
| Vendor inbox → send to processing | `/inbox` | `/emails`, `/emails/{id}/preview`, `/api/v1/ingest/email` |
| Upload PDF / EML | `/upload` | `/api/v1/ingest/pdf`, `/api/v1/ingest/eml` |
| Reference data (vendors, POs, FX, policy) | `/references` | `/api/v1/references` |
| Settings (reviewer key, theme, backend status) | `/settings` | `/health` |

The legacy `inbox.html` in this folder is still served by the backend at `/`
and requires application-key authentication when enabled. Use the React app
for the authenticated reviewer workflow.

## Run

Requires Node 20.19+ or 22.12+ and npm. Install backend requirements as described
in the [backend guide](../backend/README.md) before starting.

```bash
# terminal 1: backend (from repository root)
export BACKEND_API_KEY=dev-app-key REVIEWER_API_KEY=dev-reviewer-key
./zamp_venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 1

# terminal 2: frontend
cd frontend
npm ci
BACKEND_API_KEY=dev-app-key npm run dev       # http://localhost:5173
```

Then open **Settings** and enter the reviewer key (`dev-reviewer-key` above) to
enable corrections, retries and **Refresh & start fresh** on the dashboard.
Refresh clears processing data and reloads every dashboard query, including
Reference data. The test inputs and trusted reference configuration are kept.

`cp .env.example .env` works instead of exporting variables. `BACKEND_URL`
defaults to `http://127.0.0.1:8000`.

### Credentials

- **Application key (`X-API-Key`)** is added by the Vite dev/preview proxy from
  `BACKEND_API_KEY`. It is never part of the browser bundle, as the backend
  README requires.
- **Reviewer key (`X-Reviewer-Key`)** is typed by the reviewer in Settings and
  kept in `sessionStorage` for that tab only.

### Production

`npm run build` writes static files to `dist/`. Serve them behind a reverse
proxy (nginx, Caddy, an API gateway) that:

1. serves `dist/` with an SPA fallback to `index.html`;
2. forwards `/api`, `/emails`, `/vendors`, `/purchase-orders` and `/health` to
   the backend and injects `X-API-Key` server-side.

To call a backend on another origin instead, build with
`VITE_API_BASE=https://api.example.com` and add the frontend origin to the
backend's `CORS_ORIGINS`. In that mode an application key would have to come
from an authenticated gateway; do not embed it.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server with proxy and hot reload |
| `npm run build` | Typecheck and production build |
| `npm run preview` | Serve the production build (with proxy) |
| `npm test` | Unit and component tests (Vitest + Testing Library) |
| `npm run typecheck` | TypeScript only |
| `npm run gen:api` | Regenerate `src/api/schema.d.ts` from `../backend/openapi.json` |

## Architecture

```text
src/
  api/                 The only code that talks to the backend
    schema.d.ts        Generated from backend/openapi.json (do not edit)
    types.ts           Friendly aliases + shapes for untyped endpoints
    client.ts          fetch wrapper: auth headers, error normalisation
    endpoints.ts       One function per backend route
    queryKeys.ts       React Query cache keys
  app/
    registry.ts        Feature list → router + sidebar
    AppShell.tsx       Layout, navigation, health indicator
    App.tsx            Providers and router
  components/          Reusable UI (Badge, Card, DataTable, Tabs, PdfViewer…)
  features/<name>/     One folder per screen/domain, each with routes.ts
  lib/                 Formatting, status tones, reviewer key, theme
  styles/tokens.css    Design tokens (colours, spacing, dark mode)
```

Design rules:

- **Contract-first.** Types come from the backend OpenAPI document. After a
  backend change, run `npm run gen:api` and `npm run typecheck`; the compiler
  lists every screen that needs updating.
- **Decimal-safe.** Amounts stay as decimal strings end to end and are
  formatted without float conversion.
- **Server is the authority.** The UI never decides approval. Corrections send
  the complete extraction with `expected_version`, and a 409 tells the reviewer
  to reload.
- **Tolerant of backend growth.** Unknown extraction fields appear under
  "Other fields" and stay editable. Unknown `checks` keys render generically.

## Extending

**Add a screen.** Create `src/features/payments/PaymentsPage.tsx` (default
export) and `routes.ts`:

```ts
import { lazy } from 'react';
import type { FeatureRoute } from '@/app/types';

export const paymentsRoutes: FeatureRoute[] = [
  { path: 'payments', component: lazy(() => import('./PaymentsPage')), nav: { label: 'Payments', order: 50 } },
];
```

Then add `...paymentsRoutes` to `src/app/registry.ts`. The router, sidebar and
code splitting pick it up automatically.

**Add a backend call.** Add a function to `src/api/endpoints.ts`, a key in
`queryKeys.ts`, and use it with `useQuery`/`useMutation` in your feature.

**Add a tab to the case page.** Append a `TabDef` in `buildTabs()` in
`src/features/cases/CaseDetailPage.tsx`.

**Label a new extraction field.** Add it to `FIELD_GROUPS` in
`src/features/cases/fieldConfig.ts`. Until then it still appears under "Other
fields".

**Add a case status.** Add it to `CASE_STATUSES` in `api/types.ts` and
`STATUS_META` in `lib/tones.ts`. TypeScript flags any place that is missed.

**Restyle.** Edit `src/styles/tokens.css`. Components use only these
variables, and dark mode is defined there too.
