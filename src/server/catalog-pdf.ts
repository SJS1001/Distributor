import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { check } from "./core.ts";
import { catalogDocumentMaxBytes } from "../shared/catalog-media.ts";
let active = 0;
/** Rasterize in a disposable, bounded child. Original PDF objects never enter the result. */
export async function normalizeCatalogPdf(bytes: Buffer): Promise<Buffer> {
  check(
    active < 1,
    "RESOURCE_BUSY",
    "Document processing is busy. Retry shortly.",
    429,
  );
  active++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--max-old-space-size=256",
          fileURLToPath(
            new URL("./catalog-pdf-normalizer.mjs", import.meta.url),
          ),
        ],
        {
          stdio: ["pipe", "pipe", "ignore"],
          env: { PATH: process.env.PATH ?? "" },
        },
      );
      const chunks: Buffer[] = [];
      let size = 0,
        settled = false;
      const fail = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.kill("SIGKILL");
        try {
          check(
            false,
            "RESOURCE_INSPECTION",
            "Document could not be safely normalized within processing limits.",
            400,
          );
        } catch (e) {
          reject(e);
        }
      };
      const timeout = setTimeout(fail, 20000);
      child.on("error", fail);
      child.stdin.on("error", fail);
      child.stdout.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > catalogDocumentMaxBytes) {
          fail();
          return;
        }
        chunks.push(chunk);
      });
      child.on("close", (code) => {
        if (settled) return;
        if (code !== 0 || size === 0) {
          fail();
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve(Buffer.concat(chunks));
      });
      child.stdin.end(bytes);
    });
  } finally {
    active--;
  }
}
