import { shippingSummary } from "../shared/shipping-terms.ts";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { check } from "./core.ts";
import type { DocumentFacts } from "./billing-documents.ts";

const fontBytes = readFileSync(
  new URL("./assets/notosans/NotoSans.ttf", import.meta.url),
);
// A stored rendition retains the renderer and font that produced its bytes.
export const rendererHash = createHash("sha256")
  .update(readFileSync(new URL(import.meta.url)))
  .update(readFileSync(new URL("../shared/shipping-terms.ts", import.meta.url)))
  .update(fontBytes)
  .update("pdf-lib@1.17.1;@pdf-lib/fontkit@1.1.1")
  .digest("hex");

export async function renderDocument(facts: DocumentFacts, factsHash: string) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: true });
  const characters = new Set(font.getCharacterSet());
  const title = facts.kind === "invoice" ? "Invoice" : "Credit note";
  pdf.setTitle(`${title} ${facts.number}`);
  pdf.setAuthor(facts.issuer.name);
  pdf.setCreator("Distributor billing");
  pdf.setCreationDate(new Date(facts.capturedAt));
  pdf.setModificationDate(new Date(facts.capturedAt));
  const money = (cents: number) =>
    `${facts.currency} ${(cents / 100).toFixed(2)}`;
  let page = pdf.addPage([612, 792]),
    y = 734;
  const nextPage = () => {
    page = pdf.addPage([612, 792]);
    y = 734;
    page.drawText(`${title} (continued)`, { x: 50, y: 756, size: 12, font });
  };
  const paragraph = (value: string, size = 10, gap = 7) => {
    value = value.normalize("NFC");
    check(
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value),
      "DOCUMENT_TEXT",
      "Document contains unsupported control characters.",
      409,
    );
    for (const character of value.replace(/[\n\r\t]/g, ""))
      check(
        characters.has(character.codePointAt(0)!),
        "DOCUMENT_GLYPH",
        "A document character is not supported by the installed font. No incomplete PDF was delivered.",
        409,
      );
    const width = (s: string) => font.widthOfTextAtSize(s, size);
    const emit = (line: string) => {
      if (y < 60 + size) nextPage();
      if (line)
        page.drawText(line, {
          x: 50,
          y,
          size,
          font,
          color: rgb(0.12, 0.16, 0.2),
        });
      y -= size * 1.45;
    };
    for (const sourceLine of value.split(/\r?\n/)) {
      let line = "";
      for (const word of sourceLine.trim().split(/\s+/)) {
        if (line && width(`${line} ${word}`) > 512) {
          emit(line);
          line = "";
        }
        if (width(word) > 512) {
          if (line) {
            emit(line);
            line = "";
          }
          for (const character of word) {
            if (line && width(line + character) > 512) {
              emit(line);
              line = "";
            }
            line += character;
          }
        } else line += `${line ? " " : ""}${word}`;
      }
      emit(line);
    }
    y -= gap;
  };
  paragraph(title, 22, 12);
  paragraph(`Number: ${facts.number}`, 12);
  paragraph(
    `Issued: ${facts.issuedAt.slice(0, 10)}${facts.kind === "invoice" ? ` | Due: ${facts.dueAt?.slice(0, 10) ?? "not recorded"}` : ""}`,
  );
  if (facts.originalNumber)
    paragraph(`Original invoice: ${facts.originalNumber}`);
  for (const [label, party] of [
    ["Issuer", facts.issuer],
    ["Bill to", facts.customer],
  ] as const) {
    paragraph(label, 12, 3);
    paragraph(party.name);
    paragraph(party.address || "Billing address not recorded.");
    paragraph(`Tax registration: ${party.taxRegistration || "not recorded"}`);
  }
  paragraph(shippingSummary(facts.shipping, facts.currency));
  if (facts.shipping?.treatment === "extra")
    paragraph(
      facts.kind === "credit"
        ? "Shipping credit, if any, is shown explicitly in the credit lines below."
        : facts.shipping.charged
          ? "The agreed shipping charge is included in this invoice."
          : "No shipping charge on this invoice; the agreed charge belongs to the first shipment invoice.",
    );
  paragraph("Original document lines", 13);
  facts.lines.forEach((line, index) => {
    paragraph(`${index + 1}. ${line.description}`, 11, 3);
    paragraph(
      `Qty ${line.quantity} | Unit net ${money(line.unitPrice)} | Unit tax ${money(line.unitTax)}`,
      10,
      3,
    );
    paragraph(
      `Line net ${money(line.quantity * line.unitPrice)} | Tax ${money(line.quantity * line.unitTax)} | Total ${money(line.quantity * (line.unitPrice + line.unitTax))}`,
    );
  });
  paragraph(
    `Net: ${money(facts.net)}\nTax: ${money(facts.tax)}\nTotal: ${money(facts.total)}`,
    12,
    12,
  );
  if (facts.reason) paragraph(`Credit reason: ${facts.reason}`);
  if (facts.reference) paragraph(`Business reference: ${facts.reference}`);
  if (facts.opening) {
    paragraph(
      "Reconstructed opening invoice; this is not the original source PDF.",
      11,
    );
    paragraph(
      `Source: ${facts.opening.sourceRef} / ${facts.opening.sourceId}\nCutoff: ${facts.opening.cutoffAt}\nAt cutoff: credits ${money(facts.opening.credited)}, payments ${money(facts.opening.paid)}, refunds ${money(facts.opening.refunded)}, outstanding ${money(facts.opening.balance)}`,
    );
  }
  paragraph(
    `Identity basis: ${facts.identityBasis}\nCaptured: ${facts.capturedAt}`,
  );
  if (facts.kind === "invoice")
    paragraph(
      `Terms: ${facts.terms.days === null ? "not recorded" : `${facts.terms.days} calendar days`} | Basis: ${facts.terms.basis}`,
    );
  paragraph(
    "This document preserves original amounts. Current payments, credits, refunds and balances appear in account aging. Billing identities, tax treatment and document samples require operator qualification.",
    9,
  );
  const pages = pdf.getPages();
  pages.forEach((p, i) =>
    p.drawText(
      `Page ${i + 1} of ${pages.length} | Facts ${factsHash.slice(0, 16)}`,
      { x: 50, y: 32, size: 8, font },
    ),
  );
  return Buffer.from(await pdf.save());
}
