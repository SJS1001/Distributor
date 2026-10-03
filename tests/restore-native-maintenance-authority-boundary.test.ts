import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fixture, accept, chooseProviders } from "./fixtures.ts";
import { origin } from "./canada-post-fixture.ts";
import { carrierConfiguration } from "../src/server/carrier-configuration.ts";
import { canonical, digest } from "../src/server/core.ts";
import {
  restoreNativeMaintenanceMessage,
  type RestoreNativeDispositionConfiguration,
  type RestoreNativeMaintenanceAssociation,
  type RestoreNativeMaintenanceRequest,
  type RestoreActivationAdapter,
} from "../src/server/restore-activation.ts";
function carrierSetup(
  t: Parameters<typeof fixture>[0],
  reports = false,
  cancelBookings = true,
  keysAreIds = false,
  mismatchedGroupConfiguration = false,
) {
  const f = fixture(t, { eventReports: reports });
  chooseProviders(f, f.actor, "cp-choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["canada-post"],
    version: 1,
    acknowledgment: "Synthetic choice",
  });
  const configuration = carrierConfiguration(
    "canada-post",
    { customer: "synthetic-account" },
    "Synthetic account",
    ["CA domestic"],
    [{ service: "DOM.EP", description: "Synthetic service" }],
  );
  const entries = [0, 1].map((i) => {
    const orderId = accept(f, 1, `restore-order-${i}`).id;
    const picks = f.app.fulfillment.picks(f.actor, orderId);
    for (const pick of picks)
      f.app.fulfillment.pick(f.actor, `restore-pick-${i}`, {
        orderId,
        allocationId: pick.id,
        serial: pick.serial,
      });
    const address = "Synthetic CA destination";
    const shipmentId = f.app.fulfillment.pack(f.actor, `restore-pack-${i}`, {
      orderId,
      revision: f.app.orders.order(f.actor, orderId).revision,
      mode: "carrier",
      address,
      lines: picks.map((p) => ({ allocationId: p.id, quantity: p.quantity })),
    }).id;
    const booking = f.app.carriers.prepare(
      f.actor,
      `restore-booking-${i}`,
      {
        shipmentId,
        previousId: null,
        provider: "canada-post",
        service: "DOM.EP",
        origin,
        destination: { ...origin, name: "Synthetic receiver" },
        parcel: {
          weightGrams: 1000,
          lengthMm: 100,
          widthMm: 100,
          heightMm: 100,
        },
        reviewedDestination: address,
        acknowledgment: "Synthetic reviewed parcel",
        configurationHash: configuration.hash,
      },
      configuration,
    );
    return { bookingId: booking.id, reviewHash: booking.reviewHash };
  });
  const group = f.app.carriers.prepareCanadaPostGroup(
    f.actor,
    "restore-group",
    {
      configurationHash: mismatchedGroupConfiguration
        ? "b".repeat(64)
        : configuration.hash,
      entries,
    },
  );
  const cancel = {
    groupId: group.id,
    reviewHash: group.reviewHash,
    reason: "Synthetic wholly unsent group",
  };
  f.app.carriers.cancelCanadaPostGroup(
    f.actor,
    keysAreIds ? group.id : "restore-cancel",
    cancel,
  );
  for (const entry of cancelBookings ? entries : [])
    f.app.carriers.cancel(
      f.actor,
      keysAreIds ? entry.bookingId : `cancel-${entry.bookingId}`,
      {
        ...entry,
        reason: "Synthetic booking canceled separately",
      },
    );
  return { ...f, group, entries, configuration, cancel };
}
function ownerRows(f: ReturnType<typeof fixture>) {
  const db = new DatabaseSync(f.path, { readOnly: true });
  try {
    return canonical(
      db
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='platform_restore_releases' ORDER BY name",
        )
        .all()
        .map((r) => [
          r.name,
          db.prepare(`SELECT * FROM ${r.name} ORDER BY rowid`).all(),
        ]),
    );
  } finally {
    db.close();
  }
}

