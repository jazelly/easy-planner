// @ts-nocheck

import {
  addWeeks,
  buildMonthSpans,
  buildTracks,
  clamp,
  formatWeekLabel,
  formatWeekRangeLabel,
  laneColor,
  normalizeStatus,
  scheduleTasks,
  toDate,
  toFiniteNumber,
  toStatusClass,
  typeLabel
} from "./scheduling";
import { buildTaskDetailsHtml, initDetailsSidebar } from "./details";
import {
  captureBoardCanvas,
  captureBoardThumbnailDataUrl,
  exportMultiSlice,
  exportSingleFit
} from "./export-utils";
import {
  applyCardUiPosition,
  clearChildren,
  getWeekColumnWidth,
  relayoutCardsLayer,
  sortCardsForRow,
  updateCardMetaForUiPosition
} from "./layout-utils";

const MANIFEST_SCHEMA_VERSION = 1;

const appState = {
  baseData: null,
  boardId: "",
  boardName: "Untitled board",
  activeManifest: null,
  rowContexts: [],
  boardBounds: null,
  manifestEntries: [],
  currentManifestFileName: "",
  lastSavedLayoutSignature: "",
  lastAutoSavedLayoutSignature: "",
  isDirty: false,
  boardNameSaveTimer: null,
  boardNameSaveSeq: 0,
  autosaveTimer: null,
  autosaveSeq: 0,
  edgeControlsRaf: 0,
  initialLoadingPending: true,
  latestRenderSeq: 0,
  settledRenderSeq: 0
};

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
  relayoutRowContext,
  onLayoutChanged
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
    if (moved && typeof onLayoutChanged === "function") onLayoutChanged();
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

