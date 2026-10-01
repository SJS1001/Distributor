import React from "react";
import { providerChoices } from "../shared/provider-choices.ts";
import type { Disclosure } from "../server/iam-residency.ts";

export function DisclosureReview({
  disclosures,
  historical = false,
}: {
  disclosures: Disclosure[];
  historical?: boolean;
}) {
  return (
    <div>
      <p>
        {historical
          ? "These are the exact retained terms for this past acceptance. "
          : "Review each selected provider's terms. "}
        Changed or withdrawn disclosures stop further processing until a new
        customer choice is recorded. Previously transmitted data and in-flight
        requests cannot be recalled. Recorded terms require separate vendor
        qualification.
      </p>
      {disclosures.map((d) => (
        <details key={d.id}>
          <summary>
            {providerChoices.find((p) => p.id === d.provider)?.label} ·{" "}
            {d.version}
          </summary>
          <dl>
            <dt>Storage region</dt>
            <dd>{d.region}</dd>
            <dt>Processing purposes</dt>
            <dd>{d.purposes}</dd>
            <dt>Minimum data</dt>
            <dd>{d.minimumData.join(", ")}</dd>
            <dt>Processing countries</dt>
            <dd>{d.processingCountries.join(", ")}</dd>
            <dt>Subprocessors</dt>
            <dd>{d.subprocessors.join(", ") || "None recorded"}</dd>
            <dt>Retention and deletion</dt>
            <dd>{d.retention}</dd>
            <dt>Withdrawal consequences</dt>
            <dd>{d.withdrawal}</dd>
            <dt>Terms reference</dt>
            <dd>{d.termsReference}</dd>
          </dl>
        </details>
      ))}
      {!disclosures.length && (
        <p>
          No provider disclosures are published. Strict regional residency
          remains available.
        </p>
      )}
    </div>
  );
}
