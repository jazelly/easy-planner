import {
  createBoard,
  getBoardAutosave,
  getLatestManifestVersion,
  getManifestVersionByName,
  listManifestVersions,
  upsertBoardAutosave,
  upsertManifestVersionRecord
} from "../../lib/version-store";

const MANIFEST_PREFIX = "roadmap-manifest-v";
const MANIFEST_SUFFIX = ".json";
const SCHEMA_VERSION = 1;
const SAFE_FILE_RE = /^[a-z0-9._-]+$/i;
const SAFE_BOARD_ID_RE = /^[a-z0-9-]+$/i;

export const runtime = "nodejs";

type ManifestPayload = {
  schemaVersion?: number;
  savedAt?: string;
};

function buildManifestFilename(nextVersion: number) {
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").replace("T", "-").replace("Z", "Z");
  return `${MANIFEST_PREFIX}${String(nextVersion).padStart(4, "0")}-${stamp}${MANIFEST_SUFFIX}`;
}

function isSafeFileName(value: unknown) {
  return SAFE_FILE_RE.test(String(value || ""));
}

function isSafeBoardId(value: unknown) {
  return SAFE_BOARD_ID_RE.test(String(value || ""));
}

function toPublicEntry(entry: {
  version: number;
  fileName: string;
  thumbnailDataUrl?: string | null;
  savedAt?: string | null;
  createdAt?: string;
}) {
  return {
    version: entry.version,
    fileName: entry.fileName,
    thumbnailUrl: entry.thumbnailDataUrl || null,
    savedAt: entry.savedAt,
    createdAt: entry.createdAt
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const boardId = String(searchParams.get("boardId") || "").trim();
    if (!boardId || !isSafeBoardId(boardId)) {
      return Response.json({ error: "A valid boardId is required." }, { status: 400 });
    }

    const requestedName = String(searchParams.get("name") || "").trim();
    const autosaveMode = String(searchParams.get("autosave") || "").trim() === "1";
    const rawMode = String(searchParams.get("raw") || "").trim() === "1";
    if (autosaveMode) {
      const autosaveEntry = await getBoardAutosave(boardId);
      if (!autosaveEntry?.manifestJson) {
        return Response.json({ ok: true, manifest: null, savedAt: null });
      }
      try {
        const manifest = JSON.parse(String(autosaveEntry.manifestJson || ""));
        return Response.json({
          ok: true,
          manifest,
          savedAt: autosaveEntry.savedAt || null
        });
      } catch (_) {
        return Response.json({ ok: true, manifest: null, savedAt: autosaveEntry.savedAt || null });
      }
    }

    if (requestedName) {
      if (!isSafeFileName(requestedName) || !requestedName.startsWith(MANIFEST_PREFIX)) {
        return Response.json({ error: "Invalid manifest file name." }, { status: 400 });
      }
      const manifestEntry = await getManifestVersionByName(boardId, requestedName);
      if (!manifestEntry?.manifestJson) {
        return Response.json({ error: "Manifest not found for this board." }, { status: 404 });
      }
      const text = String(manifestEntry.manifestJson || "");
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
    await createBoard(boardId);
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

export async function POST(request: Request) {
  try {
    const payload: {
      boardId?: string;
      manifest?: ManifestPayload;
      mode?: string;
      thumbnailDataUrl?: string;
    } = await request.json();
    const boardId = String(payload?.boardId || "").trim();
    if (!boardId || !isSafeBoardId(boardId)) {
      return Response.json({ error: "A valid boardId is required." }, { status: 400 });
    }
    const manifest = payload?.manifest;
    const mode = String(payload?.mode || "manual").trim().toLowerCase();
    const thumbnailDataUrl = payload?.thumbnailDataUrl;
    if (!manifest || typeof manifest !== "object") {
      return Response.json({ error: "Manifest payload is required." }, { status: 400 });
    }
    if (manifest.schemaVersion && manifest.schemaVersion !== SCHEMA_VERSION) {
      return Response.json({ error: "Unsupported manifest schema version." }, { status: 400 });
    }

    await createBoard(boardId);
    if (mode === "autosave") {
      await upsertBoardAutosave({
        boardId,
        manifestJson: JSON.stringify(manifest, null, 2),
        savedAt: manifest?.savedAt || new Date().toISOString()
      });
      return Response.json({ ok: true, mode: "autosave" });
    }

    const latestVersion = await getLatestManifestVersion(boardId);
    const version = latestVersion + 1;
    const fileName = buildManifestFilename(version);
    const nextThumbnailDataUrl = typeof thumbnailDataUrl === "string" && thumbnailDataUrl.startsWith("data:image/")
      ? thumbnailDataUrl
      : null;

    await upsertManifestVersionRecord({
      boardId,
      version,
      fileName,
      manifestJson: JSON.stringify(manifest, null, 2),
      thumbnailDataUrl: nextThumbnailDataUrl,
      savedAt: manifest?.savedAt || new Date().toISOString()
    });

    return Response.json({
      ok: true,
      fileName,
      version,
      thumbnailUrl: nextThumbnailDataUrl
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error while saving manifest.";
    return Response.json({ error: message }, { status: 500 });
  }
}