function render(data, options = {}) {
  const renderSeq = ++appState.latestRenderSeq;
  const layoutManifest = options.layoutManifest || null;
  const board = document.getElementById("board");
  const boardWrap = getBoardWrapElement();
  const edgeControlsLayer = getBoardEdgeControlsElement();
  const errorsEl = document.getElementById("errors");
  const detailsSidebar = initDetailsSidebar();
  clearChildren(board);
  if (edgeControlsLayer) clearChildren(edgeControlsLayer);
  appState.rowContexts = [];
  appState.boardBounds = null;
  errorsEl.classList.add("hidden");
  errorsEl.textContent = "";
  detailsSidebar.close();

  try {
    const startDate = toDate(data.startDate);
    const { scheduled, window: scheduleWindow } = scheduleTasks(data, startDate);
    const scheduledById = new Map(scheduled.map((item) => [item.id, item]));
    const dataTotalWeeks = Math.max(...scheduled.map(s => s.endWeek), 0) + 2;
    const leftBufferWeeks = 2;
    const visibleStartWeek = -leftBufferWeeks;
    const visibleWeekCount = dataTotalWeeks + leftBufferWeeks;
    const maxWeeksInWindow = scheduleWindow?.maxWeeksInWindow ?? null;

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

    function syncRowAffordances() {
      if (!boardWrap || !edgeControlsLayer) return;
      const scrollTop = boardWrap.scrollTop;
      const wrapHeight = boardWrap.clientHeight;
      for (const rowContext of rowContexts) {
        const top = rowContext.row.offsetTop - scrollTop;
        const height = rowContext.row.offsetHeight;
        const sideBar = rowContext.sideBar;
        const insertBeforeControl = rowContext.insertBeforeControl;
        const insertAfterControl = rowContext.insertAfterControl;

        if (sideBar) {
          sideBar.style.top = `${Math.round(top)}px`;
          sideBar.style.height = `${Math.max(0, Math.round(height))}px`;
          const isVisible = top + height >= 0 && top <= wrapHeight;
          sideBar.classList.toggle("hidden", !isVisible);
        }

        if (insertBeforeControl) {
          insertBeforeControl.style.top = `${Math.round(top - 9)}px`;
          const isVisible = top + height >= -24 && top <= wrapHeight + 24;
          const hiddenByIndex = insertBeforeControl.dataset.hiddenByIndex === "true";
          insertBeforeControl.classList.toggle("hidden", !isVisible || hiddenByIndex);
        }

        if (insertAfterControl) {
          insertAfterControl.style.top = `${Math.round(top + height - 9)}px`;
          const isVisible = top + height >= -24 && top <= wrapHeight + 24;
          const hiddenByIndex = insertAfterControl.dataset.hiddenByIndex === "true";
          insertAfterControl.classList.toggle("hidden", !isVisible || hiddenByIndex);
        }
      }
    }

    function queueSyncRowAffordances() {
      if (!boardWrap || !edgeControlsLayer) return;
      if (appState.edgeControlsRaf) {
        window.cancelAnimationFrame(appState.edgeControlsRaf);
      }
      appState.edgeControlsRaf = window.requestAnimationFrame(() => {
        appState.edgeControlsRaf = 0;
        syncRowAffordances();
      });
    }

    function relayoutRowContext(rowContext) {
      if (!rowContext) return;
      relayoutCardsLayer(rowContext.cardsLayer, rowContext.row);
      queueSyncRowAffordances();
    }

    function updateRowContextIndexes() {
      rowContexts.forEach((rowContext, index) => {
        rowContext.rowIndex = index;
        rowContext.row.dataset.rowIndex = String(index);
      });
    }

    function updateRowInsertionAffordances() {
      rowContexts.forEach((rowContext, index) => {
        const isLast = index === rowContexts.length - 1;
        if (rowContext.insertBeforeControl) {
          rowContext.insertBeforeControl.dataset.insertIndex = String(index);
          rowContext.insertBeforeControl.dataset.hiddenByIndex = index === 0 ? "true" : "false";
        }
        if (rowContext.insertAfterControl) {
          rowContext.insertAfterControl.dataset.insertIndex = String(index + 1);
          rowContext.insertAfterControl.dataset.hiddenByIndex = !isLast ? "true" : "false";
        }
      });
      queueSyncRowAffordances();
    }

    function moveRowContextToIndex(rowContext, targetIndex) {
      const currentIndex = rowContexts.indexOf(rowContext);
      if (currentIndex === -1) return;
      const clampedTarget = clamp(targetIndex, 0, rowContexts.length);
      if (clampedTarget === currentIndex) return;

      rowContexts.splice(currentIndex, 1);
      const normalizedTarget = clampedTarget > currentIndex
        ? clampedTarget - 1
        : clampedTarget;
      rowContexts.splice(normalizedTarget, 0, rowContext);
      const insertBeforeRow = rowContexts[normalizedTarget + 1]?.row || null;
      board.insertBefore(rowContext.row, insertBeforeRow);
      updateRowContextIndexes();
      updateRowInsertionAffordances();
    }

    function findTargetRowIndexForClientY(clientY, draggingRowContext) {
      const candidates = rowContexts.filter((item) => item !== draggingRowContext);
      if (candidates.length === 0) return rowContexts.indexOf(draggingRowContext);
      for (const candidate of candidates) {
        const rect = candidate.row.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        if (clientY < midpoint) return rowContexts.indexOf(candidate);
      }
      return rowContexts.length;
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

    function insertBlankRowAt(index) {
      const clampedIndex = clamp(index, 0, rowContexts.length);
      const rowContext = createRowContext([]);
      const insertBeforeRow = rowContexts[clampedIndex]?.row || null;
      rowContexts.splice(clampedIndex, 0, rowContext);
      board.insertBefore(rowContext.row, insertBeforeRow);
      relayoutRowContext(rowContext);
      updateRowContextIndexes();
      updateRowInsertionAffordances();
      syncSaveStateFromCurrentLayout();
    }

    function createRowContext(track) {
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
      const rowContext = { row, cardsLayer, rowIndex: -1 };

      const sideBar = document.createElement("div");
      sideBar.className = "row-side-bar";
      const dragHandle = document.createElement("button");
      dragHandle.type = "button";
      dragHandle.className = "row-drag-handle";
      dragHandle.setAttribute("aria-label", "Drag to reorder row");
      dragHandle.innerHTML = `
        <span class="row-drag-grip" aria-hidden="true">
          <span class="dot"></span><span class="dot"></span>
          <span class="dot"></span><span class="dot"></span>
          <span class="dot"></span><span class="dot"></span>
        </span>
      `;
      sideBar.appendChild(dragHandle);
      if (edgeControlsLayer) edgeControlsLayer.appendChild(sideBar);

      const insertBeforeControl = document.createElement("button");
      insertBeforeControl.type = "button";
      insertBeforeControl.className = "row-insert-control row-insert-before";
      insertBeforeControl.setAttribute("aria-label", "Add row here");
      insertBeforeControl.innerHTML = `<span class="row-insert-plus" aria-hidden="true">+</span>`;
      insertBeforeControl.addEventListener("click", () => {
        const insertIndex = Math.floor(Number(insertBeforeControl.dataset.insertIndex || "0"));
        insertBlankRowAt(insertIndex);
      });
      if (edgeControlsLayer) edgeControlsLayer.appendChild(insertBeforeControl);

      const insertAfterControl = document.createElement("button");
      insertAfterControl.type = "button";
      insertAfterControl.className = "row-insert-control row-insert-after";
      insertAfterControl.setAttribute("aria-label", "Add row at end");
      insertAfterControl.innerHTML = `<span class="row-insert-plus" aria-hidden="true">+</span>`;
      insertAfterControl.addEventListener("click", () => {
        const insertIndex = Math.floor(Number(insertAfterControl.dataset.insertIndex || String(rowContexts.length)));
        insertBlankRowAt(insertIndex);
      });
      if (edgeControlsLayer) edgeControlsLayer.appendChild(insertAfterControl);

      let affordanceDeactivateTimer = 0;
      function setAffordanceActive(isActive) {
        sideBar.classList.toggle("row-side-bar-active", isActive);
        insertBeforeControl.classList.toggle("row-insert-visible", isActive);
        insertAfterControl.classList.toggle("row-insert-visible", isActive);
      }
      function activateAffordance() {
        if (affordanceDeactivateTimer) {
          window.clearTimeout(affordanceDeactivateTimer);
          affordanceDeactivateTimer = 0;
        }
        setAffordanceActive(true);
      }
      function deactivateAffordanceSoon() {
        if (affordanceDeactivateTimer) window.clearTimeout(affordanceDeactivateTimer);
        affordanceDeactivateTimer = window.setTimeout(() => {
          affordanceDeactivateTimer = 0;
          setAffordanceActive(false);
        }, 40);
      }
      row.addEventListener("mouseenter", activateAffordance);
      row.addEventListener("mouseleave", deactivateAffordanceSoon);
      sideBar.addEventListener("mouseenter", activateAffordance);
      sideBar.addEventListener("mouseleave", deactivateAffordanceSoon);
      insertBeforeControl.addEventListener("mouseenter", activateAffordance);
      insertBeforeControl.addEventListener("mouseleave", deactivateAffordanceSoon);
      insertAfterControl.addEventListener("mouseenter", activateAffordance);
      insertAfterControl.addEventListener("mouseleave", deactivateAffordanceSoon);

      function startRowDrag(clientY) {
        let moved = false;
        row.classList.add("row-dragging");

        function updateDrag(nextClientY) {
          if (!Number.isFinite(nextClientY)) return;
          const targetIndex = findTargetRowIndexForClientY(nextClientY, rowContext);
          const currentIndex = rowContexts.indexOf(rowContext);
          if (targetIndex !== currentIndex) {
            moved = true;
            moveRowContextToIndex(rowContext, targetIndex);
          }
        }

        function finishDrag() {
          row.classList.remove("row-dragging");
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
          document.removeEventListener("touchmove", onTouchMove);
          document.removeEventListener("touchend", onTouchEnd);
          document.removeEventListener("touchcancel", onTouchEnd);
          if (moved) syncSaveStateFromCurrentLayout();
        }

        function onMouseMove(event) {
          updateDrag(event.clientY);
        }
        function onMouseUp() {
          finishDrag();
        }
        function onTouchMove(event) {
          const touch = event.touches[0];
          if (!touch) return;
          updateDrag(touch.clientY);
          event.preventDefault();
        }
        function onTouchEnd() {
          finishDrag();
        }

        updateDrag(clientY);
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
        document.addEventListener("touchmove", onTouchMove, { passive: false });
        document.addEventListener("touchend", onTouchEnd);
        document.addEventListener("touchcancel", onTouchEnd);
      }

      dragHandle.addEventListener("mousedown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        startRowDrag(event.clientY);
      });
      dragHandle.addEventListener("touchstart", (event) => {
        const touch = event.touches[0];
        if (!touch) return;
        event.preventDefault();
        startRowDrag(touch.clientY);
      }, { passive: false });

      rowContext.insertBeforeControl = insertBeforeControl;
      rowContext.insertAfterControl = insertAfterControl;
      rowContext.sideBar = sideBar;

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
          () => card._rowContext || rowContext,
          (nextRowContext) => {
            card._rowContext = nextRowContext;
          },
          findRowContextByClientY,
          relayoutRowContext,
          () => {
            syncSaveStateFromCurrentLayout();
          }
        );
        card._rowContext = rowContext;
        cardsLayer.appendChild(card);
      }

      relayoutRowContext(rowContext);
      row.appendChild(cardsLayer);
      return rowContext;
    }

    for (const track of tracks) {
      const rowContext = createRowContext(track);
      rowContexts.push(rowContext);
      board.appendChild(rowContext.row);
      relayoutRowContext(rowContext);
    }
    updateRowContextIndexes();
    updateRowInsertionAffordances();
    if (boardWrap) {
      boardWrap.onscroll = () => {
        queueSyncRowAffordances();
      };
    }
    window.onresize = () => {
      queueSyncRowAffordances();
    };
    queueSyncRowAffordances();
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
    const scheduleFrame = typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame.bind(window)
      : (callback) => window.setTimeout(callback, 16);

    // Run follow-up relayout passes so stacked cards remain correct after
    // async font/layout settling (common after loading a manifest).
    scheduleFrame(() => {
      relayoutAllRowsIfCurrentRender();
      scheduleFrame(async () => {
        relayoutAllRowsIfCurrentRender();
        if (document.fonts && document.fonts.ready) {
          try {
            await Promise.race([
              document.fonts.ready,
              new Promise((resolve) => window.setTimeout(resolve, 450))
            ]);
          } catch (_) {
            // Continue with current layout if font readiness fails.
          }
          relayoutAllRowsIfCurrentRender();
        }
        if (appState.latestRenderSeq === renderSeq) {
          appState.settledRenderSeq = renderSeq;
          maybeRevealBoard();
        }
      });
    });
  } catch (err) {
    errorsEl.classList.remove("hidden");
    errorsEl.textContent = "Data validation/scheduling error: " + err.message;
    if (appState.latestRenderSeq === renderSeq) {
      appState.settledRenderSeq = renderSeq;
      maybeRevealBoard();
    }
  }
}

