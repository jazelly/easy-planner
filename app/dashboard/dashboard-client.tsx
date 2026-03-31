"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, CalendarClock, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
      <section className="rounded-xl border border-[var(--shell-border-subtle)] bg-[var(--shell-panel-muted)] p-3 shadow-[var(--shadow-sm)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--shell-text-subtle)]">Workspace</p>
            <h1 className="text-lg font-semibold text-[var(--shell-text-strong)]">Roadmap Dashboard</h1>
            <p className="text-sm text-[var(--shell-text-muted)]">Create and open boards from one focused view.</p>
          </div>
          <Button type="button" variant="outline" onClick={handleCreateBoard} disabled={creating} className="gap-1.5">
            <Plus className="size-3.5" />
            {creating ? "Creating..." : "New Board"}
          </Button>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--shell-border-subtle)] bg-[var(--shell-panel)] p-3 shadow-[var(--shadow-sm)]">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-semibold text-[var(--shell-text-strong)]">Boards</h2>
          <p className="text-xs text-[var(--shell-text-muted)]">{loading ? "Loading..." : `${boards.length} total`}</p>
        </div>
        {error ? (
          <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</div>
        ) : null}
        {!loading && !error && boards.length === 0 ? (
          <p className="mt-4 rounded-md border border-[var(--shell-border-subtle)] bg-[var(--shell-panel-muted)] px-3 py-6 text-center text-sm text-[var(--shell-text-muted)]">
            No boards yet. Create your first board.
          </p>
        ) : null}
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {boards.map((board) => (
            <article
              key={board.id}
              className="group rounded-lg border border-[var(--shell-border-subtle)] bg-[var(--shell-panel)] px-3 py-2.5 shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--shell-border-strong)]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-0.5">
                  <h3 className="truncate text-sm font-semibold text-[var(--shell-text-strong)]">
                    {board.name || "Untitled board"}
                  </h3>
                  <p className="truncate text-xs text-[var(--shell-text-subtle)]">{board.id}</p>
                </div>
                <Badge variant="secondary" className="text-[10px]">
                  Board
                </Badge>
              </div>
              <div className="mt-2 space-y-1">
                <p className="flex items-center gap-1.5 text-xs text-[var(--shell-text-muted)]">
                  <CalendarClock className="size-3" />
                  <span>Created {toPrettyDate(board.createdAt)}</span>
                </p>
                <p className="text-xs text-[var(--shell-text-muted)]">Updated {toPrettyDate(board.updatedAt)}</p>
              </div>
              <div className="mt-3">
                <Button asChild variant="outline" size="sm" className="h-7 w-full justify-between px-2 text-xs">
                  <Link href={`/boards/${encodeURIComponent(board.id)}`}>
                    Open board
                    <ArrowUpRight className="size-3" />
                  </Link>
                </Button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
