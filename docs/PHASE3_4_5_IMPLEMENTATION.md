# Phase 2-5 Implementation Notes

This document summarizes what has been implemented after Phase 1-2 optimization.

## Access URLs (local/dev)

- Main app: `/`
- Phase 0 demo: `/?phase0=1`
- Phase 1 translator MVP: `/?phase1=1`
- Phase 2 QA & hậu kỳ: `/?phase2=1`
- Phase 3 writer pro: `/?phase3=1`
- Phase 4 scale & PWA: `/?phase4=1`
- Phase 5 release hardening: `/?phase5=1`

## Phase 1-2 Optimization Applied

- Added translation response cache (session-level TTL) in `src/phase0/aiGateway.ts`.
- Improved parallel provider selection to prefer fastest successful result.
- Added glossary corrective retry flow (one auto retry + hard-fail marker) in `src/phase1/translatorEngine.ts`.
- Expanded QA severity support with `critical` level in `src/components/QualityCenter.tsx`.
- Fixed navbar CSS selector warnings by introducing a stable class selector in:
  - `src/components/Navbar.tsx`
  - `src/index.css`
- Applied route-level lazy loading in `src/main.tsx`.

## Phase 2 (QA & Hậu kỳ)

Implemented in:

- `src/phase2/Phase2App.tsx`
- `src/phase2/qaEngine.ts`
- `src/phase2/storage.ts`
- `src/phase2/types.ts`

Features:

- AI/rule-backed proofreader scan for spelling, grammar, repetition, and phrasing issues.
- Consistency scan for glossary lock, pronoun drift, duplicate target segments, and timeline conflicts.
- Quality Center workflow with assignment, resolve/reject state, and one-click suggested fix apply.
- Chapter approval pipeline: `DRAFT -> IN_REVIEW -> REVIEWED -> PUBLISHED`.
- Local KPI proxy for post-edit time reduction tracking.

## Phase 3 (Writer Pro)

Implemented in:

- `src/phase3/Phase3App.tsx`
- `src/phase3/writerEngine.ts`
- `src/phase3/storage.ts`
- `src/phase3/types.ts`

Features:

- Auto-complete (50/100/200 words, 3 variants with confidence).
- Plot generator (directions, twists, risk logic).
- Tone shift/rephrase with preset controls.
- Context query with references.
- Wiki extraction (characters, locations, items, timeline).
- Local universe store merge/save for extracted entities.
- GraphRAG-style context blending (characters/locations/items/timeline) + hierarchical summaries injected into all Writer tasks.
- FinOps quick controls (update monthly budget, reset cycle, show last charge) surfaced in Phase 3 header.

## Phase 4 (Scale & PWA Baseline)

Implemented in:

- `src/phase4/Phase4App.tsx`
- `src/phase4/syncQueue.ts`
- `src/phase4/pwa.ts`
- `public/sw.js`

Features:

- Offline drafting workspace.
- Background sync queue simulation with status (`pending/syncing/synced/failed`).
- Team comment thread bound to sync state.
- Service worker registration and static cache shell.
- Quota + observability dashboard (token usage, queue health, sync logs).

## Phase 5 (Release Hardening)

Implemented in:

- `src/phase5/Phase5App.tsx`
- `src/phase5/releaseChecks.ts`

Features:

- One-click release readiness checks:
  - glossary lock pass rate gate
  - translate latency benchmark gate
  - QA scan latency gate
  - sync queue health gate
  - crash-free session gate
- Export readiness report to JSON.

## Build / Validation

- `npm run lint` passed.
- `npm run build` passed.
- Bundle is split by route-level lazy loading; legacy `App` chunk remains large and can be split further in a next optimization pass.