function getManifestStatusElement() {
  return document.getElementById("manifest-status");
}

function getManifestLastLinkElement() {
  return document.getElementById("manifest-last-link");
}

function getBoardNameInputElement() {
  return document.getElementById("board-name-input");
}

function getBoardNameSaveStatusElement() {
  return document.getElementById("board-name-save-status");
}

function getVersionDashboardListElement() {
  return document.getElementById("version-dashboard-list");
}

function getToastHostElement() {
  return document.getElementById("toast-host");
}

function getBoardWrapElement() {
  return document.getElementById("board-wrap");
}

function getBoardEdgeControlsElement() {
  return document.getElementById("board-edge-controls");
}

function getBoardLoadingElement() {
  return document.getElementById("board-loading");
}

function setBoardLoading(isLoading) {
  const boardWrap = getBoardWrapElement();
  const loadingEl = getBoardLoadingElement();
  if (boardWrap) {
    boardWrap.classList.toggle("board-wrap-loading", Boolean(isLoading));
    boardWrap.setAttribute("aria-busy", String(Boolean(isLoading)));
  }
  if (loadingEl) {
    loadingEl.classList.toggle("hidden", !isLoading);
  }
}

function maybeRevealBoard() {
  if (appState.initialLoadingPending) return;
  if (appState.settledRenderSeq !== appState.latestRenderSeq) return;
  setBoardLoading(false);
}

