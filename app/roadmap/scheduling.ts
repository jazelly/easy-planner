// @ts-nocheck

const sizeToWeeks = {
  XS: 1, S: 2, M: 4, L: 6, XL: 8
};

export const laneColor = {
  BA: "#f59e0b",
  DESIGN: "#8b5cf6",
  DEV: "#2563eb",
  QA: "#16a34a"
};

export const typeLabel = {
  BA: "BA",
  DESIGN: "Design",
  DEV: "Dev",
  QA: "QA"
};

export function normalizeStatus(status) {
  const normalized = String(status || "NEW").trim().toUpperCase();
  const allowed = new Set(["NEW", "DELIVERY", "RELEASED", "IN_PROGRESS", "BLOCKED"]);
  return allowed.has(normalized) ? normalized : "NEW";
}

export function toStatusClass(status) {
  return `task-status-${status.toLowerCase().replaceAll("_", "-")}`;
}

export function formatWeekLabel(weekIndex) {
  return weekIndex >= 0 ? `W${weekIndex + 1}` : `B${Math.abs(weekIndex)}`;
}

export function formatWeekRangeLabel(startWeek, endWeekExclusive) {
  const inclusiveEndWeek = endWeekExclusive - 1;
  return `${formatWeekLabel(startWeek)}-${formatWeekLabel(inclusiveEndWeek)}`;
}

export function toDate(isoDate) {
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

export function addWeeks(date, weeks) {
  const d = new Date(date);
  d.setDate(d.getDate() + weeks * 7);
  return d;
}

function topologicalSort(tasks) {
  const byId = new Map();
  const inDegree = new Map();
  const adj = new Map();
  for (const t of tasks) {
    const taskId = String(t.id);
    byId.set(taskId, t);
    inDegree.set(taskId, 0);
    adj.set(taskId, []);
  }

  for (const t of tasks) {
    const taskId = String(t.id);
    for (const dep of t.dependsOn || []) {
      const depId = String(dep);
      if (!byId.has(depId)) {
        throw new Error(`Task ${t.id} depends on missing task ${dep}`);
      }
      inDegree.set(taskId, (inDegree.get(taskId) ?? 0) + 1);
      const adjacency = adj.get(depId);
      if (adjacency) adjacency.push(taskId);
    }
  }

  const ready = [];
  for (const [id, degree] of inDegree.entries()) {
    if (degree === 0) ready.push(id);
  }
  ready.sort((a, b) => byId.get(a).priorityOrder - byId.get(b).priorityOrder);

  const order = [];
  while (ready.length > 0) {
    const id = ready.shift();
    order.push(id);
    for (const nxt of adj.get(id)) {
      const deg = (inDegree.get(nxt) ?? 0) - 1;
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
  return order.map((id) => byId.get(id));
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
  const inclusiveMs = (endDate.getTime() - startDate.getTime()) + DAY_MS;
  return Math.ceil(inclusiveMs / WEEK_MS);
}

export function scheduleTasks(data, startDate) {
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
      const dep = scheduled.find((s) => s.id === depId);
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

export function buildTracks(scheduled) {
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

export function toFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function buildMonthSpans(startDate, totalWeeks, startWeekOffset = 0) {
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

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
