import { useEffect, useState } from "react";
import QRCode from "qrcode";
import scannerNotices from "./scanner-notices.txt?url";
import { ScanInput } from "./scan-input.tsx";

export function ScannerPage() {
  const [qr, setQr] = useState("");
  const [status, setStatus] = useState("");
  const url = new URL("/#scanner", window.location.origin).href;
  const message = `Open the dstrbtr barcode scanner on your phone: ${url}`;
  const ios =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(url, { width: 192, margin: 2 })
      .then((value) => {
        if (!cancelled) setQr(value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [url]);
  return (
    <div className="public-form-layout scanner-layout">
      <section>
        <p className="public-eyebrow">WAREHOUSE TOOLS</p>
        <h1>Barcode scanner.</h1>
        <p>
          Read an equipment barcode or serial label using your phone’s camera.
          Review the value before using it.
        </p>
        <div className="public-form-card scanner-reader">
          <label
            id="field-label-standalone-scan"
            htmlFor="field-standalone-scan"
          >
            Barcode or serial number
          </label>
          <ScanInput
            name="standalone-scan"
            label="Barcode or serial number"
            value=""
            multiline={false}
            optional={true}
            disabled={false}
          />
          <p>
            This reader does not change inventory. To receive, pick or move
            equipment, sign in and use the scanner inside that task’s form.
          </p>
          <a className="public-text-link" href="#admin-sign-in">
            Open staff workspace →
          </a>
        </div>
        <a className="public-text-link" href="#home">
          ← Back to the entrance
        </a>
      </section>
      <section
        className="public-form-card scanner-share"
        aria-labelledby="scanner-phone-title"
      >
        <p className="public-eyebrow">TAKE IT WITH YOU</p>
        <h2 id="scanner-phone-title">Open on your phone.</h2>
        {qr && (
          <img
            src={qr}
            width="192"
            height="192"
            alt="QR code linking to the dstrbtr barcode scanner"
          />
        )}
        <p>
          Scan this QR code with your phone camera, or send yourself the link.
        </p>
        <div className="scanner-share-actions">
          <a
            href={`mailto:?subject=${encodeURIComponent("dstrbtr barcode scanner")}&body=${encodeURIComponent(message)}`}
          >
            Email link
          </a>
          <a href={`sms:${ios ? "&" : "?"}body=${encodeURIComponent(message)}`}>
            Text link
          </a>
          {typeof navigator.share === "function" && (
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.share({
                    title: "dstrbtr barcode scanner",
                    url,
                  });
                } catch (error) {
                  if ((error as Error).name !== "AbortError")
                    setStatus(
                      "Sharing is unavailable. Use Email link, Text link or copy the link.",
                    );
                }
              }}
            >
              Share link
            </button>
          )}
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setStatus("Scanner link copied.");
              } catch {
                setStatus("Copy the scanner address shown below.");
              }
            }}
          >
            Copy link
          </button>
        </div>
        <p className="scanner-link-address">{url}</p>
        <p role="status">{status}</p>
        <p>
          Email and text open your device’s mail or messaging app. Choose a
          recipient and send there.
        </p>
        <p>
          <a href={scannerNotices} target="_blank" rel="noreferrer">
            Scanner software notices
          </a>
        </p>
        <h3>Keep it on your iPhone</h3>
        <p>
          Open this link in Safari, tap Share, then Add to Home Screen. Allow
          camera access when you start a scan. An internet connection is
          required.
        </p>
      </section>
    </div>
  );
}