function setManifestStatus(message) {
  const statusEl = getManifestStatusElement();
  if (!statusEl) return;
  statusEl.textContent = String(message || "");
}

function showToast(message, durationMs = 2200) {
  const host = getToastHostElement();
  if (!host) return;
  const toast = document.createElement("div");
  toast.className = "app-toast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.textContent = String(message || "").trim() || "Saved";
  host.appendChild(toast);

  window.requestAnimationFrame(() => {
    toast.classList.add("show");
  });

  window.setTimeout(() => {
    toast.classList.remove("show");
    toast.classList.add("hide");
    window.setTimeout(() => {
      toast.remove();
    }, 220);
  }, durationMs);
}

function setLastManifestLink(fileName) {
  const linkEl = getManifestLastLinkElement();
  if (!linkEl) return;
  if (!fileName) {
    linkEl.classList.add("hidden");
    linkEl.removeAttribute("href");
    linkEl.removeAttribute("download");
    return;
  }
  const params = new URLSearchParams({
    boardId: appState.boardId,
    name: fileName,
    raw: "1"
  });
  linkEl.href = `/api/manifests?${params.toString()}`;
  linkEl.download = fileName;
  linkEl.textContent = "Open latest saved version";
  linkEl.classList.remove("hidden");
}

function setSaveStateDirty(isDirty) {
  appState.isDirty = Boolean(isDirty);
}