// Real command-created canceled group/bookings, restored hold and actual owning
// historical projection. No mock authority validator or provider result.
function setup(t: Parameters<typeof fixture>[0]) {
  const f = carrierSetup(t);
  const user = f.app.identity.createUser(f.actor, "boundary-warehouse", {
    email: "boundary@synthetic.test",
    name: "Synthetic maintenance",
    role: "warehouse",
    sites: [f.w1],
    password: "long-synthetic-password",
  });
  const principal = f.app.identity.currentActor({ ...f.actor, id: user.id });
  f.app.platform.isolateRestore("a".repeat(64), "2026-10-03T00:00:00.000Z");
  const pair = generateKeyPairSync("ed25519");
  const authority = "synthetic-independent-authority";
  let now = Date.now();
  let clock = () => now;
  let trust: unknown = [
    {
      id: authority,
      publicKey: pair.publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
    },
  ];
  const seen: RestoreNativeMaintenanceRequest[] = [];
  const signed = (
    request: RestoreNativeMaintenanceRequest,
    extra: Record<string, unknown> = {},
  ) => {
    const body = {
      request,
      associationId: "synthetic-current-association",
      evidenceHash: digest("synthetic-evidence"),
      observedAt: now,
      validUntil: now + 10000,
      ...extra,
    };
    return {
      ...body,
      signature: sign(
        null,
        Buffer.from(restoreNativeMaintenanceMessage(body)),
        pair.privateKey,
      ).toString("base64"),
    } as RestoreNativeMaintenanceAssociation;
  };
  const configuration: RestoreNativeDispositionConfiguration = {
    mappings: [
      {
        orgId: f.actor.orgId,
        projection: "canceled-unused-membership",
        principal,
        externalAuthorityId: authority,
      },
    ],
    loadTrust: () =>
      trust as ReturnType<RestoreNativeDispositionConfiguration["loadTrust"]>,
    observe(request) {
      seen.push(structuredClone(request));
      return signed(request);
    },
  };
  // Only the real clock is configured; no adapter control is invoked.
  f.app.platform.restore.configure(
    { enabled: false } as RestoreActivationAdapter,
    () => [],
    () => clock(),
  );
  const configure = () =>
    f.app.configureRestoreNativeDispositions(configuration);
  configure();
  const project = () =>
    f.app.database.transaction(() => {
      (
        f.app.platform.restore as unknown as { settledNativeQueues(): void }
      ).settledNativeQueues();
    });
  const conserved = (action: () => void) => {
    const before = ownerRows(f);
    let error: unknown;
    try {
      action();
    } catch (e) {
      error = e;
    }
    assert.equal(
      ownerRows(f),
      before,
      "same-writer owning rows must not change",
    );
    assert.throws(() => f.app.platform.assertProviderAccess(), {
      code: "RECOVERY_HOLD",
    });
    return error;
  };
  const refuse = () => {
    const error = conserved(project);
    assert.ok(
      error,
      "actual native historical projection must refuse this authority input",
    );
  };
  return {
    ...f,
    principal,
    pair,
    authority,
    configuration,
    configure,
    signed,
    seen,
    project,
    conserved,
    refuse,
    setTrust: (value: unknown) => {
      trust = value;
    },
    trust: () => trust as { id: string; publicKey: string }[],
    time: () => now,
    setTime: (value: number) => {
      now = value;
    },
    setClock: (value: () => number) => {
      clock = value;
    },
  };
}

test("native historical projection accepts fresh canonical signed association without writes or hold release", (t) => {
  const f = setup(t);
  assert.equal(f.conserved(f.project), undefined);
  assert.equal(f.seen.length, 2);
  assert.notEqual(f.seen[0]!.challenge, f.seen[1]!.challenge);
});

for (const field of [
  "orgId",
  "projection",
  "recordId",
  "nativePrincipalId",
  "externalAuthorityId",
  "purpose",
  "challenge",
  "generation",
] as const)
  test(`native exact signed request refuses substituted ${field}`, (t) => {
    const f = setup(t);
    f.configuration.observe = (r) =>
      f.signed({
        ...r,
        [field]:
          field === "generation"
            ? { ...r.generation, snapshotHash: "b".repeat(64) }
            : "substituted",
      } as RestoreNativeMaintenanceRequest);
    f.configure();
    f.refuse();
  });
for (const field of [
  "snapshotHash",
  "restoredAt",
  "sourceCompletedAt",
] as const)
  test(`native signed recovery generation refuses changed ${field}`, (t) => {
    const f = setup(t);
    f.configuration.observe = (r) =>
      f.signed({
        ...r,
        generation: { ...r.generation, [field]: "substituted" },
      });
    f.configure();
    f.refuse();
  });

