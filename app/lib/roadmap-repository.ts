import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { DataSourceOptions } from "typeorm";
import { DataSource, EntitySchema } from "typeorm";

import { InitSchema0001 } from "./db/migrations/0001-init";
import { getDefaultRoadmapData, type RoadmapData } from "./default-roadmap-data";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "roadmap-versions.db");

type SupportedDbProvider = "sqljs" | "postgres";

type BoardEntity = {
  id: string;
  name: string;
  baseDataJson: string;
  latestHistoryId?: number | null;
  createdAt?: string;
  updatedAt?: string;
};

type BoardHistoryEntity = {
  id: number;
  boardId: string;
  version: number;
  manifestName: string;
  manifestJson: string;
  thumbnailDataUrl?: string | null;
  savedAt?: string | null;
  createdAt?: string;
};

type BoardAutosaveEntity = {
  boardId: string;
  manifestJson: string;
  savedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type BoardRecord = {
  id: string;
  name: string;
  baseDataJson?: string;
  latestHistoryId?: number | null;
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
  id?: number;
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

const BoardSchema = new EntitySchema<BoardEntity>({
  name: "Board",
  tableName: "boards",
  columns: {
    id: { type: String, primary: true },
    name: { type: String },
    baseDataJson: { name: "base_data_json", type: String },
    latestHistoryId: { name: "latest_history_id", type: Number, nullable: true },
    updatedAt: { name: "updated_at", type: String, nullable: true },
    createdAt: { name: "created_at", type: String, nullable: true }
  }
});

const BoardHistorySchema = new EntitySchema<BoardHistoryEntity>({
  name: "BoardHistory",
  tableName: "board_history",
  columns: {
    id: { type: Number, primary: true, generated: "increment" },
    boardId: { name: "board_id", type: String },
    version: { type: Number },
    manifestName: { name: "manifest_name", type: String },
    manifestJson: { name: "manifest_json", type: String },
    thumbnailDataUrl: { name: "thumbnail_data_url", type: String, nullable: true },
    savedAt: { name: "saved_at", type: String, nullable: true },
    createdAt: { name: "created_at", type: String, nullable: true }
  },
  uniques: [
    { name: "uniq_board_history_board_version", columns: ["boardId", "version"] },
    { name: "uniq_board_history_board_manifest_name", columns: ["boardId", "manifestName"] }
  ]
});

const BoardAutosaveSchema = new EntitySchema<BoardAutosaveEntity>({
  name: "BoardAutosave",
  tableName: "board_autosave",
  columns: {
    boardId: { name: "board_id", type: String, primary: true },
    manifestJson: { name: "manifest_json", type: String },
    savedAt: { name: "saved_at", type: String, nullable: true },
    createdAt: { name: "created_at", type: String, nullable: true },
    updatedAt: { name: "updated_at", type: String, nullable: true }
  }
});

let dataSourceInstance: DataSource | null = null;

function resolveDbProvider(): SupportedDbProvider {
  const raw = String(process.env.DB_PROVIDER || "sqljs").trim().toLowerCase();
  if (raw === "postgres" || raw === "neon" || raw === "supabase") return "postgres";
  return "sqljs";
}

function createDataSourceOptions(provider: SupportedDbProvider): DataSourceOptions {
  const sharedConfig = {
    entities: [BoardSchema, BoardHistorySchema, BoardAutosaveSchema],
    migrations: [InitSchema0001],
    migrationsTableName: "schema_migrations",
    synchronize: false,
    logging: false
  };

  if (provider === "postgres") {
    const url = String(process.env.DATABASE_URL || "").trim();
    if (!url) {
      throw new Error("DATABASE_URL is required when DB_PROVIDER is postgres/neon/supabase.");
    }
    return {
      ...sharedConfig,
      type: "postgres",
      url,
      ssl: process.env.DB_SSL_DISABLE === "1" ? false : { rejectUnauthorized: false }
    };
  }

  return {
    ...sharedConfig,
    type: "sqljs",
    location: DB_PATH,
    autoSave: true
  };
}

async function ensureSqliteDataDir(provider: SupportedDbProvider) {
  if (provider !== "sqljs") return;
  await mkdir(DATA_DIR, { recursive: true });
}

async function ensureDataIntegrity(dataSource: DataSource, provider: SupportedDbProvider) {
  const defaultBaseDataJson = JSON.stringify(getDefaultRoadmapData(), null, 2);

  if (provider === "postgres") {
    await dataSource.query(
      `
      UPDATE boards
      SET base_data_json = $1
      WHERE base_data_json IS NULL OR TRIM(base_data_json) = '' OR base_data_json = '{}'
      `,
      [defaultBaseDataJson]
    );
  } else {
    await dataSource.query(
      `
      UPDATE boards
      SET base_data_json = ?
      WHERE base_data_json IS NULL OR TRIM(base_data_json) = '' OR base_data_json = '{}'
      `,
      [defaultBaseDataJson]
    );
  }

  await dataSource.query(
    `
    UPDATE boards
    SET latest_history_id = (
      SELECT bh.id
      FROM board_history bh
      WHERE bh.board_id = boards.id
      ORDER BY bh.version DESC, bh.id DESC
      LIMIT 1
    )
    WHERE latest_history_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM board_history bh
        WHERE bh.board_id = boards.id
      );
    `
  );
}

export async function getVersionDb() {
  if (dataSourceInstance?.isInitialized) {
    return dataSourceInstance;
  }

  const provider = resolveDbProvider();
  await ensureSqliteDataDir(provider);
  dataSourceInstance = new DataSource(createDataSourceOptions(provider));
  await dataSourceInstance.initialize();
  await dataSourceInstance.runMigrations();
  await ensureDataIntegrity(dataSourceInstance, provider);
  return dataSourceInstance;
}

export async function getLatestManifestVersion(boardId: string) {
  const dataSource = await getVersionDb();
  const repo = dataSource.getRepository(BoardHistorySchema);
  const row = await repo.findOne({
    where: { boardId },
    select: { version: true },
    order: { version: "DESC" }
  });
  return Number(row?.version || 0);
}

export async function listManifestVersions(boardId: string) {
  const dataSource = await getVersionDb();
  const repo = dataSource.getRepository(BoardHistorySchema);
  const rows = await repo.find({
    where: { boardId },
    order: { version: "DESC" }
  });
  return rows.map((row) => ({
    boardId: row.boardId,
    version: row.version,
    fileName: row.manifestName,
    thumbnailDataUrl: row.thumbnailDataUrl || null,
    savedAt: row.savedAt || null,
    createdAt: row.createdAt
  })) as ManifestEntryRecord[];
}

export async function getManifestVersionByName(boardId: string, fileName: string) {
  const dataSource = await getVersionDb();
  const repo = dataSource.getRepository(BoardHistorySchema);
  const row = await repo.findOne({
    where: { boardId, manifestName: fileName }
  });
  if (!row) return undefined;
  return {
    id: row.id,
    boardId: row.boardId,
    version: row.version,
    fileName: row.manifestName,
    manifestJson: row.manifestJson,
    thumbnailDataUrl: row.thumbnailDataUrl || null,
    savedAt: row.savedAt || null,
    createdAt: row.createdAt
  } as ManifestRecord;
}

export async function createBoard(boardId: string, boardName = "Untitled board") {
  const dataSource = await getVersionDb();
  const repo = dataSource.getRepository(BoardSchema);
  const safeName = String(boardName || "Untitled board").trim() || "Untitled board";
  const defaultBaseDataJson = JSON.stringify(getDefaultRoadmapData(), null, 2);
  const now = new Date().toISOString();
  await repo
    .createQueryBuilder()
    .insert()
    .into(BoardSchema)
    .values({
      id: boardId,
      name: safeName,
      baseDataJson: defaultBaseDataJson,
      updatedAt: now,
      createdAt: now
    })
    .orIgnore()
    .execute();
}

export async function listBoards() {
  const dataSource = await getVersionDb();
  const repo = dataSource.getRepository(BoardSchema);
  const rows = await repo.find({
    order: { updatedAt: "DESC", createdAt: "DESC" }
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    baseDataJson: row.baseDataJson,
    latestHistoryId: row.latestHistoryId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  })) as BoardRecord[];
}

export async function getBoardById(boardId: string) {
  const dataSource = await getVersionDb();
  const repo = dataSource.getRepository(BoardSchema);
  const row = await repo.findOne({ where: { id: boardId } });
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    baseDataJson: row.baseDataJson,
    latestHistoryId: row.latestHistoryId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  } as BoardRecord;
}

