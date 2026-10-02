import { readFileSync } from "node:fs";
import { createCanvas } from "@napi-rs/canvas";
import { check, digest, integer } from "./core.ts";
import {
  renderLabel,
  labelRendererHash,
  type LabelFacts,
} from "./label-pdf.ts";

export const zplRendererHash = digest(
  Buffer.concat([
    readFileSync(new URL("./label-zpl.ts", import.meta.url)),
    Buffer.from(
      labelRendererHash + "/pdfjs-dist@6.3.289/@napi-rs/canvas@1.0.9",
    ),
  ]),
);

// Only the application's original identity PDF is rasterized. No uploaded PDF,
// network renderer, printer fonts, escaped user text or printer connection.
export async function renderZpl(facts: LabelFacts, dotsPerMm: 8 | 12) {
  check(
    dotsPerMm === 8 || dotsPerMm === 12,
    "VALIDATION",
    "Select 8 or 12 dots per mm.",
  );
  integer(facts.copies, "label copies", 1, 20);
  const bytes = await renderLabel({ ...facts, copies: 1 });
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
  });
  try {
    const pdf = await task.promise;
    check(
      pdf.numPages === 1,
      "LABEL_LAYOUT",
      "Label must contain one identity page.",
    );
    const page = await pdf.getPage(1),
      width = 100 * dotsPerMm,
      height = 50 * dotsPerMm,
      canvas = createCanvas(width, height),
      context = canvas.getContext("2d"),
      viewport = page.getViewport({ scale: (25.4 * dotsPerMm) / 72 });
    check(
      Math.abs(viewport.width - width) < 0.01 &&
        Math.abs(viewport.height - height) < 0.01,
      "LABEL_LAYOUT",
      "Label dimensions do not match selected media.",
    );
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
      background: "rgb(255,255,255)",
    }).promise;
    const pixels = context.getImageData(0, 0, width, height).data,
      rowBytes = Math.ceil(width / 8),
      graphic = Buffer.alloc(rowBytes * height);
    check(
      graphic.length <= 99999,
      "LABEL_LAYOUT",
      "Graphic exceeds ZPL field bounds.",
    );
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const p = (y * width + x) * 4;
        // Composite on white before thresholding. MSB is the leftmost dot;
        // unused row padding stays white. Fixed luminance, no dithering.
        const luminance =
            (299 * pixels[p]! + 587 * pixels[p + 1]! + 114 * pixels[p + 2]!) /
            1000,
          alpha = pixels[p + 3]! / 255;
        if (alpha * luminance + (1 - alpha) * 255 < 128)
          graphic[y * rowBytes + (x >> 3)]! |= 0x80 >> (x & 7);
      }
    const format = `^XA\n^PW${width}\n^LL${height}\n^LH0,0\n^LS0\n^LT0\n^PON\n^FWN\n^LRN\n^FO0,0\n^GFA,${graphic.length},${graphic.length},${rowBytes},${graphic.toString("hex").toUpperCase()}^FS\n^PQ1\n^XZ\n`;
    return Buffer.from(format.repeat(facts.copies), "ascii");
  } finally {
    await task.destroy();
  }
}
