# WordByWord — North Star Document

> **Purpose:** This is the single source of truth for any AI agent (or human) picking up this project. It defines what we're building, the killer features, the architectural decisions, and the current state. Read this first.

---

## 0. Evolutions (read before anything else)

Newer than anything below. When this section conflicts with the rest of the document, this section wins. Add a dated bullet here whenever the user's intent changes — do NOT silently delete the older guidance further down; just note that this section overrides it.

### 2026-09-05 — Settings now sync to the cloud (they used to be localStorage-only)

`bbb-settings` was a purely device-local blob: every sync push hardcoded `settings: null` and the pull discarded `serverChanges.settings`, so prod's `user_settings` table held 0 rows for 22 users and every preference plus all keymap overrides reset on a new device (KAN-288). Six settings now round-trip through `POST /api/sync`: `autoReadThresholdSeconds`, `defaultViewMode`, `readingMode`, `trackingMode`, `targetLanguage`, `keymapOverrides`.

- localStorage is still the read path and still local-first — settings are read once on mount, exactly as before. The cloud is a mirror, not the source of truth.
- `anthropicApiKey` and `warnBeforeSync` deliberately stay device-local. The key is a secret and the warn flag is a per-device UX choice; neither has a server column. **Don't add them to `SYNCED_SETTING_KEYS`.**
- Conflict rule lives in `SettingsService` (`src/lib/services/settings-service.ts`): two device-local markers, `bbb-settings-updatedAt` (bumped on a local edit) and `bbb-settings-syncedAt` (set when a push lands). Push only when dirty, apply a pulled row only when clean. No client/server clock is ever compared. **Don't "simplify" this into pushing settings on every sync tick** — that lets a stale device clobber newer settings on every poll.
- `downloadFromCloud()` intentionally still sends `settings: null` and force-applies the pulled row instead: it wipes local books/chapters/sections/vocab in favour of the cloud, so pushing local settings up first would invert its own cloud-wins contract.
- A pull dispatches `SETTINGS_SYNCED_EVENT`; the settings page adopts the new values only when the user has no unsaved edits in the form. Applying a pulled change must never force a reload — that would yank the UI mid-reading.
- Sign-out clears both markers (via `syncService.clearLocalSyncState()`) because `bbb-settings` itself survives sign-out. Without that, a second user on the same browser would push the first user's preferences into their own account.

**Why the change:** cloud sync already restored books, chapters, sections and vocabulary on a new device. Settings were the one entity that silently reset, and hand-configured keymap overrides were the most expensive thing to lose.

### 2026-05-16 — Vocab is now part of an external knowledge base, not local-first

Vocab capture used to be a fully local-first feature (IndexedDB + nibble-api `vocabulary` table). It now writes through to a separate personal-website knowledge base at https://shanejli.com — that is the user-facing source of truth for vocab.

- The click path is unchanged on the frontend: `VocabService.add()` still writes IndexedDB first so the user sees the entry instantly and the local-first guarantee for *reading* vocab is preserved.
- After IDB write, `add()` calls `syncService.syncNow()` (a new method that bypasses the 30s debounce). This kicks an immediate `POST /api/sync` to nibble-api. nibble-api forwards the new vocab entry to the personal-website knowledge base (`POST /api/knowledge/notes` with a Bearer PAT). See `nibble-api/src/services/knowledge-base.service.ts`.
- If the forward fails (knowledge base down, PAT misconfigured), nibble-api adds the entry to `failedEntities.vocabulary` so the WordByWord sync layer re-bumps `updatedAt` and retries on the next tick. The local IndexedDB row stays — the user does not lose their word.
- Section 5 (Data Model) and Section 10 (Backlog item: "Backend + user accounts + cloud sync") below were written before this change. Treat them as historical context, not current truth.

