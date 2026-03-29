"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";

type Board = {
  id: string;
  name?: string;
  createdAt?: string;
  updatedAt?: string;
};

function toPrettyDate(value?: string) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}

export default function DashboardClient() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  async function loadBoards() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/boards", { cache: "no-store" });
      if (!response.ok) {
        let message = `Failed to load boards (${response.status})`;
        try {
          const payload: { error?: string } = await response.json();
          if (payload?.error) message = payload.error;
        } catch (_) {
          // keep default message
        }
        throw new Error(message);
      }
      const payload: { boards?: Board[] } = await response.json();
      const list = Array.isArray(payload?.boards) ? payload.boards : [];
      setBoards(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error loading boards.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadBoards();
  }, []);

  async function handleCreateBoard() {
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/boards", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        }
      });
      if (!response.ok) {
        let message = `Failed to create board (${response.status})`;
        try {
          const payload: { error?: string } = await response.json();
          if (payload?.error) message = payload.error;
        } catch (_) {
          // keep default message
        }
        throw new Error(message);
      }
      const payload: { board?: { id?: string } } = await response.json();
      const boardId = String(payload?.board?.id || "");
      if (!boardId) {
        throw new Error("Create response did not include a board ID.");
      }
      window.location.href = `/boards/${encodeURIComponent(boardId)}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error creating board.");
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Roadmap Dashboard</CardTitle>
            <CardDescription>Create a board and open it by ID.</CardDescription>
          </div>
          <Button type="button" variant="outline" onClick={handleCreateBoard} disabled={creating}>
            {creating ? "Creating..." : "Create New Board"}
          </Button>
        </CardHeader>
      </Card>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold">Boards</h2>
          <p className="text-muted-foreground text-sm">{loading ? "Loading..." : `${boards.length} board(s)`}</p>
        </div>
        {error ? <div className="errors">{error}</div> : null}
        {!loading && !error && boards.length === 0 ? (
          <p className="text-muted-foreground text-sm">No boards yet. Create your first board.</p>
        ) : null}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {boards.map((board) => (
            <Card key={board.id} className="gap-4 py-4">
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">{board.name || "Untitled board"}</h3>
                <Badge variant="secondary">Board</Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-muted-foreground text-xs">ID: {board.id}</p>
                <p className="text-muted-foreground text-xs">Created: {toPrettyDate(board.createdAt)}</p>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/boards/${encodeURIComponent(board.id)}`}>Open Board</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
