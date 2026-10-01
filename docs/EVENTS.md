# Local event reporting and recovery

Partial D-010/D-011/D-036 engineering for REQ-04/REQ-05; all tasks and gates remain NOT VERIFIED. This is a synthetic workstation implementation, with no qualified production scheduler or external broker.

Native commands continue to commit their business facts, outbox event, command receipt and audit synchronously. Optional reports consume the durable outbox afterward. The event report owns only metadata and a payload digest; it cannot become the authority for stock, orders, billing or provider sends. Removing the report registration preserves native startup and operations, original events, historical report rows and permanent delivery receipts.

## Contract and registration

The existing version-1 envelope is `{id, orgId, type, version, reference, createdAt, payload}`. Payload must be a JSON object, at most 256 KiB when decoded; identifiers and canonical UTC time are validated. This envelope has no aggregate revision or correlation ID. Consumers must not use it to overwrite newer business state. Future mutable projections require separately defined ordering and version rules.

Consumers are trusted synchronous application code with an ID, implementation version and explicitly supported event versions. No dynamic plugin, external I/O or asynchronous handler is supported. Async functions are rejected at registration; a returned thenable rolls back the attempted local effect and quarantines it. These checks enforce a programming contract, not a sandbox against malicious or deferred code. Stop old workers before changing the registered implementation. A changed implementation cannot execute a claim recorded for another implementation version; expired claims can subsequently be acquired by the new version.

`EVENT_REPORTS=disabled` omits the optional registration in the HTTP server, bootstrap/demo, provider worker, credential CLI and QuickBooks authorization CLI. The shared setting accepts exactly `enabled` or `disabled`; absent defaults to `enabled` for compatibility. Invalid values reject before opening the application database. `.env.example` is a template and is not automatically loaded. Export the setting consistently for every process using the store. The constructor equivalent is `Application(..., {eventReports:false})`. Startup does not process events. Existing `platform_projections` rows remain historical and are not deleted or migrated into the new report. The compatibility `platform.project(true)` now processes at most 20 events and returns its completed count; `false` does nothing. It no longer promises to drain an entire outbox in one invocation.

## One foreground batch

Direct workstation commands are currently authorized; CI runner jobs and operational scheduling are not. For an existing disposable local database:

```sh
DATABASE_PATH=/absolute/path/to/synthetic.db DATA_REGION=CA EVENT_REPORTS=enabled LOCAL_EVENT_REPORTS=enabled npm run events:worker
```

The event worker requires both `EVENT_REPORTS=enabled` (or its compatibility default) and `LOCAL_EVENT_REPORTS=enabled`. Batch permission cannot override `EVENT_REPORTS=disabled`; refusal occurs before opening the store, installing the consumer or claiming work. Explicitly enabling registration can install absent report tables and update the supported schema receipt atomically. Disabling registration preserves existing report tables, receipts, pending events and history; it does not erase them or remove native event recording. Registration alone does not start a scheduler or batch.

Use `US` only for a US-tagged database. This command accepts no arguments, fails closed when disabled or the database is missing, validates organizational region tags, processes one batch of at most 20, prints aggregate counts and exits. The environment variables must be exported or supplied explicitly; `.env.example` is not automatically loaded. Region tags do not prove physical data residency. No provider runtime, credentials or outbound request is needed.

Trusted code can request 1–100 candidates through `tick`/`claimBatch`. Claims are selected in original outbox insertion order in a `BEGIN IMMEDIATE` transaction. They carry a token, revision, attempt and 30-second lease. Handler effects, permanent event-hash receipt, completed delivery and attempt outcome commit in one database transaction. A fence is checked before and after the handler. A lost acknowledgment after commit leaves the permanent receipt and prevents another effect.

