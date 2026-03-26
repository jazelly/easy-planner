const sizeToWeeks = {
  XS: 1, S: 2, M: 4, L: 6, XL: 8
};

const laneColor = {
  BA: "#f59e0b",
  DESIGN: "#8b5cf6",
  DEV: "#2563eb",
  QA: "#16a34a"
};

const typeLabel = {
  BA: "BA",
  DESIGN: "Design",
  DEV: "Dev",
  QA: "QA"
};

const MANIFEST_SCHEMA_VERSION = 1;
const MANIFEST_FOLDER_NAME = "versions";
const MANIFEST_INDEX_FILENAME = "manifest-index.json";
const MANIFEST_HANDLE_DB = "roadmap-manifest-store";
const MANIFEST_HANDLE_STORE = "handles";
const MANIFEST_HANDLE_KEY = "versions-directory-handle";

const appState = {
  baseData: null,
  activeManifest: null,
  rowContexts: [],
  boardBounds: null,
  manifestDirectoryHandle: null,
  manifestEntries: []
};

function normalizeStatus(status) {
  const normalized = String(status || "NEW").trim().toUpperCase();
  const allowed = new Set(["NEW", "DELIVERY", "RELEASED", "IN_PROGRESS", "BLOCKED"]);
  return allowed.has(normalized) ? normalized : "NEW";
}

function toStatusClass(status) {
  return `task-status-${status.toLowerCase().replaceAll("_", "-")}`;
}

function formatWeekLabel(weekIndex) {
  return weekIndex >= 0 ? `W${weekIndex + 1}` : `B${Math.abs(weekIndex)}`;
}

function formatWeekRangeLabel(startWeek, endWeekExclusive) {
  const inclusiveEndWeek = endWeekExclusive - 1;
  return `${formatWeekLabel(startWeek)}-${formatWeekLabel(inclusiveEndWeek)}`;
}

function toDate(isoDate) {
  const d = new Date(isoDate + "T00:00:00");
  if (Number.isNaN(d.getTime())) {
    throw new Error("Invalid date: " + isoDate);
  }
  return d;
}

