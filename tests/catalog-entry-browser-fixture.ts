import { fixture } from "./fixtures.ts";
import {
  seedCatalogEntry,
  seedSavedCartQueue,
} from "./catalog-entry-fixture.ts";
import { createHttp } from "./browser-http.ts";
export async function catalogEntryBrowser(after: (fn: () => void) => void) {
  const f = fixture({ after });
  seedCatalogEntry(f);
  seedSavedCartQueue(f);
  const http = await createHttp(f.app, { origin: "http://127.0.0.1:3140" });
  await http.listen({ host: "127.0.0.1", port: 3140 });
  return http;
}
