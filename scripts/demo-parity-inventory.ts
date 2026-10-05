/** Read-only inventory: registers native routes without listening or invoking handlers.
 * Run: node_modules/.bin/tsx scripts/demo-parity-inventory.ts
 * Regenerate docs: add --write. No database, login, provider transport or demo simulator.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { commands, createHttp } from "../src/server/http.ts";
import type { Application } from "../src/server/application.ts";
import { workspacePages } from "../src/web/navigation.ts";
const app = {} as Application; // Registration captures handlers; never executes them.
const names = Object.keys(commands(app)).sort();
const http = await createHttp(app, {
  origin: "http://127.0.0.1",
  staticRoot: "/distributor-inventory-no-static-files",
});
await http.ready();
const tree = http.printRoutes({ commonPrefix: false });
await http.close();
const stack: string[] = [];
const routes: { method: string; path: string }[] = [];
for (const line of tree.split("\n")) {
  const branch = line.search(/[├└]/);
  if (branch < 0) continue;
  const match = line.slice(branch).match(/^[├└]── (.*?) \(([^)]+)\)$/);
  if (!match) throw Error(`Unrecognized route tree line: ${line}`);
  const depth = branch / 4;
  if (!Number.isInteger(depth))
    throw Error("Unexpected Fastify route indentation");
  stack.length = depth;
  stack[depth] = match[1];
  const path = stack.join("");
  for (const method of match[2].split(", "))
    if (method !== "HEAD") routes.push({ method, path });
}
const files = readdirSync("src/web")
  .filter((n) => /\.tsx?$/.test(n))
  .sort()
  .map((n) => {
    const path = `src/web/${n}`,
      text = readFileSync(path, "utf8");
    return {
      path,
      lines: text.split("\n").length,
      exports: [...text.matchAll(/export (?:async )?function\s+(\w+)/g)].map(
        (m) => m[1],
      ),
    };
  });
const cli = readdirSync("src/server")
  .filter((n) => /(?:cli|worker)\.ts$/.test(n))
  .sort();
const result = {
  pages: workspacePages,
  commands: names,
  routes,
  webFiles: files,
  cliOnlyFiles: cli,
};
if (!process.argv.includes("--write")) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}
const file = "docs/DEMO-FUNCTIONALITY-MATRIX.md";
let text = readFileSync(file, "utf8").split("\n## Source coverage register")[0];
text +=
  "\n## Source coverage register\n\nReproduce with `node_modules/.bin/tsx scripts/demo-parity-inventory.ts`; regenerate this section with `--write`. This registers the native Fastify runtime without listening, opening a database, invoking handlers or provider I/O. A placeholder Application is used only to capture handlers. Command names come directly from `commands(app)` keys, and routes come from Fastify after `ready()`, including expanded command/security/carrier/effect loops and webhook plugin registration. Automatic HEAD aliases and static serving are excluded. Counts prove registration only, not successful workflow execution.\n\n";
text += `- Native pages: **${workspacePages.length}**.\n- Native registered commands: **${names.length}**.\n- Registered method/path pairs excluding automatic HEAD/static: **${routes.length}** (${[
  ...new Set(routes.map((r) => r.method)),
]
  .sort()
  .map((m) => `${m} ${routes.filter((r) => r.method === m).length}`)
  .join(
    ", ",
  )}).\n- Native web source files: **${files.length}**, including **${files.filter((f) => f.path.endsWith(".tsx")).length} TSX files**.\n- CLI/worker entrypoint files: **${cli.length}**.\n`;
text +=
  "\n### Registered native commands\n\nEvery command is retained by native runtime reuse. None is executed by public v1 or the unpublished standalone draft; their analogues are listed in the page matrix. Native source reuse does not prove every command's happy/failure/recovery path.\n\n";
for (const group of [...new Set(names.map((n) => n.split(".")[0]))].sort())
  text += `- **${group}**: ${names
    .filter((n) => n.split(".")[0] === group)
    .map((n) => `\`${n}\``)
    .join(", ")}.\n`;
text +=
  "\n### Registered HTTP method/path pairs\n\nAll routes below are absent from both standalone versions. An isolated native runtime preserves these registrations and their real handlers. Providers, documents and roles still need explicit scenario validation.\n\n| Method | Registered path |\n|---|---|\n";
for (const r of routes.sort(
  (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
))
  text += `| ${r.method} | \`${r.path}\` |\n`;
text +=
  "\n### Native UI file/component inventory\n\nPublic v1 and the standalone draft directly reuse none of these files. All specialist UI surfaces must be served from native source for UI parity. Export names are aids; internal/local components are covered by their owning file.\n\n| Native file | Lines | Exported functions / responsibility |\n|---|---|---|\n";
for (const f of files)
  text += `| \`${f.path}\` | ${f.lines} | ${f.exports.join(", ") || "Contracts, constants or application composition"} |\n`;
text +=
  "\n### CLI and worker capabilities outside browser parity\n\nThese native entrypoints are preserved in source; they are not browser UI and must not be presented as working public demo controls. Operator-only restore, credential management, migrations and journal transport need explicit controlled scenarios rather than invented public buttons.\n\n";
const cliDescriptions: Record<string, string> = {
  "cli.ts": "Fictional seeding and organization bootstrap",
  "event-worker.ts": "Event delivery/report worker processing",
  "worker.ts": "Native integration effect queue processing",
  "organization-authorization-cli.ts":
    "Organization-scoped accounting authorization operator lifecycle",
  "organization-revocation-cli.ts":
    "Organization-scoped authorization revocation operator lifecycle",
  "provider-credentials-cli.ts":
    "Provider credential configuration and inspection",
  "quickbooks-authorization-cli.ts":
    "Account-scoped QuickBooks authorization operator lifecycle",
  "recovery-cli.ts": "Backup/recovery operator operations",
  "restore-operator-cli.ts": "Restore candidate/operator phase execution",
  "restore-review-cli.ts": "Restore evidence and independent review decisions",
  "schema-cli.ts": "Schema inspection/migration operator operations",
  "stock-journal-transport-cli.ts":
    "Stock journal transport operator operations",
};
for (const f of cli)
  text += `- \`src/server/${f}\` — ${cliDescriptions[f] ?? "Native operator entrypoint"}; not represented by a public browser control.\n`;
writeFileSync(file, text);
console.log(
  JSON.stringify({
    pages: workspacePages.length,
    commands: names.length,
    routes: routes.length,
    webFiles: files.length,
    cliFiles: cli.length,
  }),
);