function formatMonthLabel(date) {
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function addWeeks(date, weeks) {
  const d = new Date(date);
  d.setDate(d.getDate() + weeks * 7);
  return d;
}

function topologicalSort(tasks) {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const inDegree = new Map(tasks.map(t => [t.id, 0]));
  const adj = new Map(tasks.map(t => [t.id, []]));

  for (const t of tasks) {
    for (const dep of t.dependsOn || []) {
      if (!byId.has(dep)) {
        throw new Error(`Task ${t.id} depends on missing task ${dep}`);
      }
      inDegree.set(t.id, inDegree.get(t.id) + 1);
      adj.get(dep).push(t.id);
    }
  }

  const ready = [];
  for (const [id, degree] of inDegree.entries()) {
    if (degree === 0) ready.push(id);
  }
  ready.sort((a, b) => byId.get(a).priorityOrder - byId.get(b).priorityOrder);

  const order = [];
  while (ready.length > 0) {
    // Pick the highest-priority ready task first.
    const id = ready.shift();
    order.push(id);
    for (const nxt of adj.get(id)) {
      const deg = inDegree.get(nxt) - 1;
      inDegree.set(nxt, deg);
      if (deg === 0) {
        ready.push(nxt);
        ready.sort((a, b) => byId.get(a).priorityOrder - byId.get(b).priorityOrder);
      }
    }
  }

  if (order.length !== tasks.length) {
    throw new Error("Dependency cycle detected.");
  }
  return order.map(id => byId.get(id));
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function countOverlappingByType(type, startWeek, endWeek, scheduled) {
  let count = 0;
  for (const s of scheduled) {
    if (s.type === type && overlaps(startWeek, endWeek, s.startWeek, s.endWeek)) {
      count++;
    }
  }
  return count;
}

function normalizeTask(task, priorityOrder) {
  return {
    ...task,
    dependsOn: task.dependsOn || [],
    earliestWeek: task.earliestWeek || 0,
    priorityOrder
  };
}

function buildCadenceDependencies(tasks) {
  const phaseOrder = ["BA", "DESIGN", "DEV", "QA"];
  const phaseIndex = new Map(phaseOrder.map((phase, idx) => [phase, idx]));
  const tasksByName = new Map();
  const tasksById = new Map();
  const mergedTasks = tasks.map((task, index) => normalizeTask(task, index));

  for (const task of mergedTasks) {
    if (!phaseIndex.has(task.type)) {
      throw new Error(`Task ${task.id} has unknown type/lane ${task.type}`);
    }
    tasksById.set(task.id, task);
    if (!tasksByName.has(task.name)) tasksByName.set(task.name, []);
    tasksByName.get(task.name).push(task);
  }

  for (const [name, group] of tasksByName.entries()) {
    const seenTypes = new Set();
    for (const task of group) {
      if (seenTypes.has(task.type)) {
        throw new Error(`Cadence violation for "${name}": duplicate phase ${task.type}`);
      }
      seenTypes.add(task.type);
    }

    const ordered = [...group].sort((a, b) => phaseIndex.get(a.type) - phaseIndex.get(b.type));
    for (let i = 0; i < ordered.length - 1; i++) {
      const from = ordered[i];
      const to = ordered[i + 1];
      const fromIdx = phaseIndex.get(from.type);
      const toIdx = phaseIndex.get(to.type);
      if (toIdx <= fromIdx) {
        throw new Error(`Cadence violation for "${name}": phases must move forward`);
      }
      if (!to.dependsOn.includes(from.id)) {
        to.dependsOn.push(from.id);
      }
    }
  }

  for (const task of mergedTasks) {
    for (const depId of task.dependsOn) {
      if (!tasksById.has(depId)) {
        throw new Error(`Task ${task.id} depends on missing task ${depId}`);
      }
    }
  }

  return mergedTasks;
}

function computeWindowMaxWeeks(startDate, constraints) {
  const windowEndDate = constraints?.windowEndDate;
  if (!windowEndDate) return null;
  const endDate = toDate(windowEndDate);
  if (endDate.getTime() < startDate.getTime()) {
    throw new Error("constraints.windowEndDate must be on or after startDate.");
  }

  // Inclusive end date: a window ending Friday should include that whole week.
  const inclusiveMs = (endDate.getTime() - startDate.getTime()) + DAY_MS;
  return Math.ceil(inclusiveMs / WEEK_MS);
}

function scheduleTasks(data, startDate) {
  const tasksWithCadence = buildCadenceDependencies(data.tasks);
  const tasks = topologicalSort(tasksWithCadence);
  const scheduled = [];
  const overflowTaskIds = [];
  const allowedTypes = new Set(["BA", "DESIGN", "DEV", "QA"]);
  const perTypeCap = data.constraints?.maxParallelByType || {
    BA: 2,
    DESIGN: 2,
    DEV: 2,
    QA: 2
  };
  const maxWeeksInWindow = computeWindowMaxWeeks(startDate, data.constraints);

  for (const task of tasks) {
    const duration = sizeToWeeks[task.size];
    if (!duration) throw new Error(`Task ${task.id} has invalid size ${task.size}`);
    if (!allowedTypes.has(task.type)) throw new Error(`Task ${task.id} has unknown type/lane ${task.type}`);

    let earliest = task.earliestWeek;
    for (const depId of (task.dependsOn || [])) {
      const dep = scheduled.find(s => s.id === depId);
      if (!dep) throw new Error(`Internal scheduling error: missing dependency ${depId}`);
      earliest = Math.max(earliest, dep.endWeek);
    }

    let startWeek = earliest;
    const endWeek = () => startWeek + duration;
    const typeCap = perTypeCap[task.type] ?? 2;

    while (countOverlappingByType(task.type, startWeek, endWeek(), scheduled) >= typeCap) {
      startWeek++;
    }
    const exceedsWindow = maxWeeksInWindow !== null && endWeek() > maxWeeksInWindow;
    if (exceedsWindow) overflowTaskIds.push(task.id);

    scheduled.push({
      id: task.id,
      name: task.name,
      type: task.type,
      size: task.size,
      priorityOrder: task.priorityOrder,
      status: normalizeStatus(task.status),
      assignee: task.assignee || "Unavailable",
      notes: task.notes || "",
      dependsOn: task.dependsOn || [],
      startWeek,
      endWeek: endWeek(),
      exceedsWindow
    });
  }

  return {
    scheduled,
    window: {
      maxWeeksInWindow,
      overflowTaskIds
    }
  };
}

function buildTracks(scheduled) {
  function extractOkrOrderFromTask(task) {
    const idMatch = String(task?.id || "").match(/OKR-(\d+)/i);
    if (idMatch) {
      const idOrder = Number.parseInt(idMatch[1], 10);
      if (Number.isFinite(idOrder)) return idOrder;
    }
    const nameMatch = String(task?.name || "").match(/\bOKR\s*[- ]?(\d+)\b/i);
    if (nameMatch) {
      const nameOrder = Number.parseInt(nameMatch[1], 10);
      if (Number.isFinite(nameOrder)) return nameOrder;
    }
    return Number.POSITIVE_INFINITY;
  }

  const groupsByName = new Map();
  for (const task of scheduled) {
    const key = String(task.name || task.id || "");
    if (!groupsByName.has(key)) groupsByName.set(key, []);
    groupsByName.get(key).push(task);
  }

  const tracks = Array.from(groupsByName.entries()).map(([name, tasks]) => {
    const orderedTasks = [...tasks].sort((a, b) => {
      if (a.startWeek !== b.startWeek) return a.startWeek - b.startWeek;
      if (a.endWeek !== b.endWeek) return a.endWeek - b.endWeek;
      return a.id.localeCompare(b.id);
    });
    const okrOrder = orderedTasks.reduce((min, task) => {
      return Math.min(min, extractOkrOrderFromTask(task));
    }, Number.POSITIVE_INFINITY);
    const earliestStart = orderedTasks.length > 0 ? orderedTasks[0].startWeek : Number.POSITIVE_INFINITY;
    return { name, okrOrder, earliestStart, tasks: orderedTasks };
  });

  tracks.sort((a, b) => {
    if (a.okrOrder !== b.okrOrder) return a.okrOrder - b.okrOrder;
    if (a.earliestStart !== b.earliestStart) return a.earliestStart - b.earliestStart;
    return a.name.localeCompare(b.name);
  });

  return tracks.map((track) => track.tasks);
}

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseManifestVersionNumber(filename) {
  const match = String(filename || "").match(/-v(\d+)-/i);
  if (!match) return 0;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildManifestFilename(nextVersion) {
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").replace("T", "-").replace("Z", "Z");
  return `roadmap-manifest-v${String(nextVersion).padStart(4, "0")}-${stamp}.json`;
}

function sortCardsForRow(cards) {
  return [...cards].sort((a, b) => {
    const aStart = toFiniteNumber(a.dataset.uiStartWeek, 0);
    const bStart = toFiniteNumber(b.dataset.uiStartWeek, 0);
    if (aStart !== bStart) return aStart - bStart;
    const aLane = toFiniteNumber(a.dataset.laneIndex, 0);
    const bLane = toFiniteNumber(b.dataset.laneIndex, 0);
    if (aLane !== bLane) return aLane - bLane;
    return String(a.dataset.taskId || "").localeCompare(String(b.dataset.taskId || ""));
  });
}

function createLayoutManifest(data) {
  const rows = appState.rowContexts.map((rowContext, rowIndex) => {
    const cards = sortCardsForRow(Array.from(rowContext.cardsLayer.querySelectorAll(".task-card")));
    const cardsPayload = cards.map((card, order) => ({
      taskId: String(card.dataset.taskId || ""),
      startWeek: toFiniteNumber(card.dataset.uiStartWeek, 0),
      order
    })).filter((entry) => entry.taskId);

    return {
      rowIndex,
      cards: cardsPayload
    };
  });

  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    source: {
      startDate: data.startDate,
      taskCount: Array.isArray(data.tasks) ? data.tasks.length : 0
    },
    rows
  };
}

function applyManifestToTracks(scheduled, manifest, minStartWeek, maxEndWeekExclusive) {
  if (!manifest || !Array.isArray(manifest.rows)) {
    return buildTracks(scheduled);
  }

  const taskById = new Map(scheduled.map((task) => [task.id, task]));
  const usedIds = new Set();
  const tracksByIndex = new Map();

  for (const row of manifest.rows) {
    const rowIndex = Math.max(0, Math.floor(toFiniteNumber(row?.rowIndex, 0)));
    const cards = Array.isArray(row?.cards) ? row.cards : [];
    const resolvedTasks = [];

    for (const cardEntry of cards) {
      const taskId = String(cardEntry?.taskId || "");
      if (!taskById.has(taskId) || usedIds.has(taskId)) continue;
      const baseTask = taskById.get(taskId);
      const duration = baseTask.endWeek - baseTask.startWeek;
      const maxStartWeek = Math.max(minStartWeek, maxEndWeekExclusive - duration);
      const startWeek = clamp(
        Math.floor(toFiniteNumber(cardEntry?.startWeek, baseTask.startWeek)),
        minStartWeek,
        maxStartWeek
      );
      resolvedTasks.push({
        ...baseTask,
        startWeek,
        endWeek: startWeek + duration,
        _manifestOrder: Math.max(0, Math.floor(toFiniteNumber(cardEntry?.order, resolvedTasks.length)))
      });
      usedIds.add(taskId);
    }

    resolvedTasks.sort((a, b) => {
      if (a._manifestOrder !== b._manifestOrder) return a._manifestOrder - b._manifestOrder;
      if (a.startWeek !== b.startWeek) return a.startWeek - b.startWeek;
      return a.id.localeCompare(b.id);
    });

    tracksByIndex.set(rowIndex, resolvedTasks);
  }

  const manifestTrackIndexes = Array.from(tracksByIndex.keys()).sort((a, b) => a - b);
  const tracks = manifestTrackIndexes.map((index) => tracksByIndex.get(index) || []);

  const unscheduled = scheduled.filter((task) => !usedIds.has(task.id));
  if (unscheduled.length > 0) {
    const fallbackTracks = buildTracks(unscheduled);
    tracks.push(...fallbackTracks);
  }

  return tracks;
}

function buildMonthSpans(startDate, totalWeeks, startWeekOffset = 0) {
  const spans = [];
  let week = 0;

  while (week < totalWeeks) {
    const currentDate = addWeeks(startDate, startWeekOffset + week);
    const monthLabel = formatMonthLabel(currentDate);
    let spanWeeks = 1;
    while (week + spanWeeks < totalWeeks) {
      const nextDate = addWeeks(startDate, startWeekOffset + week + spanWeeks);
      if (formatMonthLabel(nextDate) !== monthLabel) break;
      spanWeeks++;
    }
    spans.push({ monthLabel, startWeek: week, spanWeeks });
    week += spanWeeks;
  }
  return spans;
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getWeekColumnWidth(board) {
  const raw = getComputedStyle(board).getPropertyValue("--week-col-width").trim();
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 132;
}

function applyCardUiPosition(card, startWeek, duration, visibleStartWeek = 0) {
  const columnIndex = startWeek - visibleStartWeek;
  card.style.left = `calc(${columnIndex} * var(--week-col-width) + 2px)`;
  card.style.width = `calc(${duration} * var(--week-col-width) - 4px)`;
  card.dataset.uiStartWeek = String(startWeek);
  card.dataset.uiEndWeek = String(startWeek + duration);
}

function updateCardMetaForUiPosition(card, task, startWeek, endWeek) {
  const duration = endWeek - startWeek;
  const weekRange = formatWeekRangeLabel(startWeek, endWeek);
  const metaEl = card.querySelector(".task-meta");
  if (metaEl) {
    metaEl.textContent = `${task.size} (${duration}w) • ${weekRange}`;
  }
  card.title = `${task.id} | ${task.name}\n${task.type} • ${task.size}\nWeek ${weekRange}`;
}

function relayoutCardsLayer(cardsLayer, row) {
  const cards = sortCardsForRow(Array.from(cardsLayer.querySelectorAll(".task-card")));
  for (const card of cards) cardsLayer.appendChild(card);

  const lanesEndWeek = [];
  const laneCards = [];
  const laneHeights = [];
  const laneTops = [];
  const cardGap = 8;
  const rowPaddingTop = 6;
  const rowPaddingBottom = 6;

  // Pass 1: assign each card to the earliest compatible vertical lane.
  for (const card of cards) {
    const start = Number(card.dataset.uiStartWeek || 0);
    const end = Number(card.dataset.uiEndWeek || start + 1);
    let laneIndex = 0;
    while (laneIndex < lanesEndWeek.length && lanesEndWeek[laneIndex] > start) {
      laneIndex++;
    }
    lanesEndWeek[laneIndex] = end;
    if (!laneCards[laneIndex]) laneCards[laneIndex] = [];
    laneCards[laneIndex].push(card);
    card.dataset.laneIndex = String(laneIndex);
  }

  const stackCount = Math.max(1, laneCards.length);

  // Pass 2: measure actual content-driven height per lane.
  for (let laneIndex = 0; laneIndex < stackCount; laneIndex++) {
    const cardsInLane = laneCards[laneIndex] || [];
    let maxHeight = 0;
    for (const card of cardsInLane) {
      const cardHeight = Math.ceil(card.getBoundingClientRect().height);
      maxHeight = Math.max(maxHeight, cardHeight);
    }
    laneHeights[laneIndex] = Math.max(56, maxHeight);
  }

  // Pass 3: compute lane top offsets and place cards.
  let runningTop = rowPaddingTop;
  for (let laneIndex = 0; laneIndex < stackCount; laneIndex++) {
    laneTops[laneIndex] = runningTop;
    runningTop += laneHeights[laneIndex] + (laneIndex < stackCount - 1 ? cardGap : 0);
  }

  for (const card of cards) {
    const laneIndex = Number(card.dataset.laneIndex || 0);
    card.style.top = `${laneTops[laneIndex] ?? rowPaddingTop}px`;
  }

  const totalHeight = runningTop + rowPaddingBottom;
  row.style.minHeight = `${Math.max(96, totalHeight)}px`;
}

function enableCardDragAndDrop(
  card,
  task,
  board,
  minStartWeek,
  maxEndWeekExclusive,
  visibleStartWeek,
  getActiveRowContext,
  setActiveRowContext,
  findRowContextByClientY,
  relayoutRowContext
) {
  const duration = task.endWeek - task.startWeek;
  const maxStartWeek = Math.max(minStartWeek, maxEndWeekExclusive - duration);
  let dragging = false;
  let dragStartX = 0;
  let dragInitialStartWeek = task.startWeek;
  let activeRowContext = getActiveRowContext ? getActiveRowContext() : null;
  let moved = false;

  function updateDrag(clientX, clientY) {
    if (!dragging) return;
    const weekColumnWidth = getWeekColumnWidth(board);
    const deltaWeeks = Math.round((clientX - dragStartX) / weekColumnWidth);
    const nextStartWeek = clamp(dragInitialStartWeek + deltaWeeks, minStartWeek, maxStartWeek);
    const currentStartWeek = Number(card.dataset.uiStartWeek || task.startWeek);

    if (nextStartWeek !== currentStartWeek) {
      moved = true;
      applyCardUiPosition(card, nextStartWeek, duration, visibleStartWeek);
      updateCardMetaForUiPosition(card, task, nextStartWeek, nextStartWeek + duration);
      if (relayoutRowContext && activeRowContext) relayoutRowContext(activeRowContext);
    }

    const targetRowContext = findRowContextByClientY ? findRowContextByClientY(clientY) : null;
    if (targetRowContext && targetRowContext !== activeRowContext) {
      const previousRowContext = activeRowContext;
      targetRowContext.cardsLayer.appendChild(card);
      activeRowContext = targetRowContext;
      if (setActiveRowContext) setActiveRowContext(targetRowContext);
      moved = true;
      if (relayoutRowContext && previousRowContext) relayoutRowContext(previousRowContext);
      if (relayoutRowContext) relayoutRowContext(targetRowContext);
    }
  }

  function startDrag(clientX, clientY) {
    dragging = true;
    dragStartX = clientX;
    dragInitialStartWeek = Number(card.dataset.uiStartWeek || task.startWeek);
    if (findRowContextByClientY) {
      const pointerRowContext = findRowContextByClientY(clientY);
      if (pointerRowContext) {
        activeRowContext = pointerRowContext;
        if (setActiveRowContext) setActiveRowContext(pointerRowContext);
      }
    }
    moved = false;
    card.classList.add("task-dragging");
  }

  function finishDrag() {
    if (!dragging) return;
    dragging = false;
    card.classList.remove("task-dragging");
    if (moved) card.dataset.suppressClick = "true";
  }

  card.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    startDrag(event.clientX, event.clientY);
    event.preventDefault();
  });

  document.addEventListener("mousemove", (event) => {
    updateDrag(event.clientX, event.clientY);
  });

  document.addEventListener("mouseup", () => {
    finishDrag();
  });

  card.addEventListener("touchstart", (event) => {
    const touch = event.touches[0];
    if (!touch) return;
    startDrag(touch.clientX, touch.clientY);
    event.preventDefault();
  }, { passive: false });

  document.addEventListener("touchmove", (event) => {
    const touch = event.touches[0];
    if (!touch) return;
    updateDrag(touch.clientX, touch.clientY);
    if (dragging) event.preventDefault();
  }, { passive: false });

  document.addEventListener("touchend", () => {
    finishDrag();
  });

  document.addEventListener("touchcancel", () => {
    finishDrag();
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatPrettyDate(date) {
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function initDetailsSidebar() {
  const sidebar = document.getElementById("details-sidebar");
  const backdrop = document.getElementById("details-backdrop");
  const closeBtn = document.getElementById("details-close");
  const titleEl = document.getElementById("details-title");
  const contentEl = document.getElementById("details-content");

  if (!sidebar || !backdrop || !closeBtn || !titleEl || !contentEl) {
    return {
      open: () => {},
      close: () => {}
    };
  }

  function close() {
    sidebar.classList.remove("open");
    sidebar.classList.add("hidden");
    backdrop.classList.add("hidden");
    sidebar.setAttribute("aria-hidden", "true");
    backdrop.setAttribute("aria-hidden", "true");
  }

  function open(task, detailsHtml) {
    titleEl.textContent = `${task.id} - ${task.name}`;
    contentEl.innerHTML = detailsHtml;
    sidebar.classList.remove("hidden");
    backdrop.classList.remove("hidden");
    sidebar.classList.add("open");
    sidebar.setAttribute("aria-hidden", "false");
    backdrop.setAttribute("aria-hidden", "false");
  }

  if (!sidebar.dataset.bound) {
    closeBtn.addEventListener("click", close);
    backdrop.addEventListener("click", close);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
    });
    sidebar.dataset.bound = "true";
  }

  return { open, close };
}

function buildTaskDetailsHtml(task, scheduledById, startDate) {
  const durationWeeks = task.endWeek - task.startWeek;
  const start = addWeeks(startDate, task.startWeek);
  const endExclusive = addWeeks(startDate, task.endWeek);
  const endInclusive = new Date(endExclusive);
  endInclusive.setDate(endInclusive.getDate() - 1);

  const dependencyLines = (task.dependsOn || []).map((id) => {
    const dep = scheduledById.get(id);
    if (!dep) return `${id} (missing)`;
    return `${dep.id} - ${dep.name} (${dep.type})`;
  });

  const borderColor = laneColor[task.type] || "#94a3b8";

  return `
    <div class="details-section">
      <h3>Overview</h3>
      <div class="details-grid">
        <div class="details-key">Task ID</div>
        <div class="details-value">${escapeHtml(task.id)}</div>
        <div class="details-key">Name</div>
        <div class="details-value">${escapeHtml(task.name)}</div>
        <div class="details-key">Phase</div>
        <div class="details-value">
          <span class="details-chip" style="border-left: 4px solid ${escapeHtml(borderColor)}">${escapeHtml(task.type)}</span>
        </div>
        <div class="details-key">Status</div>
        <div class="details-value">${escapeHtml(task.status || "NEW")}</div>
        <div class="details-key">Assignee</div>
        <div class="details-value">${escapeHtml(task.assignee || "Unavailable")}</div>
        <div class="details-key">Size</div>
        <div class="details-value">${escapeHtml(task.size)} (${durationWeeks} week${durationWeeks === 1 ? "" : "s"})</div>
      </div>
    </div>

    <div class="details-section">
      <h3>Schedule</h3>
      <div class="details-grid">
        <div class="details-key">Week range</div>
        <div class="details-value">W${task.startWeek + 1} - W${task.endWeek}</div>
        <div class="details-key">Start date</div>
        <div class="details-value">${escapeHtml(formatPrettyDate(start))}</div>
        <div class="details-key">End date</div>
        <div class="details-value">${escapeHtml(formatPrettyDate(endInclusive))}</div>
      </div>
    </div>

    <div class="details-section">
      <h3>Dependencies</h3>
      <div class="details-value">
        ${dependencyLines.length > 0 ? dependencyLines.map((d) => `<div>${escapeHtml(d)}</div>`).join("") : "No dependencies"}
      </div>
    </div>

    <div class="details-section">
      <h3>Notes</h3>
      <div class="details-value">${task.notes ? escapeHtml(task.notes) : "No notes provided"}</div>
    </div>
  `;
}

function render(data, options = {}) {
  const layoutManifest = options.layoutManifest || null;
  const board = document.getElementById("board");
  const errorsEl = document.getElementById("errors");
  const detailsSidebar = initDetailsSidebar();
  clearChildren(board);
  appState.rowContexts = [];
  appState.boardBounds = null;
  errorsEl.classList.add("hidden");
  errorsEl.textContent = "";
  detailsSidebar.close();

  try {
    const startDate = toDate(data.startDate);
    const { scheduled, window } = scheduleTasks(data, startDate);
    const scheduledById = new Map(scheduled.map((item) => [item.id, item]));
    const dataTotalWeeks = Math.max(...scheduled.map(s => s.endWeek), 0) + 2;
    const leftBufferWeeks = 2;
    const visibleStartWeek = -leftBufferWeeks;
    const visibleWeekCount = dataTotalWeeks + leftBufferWeeks;
    const maxWeeksInWindow = window?.maxWeeksInWindow ?? null;

    board.style.setProperty("--week-count", String(visibleWeekCount));

    const monthSpans = buildMonthSpans(startDate, visibleWeekCount, visibleStartWeek);
    const monthBoundaryWeeks = new Set(monthSpans.map(m => m.startWeek + m.spanWeeks));

    const monthsRow = document.createElement("div");
    monthsRow.className = "months-row";
    for (const m of monthSpans) {
      const cell = document.createElement("div");
      cell.className = "month-cell";
      cell.style.gridColumn = `${m.startWeek + 1} / span ${m.spanWeeks}`;
      cell.textContent = m.monthLabel;
      monthsRow.appendChild(cell);
    }
    board.appendChild(monthsRow);

    const weeksRow = document.createElement("div");
    weeksRow.className = "weeks-row";
    for (let w = 0; w < visibleWeekCount; w++) {
      const timelineWeek = visibleStartWeek + w;
      const weekCell = document.createElement("div");
      weekCell.className = "week-cell";
      const weekStartDate = addWeeks(startDate, timelineWeek);
      const dayOfMonth = weekStartDate.getDate();
      weekCell.textContent = `${dayOfMonth} ${formatWeekLabel(timelineWeek)}`;
      if (monthBoundaryWeeks.has(w + 1)) weekCell.classList.add("month-divider");
      if (maxWeeksInWindow !== null && timelineWeek + 1 === maxWeeksInWindow) weekCell.classList.add("window-end-week");
      if (maxWeeksInWindow !== null && timelineWeek + 1 > maxWeeksInWindow) weekCell.classList.add("window-overflow-week");
      weeksRow.appendChild(weekCell);
    }
    board.appendChild(weeksRow);

    const tracks = applyManifestToTracks(scheduled, layoutManifest, visibleStartWeek, dataTotalWeeks);
    const rowContexts = [];

    function relayoutRowContext(rowContext) {
      if (!rowContext) return;
      relayoutCardsLayer(rowContext.cardsLayer, rowContext.row);
    }

    function findRowContextByClientY(clientY) {
      if (!Number.isFinite(clientY)) return null;
      for (const rowContext of rowContexts) {
        const rect = rowContext.row.getBoundingClientRect();
        if (clientY >= rect.top && clientY <= rect.bottom) return rowContext;
      }
      let nearest = null;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const rowContext of rowContexts) {
        const rect = rowContext.row.getBoundingClientRect();
        const centerY = (rect.top + rect.bottom) / 2;
        const distance = Math.abs(clientY - centerY);
        if (distance < nearestDistance) {
          nearest = rowContext;
          nearestDistance = distance;
        }
      }
      return nearest;
    }

    for (const track of tracks) {
      const row = document.createElement("div");
      row.className = "lane-row";

      for (let w = 0; w < visibleWeekCount; w++) {
        const timelineWeek = visibleStartWeek + w;
        const cell = document.createElement("div");
        cell.className = "lane-grid-cell";
        if (monthBoundaryWeeks.has(w + 1)) cell.classList.add("month-divider");
        if (maxWeeksInWindow !== null && timelineWeek + 1 === maxWeeksInWindow) cell.classList.add("window-end-week");
        if (maxWeeksInWindow !== null && timelineWeek + 1 > maxWeeksInWindow) cell.classList.add("window-overflow-week");
        row.appendChild(cell);
      }

      const cardsLayer = document.createElement("div");
      cardsLayer.className = "cards-layer";
      const rowContext = { row, cardsLayer, rowIndex: rowContexts.length };
      rowContexts.push(rowContext);

      for (const t of track) {
        const prettyType = typeLabel[t.type] || t.type;
        const statusClass = toStatusClass(t.status);
        const duration = t.endWeek - t.startWeek;

        const card = document.createElement("div");
        card.className = "task-card";
        card.dataset.taskId = t.id;
        applyCardUiPosition(card, t.startWeek, duration, visibleStartWeek);
        card.style.borderLeftColor = laneColor[t.type] || "#94a3b8";
        if (t.exceedsWindow) card.classList.add("task-overflow");
        updateCardMetaForUiPosition(card, t, t.startWeek, t.endWeek);
        card.addEventListener("click", () => {
          if (card.dataset.suppressClick === "true") {
            card.dataset.suppressClick = "false";
            return;
          }
          const detailsHtml = buildTaskDetailsHtml(t, scheduledById, startDate);
          detailsSidebar.open(t, detailsHtml);
        });

        card.innerHTML = `
          <div class="task-top">
            <span class="task-id">${t.id}</span>
            <span class="task-status ${statusClass}">${t.status}</span>
          </div>
          <div class="task-name">${t.name}</div>
          <div class="task-submeta">${t.assignee || "Unavailable"}</div>
          <div class="task-bottom">
            <span class="task-type-bottom">${prettyType}</span>
            <span class="task-meta">${t.size} (${duration}w) • ${formatWeekRangeLabel(t.startWeek, t.endWeek)}</span>
          </div>
        `;
        enableCardDragAndDrop(
          card,
          t,
          board,
          visibleStartWeek,
          dataTotalWeeks,
          visibleStartWeek,
          () => rowContext,
          (nextRowContext) => {
            card._rowContext = nextRowContext;
          },
          findRowContextByClientY,
          relayoutRowContext
        );
        card._rowContext = rowContext;
        cardsLayer.appendChild(card);
      }

      relayoutRowContext(rowContext);
      row.appendChild(cardsLayer);
      board.appendChild(row);
    }
    appState.rowContexts = rowContexts;
    appState.boardBounds = {
      visibleStartWeek,
      maxEndWeekExclusive: dataTotalWeeks
    };

    function relayoutAllRowsIfCurrentRender() {
      if (appState.rowContexts !== rowContexts) return;
      for (const rowContext of rowContexts) {
        relayoutCardsLayer(rowContext.cardsLayer, rowContext.row);
      }
    }

    // Run follow-up relayout passes so stacked cards remain correct after
    // async font/layout settling (common after loading a manifest).
    window.requestAnimationFrame(() => {
      relayoutAllRowsIfCurrentRender();
      window.requestAnimationFrame(relayoutAllRowsIfCurrentRender);
    });
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(relayoutAllRowsIfCurrentRender);
    }
  } catch (err) {
    errorsEl.classList.remove("hidden");
    errorsEl.textContent = "Data validation/scheduling error: " + err.message;
  }
}

function makeExportFilename(prefix, suffix = "") {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${prefix}${suffix ? `-${suffix}` : ""}-${stamp}.png`;
}

function downloadCanvas(canvas, filename) {
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = filename;
  link.click();
}

async function captureBoardCanvas(board) {
  if (typeof window.html2canvas !== "function") {
    throw new Error("Export library unavailable. Please refresh and try again.");
  }
  const rect = board.getBoundingClientRect();
  const captureScale = Math.max(1, Math.min(2, 7680 / Math.max(rect.width, 1)));
  return window.html2canvas(board, {
    backgroundColor: "#ffffff",
    useCORS: true,
    scale: captureScale,
    logging: false
  });
}

function buildTargetCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  return { canvas, ctx };
}

function exportSingleFit(sourceCanvas) {
  const targetWidth = 7680;
  const targetHeight = 4320;
  const { canvas, ctx } = buildTargetCanvas(targetWidth, targetHeight);

  const scale = Math.min(targetWidth / sourceCanvas.width, targetHeight / sourceCanvas.height);
  const drawW = sourceCanvas.width * scale;
  const drawH = sourceCanvas.height * scale;
  const drawX = (targetWidth - drawW) / 2;
  const drawY = (targetHeight - drawH) / 2;

  ctx.drawImage(sourceCanvas, drawX, drawY, drawW, drawH);
  downloadCanvas(canvas, makeExportFilename("roadmap-fit-8k"));
}

function exportMultiSlice(sourceCanvas) {
  const targetWidth = 7680;
  const targetHeight = 4320;
  const ratio = targetWidth / targetHeight;
  const fullSrcHeight = sourceCanvas.height;
  const maxSliceSrcWidth = fullSrcHeight * ratio;
  const sliceSrcWidth = Math.min(sourceCanvas.width, maxSliceSrcWidth);
  const sliceCount = Math.max(1, Math.ceil(sourceCanvas.width / sliceSrcWidth));

  for (let i = 0; i < sliceCount; i++) {
    const srcX = i * sliceSrcWidth;
    const srcW = Math.min(sliceSrcWidth, sourceCanvas.width - srcX);
    const { canvas, ctx } = buildTargetCanvas(targetWidth, targetHeight);
    const drawW = targetHeight * (srcW / fullSrcHeight);
    const drawX = (targetWidth - drawW) / 2;
    ctx.drawImage(sourceCanvas, srcX, 0, srcW, fullSrcHeight, drawX, 0, drawW, targetHeight);
    downloadCanvas(canvas, makeExportFilename("roadmap-slice-8k", `${String(i + 1).padStart(2, "0")}of${String(sliceCount).padStart(2, "0")}`));
  }
}

function getManifestStatusElement() {
  return document.getElementById("manifest-status");
}

function getManifestLastLinkElement() {
  return document.getElementById("manifest-last-link");
}

function setManifestStatus(message) {
  const statusEl = getManifestStatusElement();
  if (!statusEl) return;
  statusEl.textContent = message;
}

function setLastManifestLink(fileName, contentText) {
  const linkEl = getManifestLastLinkElement();
  if (!linkEl) return;
  if (!fileName || !contentText) {
    linkEl.classList.add("hidden");
    linkEl.removeAttribute("href");
    return;
  }
  const blob = new Blob([contentText], { type: "application/json" });
  const objectUrl = URL.createObjectURL(blob);
  linkEl.href = objectUrl;
  linkEl.download = fileName;
  linkEl.textContent = `Open last saved manifest (${fileName})`;
  linkEl.classList.remove("hidden");
}

function supportsFolderManifestPersistence() {
  return typeof window.showDirectoryPicker === "function";
}

function supportsHandleStorage() {
  return typeof window.indexedDB !== "undefined";
}

function openManifestHandleDb() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(MANIFEST_HANDLE_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MANIFEST_HANDLE_STORE)) {
        db.createObjectStore(MANIFEST_HANDLE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open manifest handle database."));
  });
}

function loadStoredManifestDirectoryHandle() {
  return new Promise(async (resolve, reject) => {
    if (!supportsHandleStorage()) {
      resolve(null);
      return;
    }
    let db;
    try {
      db = await openManifestHandleDb();
    } catch (error) {
      reject(error);
      return;
    }
    const tx = db.transaction(MANIFEST_HANDLE_STORE, "readonly");
    const store = tx.objectStore(MANIFEST_HANDLE_STORE);
    const request = store.get(MANIFEST_HANDLE_KEY);
    request.onsuccess = () => {
      resolve(request.result || null);
      db.close();
    };
    request.onerror = () => {
      reject(request.error || new Error("Failed to read stored manifest folder handle."));
      db.close();
    };
  });
}

function saveManifestDirectoryHandle(handle) {
  return new Promise(async (resolve, reject) => {
    if (!supportsHandleStorage()) {
      resolve();
      return;
    }
    let db;
    try {
      db = await openManifestHandleDb();
    } catch (error) {
      reject(error);
      return;
    }
    const tx = db.transaction(MANIFEST_HANDLE_STORE, "readwrite");
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("Failed to save manifest folder handle."));
    };
    tx.objectStore(MANIFEST_HANDLE_STORE).put(handle, MANIFEST_HANDLE_KEY);
  });
}

async function applyManifestDirectoryHandle(handle) {
  appState.manifestDirectoryHandle = handle;
  await refreshManifestEntries();
  const folderName = handle.name || MANIFEST_FOLDER_NAME;
  setManifestStatus(`Using ${folderName} folder manifests.`);
}

async function restoreManifestDirectoryHandle() {
  if (!supportsFolderManifestPersistence()) return false;
  if (!supportsHandleStorage()) return false;
  try {
    const handle = await loadStoredManifestDirectoryHandle();
    if (!handle) return false;
    const permission = await handle.queryPermission({ mode: "readwrite" });
    if (permission !== "granted") return false;
    await applyManifestDirectoryHandle(handle);
    return true;
  } catch (_) {
    return false;
  }
}

async function requestManifestDirectoryHandle() {
  if (!supportsFolderManifestPersistence()) {
    throw new Error("Directory picker is not supported in this browser.");
  }
  const handle = await window.showDirectoryPicker({ mode: "readwrite", id: "roadmap-versions-manifests" });
  await applyManifestDirectoryHandle(handle);
  try {
    await saveManifestDirectoryHandle(handle);
  } catch (_) {
    // Non-fatal: saving handle for auto-restore is best-effort.
  }
  return handle;
}

async function ensureManifestDirectoryHandle() {
  if (appState.manifestDirectoryHandle) {
    const permission = await appState.manifestDirectoryHandle.queryPermission({ mode: "readwrite" });
    if (permission === "granted") return appState.manifestDirectoryHandle;
  }

  const restored = await restoreManifestDirectoryHandle();
  if (restored && appState.manifestDirectoryHandle) return appState.manifestDirectoryHandle;

  setManifestStatus(`Grant access to the ${MANIFEST_FOLDER_NAME} folder to save/load manifests.`);
  return requestManifestDirectoryHandle();
}

async function writeManifestIndexToHandle() {
  if (!appState.manifestDirectoryHandle) return;
  const fileNames = appState.manifestEntries
    .map((entry) => entry.name)
    .filter((name) => name.startsWith("roadmap-manifest-") && name.toLowerCase().endsWith(".json"))
    .sort((a, b) => a.localeCompare(b))
    .reverse();
  const indexHandle = await appState.manifestDirectoryHandle.getFileHandle(MANIFEST_INDEX_FILENAME, { create: true });
  const writer = await indexHandle.createWritable();
  await writer.write(`${JSON.stringify({ manifests: fileNames }, null, 2)}\n`);
  await writer.close();
}

function getManifestHistorySelect() {
  return document.getElementById("manifest-history-select");
}

function formatHistoryLabel(entry) {
  const savedAt = entry.manifest?.savedAt ? new Date(entry.manifest.savedAt) : null;
  const prettyDate = savedAt && !Number.isNaN(savedAt.getTime())
    ? savedAt.toLocaleString()
    : entry.name;
  return `${entry.name} (${prettyDate})`;
}

function updateManifestHistorySelect() {
  const select = getManifestHistorySelect();
  if (!select) return;
  const previousValue = select.value;
  clearChildren(select);
  if (appState.manifestEntries.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No manifests loaded";
    select.appendChild(option);
    return;
  }
  for (const entry of appState.manifestEntries) {
    const option = document.createElement("option");
    option.value = entry.name;
    option.textContent = formatHistoryLabel(entry);
    select.appendChild(option);
  }
  if (previousValue) {
    const hasPreviousValue = appState.manifestEntries.some((entry) => entry.name === previousValue);
    if (hasPreviousValue) {
      select.value = previousValue;
    }
  }
}

async function readManifestFromHandle(fileHandle) {
  const file = await fileHandle.getFile();
  const text = await file.text();
  const manifest = JSON.parse(text);
  return { file, text, manifest };
}

async function readManifestFromUrl(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch manifest (${response.status})`);
  }
  const text = await response.text();
  const manifest = JSON.parse(text);
  return { text, manifest };
}

function normalizeManifestIndexPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.manifests)) return payload.manifests;
  return [];
}

async function loadManifestEntriesFromVersionsFolder() {
  const indexUrl = `./${MANIFEST_FOLDER_NAME}/${MANIFEST_INDEX_FILENAME}`;
  try {
    const response = await fetch(indexUrl, { cache: "no-store" });
    if (!response.ok) return [];
    const payload = await response.json();
    const fileNames = normalizeManifestIndexPayload(payload);
    const entries = [];
    for (const fileName of fileNames) {
      const name = String(fileName || "").trim();
      if (!name.startsWith("roadmap-manifest-") || !name.toLowerCase().endsWith(".json")) continue;
      try {
        const url = `./${MANIFEST_FOLDER_NAME}/${encodeURIComponent(name)}`;
        const loaded = await readManifestFromUrl(url);
        entries.push({
          name,
          url,
          source: "versions",
          manifest: loaded.manifest
        });
      } catch (_) {
        // Skip missing or invalid files referenced by index.
      }
    }
    return entries;
  } catch (_) {
    return [];
  }
}

function isLocalFileProtocol() {
  return String(window.location.protocol || "").toLowerCase() === "file:";
}

async function canEnumerateDirectoryHandle() {
  if (!appState.manifestDirectoryHandle) return false;
  try {
    const permission = await appState.manifestDirectoryHandle.queryPermission({ mode: "readwrite" });
    return permission === "granted";
  } catch (_) {
    return false;
  }
}