test("native replay cannot reuse prior valid target/challenge", (t) => {
  const f = setup(t);
  let cached: RestoreNativeMaintenanceAssociation | undefined;
  f.configuration.observe = (r) => (cached ??= f.signed(r));
  f.configure();
  f.refuse();
});
test("native current trust revocation during observation wins", (t) => {
  const f = setup(t);
  f.configuration.observe = (r) => {
    const signed = f.signed(r);
    f.setTrust([]);
    return signed;
  };
  f.configure();
  f.refuse();
});
test("native configuration replacement during observation refuses old grant", (t) => {
  const f = setup(t);
  f.configuration.observe = (r) => {
    f.app.configureRestoreNativeDispositions();
    return f.signed(r);
  };
  f.configure();
  f.refuse();
});
for (const attack of ["expiry", "rollback", "future", "too-long"])
  test(`native current clock refuses ${attack}`, (t) => {
    const f = setup(t);
    const at = f.time();
    let calls = 0;
    if (attack === "expiry" || attack === "rollback")
      f.setClock(() =>
        ++calls === 1 ? at : attack === "expiry" ? at + 10000 : at - 1,
      );
    else
      f.configuration.observe = (r) =>
        f.signed(
          r,
          attack === "future"
            ? { observedAt: at + 1 }
            : { validUntil: at + 30001 },
        );
    f.configure();
    f.refuse();
  });

for (const [name, sql] of [
  ["inactive", "UPDATE iam_users SET active=0 WHERE id=?"],
  ["role", "UPDATE iam_users SET role='admin' WHERE id=?"],
  ["site", "UPDATE iam_users SET sites='[]' WHERE id=?"],
  ["tenant", "UPDATE iam_users SET org_id='foreign' WHERE id=?"],
  [
    "current password",
    "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
  ],
] as const)
  test(`native copied principal loses ${name} authority in current same-writer snapshot`, (t) => {
    const f = setup(t);
    const before = ownerRows(f);
    const rollback = Error("fixture rollback");
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          f.app.database.owned("iam").run(sql, f.principal.id);
          assert.throws(f.project);
          throw rollback;
        }),
      (e) => e === rollback,
    );
    assert.equal(ownerRows(f), before);
    assert.equal(f.conserved(f.project), undefined);
  });

const torsion = [
  "0100000000000000000000000000000000000000000000000000000000000000",
  "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
  "0000000000000000000000000000000000000000000000000000000000000080",
  "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
  "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
  "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85",
  "0000000000000000000000000000000000000000000000000000000000000000",
  "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa",
];
for (const point of torsion)
  test(`native small-order trusted key forgery refused ${point.slice(0, 8)}-${point.slice(-2)}`, (t) => {
    const f = setup(t);
    const key = createPublicKey({
      key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        Buffer.from(point, "hex"),
      ]),
      type: "spki",
      format: "der",
    })
      .export({ type: "spki", format: "pem" })
      .toString();
    f.setTrust([{ id: f.authority, publicKey: key }]);
    f.configuration.observe = (r) => {
      const value = f.signed(r);
      const forged = Buffer.alloc(64);
      forged[0] = 1;
      return { ...value, signature: forged.toString("base64") };
    };
    f.configure();
    f.refuse();
  });
for (const attack of [
  "scalar",
  "signature-pad-bits",
  "key-trailing-bytes",
  "key-leading-junk",
])
  test(`native canonical Ed25519 encoding refuses ${attack}`, (t) => {
    const f = setup(t);
    if (attack.startsWith("key")) {
      const key = f.trust()[0]!.publicKey;
      f.setTrust([
        {
          id: f.authority,
          publicKey:
            attack === "key-trailing-bytes" ? key + "junk" : "junk\n" + key,
        },
      ]);
    } else
      f.configuration.observe = (r) => {
        const value = f.signed(r);
        const bytes = Buffer.from(value.signature, "base64");
        if (attack === "scalar") {
          let n = 0n;
          for (let i = 63; i >= 32; i--) n = (n << 8n) + BigInt(bytes[i]!);
          n += (1n << 252n) + 27742317777372353535851937790883648493n;
          for (let i = 32; i < 64; i++) {
            bytes[i] = Number(n & 255n);
            n >>= 8n;
          }
          return { ...value, signature: bytes.toString("base64") };
        }
        const alphabet =
          "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        const signature =
          value.signature.slice(0, 85) +
          alphabet[alphabet.indexOf(value.signature[85]!) + 1] +
          "==";
        return { ...value, signature };
      };
    f.configure();
    f.refuse();
  });

