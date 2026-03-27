import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createBoard,
  getManifestVersionByName,
  getLatestManifestVersion,
  listManifestVersions,
  upsertManifestVersionRecord
} from "../../lib/version-store";

const MANIFEST_DIR = path.join(process.cwd(), "versions");
const THUMBNAIL_DIR = path.join(process.cwd(), "thumbnails");
const MANIFEST_INDEX_FILE = "manifest-index.json";
const MANIFEST_PREFIX = "roadmap-manifest-v";
const MANIFEST_SUFFIX = ".json";
const THUMBNAIL_PREFIX = "roadmap-thumb-v";
const THUMBNAIL_SUFFIX = ".png";
const SCHEMA_VERSION = 1;
const SAFE_FILE_RE = /^[a-z0-9._-]+$/i;
const SAFE_BOARD_ID_RE = /^[a-z0-9-]+$/i;

export const runtime = "nodejs";

function parseManifestVersionNumber(filename) {
  const match = String(filename || "").match(/-v(\d+)-/i);
  if (!match) return 0;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildManifestFilename(nextVersion) {
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").replace("T", "-").replace("Z", "Z");
  return `${MANIFEST_PREFIX}${String(nextVersion).padStart(4, "0")}-${stamp}${MANIFEST_SUFFIX}`;
}

function buildThumbnailFilename(nextVersion) {
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").replace("T", "-").replace("Z", "Z");
  return `${THUMBNAIL_PREFIX}${String(nextVersion).padStart(4, "0")}-${stamp}${THUMBNAIL_SUFFIX}`;
}

async function writeManifestIndex() {
  const fileNames = await readdir(MANIFEST_DIR).catch(() => []);
  const manifests = fileNames
    .filter((name) => name.startsWith(MANIFEST_PREFIX) && name.endsWith(MANIFEST_SUFFIX))
    .sort((a, b) => a.localeCompare(b))
    .reverse();
  const indexPath = path.join(MANIFEST_DIR, MANIFEST_INDEX_FILE);
  await writeFile(indexPath, `${JSON.stringify({ manifests }, null, 2)}\n`, "utf8");
}

function decodeDataUrlImage(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return null;
  const match = dataUrl.match(/^data:(image\/png|image\/jpeg);base64,([a-z0-9+/=]+)$/i);
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length === 0) return null;
  return { mimeType, buffer };
}

function isSafeFileName(value) {
  return SAFE_FILE_RE.test(String(value || ""));
}

function isSafeBoardId(value) {
  return SAFE_BOARD_ID_RE.test(String(value || ""));
}

async function syncManifestFilesToDb() {
  const fileNames = await readdir(MANIFEST_DIR).catch(() => []);
  for (const name of fileNames) {
    if (!name.startsWith(MANIFEST_PREFIX) || !name.endsWith(MANIFEST_SUFFIX)) continue;
    const version = parseManifestVersionNumber(name);
    if (!version) continue;
    const filePath = path.join(MANIFEST_DIR, name);
    await upsertManifestVersionRecord({
        boardId: "default",
      version,
      fileName: name,
      filePath,
      thumbnailFileName: null,
      thumbnailPath: null,
      savedAt: null
    });
  }
}

