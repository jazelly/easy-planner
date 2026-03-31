# Design System — Vilo (Product Management & Context)

## Product Context

- **What this is:** A Linear-style workspace for planning and delivery, centered on **context**: issues as containers of knowledge, projects as the **cadence** layer (sequence, deadlines, ownership). Users define their own hierarchy; the product provides containers, links to projects, and continuous ingestion from external tools.
- **Who it's for:** Teams building with agents and integrations, who need roadmap clarity without a forced taxonomy.
- **Space/industry:** Product / engineering operations, adjacent to Linear, Height, Notion projects, with heavy integrations (Slack, Confluence, Jira, etc.).
- **Project type:** Web app dashboard (primary), with marketing surfaces elsewhere in the repo.

## Dashboard capabilities (functional design)

The dashboard must support:

1. **Home / command surface:** Project selector, incoming context from integrations, personal cadence (today / this week), quick create for issues and projects. Philosophy line: everything is context; users choose classification style.
2. **Issues:** Context containers with list, **outline** (user-defined tree; no prescribed depth), and optional **graph** views for relationships (blocked-by, parent/child, sibling). Rich body, linked project(s), external **sources** with sync state.
3. **Projects:** Roadmap with a **real calendar / timeline** (week/month), drag-to-date, ownership, dependency hints. Explicit links from schedule items to issues.
4. **Integrations / sources:** Connector model with status, last sync, and mapping of external objects into issues or projects (continuous ingestion, not one-shot import).
5. **Planner (agent-facing):** Decomposition, agent assignment, review queue; same underlying issues and project links as the main dashboard.

**Information architecture (nav):** Project, Issues, Roadmap, Sources, Planner (left sidebar pattern, aligned with category expectations).

## Aesthetic Direction

- **Direction:** Industrial utilitarian with warm neutrals — serious work tool, not generic “AI SaaS.”
- **Decoration level:** Intentional (subtle elevation on panels, optional very light texture; no hero gradients or default purple accents).
- **Mood:** Dense information stays readable; **context-reading** surfaces are spacious. Feels like a system of record, not ticket spam.
- **Reference sites:** [Linear](https://linear.app) (cadence clarity, density discipline); avoid interchangeable three-column marketing grids and purple gradients.

## Typography

- **Display/Hero:** Geist (current app default) — optional future accent with Instrument Serif or Fraunces for marketing/empty states only if brand requires it.
- **Body:** Geist Sans — matches existing `vilo-app` root layout.
- **UI/Labels:** Same as body.
- **Data/Tables:** Geist with `tabular-nums` for dates, estimates, calendar labels.
- **Code:** Geist Mono — matches existing stack.
- **Loading:** Next/font Google (`Geist`, `Geist_Mono`) as today.
- **Scale:** Use a modular type scale consistent with shadcn/Tailwind tokens (e.g. text-sm base UI, text-lg page titles, text-2xl+ sparingly for section headers).

## Color

- **Approach:** Restrained + semantic; accent used sparingly for primary actions and “linked to project” cues.

**Dark-first palette (recommended):**

| Token | Hex | Usage |
|--------|-----|--------|
| App bg | `#0C0D0F` | Base background |
| Raised bg | `#16181D` | Page-level lift |
| Surface | `#1C1F26` | Cards, panes |
| Border | `#2A2F3A` | Dividers, hairlines |
| Primary accent | `#BEFE3B` or `#9FD356` | Primary CTA, key links (pick one and lock) |
| Muted text | `#8B9199` | Secondary labels |
| Text | `#F2F4F7` | Primary text |

**Semantic:** success `#34C759`, warning `#FFB020`, error `#FF5C5C`, info `#5AC8FA`.

**Light mode:** Invert contrast (light neutrals for surfaces, dark text); reduce accent saturation slightly if needed for AA contrast.

## Spacing

- **Base unit:** 8px.
- **Density:** Comfortable in lists and tables; **spacious** in issue reader / context body.
- **Scale:** 2xs(2) xs(4) sm(8) md(16) lg(24) xl(32) 2xl(48) 3xl(64) — align with Tailwind defaults.

## Layout

- **Approach:** Hybrid — strict grid for app chrome; main canvas switches by mode (board, list, timeline, issue detail).
- **Issue detail (optional three-pane):** Outline or graph strip, context body, right rail (project link, schedule, assignee, sources).
- **Grid:** Follow existing dashboard sidebar + inset content (`SidebarProvider` / `SidebarInset`).
- **Max content width:** Full width for roadmap and tables; cap readable line length (~65–75ch) inside issue body only.
- **Border radius:** Hierarchical — sm for inputs, md for cards, lg for modals/drawers; avoid uniform “everything bubbly.”

## Motion

- **Approach:** Minimal-functional.
- **Easing:** enter `ease-out`, exit `ease-in`, move `ease-in-out`.
- **Duration:** micro 50–100ms, short 150–220ms, medium 250–400ms, long 400–700ms.

## Design risks (intentional)

1. **No fixed hierarchy in product copy** — only relationships and outline; requires strong empty states and examples (mega-issue vs deep tree).
2. **Home combines context stream + calendar cues** — higher complexity; mitigate with tabs or collapsible sections.
3. **Non-blue accent (acid/moss)** — distinctive; offer neutral-heavy chrome for enterprise comfort.

## Safe choices (baseline)

- Left sidebar with Project / Issues / Roadmap / Sources / Planner.
- Calendar/timeline as a primary roadmap view.
- Issue detail as full page or large drawer for deep context.

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-01 | Initial DESIGN.md from design consultation | Context-first PM dashboard; aligns with existing Geist + shadcn dashboard shell in `vilo-app`. |
