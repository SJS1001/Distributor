import React, { useEffect, useRef, useState } from "react";
import { CarrierClaim } from "./carrier-claim.tsx";
import { command, downloadCanadaPostManifest, request } from "./api.ts";
import type {
  CanadaPostGroupView,
  CanadaPostManifestIdentity,
  CarrierBookingView,
} from "../shared/carrier-booking.ts";

type Page<T> = { items: T[]; next: string | null; enabled: boolean };
const groupPath = (id: string) =>
  `/api/canada-post/groups/${encodeURIComponent(id)}`;
const address = (a: CarrierBookingView["origin"]) =>
  `${a.name}, ${a.line1}${a.line2 ? `, ${a.line2}` : ""}, ${a.city} ${a.province} ${a.postalCode}, ${a.country} · ${a.phone}`;

export function CanadaPostWarehouse({
  warehouses,
  initialWarehouse,
  recoveryOwner,
  onClose,
}: {
  warehouses: { id: string; name: string }[];
  initialWarehouse?: string;
  recoveryOwner?: string;
  onClose: () => void;
}) {
  const [warehouse, setWarehouse] = useState(
    initialWarehouse ?? warehouses[0]?.id ?? "",
  );
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <section
      aria-label="Canada Post warehouse groups"
      style={{ overflowWrap: "anywhere" }}
    >
      <h3 ref={heading} tabIndex={-1}>
        Canada Post warehouse groups
      </h3>
      <button type="button" onClick={onClose}>
        Close Canada Post groups
      </button>
      <p>
        Review domestic bookings together. Create each shipment, then review and
        transmit its group manifest. Physical handover is recorded separately.
      </p>
      <label>
        Canada Post warehouse
        <select
          aria-label="Canada Post warehouse"
          value={warehouse}
          onChange={(e) => setWarehouse(e.target.value)}
        >
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </label>
      {warehouse && (
        <WarehouseGroups
          key={warehouse}
          warehouseId={warehouse}
          recoveryOwner={recoveryOwner}
        />
      )}
    </section>
  );
}

