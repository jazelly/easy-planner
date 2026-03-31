import Link from "next/link";
import { notFound } from "next/navigation";
import Script from "next/script";
import { DoorOpen, Download, RotateCcw, Save, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";

import RoadmapBootstrap from "../../roadmap/bootstrap";

const SAFE_BOARD_ID_RE = /^[a-z0-9-]+$/i;

type BoardPageProps = {
  params: Promise<{ boardId?: string }>;
};

export default async function BoardPage({ params }: BoardPageProps) {
  const resolvedParams = await params;
  const boardId = String(resolvedParams?.boardId || "").trim();
  if (!boardId || !SAFE_BOARD_ID_RE.test(boardId)) {
    notFound();
  }

  return (
    <>
      <div className="app board-shell">
        <div className="topbar board-shell-topbar gap-4">
          <div className="topbar-left board-shell-title-region">
            <Button asChild variant="outline" size="sm" className="dashboard-back-btn">
              <Link href="/dashboard" aria-label="Exit to dashboard" title="Exit to dashboard">
                <DoorOpen />
                <span>Dashboard</span>
              </Link>
            </Button>
            <div className="board-title-wrap board-shell-name-wrap">
              <input
                id="board-name-input"
                className="board-name-input"
                type="text"
                maxLength={80}
                placeholder="Untitled board"
                defaultValue="Untitled board"
                aria-label="Board name"
              />
              <div id="board-name-save-status" className="board-name-save-status" role="status" aria-live="polite">
                <span className="status-spinner hidden" aria-hidden="true"></span>
                <span className="status-label">Saved</span>
              </div>
            </div>
          </div>
          <div className="topbar-actions board-shell-actions">
            <div className="toolbar-cluster">
              <Button
                id="save-manifest-btn"
                variant="outline"
                size="icon"
                type="button"
                className="toolbar-icon-btn"
                aria-label="Save manifest snapshot"
                title="Save manifest snapshot"
              >
                <Save />
              </Button>
              <Button
                id="reset-layout-btn"
                variant="outline"
                size="icon"
                type="button"
                className="toolbar-icon-btn"
                aria-label="Reset sequencing to baseline"
                title="Reset sequencing to baseline"
              >
                <RotateCcw />
              </Button>
            </div>
            <div className="toolbar-cluster toolbar-export-cluster">
              <label className="export-label sr-only" htmlFor="export-mode">
                Export mode
              </label>
              <div className="export-mode-wrap">
                <SlidersHorizontal className="export-mode-icon" aria-hidden="true" />
                <select id="export-mode" className="export-mode-select" aria-label="Export mode">
                  <option value="fit">Fit 16:9</option>
                  <option value="slices">Readable slices</option>
                </select>
              </div>
              <Button
                id="export-png-btn"
                size="icon"
                type="button"
                className="toolbar-icon-btn"
                aria-label="Export board as PNG (8K)"
                title="Export board as PNG (8K)"
              >
                <Download />
              </Button>
            </div>
          </div>
        </div>
        <div className="manifest-toolbar board-shell-manifest">
          <span id="manifest-status" className="manifest-status"></span>
          <a id="manifest-last-link" className="manifest-link hidden" href="#" target="_blank" rel="noopener">
            Open last saved manifest
          </a>
        </div>
        <div className="board-stage board-shell-stage">
          <div id="board-loading" className="board-loading" role="status" aria-live="polite">
            <span className="board-loading-spinner" aria-hidden="true"></span>
            <span className="board-loading-label">Loading board...</span>
          </div>
          <div id="board-edge-controls" className="board-edge-controls" aria-hidden="true"></div>
          <div id="board-wrap" className="board-wrap board-wrap-loading" aria-busy="true">
            <div id="board" className="board"></div>
          </div>
        </div>
        <div id="errors" className="errors hidden"></div>
        <div id="toast-host" className="toast-host" aria-live="polite" aria-atomic="true"></div>
      </div>

      <div id="details-backdrop" className="details-backdrop hidden" aria-hidden="true"></div>
      <aside
        id="details-sidebar"
        className="details-sidebar hidden"
        aria-hidden="true"
        aria-label="Task details"
      >
        <div className="details-header">
          <h2 id="details-title">Task details</h2>
          <button id="details-close" className="details-close" type="button" aria-label="Close details panel">
            Close
          </button>
        </div>
        <div id="details-content" className="details-content"></div>
      </aside>

      <Script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js" strategy="afterInteractive" />
      <RoadmapBootstrap />
    </>
  );
}
