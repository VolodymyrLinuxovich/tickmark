// Root layout: loads the three fonts as CSS variables used by globals.css.

import type { Metadata } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import "./globals.css";

const sans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });
const serif = Newsreader({ variable: "--font-serif", subsets: ["latin"], style: ["normal", "italic"] });

const description = "Turns an auditor's request list into a cited evidence binder from Ramp data, and flags control problems before the auditor finds them.";

export const metadata: Metadata = {
  // Absolute base for the link preview image URL. Vercel sets the production host at build time.
  metadataBase: new URL(process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://tickmark-eta.vercel.app"),
  title: { default: "Tickmark · Audit evidence from Ramp", template: "%s · Tickmark" },
  description,
  openGraph: { title: "Tickmark: audit requests answered from Ramp", description, siteName: "Tickmark", type: "website" },
  twitter: { card: "summary_large_image", title: "Tickmark: audit requests answered from Ramp", description },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
