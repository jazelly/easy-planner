# Weekly Roadmap Planner - Plan

## Goal
Build a browser-based roadmap view (HTML + JS) that schedules and renders tasks in a weekly timeline, visually similar to the provided screenshot.

## Scope
- Weekly timeline with month headers and week columns.
- Task cards rendered across week spans based on size.
- Dependency-aware scheduling.
- Lane-based rows by task type (`BA`, `DESIGN`, `DEV`, `QA`).
- Rule enforcement for natural-language constraints.

## Input Data Contract
Use this JSON structure:

```json
{
  "startDate": "2026-04-06",
  "lanes": ["BA", "DESIGN", "DEV", "QA"],
  "constraints": {
    "maxParallelByType": {
      "BA": 2,
      "DESIGN": 2,
      "DEV": 2,
      "QA": 2
    }
  },
  "tasks": [
    {
      "id": "T-101",
      "name": "Submissions API",
      "type": "DEV",
      "size": "M",
      "dependsOn": ["T-100"],
      "earliestWeek": 0,
      "notes": "optional"
    }
  ]
}
```

### Size Mapping
- `XS` = 1 week
- `S` = 2 weeks
- `M` = 4 weeks
- `L` = 6 weeks
- `XL` = 8 weeks

## Scheduling Rules
1. A task starts no earlier than:
   - its `earliestWeek` (if provided), and
   - the finish of all `dependsOn` tasks.
2. Duration is derived from `size`.
3. Cadence per task name must follow:
   - `BA -> DESIGN (optional) -> DEV -> QA`
4. For the same `name`, phase records must not overlap in time:
   - only one active phase at a time for that task name.
5. `DESIGN` is optional:
   - valid flows are `BA -> DEV -> QA` or `BA -> DESIGN -> DEV -> QA`.
6. Global per-type WIP cap is enforced:
   - at any week, concurrent tasks for a given `type` must be `<= constraints.maxParallelByType[type]`.
   - example: 3 concurrent `QA` tasks is invalid when cap is 2; 2 `QA` + 1 `DESIGN` is valid.
7. Invalid data should fail fast with clear messages:
   - missing dependency IDs,
   - unknown lane/type,
   - invalid size,
   - dependency cycles,
   - cadence violations for same task name,
   - per-type capacity violations.

## Rendering Plan
1. Build sticky month row and week row.
2. Render one row per lane.
3. Draw task cards absolutely in each lane using:
   - `left = startWeek * weekWidth`
   - `width = durationWeeks * weekWidth`
4. Show compact task metadata:
   - task ID, type badge, name, size, week range.
5. Add month boundary dividers for visual grouping.

## Constraint Interpretation Note
- The planner treats rows with the same `name` as phases of one work item.
- A work item is always sequential by phase, never parallel with itself.
- Capacity is shared across different work items by lane/type, with a default cap of 2 per type.

## Current Deliverable
- `roadmap.html` implemented with:
  - scheduler,
  - validation,
  - weekly board rendering,
  - sample dataset.

## Next Steps
1. Replace sample tasks with your real dataset in the agreed JSON shape.
2. Add optional fields if needed:
   - status (`NEW`, `DELIVERY`, `RELEASED`),
   - assignee,
   - team/stream grouping,
   - fixed start/end date support.
3. Add interaction enhancements:
   - hover dependency highlight,
   - filter by type/status,
   - zoom (week width scale),
   - export/import JSON.
4. Tune styling to match screenshot closer (labels, colors, card density).
5. Update scheduler implementation in `roadmap.html` to enforce:
   - strict per-name cadence ordering,
   - no overlap for same-name phases,
   - per-type capacity limits (default 2).
