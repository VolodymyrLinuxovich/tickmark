// /app: server wrapper for the client workbench. It reads server-only settings (data source,
// configured parser models, Ramp scopes) and passes them down as props, so no secrets reach the client.

import type { Metadata } from "next";
import { Suspense } from "react";
import { getSource } from "@/lib/ramp/source";
import { READ_SCOPES } from "@/lib/ramp/api-client";
import { availableProviders } from "@/lib/parse/claude";
import { TopBar } from "../topbar";
import Workbench from "../workbench";

export const metadata: Metadata = { title: "Tickmark app" };

export default function AppPage() {
  const info = getSource().info;
  return (
    <>
      <TopBar info={info} />
      {/* Workbench reads ?sample= with useSearchParams, which needs a Suspense boundary under Cache Components. */}
      <Suspense>
        <Workbench source={info} models={availableProviders()} scopes={READ_SCOPES} />
      </Suspense>
    </>
  );
}
