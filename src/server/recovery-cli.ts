import { createBackup, restoreBackup } from "./recovery.ts";
import { check, DomainError } from "./core.ts";
import { type Region } from "./iam.ts";

let key: Buffer | undefined;
try {
  const [action, source, target, region] = process.argv.slice(2);
  check(
    process.argv.length === 6 &&
      ["backup", "restore"].includes(action ?? "") &&
      source &&
      target &&
      ["CA", "US"].includes(region ?? ""),
    "CLI",
    "Usage: recovery <backup|restore> <source> <fresh destination> <CA|US>; supply one 64-character hex key through stdin.",
    400,
  );
  check(
    !process.stdin.isTTY,
    "RECOVERY_KEY",
    "Supply the recovery key through protected stdin; never command arguments.",
  );
  let input = "";
  for await (const chunk of process.stdin) {
    input += String(chunk);
    check(input.length <= 128, "RECOVERY_KEY", "Invalid recovery key input.");
  }
  const encoded = input.trim();
  check(
    /^[a-fA-F0-9]{64}$/.test(encoded),
    "RECOVERY_KEY",
    "Supply a 32-byte key as 64 hexadecimal characters.",
  );
  key = Buffer.from(encoded, "hex");
  const operation = action === "backup" ? createBackup : restoreBackup;
  process.stdout.write(
    `${JSON.stringify(await operation(source!, target!, region as Region, key))}\n`,
  );
} catch (error) {
  process.stderr.write(
    `${error instanceof DomainError ? error.code : "RECOVERY_FAILED"}: Recovery did not complete successfully. Preserve any published destination and inspect it before retrying.\n`,
  );
  process.exitCode = 1;
} finally {
  key?.fill(0);
}