for (const location of [
  "observation",
  "request",
  "trust-array",
  "trust-entry",
] as const)
  for (const attack of ["getter", "proxy", "extra-key", "oversized"] as const)
    test(`native byte/descriptor preflight ${location} ${attack} precedes active reflection`, (t) => {
      const f = setup(t);
      let reflections = 0;
      const wrap = (value: any, field: string) => {
        if (attack === "getter") {
          const result = { ...value };
          Object.defineProperty(result, field, {
            enumerable: true,
            get() {
              reflections++;
              return value[field];
            },
          });
          return result;
        }
        if (attack === "proxy")
          return new Proxy(value, {
            get(target, key, receiver) {
              reflections++;
              return Reflect.get(target, key, receiver);
            },
            ownKeys(target) {
              reflections++;
              return Reflect.ownKeys(target);
            },
            getOwnPropertyDescriptor(target, key) {
              reflections++;
              return Reflect.getOwnPropertyDescriptor(target, key);
            },
          });
        return {
          ...value,
          extra:
            attack === "oversized" ? "x".repeat(1024 * 1024) : "unexpected",
        };
      };
      if (location === "trust-array") {
        const trust = f.trust();
        if (attack === "oversized")
          f.setTrust([
            ...Array.from({ length: 10001 }, (_, i) => ({
              id: `unrelated-${i}`,
              publicKey: trust[0]!.publicKey,
            })),
            ...trust,
          ]);
        else if (attack === "extra-key") {
          Object.assign(trust, { extra: "unexpected" });
          f.setTrust(trust);
        } else if (attack === "getter") {
          Object.defineProperty(trust, "0", {
            get() {
              reflections++;
              return {
                id: f.authority,
                publicKey: f.pair.publicKey
                  .export({ type: "spki", format: "pem" })
                  .toString(),
              };
            },
          });
          f.setTrust(trust);
        } else f.setTrust(wrap(trust, "0"));
      } else if (location === "trust-entry")
        f.setTrust([wrap(f.trust()[0], "publicKey")]);
      else
        f.configuration.observe = (r) => {
          if (location === "request") {
            if (attack === "getter" || attack === "proxy") {
              const signed = f.signed(r);
              return { ...signed, request: wrap(r, "challenge") };
            }
            return f.signed(wrap(r, "challenge"));
          }
          if (attack === "extra-key" || attack === "oversized")
            return f.signed(r, {
              extra:
                attack === "oversized" ? "x".repeat(1024 * 1024) : "unexpected",
            });
          return wrap(f.signed(r), "request");
        };
      f.configure();
      const error = f.conserved(f.project);
      if (attack === "getter" || attack === "proxy")
        assert.equal(
          reflections,
          0,
          "hostile descriptors/proxies must be refused before active reflection/signature processing",
        );
      assert.ok(
        error,
        "malformed/oversized external authority input must fail closed",
      );
    });

test("native same-writer observer mutation cannot grant projection or persist writes", (t) => {
  const f = setup(t);
  f.configuration.observe = (r) => {
    f.app.database
      .owned("integration")
      .run(
        "UPDATE integration_carrier_bookings SET state='pending' WHERE id=?",
        f.entries[0]!.bookingId,
      );
    return f.signed(r);
  };
  f.configure();
  f.refuse();
});

for (const attack of [
  "duplicate-mapping",
  "foreign-principal",
  "missing-mapping",
])
  test(`native explicit composition refuses ${attack}`, (t) => {
    const f = setup(t);
    const mapping = f.configuration.mappings[0]!;
    f.configuration.mappings =
      attack === "duplicate-mapping"
        ? [mapping, mapping]
        : attack === "missing-mapping"
          ? []
          : [
              {
                ...mapping,
                principal: { ...mapping.principal, orgId: "foreign" },
              },
            ];
    f.configure();
    f.refuse();
  });
