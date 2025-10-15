# Agents.md

## 🎯 Mission
This agent ensures that **BabyName Duel**—a collaborative baby-name scoring web app—remains **bug-free, secure, modern, and consistent** across both the Flask backend and React frontend.  
The agent should **enforce coding standards, performance, accessibility, and deployment integrity** at every step, while maintaining a **social-grade UI/UX** experience comparable to top modern apps.

---

## 1. Architecture Scope

### Frontend
- **Stack:** React 18 + Vite build; JSX components under `src/`.
- **Styling:** Custom utility classes inspired by Tailwind; reusable Panels, Lists, and Message components.
- **State:** React Hooks (`useState`, `useEffect`, `useReducer` for complex flows).
- **API:** All requests go through `src/api.js`; no direct `fetch()` calls in components.
- **Routing:** `react-router-dom`; ensure logical flow between Login → Dashboard → Session → Duel.

### Backend
- **Stack:** Flask (Python 3.11), REST API endpoints under `/api/*`.
- **ORM:** SQLAlchemy models for sessions, members, lists, scores, messages, notifications, metadata.
- **Database:** MySQL in production, SQLite for tests.
- **Email:** SendGrid or SMTP; credentials always stored in `.env.local`.
- **Authentication:** Werkzeug password hashes, Google OAuth (Firebase), secure reset tokens.

---

## 2. Code Quality Rules

### General
- **No console or print() output** in production.
- **Type-safe JS:** Prefer JSDoc or TypeScript-like annotations for key interfaces.
- **Descriptive names:** Components, variables, and models must be self-documenting.
- **Avoid duplication:** Shared logic should live in `src/hooks/` or `src/utils/`.

### Frontend
- Use functional components only.
- Always handle loading/error states for API calls.
- Run `npm run lint` and `npm run build` before commit.
- Agents must execute all lint/test/build commands themselves (no assuming someone else ran them).

### Backend
- Always validate input (e.g., `request.get_json()` sanitized).
- Use blueprints to organize routes under `/api/`.
- Return JSON responses only; no HTML rendering.
- Log errors via Flask logger; never expose stack traces in production.

---

## 3. Security Checklist

- 🔒 **Authentication**
  - Store passwords with Werkzeug’s `generate_password_hash`.
  - Tokens: random, time-limited, stored securely in DB.
  - Firebase OAuth credentials never logged or exposed.

- 🧱 **Database & ORM**
  - Prevent SQL injection by always using ORM queries.
  - Use scoped sessions; call `session.commit()` explicitly.

- 🧭 **API & CORS**
  - Allow only whitelisted domains.
  - Rate-limit login and signup endpoints.

- 🧰 **Secrets**
- All keys/secrets in `.env.local`; never hard-coded or committed.
- CI/CD must verify `.env.local` is excluded via `.gitignore`.
- Session control knobs: `SESSION_TOKEN_TTL_HOURS` (token expiry) and `MAX_SESSION_TOKENS_PER_USER` (server-side cap) live in the environment; adjust cautiously for ops needs.

---

## 4. UX & UI Standards

- Consistent component design (Panels, Cards, Lists, Buttons).
- Minimum touch target: 44x44px.
- Accessible forms (label + aria tags).
- Responsive breakpoints: `360`, `768`, `1024`, `1280`.
- Dark mode optional; support prefers-color-scheme.
- Performance target: LCP < 2.5s, CLS < 0.1.

---

### 4.1 Social-Grade UI/UX Standards

**Design tokens & theming**
- System font stack; text sizes 12–32px, line-height ≥ 1.4.
- Spacing: 4/8/12/16/24/32.
- Radius: md=8, xl=16 for cards/modals.
- Colors: light/dark with ≥ 4.5:1 contrast ratio; semantic tokens (`--bg`, `--card`, `--accent`).
- Icons: Lucide; 18–20px action icons.

