// /readiness: the year-end checks on recent weeks, so problems are fixed while they are days old.
// Server wrapper that passes the data source to the client view.

import type { Metadata } from "next";
import { Suspense } from "react";
import { getSource } from "@/lib/ramp/source";
import { TopBar } from "../topbar";
import { ReadinessView } from "./view";

export const metadata: Metadata = { title: "Audit readiness" };

export default function ReadinessPage() {
  const info = getSource().info;
  return (
    <>
      <TopBar info={info} />
      {/* The view reads ?days= with useSearchParams, which needs a Suspense boundary under Cache Components. */}
      <Suspense>
        <ReadinessView source={info} />
      </Suspense>
    </>
  );
}
