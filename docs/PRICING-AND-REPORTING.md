# Pricing, freight and reports

Implemented in the schema27 release. This guide describes the code;
see WORKFLOW-COMPLETION-2026-10-05.md for verification and deployment status.

## Set customer prices

Use Customers → Pricing. A multiplier is the proportion of MSRP charged to the
customer: a multiplier of 0.75 means the customer pays 75% of MSRP, a 25% discount.
Configure reviewed MSRP separately on the product. Existing tier/base prices
continue when a customer has no MSRP multiplier. Do not enter an invented MSRP
merely to enable a discount display.

Choose detailed prices to show MSRP, percentage discount, savings and customer
price. Choose net-only to show the customer's own price. The server omits the
hidden breakdown; hiding it visually alone is insufficient. Product permission,
availability and credit controls still apply.

## Record wholesale cost and approval limits

In product management, enter the reviewed wholesale unit cost and a reason.
This is a pricing baseline. Receipt and purchase-order cost history remains in
inventory accounting; editing the baseline does not rewrite that history.
Only administrators can manage the baseline and organization approval limits.
Customers cannot read the baseline or internal approval evidence.

The price approval settings have two limits:

- Maximum extra discount from the customer's ordinary negotiated net price.
- Minimum margin, calculated as `(offered net price − reviewed cost) / offered
  net price`. Tax and freight are excluded.

Both limits must be configured together. Unconfigured limits, missing reviewed
cost or a zero selling price require exception approval. Boundary comparisons
use exact cents; a value on the configured boundary is within the limit.

## Offer a one-off selling price

Open a saved cart and its selling-price review. Select the line, enter an offered
net unit price and explain the reason. Staff can submit the offer. An offer
within configured limits becomes active; an exception remains pending until a
different current administrator approves it. The proposer cannot approve their
own exception. The approver must satisfy current account security requirements.

Pending or rejected offers block a fresh quote until reviewed or explicitly
cleared back to the ordinary account price. Relevant product, quantity, pricing,
cost or policy changes require another review. Every change, decision and clear
action retains a reason and history. The browser retains uncertain requests for
an exact retry after a lost response.

The customer accepts a fresh quote at the reviewed price. The accepted price is
retained in the order and subsequent invoice; later catalog edits do not rewrite
it. An accepted override cannot be reused for another order.

## Agree shipping before acceptance

Staff can record shipping as included or extra on a saved cart. Extra shipping
requires an explicit net charge and tax amount. The quote and customer review
show these terms before acceptance. A later shipping edit invalidates the old
quote. Historical records without terms remain unspecified rather than being
silently described as free shipping.

The agreed extra charge is invoiced once across partial shipments. Invoice,
credit and document history preserve the shipping amounts. A carrier's observed
fee does not automatically become the agreed customer charge.

## Read and customize reports

The workspace includes visual operational and financial reports. Use Customize
reports to show, hide, reorder or restore cards. Preferences belong to the
current organization/user in that browser; they do not synchronize across devices.

Financial reports keep invoice sales, credits, payments and refunds separate.
Use the dates and currency selector, then the Summary, Transactions and Daily
figures tabs. Summary totals cover the full selected period; the transaction
preview is bounded. Customer reports are restricted to that customer's account.
Historical invoice prices come from the documents, not today's product prices.
