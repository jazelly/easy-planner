import type { MigrationInterface, QueryRunner } from "typeorm";

import { getDefaultRoadmapData } from "../../default-roadmap-data";

type SupportedDbProvider = "sqljs" | "sqlite" | "better-sqlite3" | "postgres";

function asProvider(raw: unknown): SupportedDbProvider {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "postgres") return "postgres";
  if (value === "better-sqlite3") return "better-sqlite3";
  if (value === "sqlite") return "sqlite";
  return "sqljs";
}

async function getSqliteColumnNames(queryRunner: QueryRunner, tableName: string) {
  const rows = await queryRunner.query(`PRAGMA table_info(${tableName})`) as Array<{ name?: string }>;
  return new Set(rows.map((row) => String(row?.name || "")));
}

export class InitSchema0001 implements MigrationInterface {
  name = "InitSchema0001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const provider = asProvider(queryRunner.connection.options.type);
    const defaultBaseDataJson = JSON.stringify(getDefaultRoadmapData(), null, 2);

    if (provider === "postgres") {
      await queryRunner.query(`
        CREATE TABLE IF NOT EXISTS boards (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL DEFAULT 'Untitled board',
          base_data_json TEXT NOT NULL DEFAULT '{}',
          latest_history_id INTEGER,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await queryRunner.query(`
        CREATE TABLE IF NOT EXISTS manifest_versions (
          id BIGSERIAL PRIMARY KEY,
          board_id TEXT NOT NULL DEFAULT 'default',
          version INTEGER NOT NULL UNIQUE,
          file_name TEXT NOT NULL UNIQUE,
          file_path TEXT NOT NULL,
          thumbnail_file_name TEXT,
          thumbnail_path TEXT,
          saved_at TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await queryRunner.query(`
        CREATE TABLE IF NOT EXISTS board_history (
          id BIGSERIAL PRIMARY KEY,
          board_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          manifest_name TEXT NOT NULL,
          manifest_json TEXT NOT NULL,
          thumbnail_data_url TEXT,
          saved_at TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT uniq_board_history_board_version UNIQUE(board_id, version),
          CONSTRAINT uniq_board_history_board_manifest_name UNIQUE(board_id, manifest_name)
        );
      `);
      await queryRunner.query(`
        CREATE TABLE IF NOT EXISTS board_autosave (
          board_id TEXT PRIMARY KEY,
          manifest_json TEXT NOT NULL,
          saved_at TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await queryRunner.query("CREATE INDEX IF NOT EXISTS idx_manifest_versions_file_name ON manifest_versions(file_name);");
      await queryRunner.query("CREATE INDEX IF NOT EXISTS idx_manifest_versions_board_id ON manifest_versions(board_id);");
      await queryRunner.query("CREATE INDEX IF NOT EXISTS idx_board_history_board_version ON board_history(board_id, version DESC);");

      await queryRunner.query("ALTER TABLE boards ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT 'Untitled board';");
      await queryRunner.query("ALTER TABLE boards ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;");
      await queryRunner.query("ALTER TABLE boards ADD COLUMN IF NOT EXISTS base_data_json TEXT;");
      await queryRunner.query("ALTER TABLE boards ADD COLUMN IF NOT EXISTS latest_history_id INTEGER;");
      await queryRunner.query("ALTER TABLE manifest_versions ADD COLUMN IF NOT EXISTS board_id TEXT NOT NULL DEFAULT 'default';");

      await queryRunner.query(
        `
        UPDATE boards
        SET base_data_json = $1
        WHERE base_data_json IS NULL OR TRIM(base_data_json) = '' OR base_data_json = '{}'
        `,
        [defaultBaseDataJson]
      );
      await queryRunner.query(`
        UPDATE boards
        SET updated_at = COALESCE(updated_at, created_at, NOW())
        WHERE updated_at IS NULL;
      `);
      await queryRunner.query(`
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
      `);
      return;
    }

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS boards (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT 'Untitled board',
        base_data_json TEXT NOT NULL DEFAULT '{}',
        latest_history_id INTEGER,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    await queryRunner.query(`
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
    `);
    await queryRunner.query(`
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
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS board_autosave (
        board_id TEXT PRIMARY KEY,
        manifest_json TEXT NOT NULL,
        saved_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    await queryRunner.query("CREATE INDEX IF NOT EXISTS idx_manifest_versions_file_name ON manifest_versions(file_name);");
    await queryRunner.query("CREATE INDEX IF NOT EXISTS idx_manifest_versions_board_id ON manifest_versions(board_id);");
    await queryRunner.query("CREATE INDEX IF NOT EXISTS idx_board_history_board_version ON board_history(board_id, version DESC);");

    const manifestColumns = await getSqliteColumnNames(queryRunner, "manifest_versions");
    if (!manifestColumns.has("board_id")) {
      await queryRunner.query("ALTER TABLE manifest_versions ADD COLUMN board_id TEXT NOT NULL DEFAULT 'default';");
    }

    const boardColumns = await getSqliteColumnNames(queryRunner, "boards");
    if (!boardColumns.has("name")) {
      await queryRunner.query("ALTER TABLE boards ADD COLUMN name TEXT NOT NULL DEFAULT 'Untitled board';");
    }
    if (!boardColumns.has("updated_at")) {
      await queryRunner.query("ALTER TABLE boards ADD COLUMN updated_at TEXT;");
    }
    if (!boardColumns.has("base_data_json")) {
      await queryRunner.query("ALTER TABLE boards ADD COLUMN base_data_json TEXT;");
    }
    if (!boardColumns.has("latest_history_id")) {
      await queryRunner.query("ALTER TABLE boards ADD COLUMN latest_history_id INTEGER;");
    }

    await queryRunner.query(
      `
      UPDATE boards
      SET base_data_json = ?
      WHERE base_data_json IS NULL OR TRIM(base_data_json) = '' OR base_data_json = '{}'
      `,
      [defaultBaseDataJson]
    );
    await queryRunner.query(`
      UPDATE boards
      SET updated_at = COALESCE(updated_at, created_at, datetime('now'))
      WHERE updated_at IS NULL OR TRIM(updated_at) = '';
    `);
    await queryRunner.query(`
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
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const provider = asProvider(queryRunner.connection.options.type);
    if (provider === "postgres") {
      await queryRunner.query("DROP TABLE IF EXISTS board_autosave;");
      await queryRunner.query("DROP TABLE IF EXISTS board_history;");
      await queryRunner.query("DROP TABLE IF EXISTS manifest_versions;");
      await queryRunner.query("DROP TABLE IF EXISTS boards;");
      return;
    }
    await queryRunner.query("DROP TABLE IF EXISTS board_autosave;");
    await queryRunner.query("DROP TABLE IF EXISTS board_history;");
    await queryRunner.query("DROP TABLE IF EXISTS manifest_versions;");
    await queryRunner.query("DROP TABLE IF EXISTS boards;");
  }
}
