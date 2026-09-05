# CLAUDE.md — WordByWord (Nibbler frontend)

You are working on the Next.js frontend of **Nibbler** — a local-first, AI-powered PDF reading tracker hosted at https://nibbook.com.

## First, read NorthStar.md

`NorthStar.md` is the canonical description of what this app is and how it's built. **Read it before any non-trivial change.** Its Section 0 ("Evolutions") at the top supersedes anything older in the doc — pay attention to that section especially, because it tracks intent changes that an outdated agent might otherwise revert.

The backend (nibble-api) has its own `northstar.md` and `CLAUDE.md` — read those when your change crosses the API boundary.

## When intent changes, update NorthStar.md

This is the rule that prevents agent regressions:

- If the user changes a design decision, **add a dated bullet to Section 0 ("Evolutions") in `NorthStar.md`** describing what changed and why. Do NOT delete the older guidance — just note it's superseded. A future agent reading the doc top-down should see the new intent first and treat the lower sections as historical.
- If the change is just an implementation detail (refactor, new component, bugfix), don't bother. Commit message + tests are enough.

## Critical contracts (don't break without explicit consent)

### Vocab is now a write-through to an external knowledge base

The user's vocab lives in https://shanejli.com's knowledge base, not just in IndexedDB or nibble-api. The flow:

1. `VocabService.add()` (in `src/lib/services/vocab-service.ts`) writes the entry to IndexedDB (local-first read path).
2. Then calls `syncService.syncNow()` (in `src/lib/services/sync-service.ts`) — a method that bypasses the normal 30s debounce because vocab adds are deliberate user actions.
3. `syncNow()` fires `POST /api/sync` to nibble-api, which forwards new vocab entries to the personal-website knowledge base.

**Don't restore a long debounce for vocab.** The 30s debounce still applies to scroll progress and other bursty events; vocab is the carve-out.

### Local-first is still the rule for everything else

Books, chapters, sections, reading progress — all IndexedDB; settings live in localStorage. The backend is for sync + AI + auth, not as the primary store.

Since 2026-09-05 six settings also sync through `POST /api/sync` (KAN-288) — localStorage is still the read path, the cloud is just a mirror. See NorthStar Section 0 for the conflict rule before touching `SettingsService`.

## Tech stack

| Layer | Tech |
| --- | --- |
| Framework | Next.js (App Router, Turbopack), Tailwind v4, shadcn/ui, React 19 |
| Storage | Dexie (IndexedDB) + localStorage for settings |
| PDF | pdfjs-dist (LAZY-IMPORTED inside NibService — never top-level import, breaks SSR) |
| AI | Anthropic SDK (Claude vision) for client-side OCR |
| Testing | vitest + jsdom + fake-indexeddb |

## Critical gotcha

**Never import `pdfjs-dist` (or anything that does) at the top level of any file that may run during SSR.** It calls `new DOMMatrix()` which doesn't exist server-side. NibService uses a lazy async `getPdfService()` getter — keep that pattern. NorthStar Section 8 covers this in detail.

## Workflow

- Deploy: push to `main`. Vercel auto-deploys. The Vercel project is `word-by-word`.
- Backend lives at `https://nibble-api-production.up.railway.app/api` (or `NEXT_PUBLIC_API_URL`).
- Tests: `npm test` (vitest). Build: `npm run build`.

## Auth

JWT in `localStorage` under `auth_token`. `getAuthHeaders()` (in `src/lib/auth-api.ts`) attaches it as `Authorization: Bearer <token>`. The token is minted by `/api/auth/token` (Next.js API route) which signs with the same `JWT_SECRET` nibble-api uses to verify.
