// @ts-nocheck

import { formatWeekRangeLabel, toFiniteNumber } from "./scheduling";

export function sortCardsForRow(cards) {
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

export function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function getWeekColumnWidth(board) {
  const raw = getComputedStyle(board).getPropertyValue("--week-col-width").trim();
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 132;
}

export function applyCardUiPosition(card, startWeek, duration, visibleStartWeek = 0) {
  const columnIndex = startWeek - visibleStartWeek;
  card.style.left = `calc(${columnIndex} * var(--week-col-width) + 2px)`;
  card.style.width = `calc(${duration} * var(--week-col-width) - 4px)`;
  card.dataset.uiStartWeek = String(startWeek);
  card.dataset.uiEndWeek = String(startWeek + duration);
}

export function updateCardMetaForUiPosition(card, task, startWeek, endWeek) {
  const duration = endWeek - startWeek;
  const weekRange = formatWeekRangeLabel(startWeek, endWeek);
  const metaEl = card.querySelector(".task-meta");
  if (metaEl) {
    metaEl.textContent = `${task.size} (${duration}w) • ${weekRange}`;
  }
  card.title = `${task.id} | ${task.name}\n${task.type} • ${task.size}\nWeek ${weekRange}`;
}

export function relayoutCardsLayer(cardsLayer, row) {
  const cards = sortCardsForRow(Array.from(cardsLayer.querySelectorAll(".task-card")));
  for (const card of cards) cardsLayer.appendChild(card);

  const lanesEndWeek = [];
  const laneCards = [];
  const laneHeights = [];
  const laneTops = [];
  const cardGap = 8;
  const rowPaddingTop = 6;
  const rowPaddingBottom = 6;
  const fallbackCardHeight = 56;

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

  function measureCardHeight(card) {
    const rectHeight = Math.ceil(card.getBoundingClientRect().height);
    const offsetHeight = Math.ceil(card.offsetHeight || 0);
    const scrollHeight = Math.ceil(card.scrollHeight || 0);
    return Math.max(rectHeight, offsetHeight, scrollHeight, fallbackCardHeight);
  }
  let maxCardHeight = fallbackCardHeight;
  for (const card of cards) {
    maxCardHeight = Math.max(maxCardHeight, measureCardHeight(card));
  }
  for (let laneIndex = 0; laneIndex < stackCount; laneIndex++) {
    laneHeights[laneIndex] = maxCardHeight;
  }

  for (let laneIndex = 0; laneIndex < stackCount; laneIndex++) {
    laneTops[laneIndex] = rowPaddingTop + (laneIndex * (maxCardHeight + cardGap));
  }

  for (const card of cards) {
    const laneIndex = Number(card.dataset.laneIndex || 0);
    card.style.top = `${laneTops[laneIndex] ?? rowPaddingTop}px`;
  }

  const totalHeight = rowPaddingTop
    + (stackCount * maxCardHeight)
    + ((stackCount - 1) * cardGap)
    + rowPaddingBottom;
  row.style.minHeight = `${Math.max(96, totalHeight)}px`;
}
