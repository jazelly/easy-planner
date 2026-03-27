import Link from "next/link";
import Script from "next/script";
import { notFound } from "next/navigation";
import RoadmapBootstrap from "../../roadmap-bootstrap";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const SAFE_BOARD_ID_RE = /^[a-z0-9-]+$/i;

export default async function BoardPage({ params }) {
  const resolvedParams = await params;
  const boardId = String(resolvedParams?.boardId || "").trim();
  if (!boardId || !SAFE_BOARD_ID_RE.test(boardId)) {
    notFound();
  }

  return (
    <>
      <div className="app">
        <div className="topbar gap-4">
          <div>
            <h1>Weekly Roadmap</h1>
            <p className="hint">
              Board {boardId}. Drag cards between weeks/rows, then save versioned manifest snapshots of the layout.
            </p>
          </div>
          <div className="topbar-actions flex-wrap gap-2">
            <p className="hint">Sizes: XS=1, S=2, M=4, L=6, XL=8 weeks</p>
            <Badge id="save-state-pill" className="save-state-pill save-state-saved rounded-full">
              Saved
            </Badge>
            <Button id="save-manifest-btn" variant="outline" size="sm" type="button">
              Save
            </Button>
            <Button id="reset-layout-btn" variant="outline" size="sm" type="button">
              Reset Sequencing
            </Button>
            <label className="export-label" htmlFor="export-mode">
              Export mode
            </label>
            <select
              id="export-mode"
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              aria-label="Export mode"
            >
              <option value="fit">Single image (fit 16:9)</option>
              <option value="slices">Multi-slice (readable 16:9)</option>
            </select>
            <Button id="export-png-btn" size="sm" type="button">
              Export PNG (8K)
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard">Dashboard</Link>
            </Button>
          </div>
        </div>
        <div className="manifest-toolbar">
          <span id="manifest-status" className="manifest-status">
            Default target: versions folder manifests.
          </span>
          <a
            id="manifest-last-link"
            className="manifest-link hidden"
            href="#"
            target="_blank"
            rel="noopener"
          >
            Open last saved manifest
          </a>
        </div>
        <div className="board-wrap">
          <div id="board" className="board"></div>
        </div>
        <div id="errors" className="errors hidden"></div>
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

      <Script src="/api/legacy/roadmap-data.js" strategy="afterInteractive" />
      <Script
        src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"
        strategy="afterInteractive"
      />
      <RoadmapBootstrap />
    </>
  );
}
