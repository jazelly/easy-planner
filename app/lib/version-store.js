import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "roadmap-versions.db");

let dbInstance = null;

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS boards (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS manifest_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id TEXT NOT NULL DEFAULT 'default',
      version INTEGER NOT NULL UNIQUE,
      file_name TEXT NOT NULL UNIQUE,
      file_path TEXT NOT NULL,
      thumbnail_file_name TEXT,
      thumbnail_path TEXT,
      saved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_manifest_versions_file_name
      ON manifest_versions(file_name);
  `);

  const columns = db.prepare("PRAGMA table_info(manifest_versions)").all();
  const hasBoardId = columns.some((column) => column?.name === "board_id");
  if (!hasBoardId) {
    db.exec("ALTER TABLE manifest_versions ADD COLUMN board_id TEXT NOT NULL DEFAULT 'default';");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_manifest_versions_board_id ON manifest_versions(board_id);");
}

export async function getVersionDb() {
  if (dbInstance) {
    initSchema(dbInstance);
    return dbInstance;
  }
  await ensureDataDir();
  dbInstance = new DatabaseSync(DB_PATH);
  initSchema(dbInstance);
  return dbInstance;
}

export async function getLatestManifestVersion() {
  const db = await getVersionDb();
  const row = db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM manifest_versions").get();
  return Number(row?.version || 0);
}

export async function listManifestVersions(boardId) {
  const db = await getVersionDb();
  return db.prepare(
    `
    SELECT
      board_id AS boardId,
      version,
      file_name AS fileName,
      file_path AS filePath,
      thumbnail_file_name AS thumbnailFileName,
      thumbnail_path AS thumbnailPath,
      saved_at AS savedAt,
      created_at AS createdAt
    FROM manifest_versions
    WHERE board_id = @boardId
    ORDER BY version DESC
    `
  ).all({ boardId });
}

export async function getManifestVersionByName(boardId, fileName) {
  const db = await getVersionDb();
  return db
    .prepare(
      `
      SELECT
        board_id AS boardId,
        version,
        file_name AS fileName,
        file_path AS filePath,
        thumbnail_file_name AS thumbnailFileName,
        thumbnail_path AS thumbnailPath,
        saved_at AS savedAt,
        created_at AS createdAt
      FROM manifest_versions
      WHERE board_id = @boardId AND file_name = @fileName
      LIMIT 1
      `
    )
    .get({ boardId, fileName });
}

export async function createBoard(boardId) {
  const db = await getVersionDb();
  db.prepare(
    `
    INSERT OR IGNORE INTO boards (id)
    VALUES (@id)
    `
  ).run({ id: boardId });
}

export async function listBoards() {
  const db = await getVersionDb();
  return db.prepare(
    `
    SELECT id, created_at AS createdAt
    FROM boards
    ORDER BY datetime(created_at) DESC
    `
  ).all();
}

export async function upsertManifestVersionRecord(record) {
  const db = await getVersionDb();
  db.prepare(
    `
    INSERT INTO manifest_versions (
      board_id,
      version,
      file_name,
      file_path,
      thumbnail_file_name,
      thumbnail_path,
      saved_at
    )
    VALUES (
      @boardId,
      @version,
      @fileName,
      @filePath,
      @thumbnailFileName,
      @thumbnailPath,
      @savedAt
    )
    ON CONFLICT(file_name) DO UPDATE SET
      thumbnail_file_name = excluded.thumbnail_file_name,
      thumbnail_path = excluded.thumbnail_path,
      saved_at = excluded.saved_at
    `
  ).run({
    boardId: record.boardId,
    version: record.version,
    fileName: record.fileName,
    filePath: record.filePath,
    thumbnailFileName: record.thumbnailFileName || null,
    thumbnailPath: record.thumbnailPath || null,
    savedAt: record.savedAt || null
  });
}
