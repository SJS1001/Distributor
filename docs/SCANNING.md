# Scanning and saved receipt drafts

2026-09-30. Bounded local implementation; D-014/D-017 and all product gates remain NOT VERIFIED. No physical camera, scanner, printer or label has been qualified. See the [local receipt](evidence/LOCAL-SCAN-DRAFTS-2026-09-30.md).

## Receive equipment

1. In Purchasing, choose **Start receipt draft** on a purchase order. Select the pending line and enter its supplier delivery reference, observed SKU, quantity, receiving bin and inspection/quarantine choice. Enter serials one per line for serialized products; bulk products have no serials.
2. **Save draft** stores the evidence on the server. A serialized draft may contain fewer scans than its quantity. Saving creates no stock, reservation, purchase receipt or change to the PO's received quantity.
3. Reload and choose **Resume scans** to continue saved evidence. The purchase line and delivery reference are immutable. Changes require the current version; stale edits require reloading. Each saved version retains its input and actor.
4. **Review and receive** displays the saved evidence. **Receive stock** rechecks current permission/site, exact purchase-line SKU, remaining PO quantity and one unique new serial per unit. It creates stock at the PO's original unit cost, updates PO quantities and marks the draft received in one transaction. Quarantine stock remains unavailable for ordering.
5. **View draft history** displays retained versions. **Discard draft** requires a reason, retains the evidence and changes no stock. A discarded or received draft cannot be edited. Its purchase-line/delivery reference remains reserved to that evidence; a corrected new delivery needs a new reference.

Authorized warehouse staff act only at granted sites; administrators include these grants. Commercial/finance can inspect organization drafts and histories. Buyer and unrelated organization/site access is denied. Retry receipts still require current authority. Failed late writes roll back receipt, stock, PO totals and draft state together. The owning purchasing module reloads the active persisted principal, role and site grants and refuses a required password change before draft reads, saves, confirmations, discards and cached retry results. A previously received/discarded draft does not bypass these checks. Supplied actor roles/site lists cannot restore revoked grants. See [purchasing authorization evidence](evidence/LOCAL-PURCHASING-AUTHORITY-2026-10-02.md).

Limits: 500 serialized units/scans or 100,000 bulk units per draft, positive whole quantities within current PO remainder, nonempty SKU/bin/reference, trimmed unique serials. Existing serials anywhere in the organization's inventory history are rejected. Drafts do not reserve identities or remaining quantity; another receipt can make a saved draft stale. Confirmation performs final validation.

Retiring a product from customer ordering leaves existing purchase commitments receivable through saved or new drafts. It does not reactivate the product or create a separate supplier discontinuation policy. See [local retired-product receiving evidence](evidence/LOCAL-RETIRED-RECEIVING-2026-10-02.md).

Saving requires connectivity. Unsaved form input is lost when the dialog is closed or page reloaded; no offline persistence or background synchronization is implemented. Retry an interrupted save/confirmation with the unchanged form and retained command key. A lost success response must not produce a second receipt. After closing/reloading, inspect the saved draft and history before continuing; a confirmed draft returns its permanent result only for the original pre-confirmation version.

## Camera and hardware input

Scan-enabled SKU/serial fields accept ordinary typing and keyboard-wedge scanners. Single-value inputs ignore an Enter suffix as form submission; a serial textarea uses Enter for the next serial. Actual scanner pairing, firmware and suffix behavior need device qualification.

