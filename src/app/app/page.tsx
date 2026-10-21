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
      <Suspense>
        <Workbench source={info} models={availableProviders()} scopes={READ_SCOPES} />
      </Suspense>
    </>
  );
}
