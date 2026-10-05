# Staff record notes

Customers, products, orders, invoices and shipments have private staff notes. Open **Staff notes** on a record; product management places them in a dedicated tab. Notes load only when opened and offer older-note paging.

The server records the signed-in author and time. Original text cannot be edited or deleted; add a new note to correct or supplement it. Another authorized administrator, commercial, finance or warranty staff member can verify a note. Verification records that person's review and timestamp, not an automatic guarantee that the content is true. Authors cannot verify their own notes.

Customers cannot view staff notes. Staff must retain current access to the underlying record and warehouse; organization, account and session safeguards also apply. Recovery holds prevent adding or verifying notes.

If a connection fails after submission, use **Retry saved note attempt** rather than creating a second note. The browser retains the exact request for the signed-in user and record until its outcome is resolved. Reloading preserves that attempt in the same browser tab. Do not clear browser storage while an outcome is uncertain.

Schema 28 adds the notes and verification records without rewriting business records. See the [release and polish review](evidence/FIVE-PASS-POLISH-2026-10-05.md) for current evidence and remaining operating limits.