function setBoardNameSaveStatus(state, label = "") {
  const statusEl = getBoardNameSaveStatusElement();
  if (!statusEl) return;
  const spinnerEl = statusEl.querySelector(".status-spinner");
  const textEl = statusEl.querySelector(".status-label");
  const resolvedLabel = String(label || (
    state === "saving" ? "Saving..." :
      state === "error" ? "Save failed" :
        state === "unsaved" ? "Unsaved" :
          "Saved"
  ));
  if (textEl) textEl.textContent = resolvedLabel;
  if (spinnerEl) {
    spinnerEl.classList.toggle("hidden", state !== "saving");
  }
  statusEl.dataset.state = state;
}

async function fetchBoardMeta(includeSnapshot = false) {
  const params = new URLSearchParams();
  if (includeSnapshot) params.set("includeSnapshot", "1");
  const query = params.toString();
  const url = `/api/boards/${encodeURIComponent(appState.boardId)}${query ? `?${query}` : ""}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    let message = `Failed to load board metadata (${response.status})`;
    try {
      const payload = await response.json();
      if (payload?.error) message = payload.error;
    } catch (_) {
      // Keep default message.
    }
    throw new Error(message);
  }
  const payload = await response.json();
  return payload?.board || null;
}

async function persistBoardName(nextName) {
  const normalizedName = String(nextName || "").trim() || "Untitled board";
  const response = await fetch(`/api/boards/${encodeURIComponent(appState.boardId)}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      name: normalizedName
    })
  });
  if (!response.ok) {
    let message = `Failed to save board name (${response.status})`;
    try {
      const payload = await response.json();
      if (payload?.error) message = payload.error;
    } catch (_) {
      // Keep default message.
    }
    throw new Error(message);
  }
  const payload = await response.json();
  const savedName = String(payload?.board?.name || normalizedName).trim() || "Untitled board";
  appState.boardName = savedName;
  return savedName;
}

function initBoardHeaderControls() {
  const input = getBoardNameInputElement();
  if (!input) return;
  if (input.dataset.bound === "true") return;

  let lastCommittedName = appState.boardName;

  function scheduleSave(immediate = false) {
    if (appState.boardNameSaveTimer) {
      window.clearTimeout(appState.boardNameSaveTimer);
      appState.boardNameSaveTimer = null;
    }
    const run = async () => {
      const currentValue = String(input.value || "").trim() || "Untitled board";
      if (currentValue === lastCommittedName) {
        setBoardNameSaveStatus("saved", "Saved");
        return;
      }
      setBoardNameSaveStatus("saving", "Saving...");
      const saveSeq = ++appState.boardNameSaveSeq;
      try {
        const savedName = await persistBoardName(currentValue);
        if (saveSeq !== appState.boardNameSaveSeq) return;
        lastCommittedName = savedName;
        input.value = savedName;
        setBoardNameSaveStatus("saved", "Saved");
      } catch (error) {
        if (saveSeq !== appState.boardNameSaveSeq) return;
        const message = error instanceof Error ? error.message : "Failed to save board name.";
        setBoardNameSaveStatus("error", message);
      }
    };
    if (immediate) {
      void run();
      return;
    }
    appState.boardNameSaveTimer = window.setTimeout(() => {
      appState.boardNameSaveTimer = null;
      void run();
    }, 500);
  }

  input.addEventListener("input", () => {
    setBoardNameSaveStatus("unsaved", "Unsaved");
    scheduleSave(false);
  });

  input.addEventListener("blur", () => {
    scheduleSave(true);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    scheduleSave(true);
    input.blur();
  });

  input.dataset.bound = "true";
  const nextName = String(appState.boardName || "Untitled board").trim() || "Untitled board";
  appState.boardName = nextName;
  lastCommittedName = nextName;
  input.value = nextName;
  setBoardNameSaveStatus("saved", "Saved");
}

function getCurrentLayoutSignature() {
  if (!appState.baseData || appState.rowContexts.length === 0) return "";
  const layoutManifest = createLayoutManifest(appState.baseData);
  return JSON.stringify(layoutManifest.rows || []);
}

