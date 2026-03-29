import { createBoard, getBoardById, updateBoardName, type BoardRecord } from "../../../lib/version-store";

export const runtime = "nodejs";

const SAFE_BOARD_ID_RE = /^[a-z0-9-]+$/i;
const MAX_BOARD_NAME_LENGTH = 80;

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
    createdAt: board.createdAt,
    updatedAt: board.updatedAt
  };
}

export async function GET(_request: Request, { params }: { params: Promise<Params> }) {
  try {
    const resolvedParams = await params;
    const boardId = String(resolvedParams?.boardId || "").trim();
    if (!boardId || !SAFE_BOARD_ID_RE.test(boardId)) {
      return Response.json({ error: "A valid board ID is required." }, { status: 400 });
    }
    await createBoard(boardId);
    const board = await getBoardById(boardId);
    return Response.json({
      ok: true,
      board: toPublicBoard(board || { id: boardId, name: "Untitled board" })
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error while loading board.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<Params> }) {
  try {
    const resolvedParams = await params;
    const boardId = String(resolvedParams?.boardId || "").trim();
    if (!boardId || !SAFE_BOARD_ID_RE.test(boardId)) {
      return Response.json({ error: "A valid board ID is required." }, { status: 400 });
    }

    const payload: { name?: string } = await request.json().catch(() => ({}));
    const nextName = sanitizeBoardName(payload?.name);
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
