import type { Metadata } from "next";

import DashboardClient from "./dashboard-client";

export const metadata: Metadata = {
  title: "Roadmap Dashboard",
  description: "Create and open roadmap boards"
};

export default function DashboardPage() {
  return <DashboardClient />;
}
