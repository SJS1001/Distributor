import { useEffect, useState } from "react";
import { request, RequestError } from "./api.ts";
import type {
  ScannerLinkConfiguration,
  ScannerLinkInput,
  ScannerLinkReceipt,
} from "../shared/scanner-link.ts";
type Attempt = { key: string; input: ScannerLinkInput };
const messages: Record<ScannerLinkReceipt["state"], string> = {
  accepted:
    "The messaging provider accepted the link. Delivery is not yet confirmed.",
  confirmed: "The messaging provider confirmed delivery of the scanner link.",
  rejected:
    "The messaging provider rejected this message. Check the recipient or use the QR code.",
  unknown:
    "Delivery is uncertain. This attempt will not be sent again. Use the QR code or ask an administrator to check the messaging provider.",
};
export function ScannerLinkDelivery() {
  const [config, setConfig] = useState<
    (ScannerLinkConfiguration & { csrf: string }) | null
  >(null);
  const [info, setInfo] = useState("Checking internal delivery…");
  const [channel, setChannel] = useState<ScannerLinkInput["channel"]>("email");
  const [recipient, setRecipient] = useState("");
  const [pending, setPending] = useState<Attempt | null>(null);
  const [result, setResult] = useState<ScannerLinkReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      const session = await request<{ csrf: string }>("/api/session", {
        signal: abort.signal,
      });
      const value = await request<ScannerLinkConfiguration>(
        "/api/scanner-link/config",
        { signal: abort.signal },
      );
      if (abort.signal.aborted) return;
      setConfig({ ...value, csrf: session.csrf });
      setChannel(value.channels[0] ?? "email");
      setInfo(
        value.channels.length
          ? "Send a scanner link directly through your distributor’s messaging service."
          : "Internal email/text delivery is not configured. Use the QR code or device sharing below.",
      );
      try {
        const saved = JSON.parse(
          sessionStorage.getItem(`distributor:scanner-link:${value.scope}`) ??
            "null",
        ) as Attempt | null;
        if (
          saved &&
          typeof saved.key === "string" &&
          saved.key.length <= 128 &&
          ["email", "sms"].includes(saved.input?.channel) &&
          typeof saved.input?.recipient === "string" &&
          saved.input.recipient.length <= 254
        ) {
          setPending(saved);
          setChannel(saved.input.channel);
          setRecipient(saved.input.recipient);
          setInfo(
            "A previous send has an unread result. Check the same attempt before sending another message.",
          );
        }
      } catch {
        /* Bad storage cannot become a request. */
      }
    })().catch(() => {
      if (!abort.signal.aborted)
        setInfo(
          "Sign in to the staff workspace to use internal delivery. QR and device sharing remain available.",
        );
    });
    return () => abort.abort();
  }, []);
  return (
    <section aria-labelledby="internal-scanner-delivery">
      <h3 id="internal-scanner-delivery">Send from dstrbtr</h3>
      <p role="status">{info}</p>
      {config && (config.channels.length > 0 || pending) && (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy || result?.state === "unknown") return;
            const attempt = pending ?? {
              key: crypto.randomUUID(),
              input: { channel, recipient },
            };
            try {
              sessionStorage.setItem(
                `distributor:scanner-link:${config.scope}`,
                JSON.stringify(attempt),
              );
            } catch {
              setInfo(
                "This browser cannot retain a safe retry. Use the QR code or device sharing.",
              );
              return;
            }
            setPending(attempt);
            setBusy(true);
            setResult(null);
            try {
              const value = await request<ScannerLinkReceipt>(
                "/api/scanner-link/send",
                {
                  method: "POST",
                  headers: {
                    "idempotency-key": attempt.key,
                    "x-csrf-token": config.csrf,
                  },
                  body: JSON.stringify(attempt.input),
                },
              );
              setResult(value);
              setInfo(messages[value.state]);
              if (value.state !== "unknown") {
                sessionStorage.removeItem(
                  `distributor:scanner-link:${config.scope}`,
                );
                setPending(null);
              }
            } catch (error) {
              if (
                error instanceof RequestError &&
                error.status === 400 &&
                error.code === "VALIDATION"
              ) {
                sessionStorage.removeItem(
                  `distributor:scanner-link:${config.scope}`,
                );
                setPending(null);
                setInfo(error.message);
                return;
              }
              setInfo(
                `${(error as Error).message} Check the same attempt to recover its result.`,
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Delivery method
            <select
              aria-label="Delivery method"
              value={channel}
              disabled={busy || !!pending}
              onChange={(event) =>
                setChannel(event.target.value as ScannerLinkInput["channel"])
              }
            >
              {Array.from(
                new Set([
                  ...config.channels,
                  ...(pending ? [pending.input.channel] : []),
                ]),
              ).map((c) => (
                <option key={c} value={c}>
                  {c === "email" ? "Email" : "Text message"}
                </option>
              ))}
            </select>
          </label>
          <label>
            {channel === "email"
              ? "Recipient email"
              : "Phone number including country code"}
            <input
              aria-label={
                channel === "email"
                  ? "Recipient email"
                  : "Phone number including country code"
              }
              type={channel === "email" ? "email" : "tel"}
              required
              maxLength={254}
              value={recipient}
              disabled={busy || !!pending}
              onChange={(event) => setRecipient(event.target.value)}
            />
          </label>
          {channel === "sms" && (
            <p>Use the international format, for example +14165550123.</p>
          )}
          <button disabled={busy || result?.state === "unknown"}>
            {busy
              ? "Checking delivery…"
              : pending
                ? "Check same attempt"
                : "Send scanner link"}
          </button>
          {result && <p>Recipient: {result.recipientHint}</p>}
        </form>
      )}
    </section>
  );
}
