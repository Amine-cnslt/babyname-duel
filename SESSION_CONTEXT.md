# Session Context

## Project Snapshot
- Product: BabyName Duel – collaborative baby-name scoring with social UX expectations.
- Frontend: React 18 + Vite under `src/`; shared components live in `components/`, API helpers in `api.js`.
- Backend: Flask app in `app.py` with SQLAlchemy models and REST endpoints mounted at `/api/*`.
- Tests: Pytest suite in `tests/`; frontend linting via ESLint (`eslint.config.js`).

## Key Commands
- `npm install` / `pip install -r requirements.txt` – install JS and Python dependencies.
- `npm run dev` – start Vite dev server on `http://localhost:5173`.
- `python app.py` – run Flask API locally (requires environment variables below).
- `npm run build` – generate production SPA assets into `dist/`.
- `npm run lint` / `pytest` – enforce linting and backend integration tests; both must pass before merge.

## Environment & Secrets
- Required: `DATABASE_URL`, `ALLOWED_ORIGIN`.
- Optional integrations: `OPENAI_API_KEY`, `OPENAI_MODEL`, `FIREBASE_PROJECT_ID`, `SENDGRID_API_KEY` or SMTP credentials.
- Auth tuning: `SESSION_TOKEN_TTL_HOURS` (default 24) and `MAX_SESSION_TOKENS_PER_USER` (default 10).
- Secrets belong in `.env.local` and must never be committed; confirm `.env.local` stays ignored.

## Startup Checklist
1. Read `AGENTS.md` for the full mission brief and enforcement rules.
2. Refresh dependencies (`npm install`, `pip install -r requirements.txt`) if packages changed.
3. Export env vars (`source .env.local` or equivalent) before running backend or tests.
4. Launch backend then frontend; verify `/api/test` and SPA root load without console errors.
5. Run `npm run lint` and `pytest`; fix failures prior to development or review.

## Monitoring & QA
- Track Lighthouse targets: Performance ≥ 90, Accessibility ≥ 95, Best Practices ≥ 95.
- Ensure API responses remain JSON-only and CORS-configured for whitelisted origins.
- Document architectural or API changes in `AGENTS.md` and `README.md` after implementation.
