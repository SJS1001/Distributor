import React, { useEffect, useRef, useState } from "react";
import { request } from "./api.ts";
import { usePages } from "./billing-inbox.tsx";
import { DisclosureReview } from "./provider-disclosures.tsx";
import {
  providerChoices,
  type ProviderName,
} from "../shared/provider-choices.ts";
import type { Disclosure } from "../server/iam-residency.ts";

type Acceptance = {
  provider: ProviderName;
  disclosure_id: string;
  disclosure_hash: string;
  basis: "buyer" | "recorded";
  representative: string;
  evidence_ref: string | null;
  actor_id: string;
  accepted_at: string;
};
type Version = { version: number; acceptedAt: string; providerCount: number };
const label = (id: ProviderName) =>
  providerChoices.find((p) => p.id === id)?.label ?? id;

function AcceptedTerms({
  accountId,
  version,
}: {
  accountId: string;
  version: number;
}) {
  const [records, setRecords] = useState<
    (Acceptance & { disclosure: Disclosure })[] | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const pending = useRef<AbortController | null>(null);
  const active = useRef(true);
  const load = async () => {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    try {
      const acceptances = await request<Acceptance[]>(
        `/api/accounts/${encodeURIComponent(accountId)}/provider-acceptances?version=${version}`,
        { signal: controller.signal },
      );
      const results = await Promise.all(
        acceptances.map(async (record) => {
          const disclosure = await request<Disclosure>(
            `/api/provider-disclosures/${encodeURIComponent(record.disclosure_id)}`,
            { signal: controller.signal },
          );
          if (
            disclosure.hash !== record.disclosure_hash ||
            disclosure.provider !== record.provider
          )
            throw Error(
              "Accepted terms do not match the recorded disclosure. Ask an administrator to review the evidence.",
            );
          return { ...record, disclosure };
        }),
      );
      if (!active.current || pending.current !== controller) return;
      setRecords(results);
      heading.current?.focus();
    } catch (e) {
      if (
        active.current &&
        pending.current === controller &&
        !controller.signal.aborted
      )
        setError(
          e instanceof Error
            ? e.message
            : "Accepted terms could not be loaded.",
        );
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        if (active.current) setBusy(false);
      }
    }
  };
  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
      const controller = pending.current;
      pending.current = null;
      controller?.abort();
    };
  }, []);
  return (
    <section
      aria-label={`Accepted terms for choice ${version}`}
      className="provider-history"
    >
      <h3 ref={heading} tabIndex={-1}>
        Accepted terms · choice {version}
      </h3>
      {busy && <p role="status">Loading accepted terms…</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {records?.map((record) => (
        <section
          key={record.provider}
          aria-label={`${label(record.provider)} acceptance`}
        >
          <h4>{label(record.provider)} acceptance</h4>
          <dl>
            <dt>Accepted at</dt>
            <dd>{record.accepted_at}</dd>
            <dt>Customer representative</dt>
            <dd>{record.representative}</dd>
            <dt>Recorded by</dt>
            <dd>
              {record.basis === "buyer"
                ? "Authenticated buyer"
                : "Staff recording external customer acceptance"}{" "}
              · {record.actor_id}
            </dd>
            {record.evidence_ref && (
              <>
                <dt>Customer acceptance evidence</dt>
                <dd>{record.evidence_ref}</dd>
              </>
            )}
            <dt>Disclosure ID</dt>
            <dd>{record.disclosure_id}</dd>
            <dt>Accepted disclosure SHA-256</dt>
            <dd>{record.disclosure_hash}</dd>
          </dl>
          <DisclosureReview disclosures={[record.disclosure]} historical />
        </section>
      ))}
      {records?.length === 0 && (
        <p>
          No reviewed provider acceptance is recorded for this choice. This does
          not prove a past residency policy or authorize processing.
        </p>
      )}
      {error && (
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void load()}
        >
          Retry accepted terms
        </button>
      )}
    </section>
  );
}

export function ProviderHistory({
  account,
  close,
}: {
  account: {
    id: string;
    name: string;
    residency_version: number;
    residency_mode: string;
  };
  close: () => void;
}) {
  const rows = usePages<Version>(
    `/api/accounts/${encodeURIComponent(account.id)}/provider-acceptance-versions`,
  );
  const [version, setVersion] = useState<number | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <section
      className="panel provider-history"
      aria-label="Provider acceptance history"
    >
      <h2 ref={heading} tabIndex={-1}>
        Provider acceptance history — {account.name}
      </h2>
      <p>
        Current customer choice: {account.residency_version} ·{" "}
        {account.residency_mode === "strict"
          ? "Strict regional residency"
          : "Named processor exceptions"}
        . Historical acceptance does not authorize present processing.
      </p>
      <p>
        Only choices with reviewed provider acceptance appear here. Initial,
        strict and legacy unreviewed choices may have no acceptance record.
        Review the current residency choice separately.
      </p>
      <button className="secondary" onClick={close}>
        Close acceptance history
      </button>
      {rows.error && (
        <p role="alert" className="error">
          {rows.error}
        </p>
      )}
      <p role="status">
        {rows.items.length} accepted choices loaded
        {rows.busy ? " · Loading…" : ""}
      </p>
      {!!rows.items.length && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Choice version</th>
                <th>Accepted at</th>
                <th>Providers</th>
                <th>Review</th>
              </tr>
            </thead>
            <tbody>
              {rows.items.map((row) => (
                <tr key={row.version}>
                  <td>
                    {row.version}
                    {row.version === account.residency_version
                      ? " · Current choice"
                      : " · Previous choice"}
                  </td>
                  <td>{row.acceptedAt}</td>
                  <td>{row.providerCount}</td>
                  <td>
                    <button
                      className="secondary"
                      aria-pressed={version === row.version}
                      onClick={() => setVersion(row.version)}
                    >
                      View accepted terms for choice {row.version}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.loaded && !rows.busy && !rows.items.length && (
        <p>No reviewed provider acceptances are recorded for this account.</p>
      )}
      {(rows.next || rows.error) && (
        <button
          className="secondary"
          disabled={rows.busy}
          onClick={() => void rows.load()}
        >
          {rows.error
            ? "Retry acceptance history"
            : "Load older accepted choices"}
        </button>
      )}
      {version !== null && (
        <AcceptedTerms key={version} accountId={account.id} version={version} />
      )}
    </section>
  );
}
