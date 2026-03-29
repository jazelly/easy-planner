import { randomUUID } from "node:crypto";

import { createBoard, listBoards, type BoardRecord } from "../../lib/roadmap-repository";

export const runtime = "nodejs";

function toPublicBoard(board: BoardRecord) {
  return {
    id: board.id,
    name: board.name || "Untitled board",
    createdAt: board.createdAt,
    updatedAt: board.updatedAt
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
    await createBoard(boardId, "Untitled board");
    return Response.json({
      ok: true,
      board: {
        id: boardId,
        name: "Untitled board"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error while creating board.";
    return Response.json({ error: message }, { status: 500 });
  }
}
