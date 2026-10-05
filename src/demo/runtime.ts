import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../server/application.ts";
import { createHttp } from "../server/http.ts";
import { seedNativeDemo } from "./seed.ts";
import { DemoProviderRuntime } from "./payments.ts";
import type { PaymentScenario } from "./scenarios.ts";
import { demoCarriers } from "./carriers.ts";

export interface DemoInput {
  companyName: string;
  region: "CA" | "US";
  paymentScenario?: PaymentScenario;
}
export interface DemoAccount {
  role: string;
  email: string;
  password: string;
}
export interface DemoInstance {
  http: Awaited<ReturnType<typeof createHttp>>;
  accounts: DemoAccount[];
  close(): Promise<void>;
}

/** Deliberately does not import runtime environment/provider/carrier configuration. */
export async function createDemoInstance(
  input: DemoInput,
  options: {
    origin: string;
    secureCookies: boolean;
    staticRoot: string;
  },
): Promise<DemoInstance> {
  const directory = await mkdtemp(join(tmpdir(), "distributor-native-demo-"));
  let app: Application | undefined;
  let http: DemoInstance["http"] | undefined;
  let stopWorker: (() => Promise<void>) | undefined;
  try {
    app = new Application(join(directory, "demo.db"), input.region, {
      mfaEncryptionKey: randomBytes(32).toString("hex"),
      providerEncryptionKey: randomBytes(32).toString("hex"),
      eventReports: true,
    });
    const seed = await seedNativeDemo(app, input);
    const providers = new DemoProviderRuntime(
      app,
      seed.actor,
      input.paymentScenario,
    );
    http = await createHttp(app, {
      ...options,
      logger: false,
      providers,
      carriers: demoCarriers(app, seed.actor),
    });
    await http.ready();
    // Match the actual application's queued processing without any live transport.
    // Serialize ticks and await the current one before closing its database.
    let stopping = false;
    let active: Promise<void> = Promise.resolve();
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        active = providers
          .tick()
          .then(
            () => {},
            () => {
              // Current grants/consent can intentionally stop processing. Retain
              // native effect/callback evidence and retry on the next bounded tick.
            },
          )
          .finally(() => {
            if (!stopping) schedule();
          });
      }, 1000);
      timer.unref();
    };
    schedule();
    stopWorker = async () => {
      stopping = true;
      clearTimeout(timer);
      await active;
    };
    let closed = false;
    return {
      http,
      accounts: seed.accounts,
      async close() {
        if (closed) return;
        closed = true;
        try {
          await stopWorker!();
          await http!.close();
        } finally {
          try {
            app!.close();
          } finally {
            await rm(directory, { recursive: true, force: true });
          }
        }
      },
    };
  } catch (error) {
    try {
      await stopWorker?.();
      await http?.close();
    } finally {
      try {
        app?.close();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
    throw error;
  }
}
