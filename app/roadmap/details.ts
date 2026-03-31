// @ts-nocheck

import { addWeeks, laneColor } from "./scheduling";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
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

export function initDetailsSidebar() {
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

export function buildTaskDetailsHtml(task, scheduledById, startDate) {
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
