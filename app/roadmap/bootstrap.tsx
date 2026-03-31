"use client";

import { useEffect } from "react";

export default function RoadmapBootstrap() {
  useEffect(() => {
    import("./runtime").catch((error: unknown) => {
      console.error("Failed to load roadmap runtime", error);
    });
  }, []);

  return null;
}
