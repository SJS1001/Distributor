// Fixed child program: stdin PDF -> raster-only PDF on stdout. Never accepts paths or URLs.
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
const max = 16 * 1024 * 1024;
try {
  const chunks = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > max) throw Error("size");
    chunks.push(chunk);
  }
  const input = Buffer.concat(chunks);
  const task = getDocument({
    data: new Uint8Array(input),
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    stopAtErrors: true,
    maxImageSize: 16000000,
    verbosity: 0,
  });
  const original = await task.promise;
  if (original.numPages < 1 || original.numPages > 100) throw Error("pages");
  const output = await PDFDocument.create();
  let pixels = 0;
  for (let i = 1; i <= original.numPages; i++) {
    const page = await original.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 });
    const w = Math.ceil(viewport.width),
      h = Math.ceil(viewport.height);
    pixels += w * h;
    if (
      w < 1 ||
      h < 1 ||
      w > 4096 ||
      h > 4096 ||
      w * h > 16000000 ||
      pixels > 80000000
    )
      throw Error("pixels");
    const canvas = createCanvas(w, h);
    await page.render({
      canvas,
      canvasContext: canvas.getContext("2d"),
      viewport,
      background: "rgb(255,255,255)",
    }).promise;
    const png = canvas.toBuffer("image/png");
    const embedded = await output.embedPng(png);
    const target = output.addPage([w / 1.5, h / 1.5]);
    target.drawImage(embedded, { x: 0, y: 0, width: w / 1.5, height: h / 1.5 });
    page.cleanup();
  }
  await task.destroy();
  const result = await output.save();
  if (result.length > max) throw Error("output");
  process.stdout.write(Buffer.from(result));
} catch {
  process.exitCode = 1;
}
