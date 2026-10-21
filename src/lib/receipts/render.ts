// Picks the file to attach to Ramp for a receipt. A PDF or photo is sent as is, and so is the
// PDF or photo inside an email. An email with no attachment is rendered to a one page PDF with
// its sender, subject, date and text, which is what a person would print and upload.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { ReceiptDoc } from "./extract";
import type { ReceiptUpload } from "../ramp/types";

// The standard PDF fonts only cover Latin-1; replace anything else so drawing cannot throw.
const latin1 = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, "?");

function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if ((line + " " + word).trim().length > max) {
        out.push(line);
        line = word;
      } else line = (line + " " + word).trim();
    }
    out.push(line);
  }
  return out;
}

export async function emailToPdf(doc: ReceiptDoc): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let y = 740;
  const draw = (s: string, f = font, size = 10, color = rgb(0.1, 0.1, 0.1)) => {
    if (y < 50) return;
    page.drawText(latin1(s), { x: 54, y, size, font: f, color });
    y -= size + 5;
  };
  draw(doc.subject ?? doc.name, bold, 14);
  y -= 4;
  if (doc.from) draw(`From: ${doc.from}`, font, 9, rgb(0.35, 0.35, 0.35));
  if (doc.dates[0]) draw(`Date: ${doc.dates[0]}`, font, 9, rgb(0.35, 0.35, 0.35));
  y -= 10;
  for (const line of wrap(doc.text.replace(/\n{3,}/g, "\n\n").trim(), 95).slice(0, 60)) draw(line);
  return pdf.save();
}

export async function uploadFor(doc: ReceiptDoc, original: { bytes: Uint8Array; name: string; content_type: string }): Promise<ReceiptUpload> {
  if (doc.kind === "pdf" || doc.kind === "image") return { bytes: original.bytes, file_name: original.name, content_type: original.content_type || (doc.kind === "pdf" ? "application/pdf" : "image/jpeg") };
  if (doc.attachment) return { bytes: doc.attachment.bytes, file_name: doc.attachment.name, content_type: doc.attachment.content_type };
  return { bytes: await emailToPdf(doc), file_name: original.name.replace(/\.[a-z0-9]+$/i, "") + ".pdf", content_type: "application/pdf" };
}
