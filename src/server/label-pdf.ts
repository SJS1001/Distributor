import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import QRCode from "qrcode";
import { check, digest } from "./core.ts";

export type LabelFacts = {
  unitId: string;
  warehouseId: string;
  revision: number;
  sku: string;
  serial: string | null;
  copies: number;
};
const fontBytes = readFileSync(
  new URL("./assets/notosans/NotoSans.ttf", import.meta.url),
);
export const labelRendererHash = digest(
  Buffer.concat([
    readFileSync(new URL("./label-pdf.ts", import.meta.url)),
    fontBytes,
    Buffer.from("qrcode@1.5.4/pdf-lib@1.17.1/fontkit@1.1.1"),
  ]),
);

// Identity only: no address, price, bin, condition or mutable quantity on the label.
export async function renderLabel(facts: LabelFacts) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: true });
  const characters = new Set(font.getCharacterSet());
  const texts = [
    "SKU",
    facts.sku,
    facts.serial === null ? "Bulk product" : "Serial",
    facts.serial ?? "Scan for SKU",
  ];
  for (const value of texts) {
    check(
      !/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(value),
      "LABEL_TEXT",
      "Label identity contains unsupported control characters.",
    );
    for (const c of value)
      check(
        characters.has(c.codePointAt(0)!),
        "LABEL_GLYPH",
        "Label identity needs a character unsupported by the installed font.",
      );
  }
  // Byte mode preserves case and Unicode exactly; no GS1 or URL interpretation.
  const qr = await pdf.embedPng(
    await QRCode.toBuffer(
      [{ data: Buffer.from(facts.serial ?? facts.sku, "utf8"), mode: "byte" }],
      { errorCorrectionLevel: "M", scale: 12, margin: 4 },
    ),
  );
  const mm = 72 / 25.4,
    width = 100 * mm,
    height = 50 * mm;
  const wrap = (value: string, size: number) => {
    const lines: string[] = [];
    let line = "";
    for (const c of value) {
      if (line && font.widthOfTextAtSize(line + c, size) > 49 * mm) {
        lines.push(line);
        line = "";
      }
      line += c;
    }
    lines.push(line);
    return lines;
  };
  let size = 9,
    lines = texts.flatMap((t) => wrap(t, size));
  while (lines.length * size * 1.3 > 42 * mm && size > 6) {
    size -= 0.5;
    lines = texts.flatMap((t) => wrap(t, size));
  }
  check(
    lines.length * size * 1.3 <= 42 * mm,
    "LABEL_LAYOUT",
    "Identity does not fit the label. No shortened identity was generated.",
  );
  pdf.setTitle("Distributor stock identity label");
  pdf.setCreationDate(new Date(0));
  pdf.setModificationDate(new Date(0));
  for (let copy = 0; copy < facts.copies; copy++) {
    const page = pdf.addPage([width, height]);
    // A lossless monochrome image avoids renderer seams between adjacent vector cells.
    page.drawImage(qr, {
      x: 3 * mm,
      y: 4 * mm,
      width: 42 * mm,
      height: 42 * mm,
    });
    lines.forEach((line, i) =>
      page.drawText(line, {
        x: 48 * mm,
        y: height - 5 * mm - size - i * size * 1.3,
        size,
        font,
      }),
    );
  }
  return Buffer.from(await pdf.save());
}
