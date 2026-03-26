import Script from "next/script";

export default function Page() {
  return (
    <>
      <div className="app">
        <div className="topbar">
          <div>
            <h1>Weekly Roadmap</h1>
            <p className="hint">
              Drag cards between weeks/rows, then save versioned manifest snapshots of the layout.
            </p>
          </div>
          <div className="topbar-actions">
            <p className="hint">Sizes: XS=1, S=2, M=4, L=6, XL=8 weeks</p>
            <button id="save-manifest-btn" className="secondary-btn" type="button">
              Save
            </button>
            <label className="export-label" htmlFor="manifest-history-select">
              Previous Version
            </label>
            <select id="manifest-history-select" className="export-select" aria-label="Manifest history">
              <option value="">No manifests loaded</option>
            </select>
            <button id="load-manifest-btn" className="secondary-btn" type="button">
              Load 
            </button>
            <button id="reset-layout-btn" className="secondary-btn" type="button">
              Reset Sequencing
            </button>
            <label className="export-label" htmlFor="export-mode">
              Export mode
            </label>
            <select id="export-mode" className="export-select" aria-label="Export mode">
              <option value="fit">Single image (fit 16:9)</option>
              <option value="slices">Multi-slice (readable 16:9)</option>
            </select>
            <button id="export-png-btn" className="export-btn" type="button">
              Export PNG (8K)
            </button>
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
      <Script src="/api/legacy/roadmap.js" strategy="afterInteractive" />
    </>
  );
}
