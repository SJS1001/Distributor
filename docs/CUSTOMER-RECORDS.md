# Website and customer records

## Three experiences

The public website is an equipment library. Visitors can browse product images, descriptions and manufacturer documents without an account. The product's pricing action enters customer sign-in and retains the selected equipment reference. An existing staff session does not turn this action into an administrative shortcut. Staff workspace remains a separate navigation destination.

The customer workspace belongs to the signed-in buyer's approved trade account. Product access, availability and account pricing come from the server's current purchasing rules. Staff credentials do not grant a buyer pricing view. Customer orders, invoices and payment status remain scoped to that account; the staff cash-receipt history is restricted to authorized financial staff.

The staff workspace manages distributor operations. Customers opens a directory; selecting a customer opens one record with a persistent customer heading and tabs. The record URL and breadcrumbs retain the selected customer and section through reload and browser history. Returning to Customers returns to the directory.

## Customer record organization

- **Overview:** customer identity, current account standing and concise links to relevant tasks.
- **History:** account-filtered orders, invoices and payments, with bounded paging and the staff member's current permissions.
- **Terms:** billing address, tax registration and configured payment terms, plus existing credit limit, hold information and purchasing-access rules. Unconfigured terms are explicitly unconfigured; the interface does not assume Net 30.
- **Pricing:** the selected customer's multiplier, presentation policy and retained price-policy changes. Global override approval rules remain distributor settings.
- **Notes:** private staff notes with server-recorded author/time and separate reviewer/time; verification records human review, not an automated guarantee of truth.
- **Contacts:** durable customer contact records, with revision checks, recorded authorship/timestamps and archive rather than deletion. Contacts do not grant login access.

Permission checks apply independently to every operation. An inaccessible section must not cause another account's data or retained draft to appear. Notes and contact/pricing mutation recovery belong to the exact organization, actor and record.

Implementation and release evidence will be recorded separately; this guide does not by itself prove deployment or verification.