**Why the change:** Shane wants one knowledge base across all his tools (the periodic-website's knowledge module is the canonical store). Nibbler-side flashcards were duplicating work.

**Don't undo this without explicit user consent:**
- Don't restore a long debounce for vocab — vocab adds are deliberate user actions and need to feel instant.
- Don't re-route vocab through a path that bypasses the forward. Every new vocab must land in the personal-website knowledge base.

### 2026-05-16 — The /vocabulary route is gone; the in-app link points to shanejli

The locally-rendered vocab list page (`src/app/vocabulary/page.tsx` with the IndexedDB read flow) was removed because vocab now lives at https://shanejli.com/knowledge. Treat that URL as the canonical vocab UI for users.

- Both in-app entry points (`src/app/page.tsx` home toolbar, `src/components/auth/user-menu.tsx` profile menu) are now plain `<a target="_blank" rel="noopener noreferrer" href="https://shanejli.com/knowledge">` external links with a ↗ glyph. They no longer use Next.js `<Link>`. Don't convert them back — the destination is a different origin.
- `src/app/vocabulary/page.tsx` is reduced to a `redirect('https://shanejli.com/knowledge')` so direct URL access and bookmarks still land in the right place. Don't restore the IndexedDB-backed page here; if you want a local cache view, build it on a different route.
- The `VocabService` reads (`getAll`, `getByLanguage`, `getByBook`, `count`, `markReviewed`, `updateExplanation`) are still in place because other in-reader UI paths reference them, but nothing now renders a full vocab list inside this app.

**Why the change:** Two surfaces for the same data is a maintenance burden. The personal-website's knowledge UI has richer features (categories, source filtering, connections). Consolidating.

**Don't undo this without explicit user consent:** in particular, don't recreate the local `/vocabulary` page just because the route exists or because tests reference it.

---

## 1. Vision

**WordByWord** (codenamed "Bit by Bit" / BBB) is a **local-first, AI-powered PDF reading tracker** for technical books. It treats every book like a structured online course — chapters become modules, sections become lessons — and tracks non-linear reading progress section by section.

The core insight: **people don't read technical books front-to-back.** They jump to sections they need, skip what they know, and come back later. No existing tool tracks this. WordByWord does.

---

## 2. Killer Features

### 2.1 — .nib (Natural Interactive Book) Format

The crown jewel. Every PDF gets parsed into a **word-level document object model** where:

- **Every word is an interactive object.** Click any word to see its sentence context, paragraph position, and page number.
- **Every word knows its ancestors:** `NibWord → NibSentence → NibParagraph → NibPage → NibDocument`. You can traverse up or down the tree at will.
- **`word.getAIContext()`** returns a structured payload (word, sentence, surrounding sentences, page number) ready to send to an AI for **context-aware translation, definition, or explanation** — not just dictionary lookup, but understanding what the word means *in this specific paragraph of this specific book*.
- **Block-level type discrimination:** Each paragraph is tagged with a `NibBlockType` — `body`, `introduction`, `blockquote`, `list-item`, `figure-caption`, `epigraph`. The UI renders each type with distinct visual treatment (colored borders, italics, indentation).
- **Dual parsing pipeline:**
  - **NibParser** — for PDFs with text layers. Uses font size, position, and style data from PDF.js to detect headers, footers, footnotes by their physical layout.
  - **NibTextParser** — for scanned/OCR'd PDFs where text arrives as flat strings from AI vision. Uses regex heuristics to detect numbered headings, bullets, blockquotes, figure captions, footnotes, page breaks.
- **Serializable**: The entire NibDocument can be serialized to JSON (`toData()`) and stored in IndexedDB, then rehydrated (`NibDocument.fromData()`) without loss. Process once, read forever.

**Location:** `src/lib/nib/` — `models.ts`, `parser.ts`, `text-parser.ts`, `index.ts`
**Orchestrator:** `src/lib/services/nib-service.ts`

### 2.2 — Non-Linear Reading Tracker

- Book structure is extracted from PDF outline (TOC) or built by AI vision (Claude API, 10 pages/batch).
- Every section has a `startPage`/`endPage`, `isRead`, `readAt`, `lastPageViewed`, `scrollProgress`.
- Sections can be read in any order. Progress = sections read / total sections.
- **Auto-tracking:** configurable timer (default 5s) — view a section long enough, it's marked read. Also supports manual toggle.
- Heatmap grid on the book dashboard shows at-a-glance coverage (green = read, gray = unread).

### 2.3 — Three Reader Modes

1. **PDF** — native PDF rendering via PDF.js, scroll or flip mode.
2. **Text** — clean NibTextViewer with word-level interactivity, element badges, and context tooltips.
3. **Side-by-Side** — text on left, PDF on right. The best of both worlds.

View mode and reading mode (scroll/flip) **persist across navigation** via `SettingsService` → localStorage.

### 2.4 — Page-Level Navigation

- Prev/Next buttons navigate **pages within a section** (not section-to-section).
- At section boundaries, navigation auto-transitions to the adjacent section.
- Toolbar shows current position: `2/5 (p.34)`.
- `Ctrl+←` / `Ctrl+→` keyboard shortcuts.
- `lastPageViewed` persisted to IndexedDB — resume where you left off.

### 2.5 — AI-Powered Book Processing

- **NIB Process (recommended):** Uses the rich NibParser for all PDFs — extracts text with font/position awareness, strips headers/footers/footnotes automatically. If the PDF has a TOC outline, it uses the TOC for structure; otherwise groups pages into 10-page chapters. Fast, no AI needed. Always available as an option during import.
- **Page-by-Page (with AI OCR):** For scanned/image-only PDFs, uses client-side Claude Vision OCR via Anthropic SDK to extract text. Falls back to backend OCR if available. Each page becomes its own section.
- PDFs with a text layer → structure extracted from native PDF.js outline.
- Scanned PDFs (no text layer) → processed via Claude vision API (client-side or backend).
  - Client-side OCR via Anthropic SDK — works without a backend server.
  - Backend OCR available as an alternative when the server is running.
  - Extracts text + detects chapter/section boundaries.
  - Results cached in `Section.extractedText` — process once.
  - **Priority queue:** user-clicked chapters jump the queue; background processing continues for the rest.
- **Introduction injection:** `walkOutlineTree` in `book-processing-service.ts` detects gaps between a parent chapter's start page and its first child section, automatically injecting synthetic "Introduction" sections.

### 2.6 — Customizable Keyboard Shortcuts

- Full shortcut system via `ShortcutProvider` context + `useShortcut` hook.
- Shortcuts are storable and reassignable (persisted to localStorage).
- Current shortcuts: `Ctrl+I` (toggle labels), `Ctrl+1/2/3` (view modes), `Ctrl+←/→` (page nav).

### 2.7 — Glassy UI Components

- **BlockTooltip** — frosted-glass tooltip (`backdrop-blur-xl`) showing action label + keyboard shortcut in a pill.
- **NibElementBadge** — color-coded labels for element types (teal = introduction, indigo = blockquote, orange = list-item, pink = figure, violet = epigraph, etc.).
- All tooltips and badges toggleable via the "Labels" button in the toolbar.

---

## 3. Architecture

```
UI Components (React, Next.js App Router)
    ↓
Hooks (use-reader, use-auto-track, use-shortcuts)
    ↓
Service Layer (NibService, PDFService, AIService, BookProcessingService, SettingsService)
    ↓
Repository Layer (BookRepository, ChapterRepository, SectionRepository)
    ↓
Storage (IndexedDB via Dexie.js — local-first, no backend needed)
```

**Key architectural decisions:**
- **Repository pattern** — all data access goes through repositories. When we add a backend, only the repository layer changes.
- **Lazy imports for PDFService** — `pdfjs-dist` uses `DOMMatrix` which doesn't exist in SSR. NibService lazy-loads PDFService only when PDF methods are called (not at import time). This is critical — do not revert to static imports.
- **Service layer independence** — NibService text methods (`parseExtractedText*`) never touch PDF.js. Only `parsePages`/`getCleanText` need the PDF service.
- **All data local** — no backend, no auth, no server state. Everything in IndexedDB + localStorage.

---

## 4. Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router, Turbopack) | 16.1.6 |
| Language | TypeScript | |
| UI | React | 19.2.3 |
| Styling | Tailwind CSS | 4.x |
| Components | shadcn/ui | |
| PDF | pdfjs-dist | 5.4.624 |
| Local DB | Dexie.js (IndexedDB) | 4.3.0 |
| AI | Anthropic SDK (Claude vision) | |
| Testing | Vitest + jsdom + fake-indexeddb | 4.0.18 |

---

## 5. Data Model

```
Book {
  id, title, author, totalPages, pdfBlob, coverImage,
  structureSource ('native'|'ai'|'manual'),
  processingStatus ('pending'|'processing'|'complete'|'error'),
  createdAt, lastReadAt
}

Chapter {
  id, bookId, title, order, startPage, endPage
}

Section {
  id, chapterId, bookId, title, order,
  startPage, endPage,
  extractedText (cached AI output),
  isRead, readAt,
  lastPageViewed, scrollProgress
}
```

**NibDocument** (in-memory, serializable):
```
NibDocument → NibPage[] → {
  header?, footer?, footnotes[],
  paragraphs[] → NibSentence[] → NibWord[],
  figures[], listItems[]
}
```

Each paragraph carries a `blockType`: `body | introduction | blockquote | list-item | figure-caption | epigraph`.

---

## 6. File Map (Key Files)

| Path | Purpose |
|------|---------|
| `src/lib/nib/models.ts` | .nib data models + live class wrappers |
| `src/lib/nib/parser.ts` | Rich PDF text parser (font/position aware) |
| `src/lib/nib/text-parser.ts` | Flat text parser (OCR/AI output) |
| `src/lib/services/nib-service.ts` | NibService orchestrator (lazy PDFService!) |
| `src/lib/services/pdf-service.ts` | PDF.js extraction (DOMMatrix — client only) |
| `src/lib/services/ai-service.ts` | Claude vision API integration |
| `src/lib/services/book-processing-service.ts` | Book import, TOC extraction, AI splitting |
| `src/lib/services/settings-service.ts` | User settings (localStorage) |
| `src/hooks/use-reader.ts` | Reader state, page tracking, mode persistence |
| `src/hooks/use-shortcuts.tsx` | Keyboard shortcut system |
| `src/hooks/use-auto-track.ts` | Auto-mark-read timer |
| `src/components/reader/nib-text-viewer.tsx` | Word-level interactive text display |
| `src/components/reader/pdf-viewer.tsx` | PDF rendering (scroll + flip modes) |
| `src/components/reader/reader-toolbar.tsx` | Toolbar: modes, page nav, labels toggle |
| `src/components/reader/side-by-side-viewer.tsx` | Split view: text left, PDF right |
| `src/components/ui/block-tooltip.tsx` | Glassy tooltip + element badge components |
| `src/app/book/[id]/read/[sectionId]/page.tsx` | Reader page (main reading experience) |

---

## 7. Settings (Persisted)

Stored in `localStorage` as `bbb-settings`:
- `anthropicApiKey` — user-provided Claude API key
- `autoReadThresholdSeconds` — seconds before auto-marking read (default 5)
- `defaultViewMode` — `'pdf' | 'text' | 'side-by-side'`
- `readingMode` — `'scroll' | 'flip'`
- `trackingMode` — `'timer' | 'endofpage'`

---

## 8. Critical Gotchas (Read Before Coding)

1. **DOMMatrix SSR crash:** `pdfjs-dist` imports trigger `new DOMMatrix()` which doesn't exist outside browsers. NibService uses a lazy async `getPdfService()` getter — **never import PDFService at the top level of any file that may run during SSR**.

2. **Introduction detection:** When `walkOutlineTree` processes a PDF outline, it checks for page gaps between a parent chapter and its first child section. If there are intervening pages, it injects a synthetic "Introduction" section. The `NibTextParser` also tags paragraphs before the first header as `blockType=introduction`. The reader page uses `parseExtractedTextBodyOnly()` for regular sections (strips intro) and `parseExtractedTextIntroOnly()` for intro sections.

3. **View mode persistence:** `setViewMode` and `setReadingMode` in `use-reader.ts` are wrapped to also call `SettingsService.updateSettings()`. On initial load, settings are read once from localStorage. Don't bypass these wrappers.

4. **Page navigation vs section navigation:** Prev/Next in the toolbar navigate **pages** within a section. At boundaries, they auto-navigate to adjacent sections via `router.push()`. This is controlled in the reader `page.tsx`, not in the toolbar component.

5. **Scanned PDFs have no text layer and no outline.** They can go through either the NIB Process path (which will produce sections with no text — use PDF view) or the AI OCR path (Page-by-Page option) which extracts text via client-side Claude Vision. The `walkOutlineTree` outline fix only applies to PDFs with native TOC structure.

---

## 9. What's Built (as of March 2026)

- [x] Full .nib format with word-level object model
- [x] Dual parsing pipeline (rich PDF + flat text)
- [x] NibService with lazy PDFService loading
- [x] Library grid + book upload
- [x] Book dashboard with chapter accordion, heatmap, progress drilldown
- [x] Reader with 3 modes (PDF, text, side-by-side)
- [x] Page-level navigation with section auto-transition
- [x] Word-level interactive text viewer (NibTextViewer)
- [x] Keyboard shortcuts (customizable, storable)
- [x] Glassy tooltips + element type badges
- [x] Auto-read tracking (timer-based)
- [x] View mode + reading mode persistence
- [x] AI book processing with priority queue
- [x] Introduction section injection (outline tree + text parser)

## 10. What's Next (Backlog)

- [ ] AI translation panel — tap a word → get in-context translation using `word.getAIContext()`
- [ ] Viewport overlay in side-by-side mode (LoL minimap-style camera box on PDF)
- [ ] Backend + user accounts + cloud sync
- [ ] Bookmarks, highlights, annotations
- [ ] Search across books
- [ ] Export progress reports
- [ ] Mobile-responsive optimization
- [ ] Multiple AI provider support