import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import type { Region } from "../src/server/iam.ts";
import {
  rehearsalSale,
  type RehearsalConfig,
  type Seed,
} from "./rehearsal-fixture.ts";

type Start = {
  kind: "writer" | "http";
  path: string;
  region: Region;
  config: RehearsalConfig;
  seed: Seed;
  writer: number;
  port: number;
};
type Message =
  | { type: "start"; input: Start }
  | { type: "phase"; from: number; to: number }
  | { type: "close" };
let app: Application | undefined,
  http: Awaited<ReturnType<typeof createHttp>> | undefined,
  input: Start | undefined,
  busy = false,
  closing = false;
// Only the coordinator supplies private fresh-store paths over IPC. No environment
// provider configuration or arbitrary server/database CLI is accepted here.
if (!process.send) throw new Error("Rehearsal worker requires coordinator IPC");
const send = (message: unknown) => process.send!(message);
async function close() {
  if (closing) return;
  closing = true;
  if (http) await http.close();
  app?.close();
  process.disconnect();
}
process.on("message", async (raw: Message) => {
  try {
    if (busy) throw new Error("Overlapping worker instruction");
    busy = true;
    if (raw.type === "start") {
      if (input) throw new Error("Worker already initialized");
      input = raw.input;
      app = new Application(input.path, input.region);
      if (input.kind === "http") {
        http = await createHttp(app, {
          origin: `http://127.0.0.1:${input.port}`,
          secureCookies: false,
        });
        await http.listen({ host: "127.0.0.1", port: input.port });
      }
      send({ type: "ready", pid: process.pid });
    } else if (raw.type === "phase") {
      if (!input || !app || input.kind !== "writer")
        throw new Error("Writer not initialized");
      const startedAt = Date.now(),
        sales = [],
        durations = [];
      for (let sequence = raw.from; sequence < raw.to; sequence++) {
        const started = performance.now();
        sales.push(
          rehearsalSale(app, input.seed, input.config, input.writer, sequence),
        );
        durations.push(performance.now() - started);
      }
      send({
        type: "phaseDone",
        startedAt,
        completedAt: Date.now(),
        sales,
        durations,
      });
    } else if (raw.type === "close") {
      await close();
    } else throw new Error("Unknown worker instruction");
    busy = false;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : error instanceof Error
          ? error.name
          : "WORKER_ERROR";
    // Do not print IPC messages, passwords, session cookies or SQL.
    send({ type: "error", code });
    process.exitCode = 1;
    await close();
  }
});
process.on("disconnect", () => {
  // An interrupted coordinator must not leave a listener or writer behind.
  if (process.connected || closing) return;
  closing = true;
  void http?.close().finally(() => app?.close());
  if (!http) app?.close();
});