for (const attack of [
  "invalid-signature",
  "truncated-signature",
  "duplicate-trust",
  "changed-key",
])
  test(`native independently current cryptographic authority refuses ${attack}`, (t) => {
    const f = setup(t);
    if (attack === "duplicate-trust") f.setTrust([...f.trust(), ...f.trust()]);
    else if (attack === "changed-key")
      f.setTrust([
        {
          id: f.authority,
          publicKey: generateKeyPairSync("ed25519")
            .publicKey.export({ type: "spki", format: "pem" })
            .toString(),
        },
      ]);
    else
      f.configuration.observe = (r) => {
        const v = f.signed(r);
        return {
          ...v,
          signature:
            attack === "truncated-signature"
              ? v.signature.slice(0, 84)
              : Buffer.alloc(64).toString("base64"),
        };
      };
    f.configure();
    f.refuse();
  });
for (const kind of ["symbol", "nonenumerable"])
  test(`native observation rejects hidden ${kind} key`, (t) => {
    const f = setup(t);
    f.configuration.observe = (r) => {
      const v = f.signed(r);
      Object.defineProperty(v, kind === "symbol" ? Symbol("extra") : "extra", {
        value: "unexpected",
        enumerable: kind === "symbol",
      });
      return v;
    };
    f.configure();
    f.refuse();
  });
for (const field of ["associationId", "signature"])
  test(`native oversized ${field} refuses before trusted-key getter`, (t) => {
    const f = setup(t);
    let reads = 0;
    const key = f.trust()[0]!.publicKey;
    f.setTrust([
      {
        id: f.authority,
        get publicKey() {
          reads++;
          return key;
        },
      },
    ]);
    f.configuration.observe = (r) => ({
      ...f.signed(r),
      [field]: "x".repeat(1024 * 1024),
    });
    f.configure();
    f.refuse();
    assert.equal(reads, 0);
  });

for (const point of torsion)
  test(`native signature R small-order substitution refused ${point.slice(0, 8)}-${point.slice(-2)}`, (t) => {
    const f = setup(t);
    f.configuration.observe = (r) => {
      const v = f.signed(r);
      const bytes = Buffer.from(v.signature, "base64");
      Buffer.from(point, "hex").copy(bytes, 0);
      return { ...v, signature: bytes.toString("base64") };
    };
    f.configure();
    f.refuse();
  });

// Incremental repair coverage; the preceding original 72 assertions are intact.
for (const attack of [
  "getter",
  "proxy",
  "revoked-proxy",
  "mapping-getter",
  "sites-getter",
  "callback-proxy",
])
  test(`native malformed configuration withdraws old mapping without reflecting ${attack}`, (t) => {
    const f = setup(t);
    let reads = 0;
    const old = f.configuration;
    let hostile: unknown = { ...old };
    if (attack === "getter")
      Object.defineProperty(hostile, "mappings", {
        enumerable: true,
        get() {
          reads++;
          return old.mappings;
        },
      });
    if (attack === "proxy")
      hostile = new Proxy(old, {
        get() {
          reads++;
          throw Error("active config reflection");
        },
        ownKeys() {
          reads++;
          return [];
        },
        getPrototypeOf() {
          reads++;
          return Object.prototype;
        },
      });
    if (attack === "revoked-proxy") {
      const proxy = Proxy.revocable(old, {});
      proxy.revoke();
      hostile = proxy.proxy;
    }
    if (attack === "mapping-getter") {
      const mapping = { ...old.mappings[0]! };
      Object.defineProperty(mapping, "principal", {
        enumerable: true,
        get() {
          reads++;
          return old.mappings[0]!.principal;
        },
      });
      hostile = { ...old, mappings: [mapping] };
    }
    if (attack === "sites-getter") {
      const sites = [f.w1];
      Object.defineProperty(sites, "0", {
        get() {
          reads++;
          return f.w1;
        },
      });
      hostile = {
        ...old,
        mappings: [
          { ...old.mappings[0]!, principal: { ...f.principal, sites } },
        ],
      };
    }
    if (attack === "callback-proxy")
      hostile = {
        ...old,
        loadTrust: new Proxy(old.loadTrust, {
          apply() {
            reads++;
            return f.trust();
          },
        }),
      };
    assert.throws(
      () =>
        f.app.configureRestoreNativeDispositions(
          hostile as RestoreNativeDispositionConfiguration,
        ),
      { code: "RESTORE_MAINTENANCE_AUTHORITY" },
    );
    assert.equal(reads, 0);
    f.refuse();
  });