**Scan with camera** explicitly requests video permission. A compatible browser must support native BarcodeDetector, secure context and getUserMedia. Supported formats are the browser's intersection with Code 128, Code 39, QR, Data Matrix, EAN-13/EAN-8 and UPC-A/UPC-E. Unsupported browsers or denied/failed access retain manual entry. Native BarcodeDetector has limited availability; see [MDN's API reference](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector) and [camera permission requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

Show one label. Different simultaneous labels require another attempt. A detected value is a candidate: inspect it and choose **Use detected value** before it enters the form. Detection performs no stock command. Duplicate serial candidates are not appended to the list; the server also validates duplicates. No GS1 interpretation, automatic product substitution or printer command is provided.

The camera stops after a valid candidate, on **Stop camera**, dialog close, page exit/background or disabled form. A permission response arriving after cancellation immediately releases its tracks. Preview images stay in the browser and are neither uploaded nor saved. Media tracks are stopped and the preview detached, following [MediaStreamTrack cleanup](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/stop).

Selected serial fields in stock lookup, picking, transfers, recovery, transit loss, supplier return and warranty receipt share this input control. Those commands retain their existing validation and confirmation. Durable scan drafts currently apply only to purchase receiving. Quantity counts and other workflows do not gain offline drafts.

## Current inventory authority

Inventory warehouse/stock/serial/transfer reads, mapped warehouse lookup and warehouse creation, inspection, transfer dispatch/arrival/loss/recovery now reload active persisted identity and check required password changes. Roles and grants supplied by the caller cannot increase access. Command checks happen inside the immediate transaction before cached results or stock effects. A completed dispatch retry requires the current grant to its original source, even after the serial arrives elsewhere; an arrival retry requires its original destination. Actual warehouse users retain site-filtered stock and trace access, while authorized staff can see destination names for transfer selection. See [local inventory authority evidence](evidence/LOCAL-INVENTORY-AUTHORITY-2026-10-02.md).

These checks do not qualify internal task-shaped APIs, all module boundaries or production security. Lists remain unbounded and do not form one coherent dashboard/authority snapshot. Previously saved receipts retain their original verification scope.

## Required qualification

Use existing approved devices to record exact model/firmware, OS/browser version, symbology, label size/material and actual reads. Exercise denied permissions, no camera, low light/damaged labels, duplicate/wrong-task scans, suffix behavior, cancellation and connectivity failures with warehouse operators. Confirm camera release on real mobile backgrounding. Physical label printing/readability, large draft queries, production upgrades, physical custody, approved serial policy and any offline requirements remain pending. The [provider/device plan](PROVIDERS.md) lists candidates without qualifying them.

## Prepared stock QR labels

Authorized staff use **Inventory → Prepare QR label** on physically held stock. Review the full identity, select PDF or an explicit Zebra ZPL resolution, select one to twenty copies (including deliberate duplicates) and choose **Prepare and download**. Each PDF page is 100 × 50 mm and contains the complete SKU and, for serialized equipment, the complete serial. QR bytes contain the exact serial, or the SKU for bulk stock. Case and Unicode remain unchanged; unsupported characters or text that cannot fit reject preparation instead of shortening identity. No address, price, bin, condition or mutable quantity is printed.

Open the downloaded PDF and print at actual size using an already approved printer. Confirm paper/media dimensions, margins, quiet zone and a successful independent sample scan before attaching labels. Preparation records a **prepared** request; it does not prove download completion, physical printing, unique copies or warehouse acceptance. This candidate provides no printer driver, GS1 conversion or printer acknowledgment.

Current roles/site grants and stock revision are checked before cached retries and again after asynchronous rendering. Bytes and their SHA-256 are stored with one permanent request receipt. A lost response retains the browser retry key for the same stock version, copy count and output profile; changing copies or profile makes a separate request. Password-change restrictions apply to preparation and history, including cached bytes. Reload changed stock before generating a new label. Prepared history is restricted by current site grants and limited to the latest 200 requests. Labels change no stock or movements. See [local QR label evidence](evidence/LOCAL-STOCK-LABELS-2026-10-01.md) for synthetic checks and remaining qualification.


## Zebra ZPL stock identity export

Select **Zebra ZPL — 203 dpi / 8 dots per mm** or **Zebra ZPL — 300 dpi / 12 dots per mm** only after reviewing the actual printer head. Nominal marketing dpi does not replace the physical dot density: profiles use exactly 800 × 400 or 1200 × 600 dots for 100 × 50 mm. The [Zebra length reference](https://docs.zebra.com/content/tcm/us/en/printers/software/zpl-pg/zpl-commands/%5Ell.html) specifies physical dot-density conversion. This does not qualify a printer model, firmware or third-party ZPL emulator.

The original full-identity PDF is rendered locally to a monochrome graphic. Text and QR are included together, preserving Unicode without reliance on printer fonts. Each deliberately selected copy is a separate complete format with quantity one. The graphic uses uncompressed uppercase hexadecimal bytes, within [Zebra's graphic-field limits](https://docs.zebra.com/content/tcm/us/en/printers/software/zpl-pg/zpl-commands/%5Egf.html). Customer strings never enter the printer command stream. No uploaded document or external rendering service is used.

The downloaded `Stock_<unit-id>_zpl-8.zpl` or `_zpl-12.zpl` is a prepared file, not a printer job. Use an already approved tool to transfer it only to a qualified ZPL-mode printer with standard command prefixes, adequate print width/memory and calibrated 100 × 50 mm media. Verify gap/mark/continuous media behavior: the length command normally controls continuous stock, while calibrated noncontinuous media determines physical label length. The format sets width, length, origin, zero offsets and normal orientation/reverse state; these can affect subsequent printer formats until changed or power-cycled. It supplies no media sensing, calibration, heat/speed or persistent-save command. Review those settings through the approved printer procedure and independently scan a sample before attaching labels. No printer send, device receipt or physical readability has been verified.

ZPL bytes, full facts/output/density, renderer fingerprint and SHA-256 are retained by inventory with the prepared receipt. Exact retries survive application restart. Profile/copy changes under the same command key are refused. The browser requires the expected filename, media type, hash and receipt, rejects empty or oversized files (4,000,000-byte bound), and keeps its retry key after a failure. Original PDF command/facts identity remains compatible with historical retries. Prepared history shows the selected output; no stock or movement is changed. See [local ZPL evidence](evidence/LOCAL-STOCK-ZPL-2026-10-01.md) for actual synthetic scope and limitations.
