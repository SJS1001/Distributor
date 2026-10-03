import type {
  LedgerAuthority,
  LedgerDisclosure,
} from "../server/organization-residency.ts";
import type { OrganizationLedgerRevocation } from "../server/organization-revocation.ts";
import { canonical, disclosure } from "./stock-journal-permission-contract.ts";
export { canonical, disclosure };
export type Receipt = ReturnType<OrganizationLedgerRevocation["status"]>;
export type Summary =
  | { enabled: false }
  | {
      enabled: true;
      scope: "organization";
      realm: string;
      credentials: {
        bindingId: string;
        revision: number;
        state: string;
        startedAt: number | null;
      };
    };
export type Attempt = {
  version: 1;
  orgId: string;
  bindingId: string;
  terms: LedgerDisclosure;
} & (
  | {
      kind: "revoke";
      payload: {
        receiptId: string;
        revision: number;
        authority: LedgerAuthority;
      };
    }
  | {
      kind: "review";
      original: Receipt;
      payload: {
        receiptId: string;
        revision: number;
        resolution: "provider-confirmed" | "provider-unconfirmed";
        evidence: string;
      };
    }
);
export function assert(v: unknown): asserts v {
  if (!v)
    throw Error(
      "Organization revocation evidence could not be confirmed. Preserve the original receipt and reconcile it before another submission.",
    );
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
function exact(v: unknown, keys: string): asserts v is Record<string, unknown> {
  assert(
    object(v) && Object.keys(v).sort().join() === keys.split(",").sort().join(),
  );
}
const text = (v: unknown, max = 128): v is string =>
  typeof v === "string" && !!v.trim() && v.length <= max;
const integer = (v: unknown, min = 1): v is number =>
  typeof v === "number" &&
  Number.isSafeInteger(v) &&
  v >= min &&
  v < Number.MAX_SAFE_INTEGER;
function authority(v: unknown, orgId: string): asserts v is LedgerAuthority {
  exact(
    v,
    "provider,purpose,environment,orgId,region,realm,revision,disclosureId,disclosureHash",
  );
  assert(
    v.provider === "quickbooks" &&
      v.purpose === "stock-cost-journal" &&
      v.environment === "sandbox" &&
      v.orgId === orgId &&
      ["CA", "US"].includes(String(v.region)) &&
      typeof v.realm === "string" &&
      /^[1-9][0-9]{0,29}$/.test(v.realm) &&
      integer(v.revision) &&
      text(v.disclosureId) &&
      typeof v.disclosureHash === "string" &&
      /^[a-f0-9]{64}$/.test(v.disclosureHash),
  );
}
export function summary(v: unknown): Summary {
  assert(object(v));
  if (v.enabled === false) {
    exact(v, "enabled");
    return { enabled: false };
  }
  assert(
    v.enabled === true &&
      v.scope === "organization" &&
      typeof v.realm === "string" &&
      /^[1-9][0-9]{0,29}$/.test(v.realm),
  );
  exact(v.credentials, "bindingId,revision,state,startedAt");
  assert(
    text(v.credentials.bindingId) &&
      integer(v.credentials.revision, 0) &&
      ["ready", "refreshing", "unknown", "disabled", "missing"].includes(
        String(v.credentials.state),
      ) &&
      (v.credentials.startedAt === null || integer(v.credentials.startedAt)),
  );
  return v as Summary;
}
export function receipt(v: unknown, orgId: string): Receipt {
  exact(
    v,
    "id,purpose,credentialScope,environment,authority,bindingId,state,credentialRevision,disabledRevision,startedAt,finishedAt,providerRevocationConfirmed,confirmationSource",
  );
  authority(v.authority, orgId);
  assert(
    text(v.id) &&
      text(v.bindingId) &&
      v.purpose === "stock-cost-journal" &&
      v.credentialScope === "organization" &&
      v.environment === "sandbox" &&
      integer(v.credentialRevision) &&
      integer(v.disabledRevision) &&
      v.disabledRevision === v.credentialRevision + 1 &&
      integer(v.startedAt) &&
      (v.finishedAt === null ||
        (integer(v.finishedAt) && v.finishedAt >= v.startedAt)),
  );
  assert(
    ["sending", "unknown", "confirmed", "released"].includes(String(v.state)) &&
      v.providerRevocationConfirmed === (v.state === "confirmed"),
  );
  assert(
    v.state === "confirmed"
      ? ["provider-response", "operator-evidence"].includes(
          String(v.confirmationSource),
        ) && v.finishedAt !== null
      : v.confirmationSource === null &&
          (v.state === "released"
            ? v.finishedAt !== null
            : v.finishedAt === null),
  );
  return v as Receipt;
}
export function parse(raw: string, orgId: string): Attempt {
  assert(raw.length <= 32768);
  const v = JSON.parse(raw);
  exact(
    v,
    v?.kind === "review"
      ? "version,orgId,bindingId,terms,kind,original,payload"
      : "version,orgId,bindingId,terms,kind,payload",
  );
  assert(v.version === 1 && v.orgId === orgId && text(v.bindingId));
  const p = v.payload;
  if (v.kind === "revoke") {
    exact(p, "receiptId,revision,authority");
    authority(p.authority, orgId);
    assert(text(p.receiptId) && integer(p.revision));
  } else {
    assert(v.kind === "review");
    const original = receipt(v.original, orgId);
    exact(p, "receiptId,revision,resolution,evidence");
    assert(
      original.bindingId === v.bindingId &&
        p.receiptId === original.id &&
        integer(p.revision) &&
        p.revision >= original.disabledRevision &&
        ["unknown", "sending"].includes(original.state) &&
        ["provider-confirmed", "provider-unconfirmed"].includes(
          String(p.resolution),
        ) &&
        text(p.evidence, 2000),
    );
  }
  return v as Attempt;
}
export async function validate(a: Attempt, orgId: string) {
  parse(JSON.stringify(a), orgId);
  await disclosure(
    a.terms,
    a.kind === "revoke" ? a.payload.authority : a.original.authority,
  );
}
export function match(v: unknown, a: Attempt): Receipt {
  const r = receipt(v, a.orgId);
  assert(r.bindingId === a.bindingId && r.id === a.payload.receiptId);
  if (a.kind === "revoke")
    assert(
      r.credentialRevision === a.payload.revision &&
        canonical(r.authority) === canonical(a.payload.authority),
    );
  else {
    const {
      state: _s,
      finishedAt: _f,
      providerRevocationConfirmed: _p,
      confirmationSource: _c,
      ...base
    } = r;
    const {
      state: _os,
      finishedAt: _of,
      providerRevocationConfirmed: _op,
      confirmationSource: _oc,
      ...original
    } = a.original;
    assert(canonical(base) === canonical(original));
    if (terminal(r))
      assert(
        a.payload.resolution === "provider-confirmed"
          ? r.state === "confirmed" &&
              r.confirmationSource === "operator-evidence"
          : r.state === "released",
      );
  }
  return r;
}
export const terminal = (r: Receipt) =>
  r.state === "confirmed" || r.state === "released";
