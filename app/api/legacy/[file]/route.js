import { readFile } from "node:fs/promises";
import path from "node:path";

const LEGACY_FILES = new Set(["roadmap.js", "roadmap-data.js"]);

function contentTypeForFile(file) {
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "text/plain; charset=utf-8";
}

export async function GET(_request, { params }) {
  const resolvedParams = await params;
  const file = resolvedParams?.file;
  if (!LEGACY_FILES.has(file)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const fullPath = path.join(process.cwd(), file);
    const content = await readFile(fullPath, "utf8");
    return new Response(content, {
      status: 200,
      headers: {
        "content-type": contentTypeForFile(file),
        "cache-control": "no-store"
      }
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