async function refreshManifestEntries() {
  const entriesByName = new Map();

  const versionEntries = await loadManifestEntriesFromVersionsFolder();
  for (const entry of versionEntries) entriesByName.set(entry.name, entry);

  if (await canEnumerateDirectoryHandle()) {
    for await (const [name, handle] of appState.manifestDirectoryHandle.entries()) {
      if (handle.kind !== "file") continue;
      if (!name.toLowerCase().endsWith(".json")) continue;
      if (!name.startsWith("roadmap-manifest-")) continue;
      try {
        const loaded = await readManifestFromHandle(handle);
        entriesByName.set(name, {
          name,
          handle,
          source: "handle",
          manifest: loaded.manifest
        });
      } catch (_) {
        // Skip files that are not valid manifest JSON.
      }
    }
  }

  const entries = Array.from(entriesByName.values());
  entries.sort((a, b) => a.name.localeCompare(b.name)).reverse();
  appState.manifestEntries = entries;
  updateManifestHistorySelect();
  return entries.length;
}

async function saveManifestSnapshot() {
  const currentManifest = createLayoutManifest(appState.baseData);
  const response = await fetch("/api/manifests", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ manifest: currentManifest })
  });
  if (!response.ok) {
    let message = `Failed to save manifest (${response.status})`;
    try {
      const payload = await response.json();
      if (payload?.error) message = payload.error;
    } catch (_) {
      // Keep default message.
    }
    throw new Error(message);
  }
  const payload = await response.json();
  const fileName = String(payload?.fileName || "");
  const version = Number(payload?.version || 0);
  if (!fileName || !Number.isFinite(version) || version <= 0) {
    throw new Error("Save response was missing manifest metadata.");
  }
  const text = JSON.stringify(currentManifest, null, 2);

  await refreshManifestEntries();
  setLastManifestLink(fileName, text);
  setManifestStatus(`Saved manifest version v${String(version).padStart(4, "0")} as ${fileName}.`);
  appState.activeManifest = currentManifest;
}

