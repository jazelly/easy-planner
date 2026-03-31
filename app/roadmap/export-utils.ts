// @ts-nocheck

const THUMBNAIL_MAX_WIDTH = 480;
const THUMBNAIL_MAX_HEIGHT = 270;

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

function buildTargetCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  return { canvas, ctx };
}

export async function captureBoardCanvas(board) {
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

export async function captureBoardThumbnailDataUrl(board) {
  if (typeof window.html2canvas !== "function") return null;
  const source = await window.html2canvas(board, {
    backgroundColor: "#ffffff",
    useCORS: true,
    scale: 1,
    logging: false
  });
  const scale = Math.min(
    1,
    THUMBNAIL_MAX_WIDTH / Math.max(source.width, 1),
    THUMBNAIL_MAX_HEIGHT / Math.max(source.height, 1)
  );
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const target = document.createElement("canvas");
  target.width = width;
  target.height = height;
  const ctx = target.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  return target.toDataURL("image/png", 0.82);
}

export function exportSingleFit(sourceCanvas) {
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

export function exportMultiSlice(sourceCanvas) {
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
