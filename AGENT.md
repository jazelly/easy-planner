# AGENT.md

Quick guide for AI/dev agents to ramp up and ship safely in this repo.

## 1) What this repo is

- Next.js 15 + React 19 app-router project for a roadmap planning UI.
- UI has two main experiences:
  - `/dashboard`: list/create boards.
  - `/boards/[boardId]`: interactive roadmap canvas (drag/drop, save versions, autosave, export PNG).
- Persistence is local SQLite in `data/roadmap-versions.db` via Node runtime route handlers.

## 2) Fast architecture map

- `app/layout.tsx` - global layout and CSS imports.
- `app/page.tsx` - redirects to `/dashboard`.
- `app/dashboard/*` - dashboard UI and board creation/listing.
- `app/boards/[boardId]/page.tsx` - board shell, toolbar, scripts, and bootstrap.
- `app/roadmap.js` - core client runtime (scheduling, render, drag/drop, manifests, autosave, export).
- `app/lib/default-roadmap-data.ts` - baseline roadmap dataset for new boards.
- `app/lib/roadmap-repository.ts` - TypeORM repository/data access (boards, versions, autosave).
- `app/lib/db/migrations/0001-init.ts` - initial schema migration (SQLite + Postgres-compatible path).
- `app/api/boards/*` - board CRUD-ish APIs.
- `app/api/manifests/route.ts` - manifest list/load/save/autosave APIs.
- `components/ui/*` - shadcn-style primitives.

## 3) Run/build commands

- Start dev server: `pnpm dev`
- Clean dev cache then start: `pnpm dev:clean`
- Production build check: `pnpm build`
- Start prod server (after build): `pnpm start`

Notes:
- There is currently no lint/test script in `package.json`.
- Use `pnpm build` as the minimum validation gate before finishing non-trivial changes.

## 4) Data and persistence model

- SQLite file: `data/roadmap-versions.db`.
- Tables (created/migrated via TypeORM migration files):
  - `boards`
  - `board_history` (versioned manifests per board)
  - `board_autosave` (latest autosave per board)
  - `manifest_versions` (legacy compatibility metadata)
- Manifest filenames follow: `roadmap-manifest-v####-<timestamp>.json`.

When changing persistence:
- Keep route handlers on `runtime = "nodejs"` (SQLite depends on Node runtime).
- Make migrations additive and idempotent (support existing DB state and column backfills).
- Preserve backward compatibility for existing DBs.
- For provider switching:
  - `DB_PROVIDER=sqljs` (default local SQLite in `data/roadmap-versions.db`)
  - `DB_PROVIDER=postgres` (also accepts `neon` / `supabase`) with `DATABASE_URL`

## 5) Request/response flow to know first

- Board page loads:
  1. `/api/boards/[boardId]?includeSnapshot=1` for board metadata + baseline data + latest history pointer
  2. `app/roadmap.js` via `RoadmapBootstrap`
  3. Runtime extracts `boardId` from URL and boots UI
- Save/load flows:
  - Board metadata: `/api/boards` and `/api/boards/[boardId]`
  - Manifest versions and autosave: `/api/manifests`

## 6) Safe change workflow (recommended)

1. Identify scope:
   - UI shell/layout -> `app/boards/[boardId]/page.tsx` or dashboard files
   - Scheduling/drag/drop/render -> `app/roadmap.js`
   - API/data persistence -> `app/api/**` + `app/lib/roadmap-repository.ts`
2. Keep behavior stable for:
   - Board ID validation
   - Manifest schema version checks
   - Autosave vs manual save separation
3. Validate:
   - `pnpm build`
   - Manual smoke test in dev:
     - Create board
     - Rename board
     - Move cards
     - Autosave reload
     - Manual save version + reload saved version
     - Export PNG

## 7) Important guardrails

- Do not hardcode secrets or credentials.
- Validate/sanitize external input in route handlers (board IDs, filenames, payload shape).
- Keep error messages user-safe and return proper HTTP status codes.
- Avoid changing baseline data shape unless you also update runtime parsing assumptions.
- `app/roadmap.js` is large and stateful; prefer small, isolated edits and avoid broad refactors unless explicitly requested.

## 8) If you need to extend features

- New board metadata fields:
  - Update DB schema (`roadmap-repository.ts`)
  - Add to API serializers in `app/api/boards/*`
  - Wire into board/dashboard UI
- New manifest fields:
  - Update manifest creation in `app/roadmap.js`
  - Handle in `/api/manifests` save/load
  - Keep schema versioning strategy explicit
- New data source fields in `app/lib/default-roadmap-data.ts`:
  - Update normalization/validation logic in `app/roadmap.js`
  - Ensure scheduler still handles missing/optional values safely

