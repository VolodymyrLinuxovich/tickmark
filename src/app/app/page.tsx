import type { Metadata } from "next";
import { Suspense } from "react";
import { getSource } from "@/lib/ramp/source";
import { READ_SCOPES } from "@/lib/ramp/api-client";
import { TopBar } from "../topbar";
import Workbench from "../workbench";

export const metadata: Metadata = { title: "Tickmark app" };

export default function AppPage() {
  const info = getSource().info;
  return (
    <>
      <TopBar info={info} />
      <Suspense>
        <Workbench source={info} claude={!!process.env.ANTHROPIC_API_KEY && process.env.TICKMARK_PARSER !== "rules"} scopes={READ_SCOPES} />
      </Suspense>
    </>
  );
}