test("native caught malformed reconfiguration during observe cannot retain old grant", (t) => {
  const f = setup(t);
  f.configuration.observe = (r) => {
    try {
      f.app.configureRestoreNativeDispositions({
        ...f.configuration,
        mappings: [],
        extra: true,
      } as RestoreNativeDispositionConfiguration);
    } catch {
      /* composition caller caught validation; old association is still withdrawn */
    }
    return f.signed(r);
  };
  f.configure();
  f.refuse();
});
for (const attack of [
  "sparse",
  "revoked-proxy",
  "prototype",
  "hidden-key",
  "symbol-key",
  "unicode-id",
  "duplicate-key",
  "unrelated-weak-key",
])
  test(`native full current trust roster refuses ${attack}`, (t) => {
    const f = setup(t);
    const trust = f.trust();
    if (attack === "sparse") {
      const sparse = Array(2);
      sparse[1] = trust[0];
      f.setTrust(sparse);
    }
    if (attack === "revoked-proxy") {
      const p = Proxy.revocable(trust, {});
      p.revoke();
      f.setTrust(p.proxy);
    }
    if (attack === "prototype") {
      Object.setPrototypeOf(trust, null);
      f.setTrust(trust);
    }
    if (attack === "hidden-key") {
      Object.defineProperty(trust, "hidden", { value: true });
      f.setTrust(trust);
    }
    if (attack === "symbol-key") {
      Object.defineProperty(trust[0], Symbol("extra"), { value: true });
      f.setTrust(trust);
    }
    if (attack === "unicode-id")
      f.setTrust([
        ...trust,
        {
          id: "é".repeat(81),
          publicKey: generateKeyPairSync("ed25519")
            .publicKey.export({ type: "spki", format: "pem" })
            .toString(),
        },
      ]);
    if (attack === "duplicate-key")
      f.setTrust([...trust, { ...trust[0]!, id: "key-alias" }]);
    if (attack === "unrelated-weak-key")
      f.setTrust([
        ...trust,
        {
          id: "unrelated-weak",
          publicKey:
            "-----BEGIN PUBLIC KEY-----\n" +
            Buffer.from(
              "302a300506032b6570032100" + torsion[0],
              "hex",
            ).toString("base64") +
            "\n-----END PUBLIC KEY-----\n",
        },
      ]);
    f.refuse();
  });
for (const attack of [
  "generation-getter",
  "generation-proxy",
  "generation-hidden",
  "association-utf8",
  "request-utf8",
  "prototype",
])
  test(`native recursive bounded association preflight refuses ${attack}`, (t) => {
    const f = setup(t);
    let reads = 0;
    f.configuration.observe = (r) => {
      const v = f.signed(r);
      if (attack === "generation-getter")
        Object.defineProperty(v.request.generation, "snapshotHash", {
          enumerable: true,
          get() {
            reads++;
            return r.generation.snapshotHash;
          },
        });
      if (attack === "generation-proxy")
        v.request = {
          ...r,
          generation: new Proxy(r.generation, {
            ownKeys() {
              reads++;
              return Reflect.ownKeys(r.generation);
            },
            get() {
              reads++;
              throw Error("active generation reflection");
            },
          }),
        };
      if (attack === "generation-hidden")
        Object.defineProperty(v.request.generation, "hidden", { value: true });
      if (attack === "association-utf8")
        return f.signed(r, { associationId: "é".repeat(81) });
      if (attack === "request-utf8")
        v.request = { ...r, nativePrincipalId: "é".repeat(81) };
      if (attack === "prototype") Object.setPrototypeOf(v, Date.prototype);
      return v;
    };
    f.configure();
    f.refuse();
    assert.equal(reads, 0);
  });
test("native complete 256-key trust roster accepts canonical current signer at final position", (t) => {
  const f = setup(t);
  const trust = Array.from({ length: 255 }, (_, i) => ({
    id: `unrelated-${i}`,
    publicKey: generateKeyPairSync("ed25519")
      .publicKey.export({ type: "spki", format: "pem" })
      .toString(),
  }));
  f.setTrust([...trust, ...f.trust()]);
  assert.equal(f.conserved(f.project), undefined);
});
test("native 257-entry trust roster refuses before reading any entry descriptor", (t) => {
  const f = setup(t);
  let reads = 0;
  const trust = Array(257).fill(null);
  Object.defineProperty(trust, "0", {
    get() {
      reads++;
      return f.trust()[0];
    },
  });
  f.setTrust(trust);
  f.refuse();
  assert.equal(reads, 0);
});
test("native exact 160-byte UTF8 association identity remains accepted", (t) => {
  const f = setup(t);
  f.configuration.observe = (r) =>
    f.signed(r, { associationId: "é".repeat(80) });
  f.configure();
  assert.equal(f.conserved(f.project), undefined);
});

