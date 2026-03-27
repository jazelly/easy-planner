import { randomUUID } from "node:crypto";
import { createBoard, listBoards } from "../../lib/version-store";

export const runtime = "nodejs";

function toPublicBoard(board) {
  return {
    id: board.id,
    createdAt: board.createdAt
  };
}

export async function GET() {
  try {
    const boards = await listBoards();
    return Response.json({
      ok: true,
      boards: boards.map(toPublicBoard)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error while loading boards.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const boardId = randomUUID();
    await createBoard(boardId);
    return Response.json({
      ok: true,
      board: {
        id: boardId
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error while creating board.";
    return Response.json({ error: message }, { status: 500 });
  }
}