export async function updateBoardName(boardId: string, boardName: string) {
  const dataSource = await getVersionDb();
  const repo = dataSource.getRepository(BoardSchema);
  const safeName = String(boardName || "Untitled board").trim() || "Untitled board";
  await repo.update(
    { id: boardId },
    {
      name: safeName,
      updatedAt: new Date().toISOString()
    }
  );
}

export async function upsertManifestVersionRecord(record: UpsertManifestVersionRecordInput) {
  const dataSource = await getVersionDb();
  const historyRepo = dataSource.getRepository(BoardHistorySchema);
  const boardRepo = dataSource.getRepository(BoardSchema);

  await historyRepo.upsert(
    {
      boardId: record.boardId,
      version: record.version,
      manifestName: record.fileName,
      manifestJson: record.manifestJson,
      thumbnailDataUrl: record.thumbnailDataUrl || null,
      savedAt: record.savedAt || null
    },
    {
      conflictPaths: ["boardId", "manifestName"]
    }
  );

  const saved = await historyRepo.findOne({
    where: { boardId: record.boardId, manifestName: record.fileName },
    select: { id: true }
  });
  if (saved?.id) {
    await boardRepo.update(
      { id: record.boardId },
      {
        latestHistoryId: saved.id,
        updatedAt: new Date().toISOString()
      }
    );
  }
}

