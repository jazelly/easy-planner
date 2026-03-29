import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "roadmap-versions.db");

type SqliteRow = Record<string, unknown>;
type Db = DatabaseSync;

export type BoardRecord = {
  id: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
};

export type ManifestEntryRecord = {
  boardId: string;
  version: number;
  fileName: string;
  thumbnailDataUrl?: string | null;
  savedAt?: string | null;
  createdAt?: string;
};

export type ManifestRecord = ManifestEntryRecord & {
  manifestJson: string;
};

export type UpsertManifestVersionRecordInput = {
  boardId: string;
  version: number;
  fileName: string;
  manifestJson: string;
  thumbnailDataUrl?: string | null;
  savedAt?: string | null;
};

export type UpsertAutosaveInput = {
  boardId: string;
  manifestJson: string;
  savedAt?: string | null;
};

export type BoardAutosaveRecord = {
  boardId: string;
  manifestJson: string;
  savedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

let dbInstance: Db | null = null;

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

function initSchema(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS boards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'Untitled board',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
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

    CREATE TABLE IF NOT EXISTS board_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      manifest_name TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      thumbnail_data_url TEXT,
      saved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(board_id, version),
      UNIQUE(board_id, manifest_name)
    );

    CREATE INDEX IF NOT EXISTS idx_board_history_board_version
      ON board_history(board_id, version DESC);

    CREATE TABLE IF NOT EXISTS board_autosave (
      board_id TEXT PRIMARY KEY,
      manifest_json TEXT NOT NULL,
      saved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const columns = db.prepare("PRAGMA table_info(manifest_versions)").all() as SqliteRow[];
  const hasBoardId = columns.some((column) => column?.name === "board_id");
  if (!hasBoardId) {
    db.exec("ALTER TABLE manifest_versions ADD COLUMN board_id TEXT NOT NULL DEFAULT 'default';");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_manifest_versions_board_id ON manifest_versions(board_id);");

  const boardColumns = db.prepare("PRAGMA table_info(boards)").all() as SqliteRow[];
  const hasBoardName = boardColumns.some((column) => column?.name === "name");
  if (!hasBoardName) {
    db.exec("ALTER TABLE boards ADD COLUMN name TEXT NOT NULL DEFAULT 'Untitled board';");
  }
  const hasBoardUpdatedAt = boardColumns.some((column) => column?.name === "updated_at");
  if (!hasBoardUpdatedAt) {
    db.exec("ALTER TABLE boards ADD COLUMN updated_at TEXT;");
  }
  db.exec(`
    UPDATE boards
    SET updated_at = COALESCE(updated_at, created_at, datetime('now'))
    WHERE updated_at IS NULL OR TRIM(updated_at) = '';
  `);
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

export async function getLatestManifestVersion(boardId: string) {
  const db = await getVersionDb();
  const row = db
    .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM board_history WHERE board_id = @boardId")
    .get({ boardId }) as { version?: number } | undefined;
  return Number(row?.version || 0);
}

export async function listManifestVersions(boardId: string) {
  const db = await getVersionDb();
  return db.prepare(
    `
    SELECT
      board_id AS boardId,
      version,
      manifest_name AS fileName,
      thumbnail_data_url AS thumbnailDataUrl,
      saved_at AS savedAt,
      created_at AS createdAt
    FROM board_history
    WHERE board_id = @boardId
    ORDER BY version DESC
    `
  ).all({ boardId }) as ManifestEntryRecord[];
}

export async function getManifestVersionByName(boardId: string, fileName: string) {
  const db = await getVersionDb();
  return db
    .prepare(
      `
      SELECT
        board_id AS boardId,
        version,
        manifest_name AS fileName,
        manifest_json AS manifestJson,
        thumbnail_data_url AS thumbnailDataUrl,
        saved_at AS savedAt,
        created_at AS createdAt
      FROM board_history
      WHERE board_id = @boardId AND manifest_name = @fileName
      LIMIT 1
      `
    )
    .get({ boardId, fileName }) as ManifestRecord | undefined;
}

export async function createBoard(boardId: string, boardName = "Untitled board") {
  const db = await getVersionDb();
  const safeName = String(boardName || "Untitled board").trim() || "Untitled board";
  db.prepare(
    `
    INSERT OR IGNORE INTO boards (id, name, updated_at)
    VALUES (@id, @name, datetime('now'))
    `
  ).run({ id: boardId, name: safeName });
}

export async function listBoards() {
  const db = await getVersionDb();
  return db.prepare(
    `
    SELECT id, name, created_at AS createdAt, updated_at AS updatedAt
    FROM boards
    ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC
    `
  ).all() as BoardRecord[];
}

export async function getBoardById(boardId: string) {
  const db = await getVersionDb();
  return db.prepare(
    `
    SELECT id, name, created_at AS createdAt, updated_at AS updatedAt
    FROM boards
    WHERE id = @id
    LIMIT 1
    `
  ).get({ id: boardId }) as BoardRecord | undefined;
}

export async function updateBoardName(boardId: string, boardName: string) {
  const db = await getVersionDb();
  const safeName = String(boardName || "Untitled board").trim() || "Untitled board";
  db.prepare(
    `
    UPDATE boards
    SET
      name = @name,
      updated_at = datetime('now')
    WHERE id = @id
    `
  ).run({ id: boardId, name: safeName });
}

export async function upsertManifestVersionRecord(record: UpsertManifestVersionRecordInput) {
  const db = await getVersionDb();
  db.prepare(
    `
    INSERT INTO board_history (
      board_id,
      version,
      manifest_name,
      manifest_json,
      thumbnail_data_url,
      saved_at
    )
    VALUES (
      @boardId,
      @version,
      @manifestName,
      @manifestJson,
      @thumbnailDataUrl,
      @savedAt
    )
    ON CONFLICT(board_id, manifest_name) DO UPDATE SET
      manifest_json = excluded.manifest_json,
      thumbnail_data_url = excluded.thumbnail_data_url,
      saved_at = excluded.saved_at
    `
  ).run({
    boardId: record.boardId,
    version: record.version,
    manifestName: record.fileName,
    manifestJson: record.manifestJson,
    thumbnailDataUrl: record.thumbnailDataUrl || null,
    savedAt: record.savedAt || null
  });
}

export async function upsertBoardAutosave(record: UpsertAutosaveInput) {
  const db = await getVersionDb();
  db.prepare(
    `
    INSERT INTO board_autosave (
      board_id,
      manifest_json,
      saved_at,
      updated_at
    )
    VALUES (
      @boardId,
      @manifestJson,
      @savedAt,
      datetime('now')
    )
    ON CONFLICT(board_id) DO UPDATE SET
      manifest_json = excluded.manifest_json,
      saved_at = excluded.saved_at,
      updated_at = datetime('now')
    `
  ).run({
    boardId: record.boardId,
    manifestJson: record.manifestJson,
    savedAt: record.savedAt || null
  });
}

export async function getBoardAutosave(boardId: string) {
  const db = await getVersionDb();
  return db.prepare(
    `
    SELECT
      board_id AS boardId,
      manifest_json AS manifestJson,
      saved_at AS savedAt,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM board_autosave
    WHERE board_id = @boardId
    LIMIT 1
    `
  ).get({ boardId }) as BoardAutosaveRecord | undefined;
}