function markCurrentLayoutAsSaved() {
  const signature = getCurrentLayoutSignature();
  appState.lastSavedLayoutSignature = signature;
  appState.lastAutoSavedLayoutSignature = signature;
  setSaveStateDirty(false);
}

function syncSaveStateFromCurrentLayout() {
  const currentSignature = getCurrentLayoutSignature();
  if (!currentSignature) return;
  if (!appState.lastSavedLayoutSignature) {
    appState.lastSavedLayoutSignature = currentSignature;
  }
  const nextDirty = currentSignature !== appState.lastSavedLayoutSignature;
  setSaveStateDirty(nextDirty);
  if (nextDirty) {
    scheduleLayoutAutosave();
  }
}

function getManifestHistorySelect() {
  return document.getElementById("manifest-history-select");
}

function getManifestFromQueryParam() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    return String(params.get("manifest") || "").trim();
  } catch (_) {
    return "";
  }
}

function getBoardIdFromPath() {
  try {
    const parts = String(window.location.pathname || "").split("/").filter(Boolean);
    if (parts.length >= 2 && parts[0] === "boards") return String(parts[1] || "").trim();
    return "";
  } catch (_) {
    return "";
  }
}

function formatHistoryLabel(entry) {
  const savedAt = entry?.savedAt ? new Date(entry.savedAt) : null;
  const prettyDate = savedAt && !Number.isNaN(savedAt.getTime())
    ? savedAt.toLocaleString()
    : (entry?.fileName || "unknown");
  return `v${String(entry.version || 0).padStart(4, "0")} - ${prettyDate}`;
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
    option.value = entry.fileName;
    option.textContent = `${formatHistoryLabel(entry)} (${entry.fileName})`;
    select.appendChild(option);
  }
  const targetValue = appState.currentManifestFileName || previousValue;
  if (!targetValue) return;
  const hasTarget = appState.manifestEntries.some((entry) => entry.fileName === targetValue);
  if (hasTarget) {
    select.value = targetValue;
  }
}

function renderVersionDashboard() {
  const listEl = getVersionDashboardListElement();
  if (!listEl) return;
  clearChildren(listEl);

  if (appState.manifestEntries.length === 0) {
    const placeholder = document.createElement("p");
    placeholder.className = "hint";
    placeholder.textContent = "No saved versions yet.";
    listEl.appendChild(placeholder);
    return;
  }

  for (const entry of appState.manifestEntries) {
    const card = document.createElement("article");
    card.className = "version-item";

    const head = document.createElement("div");
    head.className = "version-item-head";
    const title = document.createElement("h3");
    title.className = "version-item-title";
    title.textContent = `v${String(entry.version || 0).padStart(4, "0")}`;
    const badge = document.createElement("span");
    badge.className = "task-status task-status-new";
    badge.textContent = entry.fileName === appState.currentManifestFileName ? "Current" : "Previous";
    head.appendChild(title);
    head.appendChild(badge);

    const meta = document.createElement("p");
    meta.className = "version-item-meta";
    meta.textContent = entry.savedAt
      ? new Date(entry.savedAt).toLocaleString()
      : (entry.createdAt ? new Date(entry.createdAt).toLocaleString() : entry.fileName);

    const thumb = document.createElement("img");
    thumb.className = "version-item-thumb";
    thumb.alt = `Thumbnail for ${entry.fileName}`;
    thumb.src = entry.thumbnailUrl || "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";

    const actions = document.createElement("div");
    actions.className = "version-item-actions";
    const loadButton = document.createElement("button");
    loadButton.type = "button";
    loadButton.className = "secondary-btn";
    loadButton.textContent = "Load";
    loadButton.addEventListener("click", async () => {
      try {
        await loadSelectedManifest(entry.fileName);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load selected version.";
        showToast(`Load failed: ${message}`, 2800);
      }
    });
    actions.appendChild(loadButton);

    card.appendChild(head);
    card.appendChild(meta);
    card.appendChild(thumb);
    card.appendChild(actions);
    listEl.appendChild(card);
  }
}