// Native entry-point sentinel only: even permissive host crypto must never see
// malformed/torsion/mixed-subgroup encodings. No mock authority validator.
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
// Independently computed with Python affine RFC 8032 curve addition B + T,
// where B is the standard base point and T the seven nonidentity vectors above.
const mixedSubgroupPoints = [
  "98519eadf35b995233b51b5cd23e9cc5a28b639b5a4af0ec903cb960d81b7819",
  "9bad33f580df7ecc49df5342bac8145d5bedc40f573d1b067f3c4ce449689a15",
  "da99e28ba529cdde35a25fba9059e78ecaee239f99755b9b1aa4f65df00803e2",
  "9599999999999999999999999999999999999999999999999999999999999999",
  "55ae61520ca466adcc4ae4a32dc1633a5d749c64a5b50f136fc3469f27e487e6",
  "5252cc0a7f208133b620acbd4537eba2a4123bf0a8c2e4f980c3b31bb69765ea",
  "13661d745ad63221ca5da0456fa618713511dc60668aa464e55b09a20ff7fc1d",
];
for (const location of ["trusted-key", "signature-R"] as const)
  test(`native strict prime-subgroup ${location} capture precedes permissive OpenSSL`, (t) => {
    const f = setup(t);
    let calls = 0;
    const native = t.mock.method(crypto, "verify", () => {
      calls++;
      return true;
    });
    syncBuiltinESMExports();
    try {
      for (const point of [
        ...torsion,
        ...mixedSubgroupPoints,
        "edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
        "0100000000000000000000000000000000000000000000000000000000000080",
      ]) {
        if (location === "trusted-key")
          f.setTrust([
            {
              id: f.authority,
              publicKey:
                "-----BEGIN PUBLIC KEY-----\n" +
                Buffer.from("302a300506032b6570032100" + point, "hex").toString(
                  "base64",
                ) +
                "\n-----END PUBLIC KEY-----\n",
            },
          ]);
        else {
          f.configuration.observe = (r) => {
            const value = f.signed(r);
            const bytes = Buffer.from(value.signature, "base64");
            Buffer.from(point, "hex").copy(bytes, 0);
            return { ...value, signature: bytes.toString("base64") };
          };
          f.configure();
        }
        const error = f.conserved(f.project);
        assert.equal(
          (error as { code?: string })?.code,
          "RESTORE_MAINTENANCE_AUTHORITY",
          point,
        );
        assert.equal(calls, 0, point);
      }
    } finally {
      native.mock.restore();
      syncBuiltinESMExports();
    }
  });
test("native second sampled clock still refuses expiry reached during trust reload", (t) => {
  const f = setup(t);
  const trust = f.trust();
  f.configuration.loadTrust = () => {
    f.setTime(f.time() + 10000);
    return trust;
  };
  f.configure();
  f.refuse();
});
test("native configuration replacement during current trust reload refuses old grant", (t) => {
  const f = setup(t);
  const trust = f.trust();
  f.configuration.loadTrust = () => {
    f.app.configureRestoreNativeDispositions();
    return trust;
  };
  f.configure();
  f.refuse();
});

test("native whole-roster descriptor preflight precedes every key import", (t) => {
  const f = setup(t);
  let imports = 0,
    reads = 0;
  const unrelated = {
    id: "later-unrelated",
    publicKey: f.trust()[0]!.publicKey,
  };
  Object.defineProperty(unrelated, "publicKey", {
    enumerable: true,
    get() {
      reads++;
      return f.trust()[0]!.publicKey;
    },
  });
  f.setTrust([...f.trust(), unrelated]);
  const native = t.mock.method(crypto, "createPublicKey", () => {
    imports++;
    throw Error("key import before roster preflight");
  });
  syncBuiltinESMExports();
  try {
    const error = f.conserved(f.project);
    assert.equal(
      (error as { code?: string })?.code,
      "RESTORE_MAINTENANCE_AUTHORITY",
    );
    assert.equal(imports, 0);
    assert.equal(reads, 0);
  } finally {
    native.mock.restore();
    syncBuiltinESMExports();
  }
});