**Layout**
- Mobile-first; sticky top bar and bottom nav (mobile) with key tabs: *Home*, *Sessions*, *Messages*, *Profile*, *Notifications*.
- Max content width: 720–840px.
- Drawers/sheets for mobile; avoid nested modals.

**Navigation patterns**
- Home/feed shows recent session updates (invites, list submissions, scores, DMs).
- Session details have tabs: *Lists*, *Scores*, *Chat*, *Members*.
- Hardware “back” restores last feed scroll position.

**Social components**
- Card design with avatars, display name, timestamp, overflow menu, reactions, comment count, and share.
- Inline composer with @mentions, emoji picker, and attachment upload (CSV).
- Typing indicators, read receipts, and presence dots.
- Toast + undo for quick user feedback (invite sent, message deleted).
- Skeleton loaders and friendly empty states on all top-level routes.

**Micro-interactions**
- Animations ≤200ms ease-out.
- Ripple feedback on click/tap.
- Confetti for milestones (session completion).
- Haptic feedback for success/error (if supported).

**Accessibility**
- Full keyboard navigation and focus visible states.
- aria-live for toasts and chat notifications.
- Contrast-safe chat bubbles and dark mode compliance.

**Performance**
- TTI < 2s on mid-range mobile; LCP < 2.5s.
- Virtualize long lists (names/messages).
- Lazy-load emoji pickers, charts, admin panels.
- Cache session data; debounce inputs by 250ms.

**Safety**
- Confirm destructive actions.
- Block/report options on messages.
- Hide or hash invite tokens in UI.

**Search & discovery**
- Global search (Ctrl/Cmd + K) for sessions, people, names with fuzzy match.

**Notifications**
- In-app bell badge; batched by session.
- Optional digest email for invites & mentions.

**Definition of Done (UI)**
- Lighthouse: Performance ≥ 90, A11y ≥ 95, Best Practices ≥ 95.
- No console warnings or layout shifts.
- Bottom nav + sticky header tested at 360px.
- Each route has skeleton + empty state.
- Virtualized long lists and optimistic updates implemented.

---

## 5. Testing & Validation

- Run `pytest` for backend with in-memory SQLite.
- Mock external services (email, OpenAI API).
- Use React Testing Library for frontend logic.
- CI must block merges if:
  - Any test fails.
  - `npm run lint` or `pytest` return errors.
  - Bundle size > 200KB gzipped.

---

## 6. Deployment & DevOps

- **Railway:** Multi-stage Docker build:
  - Stage 1: Node 20 → build frontend.
  - Stage 2: Python 3.11 runtime → Flask backend.
- Validate `.env.local` loads correctly on Railway.
- `RAILWAY_TCP_PROXY_DOMAIN` only for external DB access.
- Ensure `railway up` succeeds with no warnings.
- Run `docker build . && docker run` locally before push.

---

## 7. Modern Standards Checklist

| Area | Requirement |
|------|--------------|
| Security | OWASP Top 10 compliance |
| API | RESTful, versioned `/api/v1/...` |
| Performance | Code-splitting, lazy-loading routes |
| Accessibility | Lighthouse a11y ≥ 95 |
| Maintainability | ESLint, Black, Prettier enforced |
| Documentation | `/docs/` updated when APIs/models change |

---

## 8. Agent Prompts & Behavior

When acting as an agent or reviewer:
1. **Focus only on BabyName Duel context.**
2. Apply sections 2–7 as enforcement rules.
3. Recommend fixes for UX gaps, security flaws, or code smells.
4. Flag missing error handling, secrets, or unreviewed dependencies.
5. Improve visual consistency and suggest layout/UI refactors if they drift from the “modern social” standard.

---

## ✅ Definition of Done
A change is “done” when:
- Tests, lint, and build pass.
- No secrets in code.
- User flow (create session → invite → score → message) verified.
- UI feels modern, responsive, intuitive.
- Lighthouse scores ≥ thresholds.
- Agent audit passes with 0 warnings.
- Docs updated where applicable.

---

**End of Agents.md**
