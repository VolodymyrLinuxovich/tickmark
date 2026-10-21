import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LandingPage } from "../landing/landing-page";
import { DICTS, LOCALES, isLocale } from "@/lib/i18n";

// Translated landing pages: /es, /de, /fr, /uk. English lives at /.

export function generateStaticParams() {
  return LOCALES.filter((l) => l !== "en").map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  return { title: { absolute: DICTS[lang].meta.title }, description: DICTS[lang].meta.description };
}

export default async function LocalizedHome({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLocale(lang) || lang === "en") notFound();
  return <LandingPage lang={lang} />;
}