function WarehouseGroups({
  warehouseId,
  recoveryOwner,
}: {
  warehouseId: string;
  recoveryOwner?: string;
}) {
  const lifetime = useRef<AbortController | null>(null);
  const candidateRead = useRef<AbortController | null>(null);
  const groupRead = useRef<AbortController | null>(null);
  const writing = useRef(false);
  const [candidates, setCandidates] = useState<CarrierBookingView[]>([]);
  const [candidateNext, setCandidateNext] = useState<string | null>(null);
  const [candidateLoaded, setCandidateLoaded] = useState(false);
  const [candidateBusy, setCandidateBusy] = useState(false);
  const [candidateError, setCandidateError] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [selected, setSelected] = useState<CarrierBookingView[]>([]);
  const [attempt, setAttempt] = useState<{
    warehouseId: string;
    entries: { bookingId: string; reviewHash: string }[];
  } | null>(null);
  const [groups, setGroups] = useState<CanadaPostGroupView[]>([]);
  const [groupNext, setGroupNext] = useState<string | null>(null);
  const [groupLoaded, setGroupLoaded] = useState(false);
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupError, setGroupError] = useState("");
  const [groupId, setGroupId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const live = (token: AbortController | null) =>
    token !== null && token === lifetime.current && !token.signal.aborted;
  const readCandidates = async (reset = false) => {
    if (candidateRead.current && !reset) return;
    candidateRead.current?.abort();
    const controller = new AbortController(),
      token = lifetime.current;
    candidateRead.current = controller;
    setCandidateBusy(true);
    setCandidateError("");
    if (reset) {
      setEnabled(false);
      setCandidates([]);
      setCandidateLoaded(false);
      setCandidateNext(null);
      if (!writing.current && !attempt) setSelected([]);
    }
    try {
      const result = await request<Page<CarrierBookingView>>(
        `/api/warehouses/${encodeURIComponent(warehouseId)}/canada-post/candidates${!reset && candidateNext ? `?after=${encodeURIComponent(candidateNext)}` : ""}`,
        { signal: controller.signal },
      );
      if (!live(token) || controller.signal.aborted) return;
      setCandidates((rows) =>
        reset
          ? result.items
          : [
              ...rows,
              ...result.items.filter((i) => !rows.some((r) => r.id === i.id)),
            ],
      );
      setCandidateNext(result.next);
      setEnabled(result.enabled);
      setCandidateLoaded(true);
    } catch (e) {
      if (live(token) && !controller.signal.aborted)
        setCandidateError((e as Error).message);
    } finally {
      if (live(token) && candidateRead.current === controller) {
        candidateRead.current = null;
        setCandidateBusy(false);
      }
    }
  };
  const readGroups = async (reset = false) => {
    if (groupRead.current && !reset) return;
    groupRead.current?.abort();
    const controller = new AbortController(),
      token = lifetime.current;
    groupRead.current = controller;
    setGroupBusy(true);
    setGroupError("");
    if (reset) {
      setGroups([]);
      setGroupNext(null);
      setGroupLoaded(false);
    }
    try {
      const result = await request<Page<CanadaPostGroupView>>(
        `/api/warehouses/${encodeURIComponent(warehouseId)}/canada-post/groups${!reset && groupNext ? `?after=${encodeURIComponent(groupNext)}` : ""}`,
        { signal: controller.signal },
      );
      if (!live(token) || controller.signal.aborted) return;
      setGroups((rows) =>
        reset
          ? result.items
          : [
              ...rows,
              ...result.items.filter((i) => !rows.some((r) => r.id === i.id)),
            ],
      );
      setGroupNext(result.next);
      setGroupLoaded(true);
    } catch (e) {
      if (live(token) && !controller.signal.aborted)
        setGroupError((e as Error).message);
    } finally {
      if (live(token) && groupRead.current === controller) {
        groupRead.current = null;
        setGroupBusy(false);
      }
    }
  };
  useEffect(() => {
    lifetime.current = new AbortController();
    void readCandidates(true);
    void readGroups(true);
    return () => {
      lifetime.current?.abort();
      candidateRead.current?.abort();
      groupRead.current?.abort();
      lifetime.current = null;
    };
  }, [warehouseId]);
  const prepare = async () => {
    if (writing.current || !enabled || (!attempt && selected.length === 0))
      return;
    const token = lifetime.current;
    const payload = attempt ?? {
      warehouseId,
      entries: selected
        .map((b) => ({ bookingId: b.id, reviewHash: b.reviewHash }))
        .sort((a, b) => a.bookingId.localeCompare(b.bookingId)),
    };
    setAttempt(payload);
    writing.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await command("canada-post.group.prepare", payload);
      if (!live(token)) return;
      setAttempt(null);
      setSelected([]);
      setGroupId(result.id);
      setRevision((v) => v + 1);
      await Promise.all([readCandidates(true), readGroups(true)]);
    } catch (e) {
      if (live(token)) setError((e as Error).message);
    } finally {
      if (live(token)) {
        writing.current = false;
        setBusy(false);
      }
    }
  };
  const changed = () => {
    void readCandidates(true);
    void readGroups(true);
  };
  return (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {candidateLoaded && !enabled && (
        <p>
          Canada Post test processing is disabled for this warehouse. Retained
          groups can be reviewed; wholly unsent groups can be canceled. Service,
          credentials, customer acceptance and residency must be qualified
          before activation.
        </p>
      )}
      <h4>Pending Canada Post bookings</h4>
      <p>
        Selected: {selected.length} of 100 maximum. Only ungrouped pending
        bookings appear. All entries must have the same reviewed warehouse
        origin.
      </p>
      {candidateError && (
        <p className="error" role="alert">
          {candidateError}
        </p>
      )}
      {candidateBusy && (
        <p role="status">Loading pending Canada Post bookings…</p>
      )}
      {candidateLoaded && candidates.length === 0 && (
        <p>No ungrouped pending Canada Post bookings.</p>
      )}
      <ul>
        {candidates.map((b) => (
          <li key={b.id}>
            <label
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "start",
              }}
            >
              <input
                style={{ width: "auto" }}
                type="checkbox"
                aria-label={`Select Canada Post booking ${b.id}`}
                checked={selected.some((s) => s.id === b.id)}
                disabled={
                  !enabled ||
                  busy ||
                  candidateBusy ||
                  attempt !== null ||
                  (!selected.some((s) => s.id === b.id) &&
                    selected.length >= 100)
                }
                onChange={(e) =>
                  setSelected((rows) =>
                    e.target.checked
                      ? [...rows, b]
                      : rows.filter((s) => s.id !== b.id),
                  )
                }
              />
              <span>
                Booking: {b.id} · Shipment: {b.shipmentId} · {b.service}
                <br />
                Origin: {address(b.origin)}
                <br />
                Destination: {address(b.destination)}
                <br />
                Parcel: {b.parcel.weightGrams} grams · {b.parcel.lengthMm} ×{" "}
                {b.parcel.widthMm} × {b.parcel.heightMm} mm
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="actions">
        <button
          type="button"
          disabled={busy || candidateBusy || attempt !== null}
          onClick={() => void readCandidates(true)}
        >
          Refresh pending Canada Post bookings
        </button>
        {(!candidateLoaded || candidateNext || candidateError) && (
          <button
            type="button"
            disabled={busy || candidateBusy || attempt !== null}
            onClick={() => void readCandidates()}
          >
            {candidateError
              ? "Retry pending Canada Post bookings"
              : candidateLoaded
                ? "Load more pending Canada Post bookings"
                : "Load pending Canada Post bookings"}
          </button>
        )}
        <button
          type="button"
          disabled={
            busy ||
            candidateBusy ||
            !enabled ||
            (!attempt && selected.length === 0)
          }
          onClick={() => void prepare()}
        >
          {attempt
            ? "Retry exact Canada Post group preparation"
            : "Prepare selected Canada Post group"}
        </button>
      </div>
      {attempt && !busy && (
        <button
          type="button"
          onClick={() => {
            setAttempt(null);
            setSelected([]);
            setError("");
            void readCandidates(true);
            void readGroups(true);
          }}
        >
          Review warehouse before changing selection
        </button>
      )}
      {attempt && (
        <p>
          Changing selection does not cancel a committed group. Review retained
          groups and the refreshed pending list before choosing again. Keep this
          exact selection until preparation returns a confirmed group. Retrying
          uses the same saved request; it does not create a second group.
        </p>
      )}
      <h4>Retained Canada Post groups</h4>
      <p>
        Loaded: {groups.length}. Ordered by group ID. Refresh reloads the first
        page.
      </p>
      {groupError && (
        <p className="error" role="alert">
          {groupError}
        </p>
      )}
      {groupBusy && <p role="status">Loading Canada Post groups…</p>}
      {groupLoaded && groups.length === 0 && (
        <p>No Canada Post groups recorded.</p>
      )}
      <ol>
        {groups.map((g) => (
          <li key={g.id}>
            Group: {g.id} · {g.state} · {g.entries.length} bookings ·{" "}
            {g.createdAt}{" "}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setGroupId(g.id);
                setRevision((v) => v + 1);
              }}
            >
              Review Canada Post group {g.id}
            </button>
          </li>
        ))}
      </ol>
      <div className="actions">
        <button
          type="button"
          disabled={busy || groupBusy}
          onClick={() => void readGroups(true)}
        >
          Refresh Canada Post group history
        </button>
        {(!groupLoaded || groupNext || groupError) && (
          <button
            type="button"
            disabled={busy || groupBusy}
            onClick={() => void readGroups()}
          >
            {groupError
              ? "Retry Canada Post group history"
              : "Load more Canada Post groups"}
          </button>
        )}
      </div>
      {groupId && (
        <GroupReview
          key={`${groupId}:${revision}`}
          groupId={groupId}
          warehouseId={warehouseId}
          recoveryOwner={recoveryOwner}
          onBusy={setBusy}
          onChanged={changed}
        />
      )}
    </>
  );
}

