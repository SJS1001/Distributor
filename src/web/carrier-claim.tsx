import React, { useEffect, useRef, useState } from "react";
import { command, request } from "./api.ts";
import type {
  CarrierClaimReview,
  CarrierClaimTarget,
} from "../shared/carrier-booking.ts";

type Attempt = {
  target: CarrierClaimTarget;
  minimumAgeMs: number;
  claimHash: string;
  reason: string;
};
const timestamp = (value: number) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toISOString()
    : `Timestamp ${value} is outside the display range`;
};
const path = (target: CarrierClaimTarget) =>
  target.kind === "booking"
    ? `/api/carrier/${encodeURIComponent(target.bookingId)}/claim`
    : `/api/canada-post/groups/${encodeURIComponent(target.groupId)}/${
        target.kind === "manifest"
          ? "manifest"
          : `members/${encodeURIComponent(target.bookingId)}`
      }/claim`;

export function CarrierClaim({
  target,
  ownerKey,
  disabled,
  onBusy,
  onReleased,
}: {
  target: CarrierClaimTarget;
  ownerKey: string;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onReleased: () => Promise<void>;
}) {
  const signature = JSON.stringify(target);
  const storageKey = `distributor-claim-release:${ownerKey}:${signature}`;
  const lifetime = useRef<AbortController | null>(null);
  const currentRead = useRef<AbortController | null>(null);
  const writing = useRef(false);
  const [age, setAge] = useState("");
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [review, setReview] = useState<CarrierClaimReview | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const live = (token: AbortController | null) =>
    token !== null && token === lifetime.current && !token.signal.aborted;
  const clearReview = () => {
    currentRead.current?.abort();
    currentRead.current = null;
    setLoading(false);
    setReview(null);
    setAcknowledged(false);
  };
  useEffect(() => {
    lifetime.current = new AbortController();
    setAge("");
    setReason("");
    setAcknowledged(false);
    setReview(null);
    setAttempt(null);
    setLoading(false);
    setError("");
    setNotice("");
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const a: Attempt = JSON.parse(saved);
        if (
          JSON.stringify(a.target) !== signature ||
          !Number.isInteger(a.minimumAgeMs) ||
          a.minimumAgeMs < 1 ||
          a.minimumAgeMs > 86400000 ||
          !/^[a-f0-9]{64}$/.test(a.claimHash) ||
          typeof a.reason !== "string" ||
          !a.reason.trim() ||
          a.reason.length > 160
        )
          throw Error(
            "Saved release attempt is invalid. Review current status.",
          );
        setAttempt(a);
      }
    } catch (e) {
      setError((e as Error).message);
    }
    return () => {
      lifetime.current?.abort();
      currentRead.current?.abort();
      lifetime.current = null;
    };
  }, [storageKey]);
  const read = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (writing.current || disabled || attempt) return;
    clearReview();
    const token = lifetime.current;
    const controller = new AbortController();
    currentRead.current = controller;
    setLoading(true);
    setError("");
    setNotice("");
    const minimumAgeMs = Number(age) * 1000;
    try {
      const result = await request<CarrierClaimReview>(
        `${path(target)}?minimumAgeMs=${minimumAgeMs}`,
        { signal: controller.signal },
      );
      if (!live(token) || currentRead.current !== controller) return;
      if (
        JSON.stringify(result.target) !== signature ||
        result.minimumAgeMs !== minimumAgeMs ||
        !/^[a-f0-9]{64}$/.test(result.claimHash)
      )
        throw Error("Claim review does not match the selected record and age.");
      setReview(result);
    } catch (e) {
      if (live(token) && !controller.signal.aborted)
        setError((e as Error).message);
    } finally {
      if (live(token) && currentRead.current === controller) {
        currentRead.current = null;
        setLoading(false);
      }
    }
  };
  const release = async () => {
    if (writing.current || disabled || (!attempt && (!review || !acknowledged)))
      return;
    if (!attempt && !reason.trim()) {
      setError("Enter an investigation and release reason.");
      return;
    }
    const token = lifetime.current;
    const input = attempt ?? {
      target: review!.target,
      minimumAgeMs: review!.minimumAgeMs,
      claimHash: review!.claimHash,
      reason: reason.trim(),
    };
    writing.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    setNotice("");
    try {
      // Persist the exact payload before sending; a reload can recover a lost reply.
      sessionStorage.setItem(storageKey, JSON.stringify(input));
      setAttempt(input);
      await command("carrier.claim.release", input);
      sessionStorage.removeItem(storageKey);
      if (!live(token)) return;
      setAttempt(null);
      setReview(null);
      setAcknowledged(false);
      setReason("");
      setNotice(
        "Claim released to unknown. Use a separate lookup to recover its outcome.",
      );
      writing.current = false;
      setBusy(false);
      onBusy(false);
      await onReleased();
    } catch (e) {
      if (live(token)) setError((e as Error).message);
    } finally {
      if (live(token)) {
        writing.current = false;
        setBusy(false);
        onBusy(false);
      }
    }
  };
  return (
    <section aria-label={`Interrupted ${target.kind} claim`}>
      <h5>Review interrupted carrier operation</h5>
      <p>
        Investigate the carrier outcome and stop the local writer before
        release. Choose the minimum age from your operating procedure. Release
        keeps the outcome unknown; recovery uses a separate lookup.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {attempt ? (
        <>
          <p>
            A release attempt is awaiting confirmation. Its age and reason are
            retained exactly, including after a reload in this tab.
          </p>
          <p>
            Selected age: {attempt.minimumAgeMs / 1000} seconds · Reason:{" "}
            {attempt.reason}
          </p>
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => void release()}
          >
            Retry exact claim release
          </button>
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => {
              try {
                sessionStorage.removeItem(storageKey);
                setAttempt(null);
                clearReview();
                setError("");
                setNotice(
                  "The release may already have succeeded. Refresh the current status before another review.",
                );
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Discard saved release attempt
          </button>
        </>
      ) : (
        <>
          <form onSubmit={(e) => void read(e)}>
            <label>
              Minimum claim age (seconds)
              <input
                type="number"
                min={1}
                max={86400}
                step={1}
                required
                value={age}
                disabled={disabled || busy}
                onChange={(e) => {
                  clearReview();
                  setAge(e.target.value);
                }}
              />
            </label>
            <button disabled={disabled || busy || loading}>
              Review exact interrupted claim
            </button>
          </form>
          {loading && <p role="status">Loading interrupted claim…</p>}
          {(loading || review) && (
            <button type="button" disabled={busy} onClick={clearReview}>
              Cancel interrupted claim review
            </button>
          )}
          {review && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void release();
              }}
            >
              <p>
                Claim state: {review.state} · Started:{" "}
                {timestamp(review.startedAt)}
              </p>
              <p>
                Selected minimum age: {review.minimumAgeMs / 1000} seconds ·
                Earliest release: {timestamp(review.eligibleAt)}. The server
                checks the age again on release.
              </p>
              <fieldset disabled={disabled || busy}>
                <legend>Release this reviewed claim</legend>
                <label>
                  Investigation and release reason
                  <textarea
                    required
                    maxLength={160}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <label
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "start",
                  }}
                >
                  <input
                    type="checkbox"
                    required
                    style={{ width: "auto" }}
                    checked={acknowledged}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                  />
                  I stopped the local writer and investigated the carrier
                  outcome for this record.
                </label>
                <button>Release reviewed claim to unknown</button>
              </fieldset>
            </form>
          )}
        </>
      )}
    </section>
  );
}
