import {
  createBoard,
  getBoardBaseData,
  getBoardById,
  getLatestManifestForBoard,
  updateBoardName,
  type BoardRecord
} from "../../../lib/roadmap-repository";
import { z } from "zod";

export const runtime = "nodejs";

const SAFE_BOARD_ID_RE = /^[a-z0-9-]+$/i;
const MAX_BOARD_NAME_LENGTH = 80;
const boardIdSchema = z.string().trim().regex(SAFE_BOARD_ID_RE, "A valid board ID is required.");
const patchBodySchema = z.object({
  name: z.string().trim().max(MAX_BOARD_NAME_LENGTH).optional()
});

type Params = {
  boardId?: string;
};

function sanitizeBoardName(rawValue: unknown) {
  const value = String(rawValue || "").trim();
  if (!value) return "Untitled board";
  return value.slice(0, MAX_BOARD_NAME_LENGTH);
}

function toPublicBoard(board: BoardRecord) {
  return {
    id: board.id,
    name: board.name || "Untitled board",
    latestHistoryId: board.latestHistoryId ?? null,
    createdAt: board.createdAt,
    updatedAt: board.updatedAt
  };
}

export async function GET(_request: Request, { params }: { params: Promise<Params> }) {
  try {
    const requestUrl = new URL(_request.url);
    const includeSnapshot = String(requestUrl.searchParams.get("includeSnapshot") || "") === "1";
    const resolvedParams = await params;
    const boardIdResult = boardIdSchema.safeParse(resolvedParams?.boardId || "");
    if (!boardIdResult.success) {
      return Response.json({ error: boardIdResult.error.issues[0]?.message || "A valid board ID is required." }, { status: 400 });
    }
    const boardId = boardIdResult.data;
    await createBoard(boardId);
    const board = await getBoardById(boardId);
    const publicBoard = toPublicBoard(board || { id: boardId, name: "Untitled board" });
    if (!includeSnapshot) {
      return Response.json({
        ok: true,
        board: publicBoard
      });
    }
    const [baseData, latestManifestEntry] = await Promise.all([
      getBoardBaseData(boardId),
      getLatestManifestForBoard(boardId)
    ]);
    let latestManifest = null;
    if (latestManifestEntry?.manifestJson) {
      try {
        latestManifest = JSON.parse(String(latestManifestEntry.manifestJson || ""));
      } catch {
        latestManifest = null;
      }
    }
    return Response.json({
      ok: true,
      board: {
        ...publicBoard,
        baseData,
        latestManifestFileName: latestManifestEntry?.fileName || "",
        latestManifest
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error while loading board.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<Params> }) {
  try {
    const resolvedParams = await params;
    const boardIdResult = boardIdSchema.safeParse(resolvedParams?.boardId || "");
    if (!boardIdResult.success) {
      return Response.json({ error: boardIdResult.error.issues[0]?.message || "A valid board ID is required." }, { status: 400 });
    }
    const boardId = boardIdResult.data;

    const payload: unknown = await request.json().catch(() => ({}));
    const parsedPayload = patchBodySchema.safeParse(payload);
    if (!parsedPayload.success) {
      const message = parsedPayload.error.issues[0]?.message || "Invalid board payload.";
      return Response.json({ error: message }, { status: 400 });
    }
    const nextName = sanitizeBoardName(parsedPayload.data.name);
    await createBoard(boardId);
    await updateBoardName(boardId, nextName);
    const board = await getBoardById(boardId);
    return Response.json({
      ok: true,
      board: toPublicBoard(board || { id: boardId, name: nextName })
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error while updating board.";
    return Response.json({ error: message }, { status: 500 });
  }
}