async function fetchManifestByName(fileName) {
  const params = new URLSearchParams({
    boardId: appState.boardId,
    name: fileName
  });
  const response = await fetch(`/api/manifests?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) {
    let message = `Failed to fetch manifest (${response.status})`;
    try {
      const payload = await response.json();
      if (payload?.error) message = payload.error;
    } catch (_) {
      // Keep default error
    }
    throw new Error(message);
  }
  const payload = await response.json();
  if (!payload?.manifest || typeof payload.manifest !== "object") {
    throw new Error("Manifest payload was invalid.");
  }
  return payload.manifest;
}

async function refreshManifestEntries() {
  const params = new URLSearchParams({
    boardId: appState.boardId
  });
  const response = await fetch(`/api/manifests?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) {
    let message = `Failed to load versions (${response.status})`;
    try {
      const payload = await response.json();
      if (payload?.error) message = payload.error;
    } catch (_) {
      // Keep default error
    }
    throw new Error(message);
  }
  const payload = await response.json();
  const entries = Array.isArray(payload?.manifests) ? payload.manifests : [];
  appState.manifestEntries = entries.slice().sort((a, b) => Number(b.version || 0) - Number(a.version || 0));
  updateManifestHistorySelect();
  renderVersionDashboard();
}

async function saveLayoutAutosave() {
  const currentManifest = createLayoutManifest(appState.baseData);
  const response = await fetch("/api/manifests", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      boardId: appState.boardId,
      mode: "autosave",
      manifest: currentManifest
    })
  });
  if (!response.ok) {
    let message = `Failed to autosave layout (${response.status})`;
    try {
      const payload = await response.json();
      if (payload?.error) message = payload.error;
    } catch (_) {
      // Keep default message.
    }
    throw new Error(message);
  }
  appState.lastAutoSavedLayoutSignature = getCurrentLayoutSignature();
}

function scheduleLayoutAutosave() {
  if (!appState.baseData || !appState.boardId) return;
  const currentSignature = getCurrentLayoutSignature();
  if (!currentSignature || currentSignature === appState.lastAutoSavedLayoutSignature) return;
  if (appState.autosaveTimer) {
    window.clearTimeout(appState.autosaveTimer);
    appState.autosaveTimer = null;
  }
  const pendingSeq = ++appState.autosaveSeq;
  appState.autosaveTimer = window.setTimeout(async () => {
    appState.autosaveTimer = null;
    if (!appState.isDirty) return;
    if (pendingSeq !== appState.autosaveSeq) return;
    const latestSignature = getCurrentLayoutSignature();
    if (!latestSignature || latestSignature === appState.lastAutoSavedLayoutSignature) return;
    try {
      await saveLayoutAutosave();
    } catch (_) {
      // Silent failure: manual save still available and versioned.
    }
  }, 1500);
}

async function saveManifestSnapshot() {
  const board = document.getElementById("board");
  const currentManifest = createLayoutManifest(appState.baseData);
  let thumbnailDataUrl = null;
  if (board) {
    try {
      thumbnailDataUrl = await captureBoardThumbnailDataUrl(board);
    } catch (_) {
      thumbnailDataUrl = null;
    }
  }
  const response = await fetch("/api/manifests", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      boardId: appState.boardId,
      manifest: currentManifest,
      thumbnailDataUrl
    })
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
  appState.lastAutoSavedLayoutSignature = getCurrentLayoutSignature();
  appState.currentManifestFileName = fileName;
  appState.activeManifest = currentManifest;
  await refreshManifestEntries();
  setLastManifestLink(fileName);
  showToast("Version saved");
  markCurrentLayoutAsSaved();
}

async function loadSelectedManifest(selectedNameOverride = "") {
  const select = getManifestHistorySelect();
  const selectedName = String(selectedNameOverride || select?.value || "");
  if (!selectedName) {
    throw new Error("Select a manifest version first.");
  }
  const manifest = await fetchManifestByName(selectedName);
  appState.activeManifest = manifest;
  appState.currentManifestFileName = selectedName;
  render(appState.baseData, { layoutManifest: appState.activeManifest });
  updateManifestHistorySelect();
  renderVersionDashboard();
  setLastManifestLink(selectedName);
  showToast("Version loaded");
  markCurrentLayoutAsSaved();
}

