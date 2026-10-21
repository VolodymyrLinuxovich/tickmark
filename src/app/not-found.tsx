// 404 page, rendered with the normal header so the data source pill still shows.

import type { Metadata } from "next";
import Link from "next/link";
import { getSource } from "@/lib/ramp/source";
import { TopBar } from "./topbar";

export const metadata: Metadata = { title: "Page not found · Tickmark" };

export default function NotFound() {
  return (
    <>
      <TopBar info={getSource().info} />
      <main className="wrap not-found">
        <p className="not-found-code">404</p>
        <h1>This page does not exist.</h1>
        <p>The link may be from an older version of Tickmark. Start again from a request list.</p>
        <div className="not-found-actions">
          <Link href="/app" className="btn primary">Open Tickmark</Link>
          <Link href="/" className="btn">Back to home</Link>
        </div>
      </main>
    </>
  );
}
