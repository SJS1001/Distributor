import React, { useEffect, useRef, useState } from "react";
import { command, request } from "./api.ts";
import {
  carrierNames,
  type CarrierAddress,
  type CarrierBookingView,
  type CarrierPrepare,
  type CarrierReview,
  type CanadaPostGroupView,
} from "../shared/carrier-booking.ts";
import { providerChoices } from "../shared/provider-choices.ts";

type Review = CarrierReview & {
  enabled?: boolean;
  canadaPostGroup?: CanadaPostGroupView | null;
};
const label = (provider: string) =>
  providerChoices.find((p) => p.id === provider)?.label ?? provider;
const addressFields = [
  ["name", "Name"],
  ["line1", "Address line 1"],
  ["line2", "Address line 2 (optional)"],
  ["city", "City"],
  ["province", "Province / state"],
  ["postalCode", "Postal / ZIP code"],
  ["phone", "Phone"],
] as const;
function AddressFields({ kind }: { kind: "origin" | "destination" }) {
  return (
    <fieldset style={{ minWidth: 0 }}>
      <legend>
        {kind === "origin"
          ? "Reviewed warehouse origin"
          : "Reviewed destination"}
      </legend>
      {addressFields.map(([field, text]) => (
        <label key={field}>
          {text}
          <input
            name={`${kind}.${field}`}
            required={field !== "line2"}
            type={field === "phone" ? "tel" : "text"}
          />
        </label>
      ))}
      <label>
        Country
        <select name={`${kind}.country`} required defaultValue="">
          <option value="" disabled>
            Choose country
          </option>
          <option value="US">US</option>
          <option value="CA">Canada</option>
        </select>
      </label>
    </fieldset>
  );
}
function AddressDetail({ address }: { address: CarrierAddress }) {
  return (
    <p>
      {address.name} · {address.line1}
      {address.line2 ? ` · ${address.line2}` : ""} · {address.city},{" "}
      {address.province} {address.postalCode} · {address.country} ·{" "}
      {address.phone}
    </p>
  );
}
function BookingMetadata({ booking }: { booking: CarrierBookingView }) {
  return (
    <div style={{ overflowWrap: "anywhere" }}>
      <p>
        {label(booking.provider)} · {booking.service} · {booking.state} ·{" "}
        {booking.createdAt}
      </p>
      <p>Booking ID: {booking.id}</p>
      <p>Carrier handover identifier: {booking.provider}</p>
      {booking.reference && (
        <p>Carrier booking reference: {booking.reference}</p>
      )}
      {booking.tracking && <p>Tracking: {booking.tracking}</p>}
      {booking.error && <p>Last booking observation: {booking.error}</p>}
    </div>
  );
}
export function CarrierBooking({
  shipmentId,
  packedDestination,
  packed,
  onClose,
  onCanadaPost,
}: {
  shipmentId: string;
  packedDestination: string;
  packed: boolean;
  onClose: () => void;
  onCanadaPost?: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const lifetime = useRef<AbortController | null>(null);
  const currentRead = useRef<AbortController | null>(null);
  const historyRead = useRef<AbortController | null>(null);
  const writing = useRef(false);
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<CarrierBookingView[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [reason, setReason] = useState("");
  const live = (token: AbortController | null) =>
    token !== null && token === lifetime.current && !token.signal.aborted;
  const loadReview = async () => {
    const token = lifetime.current;
    historyRead.current?.abort();
    historyRead.current = null;
    setHistoryBusy(false);
    currentRead.current?.abort();
    const controller = new AbortController();
    currentRead.current = controller;
    setLoading(true);
    setError("");
    // A failed refresh must not leave stale send/cancel controls enabled.
    setReview(null);
    try {
      const result = await request<Review>(
        `/api/shipments/${encodeURIComponent(shipmentId)}/carrier`,
        { signal: controller.signal },
      );
      if (result.booking?.provider === "canada-post")
        result.canadaPostGroup = await request<CanadaPostGroupView | null>(
          `/api/carrier/${encodeURIComponent(result.booking.id)}/canada-post/group`,
          { signal: controller.signal },
        );
      if (
        live(token) &&
        currentRead.current === controller &&
        !controller.signal.aborted
      )
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
  const loadHistory = async () => {
    if (historyRead.current) return;
    const token = lifetime.current;
    const controller = new AbortController();
    historyRead.current = controller;
    setHistoryBusy(true);
    setHistoryError("");
    try {
      const result = await request<{
        items: CarrierBookingView[];
        next: string | null;
      }>(
        `/api/shipments/${encodeURIComponent(shipmentId)}/carrier/history${next ? `?after=${encodeURIComponent(next)}` : ""}`,
        { signal: controller.signal },
      );
      if (!live(token) || controller.signal.aborted) return;
      setHistory((rows) => [
        ...rows,
        ...result.items.filter(
          (item) => !rows.some((row) => row.id === item.id),
        ),
      ]);
      setNext(result.next);
      setHistoryLoaded(true);
    } catch (e) {
      if (live(token) && !controller.signal.aborted)
        setHistoryError((e as Error).message);
    } finally {
      if (live(token) && historyRead.current === controller) {
        historyRead.current = null;
        setHistoryBusy(false);
      }
    }
  };
  useEffect(() => {
    lifetime.current = new AbortController();
    heading.current?.focus();
    void loadReview();
    return () => {
      lifetime.current?.abort();
      currentRead.current?.abort();
      historyRead.current?.abort();
      lifetime.current = null;
    };
  }, [shipmentId]);
  const perform = async (
    work: () => Promise<unknown>,
    providerOperation = false,
  ) => {
    if (writing.current) return;
    const token = lifetime.current;
    writing.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      if (!live(token)) return;
      setNotice(
        "Booking operation recorded. Review the current status before continuing.",
      );
      setReason("");
      await loadReview();
    } catch (e) {
      if (live(token)) {
        setError((e as Error).message);
        // Durable prepare/cancel retries preserve their exact form payload.
        // A provider operation needs a fresh review after a lost response.
        if (providerOperation) setReview(null);
      }
    } finally {
      if (live(token)) {
        writing.current = false;
        setBusy(false);
      }
    }
  };
  const prepare = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "");
    const address = (kind: "origin" | "destination"): CarrierAddress => ({
      name: value(`${kind}.name`),
      line1: value(`${kind}.line1`),
      line2: value(`${kind}.line2`),
      city: value(`${kind}.city`),
      province: value(`${kind}.province`),
      postalCode: value(`${kind}.postalCode`),
      country: value(`${kind}.country`) as "US" | "CA",
      phone: value(`${kind}.phone`),
    });
    if (form.get("addressConfirmed") !== "on" || !review) return;
    const input: CarrierPrepare = {
      shipmentId,
      previousId: review.booking?.id ?? null,
      provider: value("provider") as CarrierPrepare["provider"],
      service: value("service"),
      origin: address("origin"),
      destination: address("destination"),
      parcel: {
        weightGrams: Number(value("weightGrams")),
        lengthMm: Number(value("lengthMm")),
        widthMm: Number(value("widthMm")),
        heightMm: Number(value("heightMm")),
      },
      reviewedDestination: packedDestination,
      acknowledgment: value("acknowledgment"),
    };
    void perform(() => command("carrier.prepare", input));
  };
  const booking = review?.booking;
  return (
    <section
      aria-label="Carrier booking review"
      style={{ overflowWrap: "anywhere" }}
    >
      <h3 ref={heading} tabIndex={-1}>
        Carrier booking review
      </h3>
      <button type="button" onClick={onClose}>
        Close carrier booking review
      </button>
      <p>Shipment: {shipmentId}</p>
      <p>Packed destination: {packedDestination}</p>
      <p>
        Booking creates no shipment handover or invoice. Record the separate
        physical handover after booking. A provider choice does not accept its
        terms or qualify the carrier.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {loading && <p role="status">Loading carrier review…</p>}
      <button
        type="button"
        disabled={busy || loading}
        onClick={() => void loadReview()}
      >
        {error ? "Retry current carrier review" : "Refresh carrier review"}
      </button>
      {review &&
        review.enabled !== true &&
        booking?.provider !== "canada-post" && (
          <p>
            Carrier send and reconciliation are disabled. No qualified carrier
            adapter is enabled for this booking. Named customer acceptance,
            carrier service and credential configuration, residency and provider
            qualification must be completed before activation. Manual handover
            remains a separate warehouse operation; unresolved bookings restrict
            it.
          </p>
        )}
      {booking && (
        <>
          <h4>Current booking</h4>
          <BookingMetadata booking={booking} />
          {booking.provider === "canada-post" && (
            <>
              <p>
                Canada Post uses warehouse groups and a separately reviewed
                manifest.{" "}
                {review.canadaPostGroup
                  ? `Current group: ${review.canadaPostGroup.id} · ${review.canadaPostGroup.state}. Resolve this group before canceling an individual booking.`
                  : "This booking has no active warehouse group."}
              </p>
              {onCanadaPost && (
                <button
                  type="button"
                  disabled={busy || loading}
                  onClick={onCanadaPost}
                >
                  Open Canada Post warehouse groups
                </button>
              )}
            </>
          )}
          <h4>Reviewed origin</h4>
          <AddressDetail address={booking.origin} />
          <h4>Reviewed destination</h4>
          <AddressDetail address={booking.destination} />
          <p>
            Parcel: {booking.parcel.weightGrams} grams ·{" "}
            {booking.parcel.lengthMm} × {booking.parcel.widthMm} ×{" "}
            {booking.parcel.heightMm} mm
          </p>
          {booking.state === "booked" && (
            <p>
              Use the exact carrier handover identifier and tracking above for
              manual handover. Do not create a second booking. Separate handover
              is still required.
            </p>
          )}
          {booking.state === "booked" && booking.hasLabel && (
            <a
              className="button secondary"
              href={`/api/carrier/${encodeURIComponent(booking.id)}/label`}
            >
              Download carrier label
            </a>
          )}
          {booking.state === "pending" && packed && !review.canadaPostGroup && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void perform(() =>
                  command("carrier.cancel", {
                    bookingId: booking.id,
                    reviewHash: booking.reviewHash,
                    reason,
                  }),
                );
              }}
            >
              <p>
                Pending booking has not been sent. Cancel this reviewed booking
                before using manual handover or voiding packing. Cancellation
                creates no stock or invoice changes.
              </p>
              <label>
                Cancellation reason
                <textarea
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button disabled={busy || loading}>
                Cancel reviewed pending booking
              </button>
            </form>
          )}
          {(booking.state === "running" || booking.state === "unknown") && (
            <p>
              The carrier outcome is unresolved. Do not resend, replace, cancel
              or use manual handover to bypass this booking. Reconcile the
              existing booking when a qualified adapter is enabled.
            </p>
          )}
          {booking.state === "canceled" && (
            <p>
              This unsent booking was canceled. A packed shipment may be
              reviewed for a new booking or use the separate manual handover
              workflow.
            </p>
          )}
          {review.enabled === true && packed && booking.state === "pending" && (
            <button
              type="button"
              disabled={busy || loading}
              onClick={() =>
                void perform(
                  () =>
                    request(
                      `/api/carrier/${encodeURIComponent(booking.id)}/send`,
                      { method: "POST", body: "{}" },
                    ),
                  true,
                )
              }
            >
              Send reviewed carrier booking
            </button>
          )}
          {review.enabled === true && booking.state === "unknown" && (
            <button
              type="button"
              disabled={busy || loading}
              onClick={() =>
                void perform(
                  () =>
                    request(
                      `/api/carrier/${encodeURIComponent(booking.id)}/reconcile`,
                      { method: "POST", body: "{}" },
                    ),
                  true,
                )
              }
            >
              Reconcile existing carrier booking
            </button>
          )}
        </>
      )}
      {review && packed && (!booking || booking.state === "canceled") && (
        <form onSubmit={prepare}>
          <h4>Prepare reviewed carrier booking</h4>
          <p>
            Enter the actual structured addresses. Compare the destination with
            the packed destination above and confirm the origin belongs to this
            warehouse. Preparation records a review; it does not send a provider
            request. Missing named customer acceptance will be explained by the
            returned error; acceptance is managed separately.
          </p>
          <fieldset disabled={busy || loading} style={{ minWidth: 0 }}>
            <legend>Carrier and service</legend>
            <label>
              Carrier provider
              <select name="provider" required defaultValue="">
                <option value="" disabled>
                  Choose carrier provider
                </option>
                {providerChoices
                  .filter((p) => carrierNames.some((name) => name === p.id))
                  .map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.label}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Service
              <input name="service" required />
            </label>
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit, minmax(min(100%, 260px), 1fr))",
                gap: "1rem",
              }}
            >
              <AddressFields kind="origin" />
              <AddressFields kind="destination" />
            </div>
            <fieldset style={{ minWidth: 0 }}>
              <legend>Parcel measurements</legend>
              {(
                [
                  ["weightGrams", "Weight (grams)"],
                  ["lengthMm", "Length (mm)"],
                  ["widthMm", "Width (mm)"],
                  ["heightMm", "Height (mm)"],
                ] as const
              ).map(([name, text]) => (
                <label key={name}>
                  {text}
                  <input
                    name={name}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    required
                  />
                </label>
              ))}
            </fieldset>
            <label
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "start",
              }}
            >
              <input
                style={{ width: "auto" }}
                name="addressConfirmed"
                type="checkbox"
                required
              />
              I reviewed the entered structured destination against the packed
              destination and confirm the entered origin belongs to this
              warehouse.
            </label>
            <label>
              Address review acknowledgment / evidence
              <textarea name="acknowledgment" required />
            </label>
            <button>Prepare reviewed booking</button>
          </fieldset>
        </form>
      )}
      <h4>Carrier booking history</h4>
      <p>Loaded: {history.length}. Booking status and carrier references.</p>
      {historyError && (
        <p role="alert" className="error">
          {historyError}
        </p>
      )}
      {historyLoaded && history.length === 0 && (
        <p>No carrier bookings recorded.</p>
      )}
      <ol>
        {history.map((item) => (
          <li key={item.id}>
            <BookingMetadata booking={item} />
          </li>
        ))}
      </ol>
      {historyBusy && <p role="status">Loading carrier booking history…</p>}
      {(!historyLoaded || next || historyError) && (
        <button
          type="button"
          disabled={historyBusy}
          onClick={() => void loadHistory()}
        >
          {historyError
            ? "Retry carrier booking history"
            : historyLoaded
              ? "Load more carrier bookings"
              : "Load carrier booking history"}
        </button>
      )}
    </section>
  );
}
