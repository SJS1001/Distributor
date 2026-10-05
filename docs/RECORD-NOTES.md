# Staff record notes

Customers, products, orders, invoices and shipments have private staff notes. Open **Staff notes** on a record; product management places them in a dedicated tab. Notes load only when opened and offer older-note paging.

The server records the signed-in author and time. Original text cannot be edited or deleted; add a new note to correct or supplement it. Another authorized administrator, commercial, finance or warranty staff member can verify a note. Verification records that person's review and timestamp, not an automatic guarantee that the content is true. Authors cannot verify their own notes.

Customers cannot view staff notes. Staff must retain current access to the underlying record and warehouse; organization, account and session safeguards also apply. Recovery holds prevent adding or verifying notes.

If a connection fails after submission, use **Retry saved note attempt** rather than creating a second note. The browser retains the exact request for the same organization, staff user and record until its outcome is resolved. Attempts survive reload, sign-out and returning in another tab in the same browser profile. Authorization failures preserve the attempt so its original staff member can retry after access is restored. Another account does not inherit the pending command.

Attempts saved by the earlier release migrate from session storage when their record opens; signing out before opening that record preserves the old copy. If saved data is malformed, conflicts with another attempt, or cannot be persisted, changes stay blocked until storage is restored and the record reloaded. A stale tab cannot replace an already saved, different attempt. Do not clear browser storage while an outcome is uncertain; browser storage remains local to the browser profile and is not an encrypted vault.

Schema 28 adds the notes and verification records without rewriting business records. See the [release and polish review](evidence/FIVE-PASS-POLISH-2026-10-05.md) for current evidence and remaining operating limits.
