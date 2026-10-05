# Five-pass pilot review

Owner requested five iterative reviews after the navigation/notes update is live. Status: queued until that release is verified live. Each pass records evidence and fixes; external provider and physical-device qualification remain explicit. No CI, PR or merge authorized.

1. **Navigation and orientation:** guest/customer/staff entry points, breadcrumbs, back/forward/reload, mobile layout, keyboard focus. Fix broken paths and misleading state.
2. **Customer purchasing:** approved product discovery, pricing presentation, cart/quote/order, invoices and reports. Compare visible flows with implemented permissions and specifications; exercise synthetic mutations locally.
3. **Administration:** customers, catalog/media/availability, cost and approval policies, shipping and reports, timestamped notes. Check task grouping, empty/error states and small-screen operation.
4. **Permissions and recovery:** tenant/site/customer isolation, stale sessions, independent approval, uncertain writes and retries. Run targeted fault cases, inspect underlying facts, repair confirmed gaps.
5. **Integrated polish:** revisit the corrected journeys, responsive/keyboard/accessibility checks, startup and health, final source/deployment identity. Publish a concise remaining-dependencies list with evidence limits.

## Findings and results

Not yet started. Pre-release findings and checks belong to the navigation/notes release receipt; they do not count as these five post-release passes.
