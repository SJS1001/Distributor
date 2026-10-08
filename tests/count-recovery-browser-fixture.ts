import { fixture } from "./fixtures.ts";
import { createHttp } from "./browser-http.ts";

export async function countRecoveryBrowser(after: (fn: () => void) => void) {
  const f = fixture({ after });
  const http = await createHttp(f.app, { origin: "http://127.0.0.1:3165" });
  await http.listen({ host: "127.0.0.1", port: 3165 });
  return http;
}
