// Link preview image (Open Graph and Twitter) shown when the site is shared in Slack, iMessage or X.
// Rendered once at build time by next/og from the JSX below.

import { ImageResponse } from "next/og";

export const alt = "Tickmark: your auditor's request list, answered from Ramp";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  const ink = "#1b1b18";
  const green = "#17714a";
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 72px", background: "#f6f5f1", color: ink, fontFamily: "Georgia, serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 30, fontFamily: "sans-serif", fontWeight: 600 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, border: `3px solid ${green}`, display: "flex", alignItems: "center", justifyContent: "center", color: green }}>
            <svg width="24" height="24" viewBox="0 0 16 16">
              <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke={green} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          Tickmark
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 72, lineHeight: 1.05, letterSpacing: -2, display: "flex", flexWrap: "wrap" }}>
            Your auditor&apos;s request list,&nbsp;<span style={{ color: green, fontStyle: "italic" }}>answered from Ramp.</span>
          </div>
          <div style={{ fontSize: 30, color: "#55544e", fontFamily: "sans-serif", lineHeight: 1.35 }}>
            Evidence binder in minutes, with control problems flagged before the auditor finds them.
          </div>
        </div>
        <div style={{ display: "flex", gap: 14, fontFamily: "sans-serif", fontSize: 24 }}>
          {["Missing receipts", "Split purchases", "Self-approval", "Duplicate invoices"].map((t) => (
            <div key={t} style={{ display: "flex", padding: "8px 16px", borderRadius: 999, background: "#e6f2eb", color: green }}>{t}</div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
