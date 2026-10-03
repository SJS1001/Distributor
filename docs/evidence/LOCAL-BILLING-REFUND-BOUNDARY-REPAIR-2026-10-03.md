# Local Billing refund boundary repair — 2026-10-03

This scoped repair is applied to the working tree based on published `2a60b2d12e9297cf06e6bb06543141c030f0ab6d`. Cloud commit `0192f2b295b1434851a83c396554c67fa0ed1228` excludes original boundary commit `c0ed01a7647826e195d8ed330dadfa905c38b173`. Root verified decoded/gzip/raw hashes and lengths, three owned paths, apply check and original full test prefix preserved byte-for-byte. Raw incremental patch: 23,912 bytes, SHA-256 `5e5d88562182fe62413d2043fa5185289d7fd6980291aa9ee78c3bd8a2cfda56`.

Original local evidence remains retained: 39 tests, 36 passes, three failures, exit 1, log SHA-256 `fac0c1351c045c4ffabf84ad5f4d33f7e1851c9ec93f04195a8b74cc66a4129d`. These failures showed excessive retained text reaching JavaScript serialization before refusal. Billing now counts complete rows and every fixed returned column's UTF-8 bytes in SQLite before materialization, including its early refund/invoice/payment scalar paths. Unsupported opening snapshots refuse before their source text is read. Canonical output budgeting remains after the SQL preflight. Original red assertions are unmodified; additional tests cover scalar fields, retained relationships, embedded NUL/Unicode and exact byte capacity.

## Local verification

Direct workstation: macOS 27.0, arm64, Node v24.16.0, OpenSSL 3.5.6, SQLite 3.53.0. Synthetic native application fixtures only, no CI runner or provider request.

```sh
node --import tsx --test tests/billing-offline-refund-review-boundary.test.ts tests/billing-offline-refund-review.test.ts tests/integration-offline-refund-evidence.test.ts tests/refunds.test.ts tests/refund-callbacks.test.ts tests/billing.test.ts tests/accounting-credits.test.ts tests/accounting-refunds.test.ts tests/accounting-balances.test.ts
```

Actual outcome: 172 tests, 172 passes, zero failures/cancellations/skips/todo, exit 0, 3,150.990459 ms. Private local log SHA-256 `32a34d2f1eba7d4a5924a4fb46bedecb502012492f2fef78192eb7732d4fd15a`. Complete TypeScript exits 0 after the repair. This is affected verification only. Storage's four independent append-only replacement failures still await production repair. No qualified coordinator, source/provider authentication, current release authority or product gate acceptance is established.

## Tested bytes

- `src/server/billing-refunds.ts`: `b1a23c37b8a7837557fe1b4de5ead880147fa618890e0a0935cc6326e4702f39`
- `tests/billing-offline-refund-review-boundary.test.ts`: `56fb8da3903fbf7b5dcace801b55296a6adfc9b174911e18607f0a091c746177`
