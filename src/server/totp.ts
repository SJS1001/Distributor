import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { check } from "./core.ts";
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function encodeSecret(bytes: Buffer) {
  let value = 0,
    bits = 0,
    result = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += alphabet[(value >>> bits) & 31];
    }
  }
  if (bits) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}
function decodeSecret(secret: string) {
  check(
    /^[A-Z2-7]+$/.test(secret),
    "MFA_UNAVAILABLE",
    "Authenticator material is unavailable.",
    503,
  );
  let value = 0,
    bits = 0;
  const bytes: number[] = [];
  for (const char of secret) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 255);
    }
  }
  return Buffer.from(bytes);
}
// Independent implementation of RFC 4226 dynamic truncation / RFC 6238 time counter.
export function totp(secret: string, step: number, digits = 6) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", decodeSecret(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 15;
  return String(
    (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits,
  ).padStart(digits, "0");
}
export function matchingStep(
  secret: string,
  code: string,
  timestamp: number,
  lastStep = -1,
) {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(timestamp / 30000);
  for (const step of [current, current - 1, current + 1]) {
    if (
      step > lastStep &&
      step >= 0 &&
      timingSafeEqual(Buffer.from(totp(secret, step)), Buffer.from(code))
    )
      return step;
  }
  return null;
}
export class FactorCipher {
  private key: Buffer | null;
  constructor(value?: string) {
    check(
      value === undefined || /^[a-fA-F0-9]{64}$/.test(value),
      "CONFIG",
      "MFA encryption key must contain exactly 64 hexadecimal characters.",
      500,
    );
    this.key = value === undefined ? null : Buffer.from(value, "hex");
  }
  get available() {
    return this.key !== null;
  }
  require() {
    check(
      this.key,
      "MFA_UNAVAILABLE",
      "Authenticator service is unavailable. Contact your administrator.",
      503,
    );
    return this.key;
  }
  encrypt(value: unknown, context: string) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.require(), iv);
    cipher.setAAD(Buffer.from(context));
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), encrypted]
      .map((b) => b.toString("base64url"))
      .join(".");
  }
  decrypt<T>(value: string, context: string): T {
    const key = this.require();
    try {
      const [iv, tag, data] = value
        .split(".")
        .map((part) => Buffer.from(part, "base64url"));
      const cipher = createDecipheriv("aes-256-gcm", key, iv!);
      cipher.setAAD(Buffer.from(context));
      cipher.setAuthTag(tag!);
      return JSON.parse(
        Buffer.concat([cipher.update(data!), cipher.final()]).toString("utf8"),
      ) as T;
    } catch {
      check(
        false,
        "MFA_UNAVAILABLE",
        "Authenticator material cannot be read. Contact your administrator.",
        503,
      );
    }
  }
}