export async function getLatestManifestForBoard(boardId: string) {
  const dataSource = await getVersionDb();
  const historyRepo = dataSource.getRepository(BoardHistorySchema);
  const boardRepo = dataSource.getRepository(BoardSchema);
  const board = await boardRepo.findOne({
    where: { id: boardId },
    select: { latestHistoryId: true }
  });
  if (!board?.latestHistoryId) return undefined;
  const row = await historyRepo.findOne({ where: { id: board.latestHistoryId } });
  if (!row) return undefined;
  return {
    id: row.id,
    boardId: row.boardId,
    version: row.version,
    fileName: row.manifestName,
    manifestJson: row.manifestJson,
    thumbnailDataUrl: row.thumbnailDataUrl || null,
    savedAt: row.savedAt || null,
    createdAt: row.createdAt
  } as ManifestRecord;
}

export async function getBoardBaseData(boardId: string): Promise<RoadmapData> {
  const dataSource = await getVersionDb();
  const repo = dataSource.getRepository(BoardSchema);
  const row = await repo.findOne({
    where: { id: boardId },
    select: { baseDataJson: true }
  });
  if (!row?.baseDataJson) return getDefaultRoadmapData();
  try {
    const parsed = JSON.parse(String(row.baseDataJson || "{}"));
    if (parsed && typeof parsed === "object") {
      return parsed as RoadmapData;
    }
  } catch {
    // Fall back to default baseline if existing DB value is malformed.
  }
  return getDefaultRoadmapData();
}

export async function upsertBoardAutosave(record: UpsertAutosaveInput) {
  const dataSource = await getVersionDb();
  const repo = dataSource.getRepository(BoardAutosaveSchema);
  const existing = await repo.findOne({ where: { boardId: record.boardId } });
  const now = new Date().toISOString();
  if (!existing) {
    await repo.insert({
      boardId: record.boardId,
      manifestJson: record.manifestJson,
      savedAt: record.savedAt || null,
      createdAt: now,
      updatedAt: now
    });
    return;
  }
  await repo.update(
    { boardId: record.boardId },
    {
      manifestJson: record.manifestJson,
      savedAt: record.savedAt || null,
      updatedAt: now
    }
  );
}

export async function getBoardAutosave(boardId: string) {
  const dataSource = await getVersionDb();
  const repo = dataSource.getRepository(BoardAutosaveSchema);
  const row = await repo.findOne({ where: { boardId } });
  if (!row) return undefined;
  return {
    boardId: row.boardId,
    manifestJson: row.manifestJson,
    savedAt: row.savedAt || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  } as BoardAutosaveRecord;
}