async function loadSelectedManifest() {
  const select = getManifestHistorySelect();
  const selectedName = String(select?.value || "");
  if (!selectedName) {
    throw new Error("Select a manifest version first.");
  }

  await refreshManifestEntries();

  const selected = appState.manifestEntries.find((entry) => entry.name === selectedName);
  if (!selected) {
    throw new Error("Selected manifest was not found in versions.");
  }
  let loaded;
  if (selected.source === "handle" && selected.handle) {
    loaded = await readManifestFromHandle(selected.handle);
  } else if (selected.url) {
    loaded = await readManifestFromUrl(selected.url);
  } else {
    throw new Error("Selected manifest has no readable source.");
  }
  appState.activeManifest = loaded.manifest;
  render(appState.baseData, { layoutManifest: appState.activeManifest });
  setLastManifestLink(selected.name, loaded.text);
  setManifestStatus(`Loaded manifest: ${selected.name}`);
}

function resetLayoutToBaseline() {
  appState.activeManifest = null;
  render(appState.baseData);
  setManifestStatus("Layout reset to baseline algorithm output from roadmap-data.js.");
}

function initManifestControls() {
  const saveBtn = document.getElementById("save-manifest-btn");
  const loadBtn = document.getElementById("load-manifest-btn");
  const resetBtn = document.getElementById("reset-layout-btn");

  if (!saveBtn || !loadBtn || !resetBtn) return;
  if (saveBtn.dataset.bound === "true") return;

  saveBtn.addEventListener("click", async () => {
    try {
      await saveManifestSnapshot();
    } catch (error) {
      setManifestStatus(`Save failed: ${error.message}`);
    }
  });

  loadBtn.addEventListener("click", async () => {
    try {
      await loadSelectedManifest();
    } catch (error) {
      setManifestStatus(`Load failed: ${error.message}`);
    }
  });

  resetBtn.addEventListener("click", () => {
    resetLayoutToBaseline();
  });

  (async () => {
    await refreshManifestEntries();
    setManifestStatus(`Save/load uses ${MANIFEST_FOLDER_NAME} folder manifests.`);
  })();
  saveBtn.dataset.bound = "true";
}