function toPublicEntry(entry) {
  return {
    version: entry.version,
    fileName: entry.fileName,
    filePath: entry.filePath,
    thumbnailFileName: entry.thumbnailFileName,
    thumbnailPath: entry.thumbnailPath,
    thumbnailUrl: entry.thumbnailFileName
      ? `/api/manifests?thumbnail=${encodeURIComponent(entry.thumbnailFileName)}`
      : null,
    savedAt: entry.savedAt,
    createdAt: entry.createdAt
  };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const boardId = String(searchParams.get("boardId") || "").trim();
    if (!boardId || !isSafeBoardId(boardId)) {
      return Response.json({ error: "A valid boardId is required." }, { status: 400 });
    }

    const requestedName = String(searchParams.get("name") || "").trim();
    const rawMode = String(searchParams.get("raw") || "").trim() === "1";
    if (requestedName) {
      if (!isSafeFileName(requestedName) || !requestedName.startsWith(MANIFEST_PREFIX)) {
        return Response.json({ error: "Invalid manifest file name." }, { status: 400 });
      }
      const manifestEntry = await getManifestVersionByName(boardId, requestedName);
      if (!manifestEntry?.filePath) {
        return Response.json({ error: "Manifest not found for this board." }, { status: 404 });
      }
      const filePath = manifestEntry.filePath;
      const text = await readFile(filePath, "utf8");
      if (rawMode) {
        return new Response(text, {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store"
          }
        });
      }
      const manifest = JSON.parse(text);
      return Response.json({ ok: true, fileName: requestedName, manifest });
    }

    const requestedThumbnail = String(searchParams.get("thumbnail") || "").trim();
    if (requestedThumbnail) {
      if (!isSafeFileName(requestedThumbnail) || !requestedThumbnail.startsWith(THUMBNAIL_PREFIX)) {
        return Response.json({ error: "Invalid thumbnail file name." }, { status: 400 });
      }
      const thumbPath = path.join(THUMBNAIL_DIR, requestedThumbnail);
      const content = await readFile(thumbPath);
      return new Response(content, {
        status: 200,
        headers: {
          "content-type": "image/png",
          "cache-control": "no-store"
        }
      });
    }

    await mkdir(MANIFEST_DIR, { recursive: true });
    await createBoard(boardId);
    await syncManifestFilesToDb();
    const entries = await listManifestVersions(boardId);
    return Response.json({
      ok: true,
      manifests: entries.map(toPublicEntry)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error while loading manifests.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const payload = await request.json();
    const boardId = String(payload?.boardId || "").trim();
    if (!boardId || !isSafeBoardId(boardId)) {
      return Response.json({ error: "A valid boardId is required." }, { status: 400 });
    }
    const manifest = payload?.manifest;
    const thumbnailDataUrl = payload?.thumbnailDataUrl;
    if (!manifest || typeof manifest !== "object") {
      return Response.json({ error: "Manifest payload is required." }, { status: 400 });
    }
    if (manifest.schemaVersion && manifest.schemaVersion !== SCHEMA_VERSION) {
      return Response.json({ error: "Unsupported manifest schema version." }, { status: 400 });
    }

    await mkdir(MANIFEST_DIR, { recursive: true });
    await mkdir(THUMBNAIL_DIR, { recursive: true });
    await createBoard(boardId);
    await syncManifestFilesToDb();
    const latestVersion = await getLatestManifestVersion();
    const version = latestVersion + 1;
    const fileName = buildManifestFilename(version);
    const filePath = path.join(MANIFEST_DIR, fileName);
    await writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    let thumbnailFileName = null;
    let thumbnailPath = null;
    const decodedThumbnail = decodeDataUrlImage(thumbnailDataUrl);
    if (decodedThumbnail) {
      thumbnailFileName = buildThumbnailFilename(version);
      thumbnailPath = path.join(THUMBNAIL_DIR, thumbnailFileName);
      await writeFile(thumbnailPath, decodedThumbnail.buffer);
    }

    await upsertManifestVersionRecord({
      boardId,
      version,
      fileName,
      filePath,
      thumbnailFileName,
      thumbnailPath,
      savedAt: manifest?.savedAt || new Date().toISOString()
    });
    await writeManifestIndex();

    return Response.json({
      ok: true,
      fileName,
      version,
      thumbnailFileName,
      thumbnailUrl: thumbnailFileName
        ? `/api/manifests?thumbnail=${encodeURIComponent(thumbnailFileName)}`
        : null
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error while saving manifest.";
    return Response.json({ error: message }, { status: 500 });
  }
}