Failures roll back effects first, then save a static redacted error code. Transient failures wait 1 second times the current cycle attempt. Unsupported versions, malformed envelopes and asynchronous returns quarantine immediately. Three failed or abandoned attempts in a cycle quarantine the delivery. An expired claim is retained as an expired attempt; another worker receives a new fenced claim. Quarantined events do not prevent later candidates from running. Lifetime attempt history is retained when a reviewed retry resets the cycle.

## Scoped diagnostics and reviewed retries

Current active administrator/support identity and password rules apply to each read. Diagnostics are organization-scoped and omit payloads, lease tokens and original exception text:

- `GET /api/events/:consumerId/deliveries?after=eventId` returns up to 20 delivery summaries, state totals, unclaimed count/oldest time and local policy.
- `GET /api/events/:consumerId/deliveries/:eventId/history?before=attempt` returns up to 20 attempts, newest first.
- `POST /api/commands/events.retry` requires current administrator authority, session CSRF, idempotency key and exactly `{consumerId,eventId,revision,reason}`.

Review the static error, compatible registered code and original event before retrying. Retry permits only failed/quarantined deliveries at the expected revision; it retains the original event and all previous attempts and audits the reason. Repeat the exact key/payload after a lost response. Changed input conflicts. Completed effects are never replayed. A removed consumer refuses retry until it is registered again. No HTTP endpoint accepts worker claims or lease tokens.

Delivery pages use current update-time/event-ID boundaries and are live views, not frozen snapshots; refresh when workers change rows during browsing. Attempt pages use immutable attempt numbers. Backlog counters scan retained data. Returned batch/page limits do not qualify SQLite scan/sort working memory, payload-row retrieval, index creation or production load.

### Staff interface

Administrators and support staff can open **Event reporting** in the workspace. The compiled metadata consumer view shows registration, unclaimed backlog, state totals, delivery states, lifetime/cycle attempt counts and static failure codes. **View attempts** opens retained history; **Load older deliveries** and **Load older attempts** continue bounded pages. Failed reads retain rows and continuations. Refresh resets the view; refresh, navigation and sign-out cancel its pending reads. Live continuation rows are deduplicated by event ID, but pages are not a stable snapshot when workers update them.

Only administrators see **Review retry** on registered failed/quarantined deliveries. Review the named event, failure and compatible implementation; enter evidence and choose **Queue reviewed retry**. This captures the displayed revision and queues local reporting without running a worker or replaying native business commands. If the response is lost, keep the dialog and submit the same evidence to repeat its exact key/payload. A concurrent revision change requires closing the review, refreshing and reviewing the new state. Completed deliveries have no retry action. Support may read history but cannot queue retries; buyer and other staff navigation omits the view and the server checks current authority independently.

The interface handles the compiled metadata consumer only; it does not list dynamically registered consumers or expose event payloads, lease tokens or a processing control. A removed consumer retains readable history with retries unavailable. Mobile dialogs support Escape and focus restoration, including after command rejection. Local synthetic browser evidence is recorded in the [interface receipt](evidence/LOCAL-EVENT-UI-2026-10-01.md).

## Recovery and qualification

Local encrypted backup/restore preserves reports, attempt history and permanent receipts. Restored provider access remains held; optional local metadata processing does not clear that hold or perform provider work. SIGKILL checks exercise termination before effect processing, during an uncommitted effect and after a committed effect, with one report effect after recovery. Expiry is advanced synthetically in these tests; actual clock behavior, production termination and RPO/RTO remain unqualified.

No production scheduler, retention/deletion policy, external broker, deployment, actual hosting residency, aggregate-state replay, malicious-plugin boundary, load qualification or independent human acceptance is provided. Keep completed receipts permanent until an explicitly approved retention/rebuild protocol exists. General module/protocol qualification and full G1/G7 remain open. See the [local event receipt](evidence/LOCAL-EVENT-DELIVERY-2026-10-01.md).


[Local runtime configuration evidence](evidence/LOCAL-REPORT-RUNTIME-2026-10-01.md) records real loopback child-process startup and stored-profile preservation, with synthetic fixtures and explicit qualification limits.