function initExportControls() {
  const button = document.getElementById("export-png-btn");
  const modeSelect = document.getElementById("export-mode");
  const board = document.getElementById("board");
  if (!button || !modeSelect || !board) return;
  if (button.dataset.bound === "true") return;

  button.addEventListener("click", async () => {
    const mode = modeSelect.value === "slices" ? "slices" : "fit";
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = mode === "slices" ? "Exporting slices..." : "Exporting 8K...";

    try {
      const sourceCanvas = await captureBoardCanvas(board);
      if (mode === "slices") {
        exportMultiSlice(sourceCanvas);
      } else {
        exportSingleFit(sourceCanvas);
      }
    } catch (error) {
      alert(`Export failed: ${error.message}`);
    } finally {
      button.textContent = originalText;
      button.disabled = false;
    }
  });

  button.dataset.bound = "true";
}

function bootRoadmapApp(attempt = 0) {
  if (window.roadmapData && typeof window.roadmapData === "object") {
    appState.baseData = window.roadmapData;
    render(appState.baseData);
    initManifestControls();
    initExportControls();
    return;
  }

  if (attempt >= 100) {
    const errorsEl = document.getElementById("errors");
    if (errorsEl) {
      errorsEl.classList.remove("hidden");
      errorsEl.textContent = "Roadmap data failed to load. Please refresh the page.";
    }
    return;
  }

  window.setTimeout(() => bootRoadmapApp(attempt + 1), 50);
}

bootRoadmapApp();
