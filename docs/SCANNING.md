# Scanning and saved receipt drafts

2026-09-30. Bounded local implementation; D-014/D-017 and all product gates remain NOT VERIFIED. No physical camera, scanner, printer or label has been qualified. See the [local receipt](evidence/LOCAL-SCAN-DRAFTS-2026-09-30.md).

## Receive equipment

1. In Purchasing, choose **Start receipt draft** on a purchase order. Select the pending line and enter its supplier delivery reference, observed SKU, quantity, receiving bin and inspection/quarantine choice. Enter serials one per line for serialized products; bulk products have no serials.
2. **Save draft** stores the evidence on the server. A serialized draft may contain fewer scans than its quantity. Saving creates no stock, reservation, purchase receipt or change to the PO's received quantity.
3. Reload and choose **Resume scans** to continue saved evidence. The purchase line and delivery reference are immutable. Changes require the current version; stale edits require reloading. Each saved version retains its input and actor.
4. **Review and receive** displays the saved evidence. **Receive stock** rechecks current permission/site, exact active SKU, remaining PO quantity and one unique new serial per unit. It creates stock at the PO's original unit cost, updates PO quantities and marks the draft received in one transaction. Quarantine stock remains unavailable for ordering.
5. **View draft history** displays retained versions. **Discard draft** requires a reason, retains the evidence and changes no stock. A discarded or received draft cannot be edited. Its purchase-line/delivery reference remains reserved to that evidence; a corrected new delivery needs a new reference.

Authorized warehouse staff act only at granted sites; administrators include these grants. Commercial/finance can inspect organization drafts and histories. Buyer and unrelated organization/site access is denied. Retry receipts still require current authority. Failed late writes roll back receipt, stock, PO totals and draft state together.

Limits: 500 serialized units/scans or 100,000 bulk units per draft, positive whole quantities within current PO remainder, nonempty SKU/bin/reference, trimmed unique serials. Existing serials anywhere in the organization's inventory history are rejected. Drafts do not reserve identities or remaining quantity; another receipt can make a saved draft stale. Confirmation performs final validation.

Saving requires connectivity. Unsaved form input is lost when the dialog is closed or page reloaded; no offline persistence or background synchronization is implemented. Retry an interrupted save/confirmation with the unchanged form and retained command key. A lost success response must not produce a second receipt. After closing/reloading, inspect the saved draft and history before continuing; a confirmed draft returns its permanent result only for the original pre-confirmation version.

## Camera and hardware input

Scan-enabled SKU/serial fields accept ordinary typing and keyboard-wedge scanners. Single-value inputs ignore an Enter suffix as form submission; a serial textarea uses Enter for the next serial. Actual scanner pairing, firmware and suffix behavior need device qualification.

**Scan with camera** explicitly requests video permission. A compatible browser must support native BarcodeDetector, secure context and getUserMedia. Supported formats are the browser's intersection with Code 128, Code 39, QR, Data Matrix, EAN-13/EAN-8 and UPC-A/UPC-E. Unsupported browsers or denied/failed access retain manual entry. Native BarcodeDetector has limited availability; see [MDN's API reference](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector) and [camera permission requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

Show one label. Different simultaneous labels require another attempt. A detected value is a candidate: inspect it and choose **Use detected value** before it enters the form. Detection performs no stock command. Duplicate serial candidates are not appended to the list; the server also validates duplicates. No GS1 interpretation, automatic product substitution or printer command is provided.

The camera stops after a valid candidate, on **Stop camera**, dialog close, page exit/background or disabled form. A permission response arriving after cancellation immediately releases its tracks. Preview images stay in the browser and are neither uploaded nor saved. Media tracks are stopped and the preview detached, following [MediaStreamTrack cleanup](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/stop).

Selected serial fields in stock lookup, picking, transfers, recovery, transit loss, supplier return and warranty receipt share this input control. Those commands retain their existing validation and confirmation. Durable scan drafts currently apply only to purchase receiving. Quantity counts and other workflows do not gain offline drafts.

## Required qualification

Use existing approved devices to record exact model/firmware, OS/browser version, symbology, label size/material and actual reads. Exercise denied permissions, no camera, low light/damaged labels, duplicate/wrong-task scans, suffix behavior, cancellation and connectivity failures with warehouse operators. Confirm camera release on real mobile backgrounding. Label generation/printing, large draft queries, production upgrades, physical custody, approved serial policy and any offline requirements remain pending. The [provider/device plan](PROVIDERS.md) lists candidates without qualifying them.
