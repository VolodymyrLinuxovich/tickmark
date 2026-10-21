import type { Metadata } from "next";
import { Suspense } from "react";
import { PortalView } from "./portal-view";

export const metadata: Metadata = { title: "Shared audit", robots: { index: false, follow: false } };

async function Portal({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PortalView id={id} />;
}

export default function PortalPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={null}>
      <Portal params={params} />
    </Suspense>
  );
}