function GroupReview({
  groupId,
  warehouseId,
  recoveryOwner,
  onBusy,
  onChanged,
}: {
  groupId: string;
  warehouseId: string;
  recoveryOwner?: string;
  onBusy: (busy: boolean) => void;
  onChanged: () => void;
}) {
  const lifetime = useRef<AbortController | null>(null),
    currentRead = useRef<AbortController | null>(null),
    writing = useRef(false),
    heading = useRef<HTMLHeadingElement>(null);
  const [group, setGroup] = useState<CanadaPostGroupView | null>(null),
    [bookings, setBookings] = useState<CarrierBookingView[]>([]),
    [identity, setIdentity] = useState<CanadaPostManifestIdentity | null>(null),
    [enabled, setEnabled] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [reason, setReason] = useState("");
  const live = (token: AbortController | null) =>
    token !== null && token === lifetime.current && !token.signal.aborted;
  const read = async () => {
    const token = lifetime.current;
    currentRead.current?.abort();
    const controller = new AbortController();
    currentRead.current = controller;
    setGroup(null);
    setBookings([]);
    setIdentity(null);
    setEnabled(false);
    setLoading(true);
    setError("");
    try {
      const [g, p, b] = await Promise.all([
        request<CanadaPostGroupView>(groupPath(groupId), {
          signal: controller.signal,
        }),
        request<Page<CanadaPostGroupView>>(
          `/api/warehouses/${encodeURIComponent(warehouseId)}/canada-post/groups`,
          { signal: controller.signal },
        ),
        request<CarrierBookingView[]>(groupPath(groupId) + "/bookings", {
          signal: controller.signal,
        }),
      ]);
      if (!live(token) || controller.signal.aborted) return;
      setGroup(g);
      setBookings(b);
      setEnabled(p.enabled);
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
  useEffect(() => {
    lifetime.current = new AbortController();
    heading.current?.focus();
    void read();
    return () => {
      lifetime.current?.abort();
      currentRead.current?.abort();
      lifetime.current = null;
    };
  }, [groupId]);
  const perform = async (
    work: () => Promise<unknown>,
    refresh = true,
    message = "Manifest review loaded. Compare its membership before proceeding.",
  ) => {
    if (writing.current) return;
    const token = lifetime.current;
    writing.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      if (!live(token)) return;
      if (refresh) {
        setReason("");
        await read();
        onChanged();
      }
      setNotice(
        refresh
          ? "Operation recorded. Review the current group before continuing."
          : message,
      );
    } catch (e) {
      if (live(token)) {
        setError((e as Error).message);
        setGroup(null);
        setIdentity(null);
        setEnabled(false);
      }
    } finally {
      if (live(token)) {
        writing.current = false;
        setBusy(false);
        onBusy(false);
      }
    }
  };
  const post = (suffix: string, payload: unknown = {}) =>
    request(groupPath(groupId) + suffix, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  return (
    <section aria-label="Canada Post group review">
      <h4 ref={heading} tabIndex={-1}>
        Canada Post group review
      </h4>
      <p>Group: {groupId}</p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {loading && <p role="status">Loading current Canada Post group…</p>}
      <button
        type="button"
        disabled={busy || loading}
        onClick={() => void read()}
      >
        {error
          ? "Retry current Canada Post group"
          : "Refresh current Canada Post group"}
      </button>
      {group && (
        <>
          <p>
            Group status: {group.state} · Provider group:{" "}
            {group.providerGroupId}
          </p>
          {!enabled && (
            <p>Provider operations are disabled for this warehouse.</p>
          )}
          <ul>
            {group.entries.map((entry) => {
              const booking = bookings.find((b) => b.id === entry.bookingId);
              return (
                <li key={entry.bookingId}>
                  <p>
                    Booking: {entry.bookingId} · Member status: {entry.state}
                  </p>
                  {booking && (
                    <p>
                      Shipment: {booking.shipmentId} · {booking.service}
                      <br />
                      Origin: {address(booking.origin)}
                      <br />
                      Destination: {address(booking.destination)}
                      <br />
                      Parcel: {booking.parcel.weightGrams} grams ·{" "}
                      {booking.parcel.lengthMm} × {booking.parcel.widthMm} ×{" "}
                      {booking.parcel.heightMm} mm
                      {booking.tracking && (
                        <>
                          <br />
                          Tracking: {booking.tracking}
                        </>
                      )}
                      {booking.reference && (
                        <>
                          <br />
                          Carrier booking reference: {booking.reference}
                        </>
                      )}
                    </p>
                  )}
                  {enabled &&
                    ["prepared", "creating"].includes(group.state) &&
                    entry.state === "pending" && (
                      <button
                        type="button"
                        disabled={busy || loading}
                        onClick={() =>
                          void perform(() =>
                            post(
                              `/members/${encodeURIComponent(entry.bookingId)}/create`,
                            ),
                          )
                        }
                      >
                        Create Canada Post member {entry.bookingId}
                      </button>
                    )}
                  {enabled && entry.state === "unknown" && (
                    <button
                      type="button"
                      disabled={busy || loading}
                      onClick={() =>
                        void perform(() =>
                          post(
                            `/members/${encodeURIComponent(entry.bookingId)}/reconcile`,
                          ),
                        )
                      }
                    >
                      Recover Canada Post member {entry.bookingId}
                    </button>
                  )}
                  {recoveryOwner &&
                    ["creating", "unknown"].includes(entry.state) && (
                      <CarrierClaim
                        key={entry.bookingId}
                        target={{
                          kind: "member",
                          groupId,
                          bookingId: entry.bookingId,
                        }}
                        ownerKey={recoveryOwner}
                        disabled={busy || loading}
                        onBusy={(value) => {
                          setBusy(value);
                          onBusy(value);
                        }}
                        onReleased={async () => {
                          await read();
                          onChanged();
                          setNotice(
                            "Member claim released to unknown. Recover the existing shipment separately.",
                          );
                        }}
                      />
                    )}
                  {entry.state === "creating" && (
                    <p>
                      A creation is in progress. Refresh to observe its durable
                      outcome; do not resend.
                    </p>
                  )}
                  {entry.state === "unknown" && (
                    <p>
                      The outcome is uncertain. Recovery only looks up the
                      existing shipment.
                    </p>
                  )}
                  {group.state === "transmitted" && (
                    <a
                      className="button secondary"
                      href={`/api/carrier/${encodeURIComponent(entry.bookingId)}/label`}
                    >
                      Download Canada Post label {entry.bookingId}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
          {group.state === "prepared" &&
            group.entries.every((e) => e.state === "pending") && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void perform(() =>
                    command("canada-post.group.cancel", {
                      groupId,
                      reviewHash: group.reviewHash,
                      reason,
                    }),
                  );
                }}
              >
                <label>
                  Canada Post group cancellation reason
                  <textarea
                    required
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    disabled={busy}
                  />
                </label>
                <button disabled={busy || loading}>
                  Cancel wholly unsent Canada Post group
                </button>
              </form>
            )}
          {enabled &&
            ["closed", "transmitting", "unknown"].includes(group.state) && (
              <>
                <p>
                  All member creations must be confirmed before manifest
                  transmission. An uncertain transmission can only be recovered,
                  never resent.
                </p>
                <button
                  type="button"
                  disabled={busy || loading}
                  onClick={() =>
                    void perform(async () => {
                      const token = lifetime.current;
                      const result = await request<CanadaPostManifestIdentity>(
                        groupPath(groupId) + "/manifest/review",
                        { signal: token?.signal },
                      );
                      if (live(token)) setIdentity(result);
                    }, false)
                  }
                >
                  Review Canada Post manifest
                </button>
              </>
            )}
          {recoveryOwner &&
            ["transmitting", "unknown"].includes(group.state) &&
            group.entries.every((e) => e.state === "created") && (
              <CarrierClaim
                key={groupId}
                target={{ kind: "manifest", groupId }}
                ownerKey={recoveryOwner}
                disabled={busy || loading}
                onBusy={(value) => {
                  setBusy(value);
                  onBusy(value);
                }}
                onReleased={async () => {
                  await read();
                  onChanged();
                  setNotice(
                    "Manifest claim released to unknown. Recover its existing outcome separately.",
                  );
                }}
              />
            )}
          {identity && (
            <section aria-label="Canada Post manifest review">
              <p>
                Manifest: {identity.manifestId} · Customer reference:{" "}
                {identity.customerReference}
              </p>
              <p>
                Reviewed carrier shipment IDs: {identity.shipmentIds.join(", ")}
              </p>
              {group.state === "closed" && (
                <button
                  type="button"
                  disabled={busy || loading}
                  onClick={() =>
                    void perform(() =>
                      post("/manifest/transmit", {
                        reviewHash: identity.reviewHash,
                      }),
                    )
                  }
                >
                  Transmit reviewed Canada Post manifest
                </button>
              )}
              {group.state === "unknown" && (
                <button
                  type="button"
                  disabled={busy || loading}
                  onClick={() =>
                    void perform(() =>
                      post("/manifest/reconcile", {
                        reviewHash: identity.reviewHash,
                      }),
                    )
                  }
                >
                  Recover existing Canada Post manifest
                </button>
              )}
              {group.state === "transmitting" && (
                <p>Transmission is in progress. Refresh its current status.</p>
              )}
            </section>
          )}
          {group.state === "transmitted" && (
            <>
              <p>
                Manifest confirmed. Use the retained labels and tracking for the
                separate physical handover. This group operation creates no
                native shipment handover or invoice.
              </p>
              <button
                type="button"
                disabled={busy || loading}
                onClick={() =>
                  void perform(
                    () =>
                      downloadCanadaPostManifest(
                        groupId,
                        lifetime.current!.signal,
                      ),
                    false,
                    "Manifest document downloaded. Physical handover remains separate.",
                  )
                }
              >
                Download Canada Post manifest
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