async function loadAutosavedLayoutIfAvailable() {
  const params = new URLSearchParams({
    boardId: appState.boardId,
    autosave: "1"
  });
  const response = await fetch(`/api/manifests?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) return false;
  const payload = await response.json();
  const manifest = payload?.manifest;
  if (!manifest || typeof manifest !== "object") return false;
  appState.activeManifest = manifest;
  appState.currentManifestFileName = "";
  render(appState.baseData, { layoutManifest: appState.activeManifest });
  markCurrentLayoutAsSaved();
  return true;
}

function resetLayoutToBaseline() {
  appState.activeManifest = null;
  appState.currentManifestFileName = "";
  render(appState.baseData);
  updateManifestHistorySelect();
  renderVersionDashboard();
  showToast("Layout reset");
  markCurrentLayoutAsSaved();
}

function initManifestControls() {
  const saveBtn = document.getElementById("save-manifest-btn");
  const loadBtn = document.getElementById("load-manifest-btn");
  const resetBtn = document.getElementById("reset-layout-btn");

  if (!saveBtn || !resetBtn) return Promise.resolve();
  if (saveBtn.dataset.bound === "true") return Promise.resolve();

  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    const originalLabel = saveBtn.getAttribute("aria-label") || "Save manifest snapshot";
    saveBtn.dataset.busy = "true";
    saveBtn.setAttribute("aria-label", "Saving manifest snapshot");
    saveBtn.setAttribute("title", "Saving manifest snapshot");
    try {
      await saveManifestSnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save version.";
      showToast(`Save failed: ${message}`, 3200);
    } finally {
      saveBtn.removeAttribute("data-busy");
      saveBtn.setAttribute("aria-label", originalLabel);
      saveBtn.setAttribute("title", originalLabel);
      saveBtn.disabled = false;
    }
  });

  if (loadBtn) {
    loadBtn.addEventListener("click", async () => {
      try {
        await loadSelectedManifest();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load selected version.";
        showToast(`Load failed: ${message}`, 2800);
      }
    });
  }

  resetBtn.addEventListener("click", () => {
    resetLayoutToBaseline();
  });

  const initialLoadPromise = (async () => {
    try {
      await refreshManifestEntries();
      const manifestFromQuery = getManifestFromQueryParam();
      if (manifestFromQuery) {
        await loadSelectedManifest(manifestFromQuery);
      } else {
        await loadAutosavedLayoutIfAvailable();
      }
      setManifestStatus("");
      syncSaveStateFromCurrentLayout();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load saved versions.";
      showToast(`Failed to load saved versions: ${message}`, 3200);
    }
  })();
  saveBtn.dataset.bound = "true";
  return initialLoadPromise;
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
    const originalLabel = button.getAttribute("aria-label") || "Export board as PNG (8K)";
    const busyLabel = mode === "slices"
      ? "Exporting readable slices"
      : "Exporting fit image";
    button.dataset.busy = "true";
    button.setAttribute("aria-label", busyLabel);
    button.setAttribute("title", busyLabel);

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
      button.removeAttribute("data-busy");
      button.setAttribute("aria-label", originalLabel);
      button.setAttribute("title", originalLabel);
      button.disabled = false;
    }
  });

  button.dataset.bound = "true";
}

function showBootError(message) {
  const errorsEl = document.getElementById("errors");
  if (errorsEl) {
    errorsEl.classList.remove("hidden");
    errorsEl.textContent = message;
  }
}

async function bootRoadmapApp() {
  setBoardLoading(true);
  appState.initialLoadingPending = true;
  if (!appState.boardId) {
    appState.boardId = getBoardIdFromPath();
  }
  if (!appState.boardId) {
    setBoardLoading(false);
    showBootError("Missing board ID in URL.");
    return;
  }
  try {
    const board = await fetchBoardMeta(true);
    appState.boardName = String(board?.name || "Untitled board").trim() || "Untitled board";
    if (!board?.baseData || typeof board.baseData !== "object") {
      throw new Error("Board data is unavailable.");
    }
    appState.baseData = board.baseData;
    const latestManifest = board?.latestManifest;
    if (latestManifest && typeof latestManifest === "object") {
      appState.activeManifest = latestManifest;
      appState.currentManifestFileName = String(board?.latestManifestFileName || "").trim();
    }
  } catch (error) {
    setBoardLoading(false);
    const message = error instanceof Error ? error.message : "Failed to load board.";
    showBootError(message);
    return;
  }
  initBoardHeaderControls();
  render(appState.baseData, appState.activeManifest ? { layoutManifest: appState.activeManifest } : undefined);
  await initManifestControls();
  initExportControls();
  appState.initialLoadingPending = false;
  maybeRevealBoard();
}

void bootRoadmapApp();

export {};
