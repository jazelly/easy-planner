import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const MANIFEST_DIR = path.join(process.cwd(), "versions");
const MANIFEST_INDEX_FILE = "manifest-index.json";
const MANIFEST_PREFIX = "roadmap-manifest-v";
const MANIFEST_SUFFIX = ".json";
const SCHEMA_VERSION = 1;

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

async function getNextVersion() {
  const fileNames = await readdir(MANIFEST_DIR).catch(() => []);
  return (
    fileNames.reduce((maxVersion, name) => {
      if (!name.startsWith(MANIFEST_PREFIX) || !name.endsWith(MANIFEST_SUFFIX)) return maxVersion;
      return Math.max(maxVersion, parseManifestVersionNumber(name));
    }, 0) + 1
  );
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

export async function POST(request) {
  try {
    const payload = await request.json();
    const manifest = payload?.manifest;
    if (!manifest || typeof manifest !== "object") {
      return Response.json({ error: "Manifest payload is required." }, { status: 400 });
    }
    if (manifest.schemaVersion && manifest.schemaVersion !== SCHEMA_VERSION) {
      return Response.json({ error: "Unsupported manifest schema version." }, { status: 400 });
    }

    await mkdir(MANIFEST_DIR, { recursive: true });
    const version = await getNextVersion();
    const fileName = buildManifestFilename(version);
    const filePath = path.join(MANIFEST_DIR, fileName);
    await writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await writeManifestIndex();

    return Response.json({ ok: true, fileName, version });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error while saving manifest.";
    return Response.json({ error: message }, { status: 500 });
  }
}
