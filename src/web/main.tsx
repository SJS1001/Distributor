import {
  useSupplierReturnQueue,
  SupplierReturnQueueControls,
} from "./supplier-return-queue.tsx";
import { useStockQueue, StockQueueControls } from "./stock-queue.tsx";
import { StockHistory } from "./stock-history.tsx";
import { BinRelocation, type BinSelection } from "./bin-relocation.tsx";
import { ReplacementSerialSelect } from "./replacement-serial-select.tsx";
import { useInvoiceQueue, InvoiceQueueControls } from "./invoice-queue.tsx";
import { usePurchaseQueue, PurchaseQueueControls } from "./purchase-queue.tsx";
import { PurchaseEntry } from "./purchase-entry.tsx";
import { SupplierAvailability } from "./supplier-availability.tsx";
import { useOrderQueue, OrderQueueControls } from "./order-queue.tsx";
import { useClaimQueue, ClaimQueueControls } from "./claim-queue.tsx";
import { ClaimSerialReview, RetainedClaimCoverage } from "./claim-coverage.tsx";
import type { WarrantyCoverage } from "../shared/warranty-coverage.ts";
import type {
  CustomerProductPage,
  OrderEntry,
} from "../shared/customer-products.ts";
import { CartQuantities } from "./cart-quantities.tsx";
import { UnavailableCartItems } from "./unavailable-cart-items.tsx";
import { SavedCarts } from "./saved-carts.tsx";
import {
  CartSaveRecovery,
  cartRecoveryKey,
  saveReviewedCart,
  type CartSaveReview,
} from "./cart-save-recovery.tsx";
import React, { useEffect, useState, useRef } from "react";
import { providerChoices, providerNames } from "../shared/provider-choices.ts";
import { createRoot } from "react-dom/client";
import {
  command,
  request,
  RequestError,
  setCsrf,
  downloadDocument,
  downloadStockLabel,
  downloadInboxDocument,
} from "./api.ts";
import { CanadaPostWarehouse } from "./canada-post.tsx";
import { CarrierBooking } from "./carrier-booking.tsx";
import { CheckoutAction } from "./checkout-action.tsx";
import { AccountingCosts } from "./accounting-costs.tsx";
import { AccountingBalanceReview } from "./accounting-balance.tsx";
import { BillingInbox } from "./billing-inbox.tsx";
import { RefundPaymentSelect } from "./refund-payment-select.tsx";
import { CashPayments } from "./cash-payments.tsx";
import { CashRefunds } from "./cash-refunds.tsx";
import { RefundNotices } from "./refund-notices.tsx";
import { EventReporting } from "./event-reporting.tsx";
import { DisclosureReview } from "./provider-disclosures.tsx";
import { ProviderHistory } from "./provider-history.tsx";
import { OrderAmendments } from "./order-amendments.tsx";
import { OrderReservations, ReservationStatus } from "./order-reservations.tsx";
import { SupplierReturnHistory } from "./supplier-return-history.tsx";
import { ReconciliationPanel } from "./reconciliation.tsx";
import { OperationsHealthPanel } from "./operations-health.tsx";
import { AuditHistory } from "./audit-history.tsx";
import { RequiredMfa } from "./required-mfa.tsx";
import { MfaSecurity } from "./mfa-security.tsx";
import { SerialCustody } from "./serial-custody.tsx";
import { WarrantyEvidence } from "./warranty-evidence.tsx";
import { WarrantyDecisions } from "./warranty-decisions.tsx";
import { SoldCoverage } from "./warranty-coverage.tsx";
import { SoldSerialSelect } from "./sold-serial-select.tsx";
import { stockLabelOutputs } from "../shared/stock-label.ts";
import {
  shipmentQueueStates,
  type ShipmentQueueState,
} from "../shared/shipment-queue.ts";
import {
  QuickBooksCallback,
  QuickBooksConnection,
} from "./quickbooks-authorization.tsx";
import type { SoldSerial } from "../shared/sold-serials.ts";
import { Modal, type Dialog, type Field } from "./modal.tsx";
import {
  CatalogMaintenance,
  CatalogHistoryRows,
} from "./catalog-maintenance.tsx";
import type {
  CatalogReview,
  CatalogLifecycleRecord,
  CatalogLifecyclePage,
} from "../shared/catalog-lifecycle.ts";
import "./style.css";
type Item = Record<string, any>;
const money = (value: number, currency = "CAD") =>
  new Intl.NumberFormat("en", { style: "currency", currency }).format(
    value / 100,
  );
const purchaseLineName = (line: Item) =>
  `${line.product_sku} · ${line.product_name}${line.product_active === 0 ? " · retired from customer ordering" : ""}`;
function App() {
  const [actor, setActor] = useState<Item | null>(null),
    [data, setData] = useState<Item | null>(null),
    [page, setPage] = useState("Overview"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [dialog, setDialog] = useState<Dialog | null>(null),
    [extra, setExtra] = useState<Item>({});
  const claimQueue = useClaimQueue(
    data?.claims,
    data?.claimNext,
    page === "Returns" && !!actor && !busy,
  );
  const orderQueue = useOrderQueue(
    data?.orders,
    data?.orderNext,
    page === "Orders" && !!actor && !busy,
  );
  const invoiceQueue = useInvoiceQueue(
    data?.invoices,
    data?.invoiceNext,
    page === "Billing" && !!actor && !busy,
  );
  const stockQueue = useStockQueue(
    data?.stock,
    data?.stockNext,
    page === "Inventory" && !!actor && !busy,
  );
  const purchaseQueue = usePurchaseQueue(
    extra.purchases?.orders,
    extra.purchases?.orderNext,
    page === "Purchasing" && !!actor && !busy,
  );
  const supplierReturnQueue = useSupplierReturnQueue(
    extra.purchases?.returns,
    extra.purchases?.returnNext,
    page === "Purchasing" && !!actor && !busy,
  );
  const [passwordChangeRequired, setPasswordChangeRequired] = useState(false);
  const [stockHistory, setStockHistory] = useState<{
    unitId?: string;
    serial?: string;
  } | null>(null);
  const stockHistoryOpener = useRef<HTMLElement | null>(null);
  const [binSelection, setBinSelection] = useState<BinSelection | null>(null);
  const [purchaseEntryOpen, setPurchaseEntryOpen] = useState(false);
  const [mfaEnrollmentRequired, setMfaEnrollmentRequired] = useState(false);
  const [evidenceClaim, setEvidenceClaim] = useState<string | null>(null);
  const [decisionClaim, setDecisionClaim] = useState<string | null>(null);
  const decisionOpener = useRef<HTMLElement | null>(null);
  const [coverageOpen, setCoverageOpen] = useState(false);
  const coverageOpener = useRef<HTMLElement | null>(null);
  const [providerHistoryAccount, setProviderHistoryAccount] = useState<
    string | null
  >(null);
  const providerHistoryOpener = useRef<HTMLElement | null>(null);
  const [supplierHistoryId, setSupplierHistoryId] = useState<string | null>(
    null,
  );
  const supplierHistoryOpener = useRef<HTMLElement | null>(null);
  const [amendmentOrderId, setAmendmentOrderId] = useState<string | null>(null);
  const amendmentOpener = useRef<HTMLElement | null>(null);
  const [reservationOrderId, setReservationOrderId] = useState<string | null>(
    null,
  );
  const reservationOpener = useRef<HTMLElement | null>(null);
  const evidenceOpener = useRef<HTMLElement | null>(null);
  const [carrierShipmentId, setCarrierShipmentId] = useState<string | null>(
    null,
  );
  const [carrierReplacementId, setCarrierReplacementId] = useState<
    string | null
  >(null);
  const carrierOpener = useRef<HTMLElement | null>(null);
  const [canadaPostWarehouse, setCanadaPostWarehouse] = useState<string | null>(
    null,
  );
  const canadaPostOpener = useRef<HTMLElement | null>(null);
  const shipmentEpoch = useRef(0);
  const dashboardEpoch = useRef(0);
  const orderEntryRead = useRef<AbortController | null>(null);
  const cartEditorEpoch = useRef(0);
  const stopOrderEntryRead = () => {
    cartEditorEpoch.current++;
    orderEntryRead.current?.abort();
    orderEntryRead.current = null;
  };
  const [eventViewEpoch, setEventViewEpoch] = useState(0);
  const shipmentRequest = useRef<number | null>(null);
  const shipmentHeading = useRef<HTMLHeadingElement | null>(null);
  const [shipmentsLoading, setShipmentsLoading] = useState(false);
  const [shipmentFilter, setShipmentFilter] = useState<ShipmentQueueState | "">(
    "",
  );
  const [shipmentFilterReady, setShipmentFilterReady] = useState(true);
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [loginCode, setLoginCode] = useState(""),
    [mfaRequired, setMfaRequired] = useState(false);
  const refresh = async () => {
    setStockHistory(null);
    setBinSelection(null);
    stockHistoryOpener.current = null;
    setPurchaseEntryOpen(false);
    stopOrderEntryRead();
    orderQueue.stop();
    purchaseQueue.stop();
    supplierReturnQueue.stop();
    invoiceQueue.stop();
    stockQueue.stop();
    claimQueue.stop();
    setDialog((current) =>
      [
        "Serial history",
        "Request return or warranty review",
        "Approve replacement reservation",
      ].includes(current?.title ?? "")
        ? null
        : current,
    );
    setCoverageOpen(false);
    coverageOpener.current = null;
    setDecisionClaim(null);
    decisionOpener.current = null;
    setExtra((current) => ({
      ...current,
      refunds: undefined,
      payments: undefined,
    }));
    setCarrierShipmentId(null);
    setCarrierReplacementId(null);
    setCanadaPostWarehouse(null);
    canadaPostOpener.current = null;
    carrierOpener.current = null;
    setReservationOrderId(null);
    reservationOpener.current = null;
    setAmendmentOrderId(null);
    amendmentOpener.current = null;
    const epoch = ++shipmentEpoch.current;
    const dashboardVersion = ++dashboardEpoch.current;
    shipmentRequest.current = null;
    setShipmentsLoading(false);
    setShipmentFilterReady(false);
    const d = await request("/api/dashboard");
    if (dashboardEpoch.current !== dashboardVersion) return;
    setData((current) =>
      shipmentEpoch.current === epoch
        ? d
        : {
            ...d,
            shipments: current?.shipments ?? [],
            shipmentNext: current?.shipmentNext ?? null,
          },
    );
    if (shipmentEpoch.current === epoch) {
      setShipmentFilter("");
      setShipmentFilterReady(true);
    }
    setEventViewEpoch((value) => value + 1);
    const e: Item = {};
    if (
      ["admin", "commercial", "warehouse", "finance"].includes(
        actor?.role ?? "",
      )
    )
      e.purchases = await request("/api/purchases");
    if (actor?.role === "admin")
      e.coveragePolicy = await request("/api/warranty/coverage-policy");
    if (["admin", "commercial", "buyer"].includes(actor?.role ?? "")) {
      e.carts = await request("/api/carts/page");
      e.cartRefresh = crypto.randomUUID();
    }
    if (["admin", "warehouse", "support"].includes(actor?.role ?? "")) {
      e.transfers = await request("/api/transfers");
      e.transferDestinations = await request("/api/transfer-destinations");
      e.counts = await request("/api/counts");
      e.countReviewPolicy = await request("/api/count-review-policy");
      if (["admin", "warehouse"].includes(actor?.role ?? ""))
        e.labels = await request("/api/stock/labels");
    }
    if (
      ["admin", "finance", "commercial", "buyer", "support"].includes(
        actor?.role ?? "",
      )
    )
      e.effects = await request("/api/effects");
    if (["admin", "finance", "support"].includes(actor?.role ?? ""))
      e.callbacks = await request("/api/provider-callbacks");
    if (["admin", "finance", "support"].includes(actor?.role ?? "")) {
      e.payments = await request("/api/billing/payments/page");
      e.paymentRefresh = crypto.randomUUID();
      e.refunds = await request("/api/billing/refunds/page");
      e.refundRefresh = crypto.randomUUID();
    }
    if (["admin", "finance", "support", "buyer"].includes(actor?.role ?? "")) {
      e.refundNotices = await request("/api/billing/refund-notices");
      e.refundNoticeRefresh = crypto.randomUUID();
    }
    if (
      ["admin", "warehouse", "finance", "support"].includes(actor?.role ?? "")
    ) {
      e.serialReviews = await request("/api/stock/serial-reviews");
      e.serialReviewRefresh = crypto.randomUUID();
    }
    if (actor?.role === "admin") {
      e.users = await request("/api/users");
      e.openingImports = await request("/api/imports/opening");
      e.masterImports = await request("/api/imports/masters");
      e.documentImports = await request("/api/imports/documents");
    }
    if (
      [
        "admin",
        "finance",
        "commercial",
        "buyer",
        "warranty",
        "support",
      ].includes(actor?.role ?? "")
    ) {
      e.credits = await request("/api/credits");
      e.aging = await request("/api/billing/aging");
      e.downloads = await request("/api/billing/downloads");
      e.inbox = await request("/api/billing/inbox/page");
      e.inboxRefresh = crypto.randomUUID();
    }
    if (["admin", "finance"].includes(actor?.role ?? ""))
      e.billingProfiles = await request("/api/billing/profiles");
    e.security = await request("/api/security");
    if (dashboardEpoch.current === dashboardVersion) setExtra(e);
  };
  const loadShipments = async (
    state = shipmentFilter,
    first = !shipmentFilterReady,
  ) => {
    if (
      !data ||
      (!first && !data.shipmentNext) ||
      shipmentRequest.current !== null
    )
      return;
    const epoch = shipmentEpoch.current,
      after = first ? null : data.shipmentNext;
    shipmentRequest.current = epoch;
    setShipmentsLoading(true);
    setError("");
    try {
      const query = new URLSearchParams();
      if (after) query.set("after", after);
      if (state) query.set("state", state);
      const result = await request(`/api/shipments/page?${query}`);
      if (shipmentEpoch.current !== epoch) return;
      setData((current) =>
        current &&
        shipmentEpoch.current === epoch &&
        (first || current.shipmentNext === after)
          ? {
              ...current,
              shipments: first
                ? result.items
                : [
                    ...current.shipments,
                    ...result.items.filter(
                      (s: Item) =>
                        !current.shipments.some((old: Item) => old.id === s.id),
                    ),
                  ],
              shipmentNext: result.next,
            }
          : current,
      );
      setShipmentFilterReady(true);
      if (!first && !result.next) shipmentHeading.current?.focus();
    } catch (e) {
      if (shipmentEpoch.current === epoch) setError((e as Error).message);
    } finally {
      if (shipmentEpoch.current === epoch) {
        shipmentRequest.current = null;
        setShipmentsLoading(false);
      }
    }
  };
  const filterShipments = (state: ShipmentQueueState | "") => {
    ++shipmentEpoch.current;
    shipmentRequest.current = null;
    setShipmentFilter(state);
    setShipmentFilterReady(false);
    setData((current) =>
      current ? { ...current, shipments: [], shipmentNext: null } : current,
    );
    setCarrierShipmentId(null);
    void loadShipments(state, true);
  };
  useEffect(() => {
    void request("/api/session")
      .then((s) => {
        setCsrf(s.csrf);
        setPasswordChangeRequired(s.passwordChangeRequired);
        setMfaEnrollmentRequired(s.mfaEnrollmentRequired);
        setActor(s.actor);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (actor && !passwordChangeRequired && !mfaEnrollmentRequired)
      void refresh().catch((e) => setError(e.message));
  }, [actor, passwordChangeRequired, mfaEnrollmentRequired]);
  const clearSession = (message = "") => {
    setPurchaseEntryOpen(false);
    stopOrderEntryRead();
    orderQueue.stop();
    purchaseQueue.stop();
    supplierReturnQueue.stop();
    invoiceQueue.stop();
    stockQueue.stop();
    claimQueue.stop();
    setCoverageOpen(false);
    coverageOpener.current = null;
    setDecisionClaim(null);
    decisionOpener.current = null;
    setCarrierShipmentId(null);
    setCarrierReplacementId(null);
    setCanadaPostWarehouse(null);
    canadaPostOpener.current = null;
    carrierOpener.current = null;
    shipmentEpoch.current++;
    dashboardEpoch.current++;
    shipmentRequest.current = null;
    setShipmentsLoading(false);
    setEvidenceClaim(null);
    setProviderHistoryAccount(null);
    setSupplierHistoryId(null);
    setStockHistory(null);
    setBinSelection(null);
    stockHistoryOpener.current = null;
    setReservationOrderId(null);
    reservationOpener.current = null;
    setAmendmentOrderId(null);
    amendmentOpener.current = null;
    supplierHistoryOpener.current = null;
    providerHistoryOpener.current = null;
    evidenceOpener.current = null;
    setActor(null);
    setData(null);
    setExtra({});
    setDialog(null);
    setPage("Overview");
    setPasswordChangeRequired(false);
    setMfaEnrollmentRequired(false);
    setPassword("");
    setLoginCode("");
    setMfaRequired(false);
    setNotice(message);
    setError("");
    setCsrf("");
    sessionStorage.clear();
  };
  const signOut = () => {
    setStockHistory(null);
    setBinSelection(null);
    stockHistoryOpener.current = null;
    setPurchaseEntryOpen(false);
    stopCatalogRead();
    stopOrderEntryRead();
    orderQueue.stop();
    purchaseQueue.stop();
    supplierReturnQueue.stop();
    invoiceQueue.stop();
    stockQueue.stop();
    claimQueue.stop();
    setDialog((current) =>
      [
        "Request return or warranty review",
        "Approve replacement reservation",
        "Prepare an order",
        "Edit order quantities",
        "Review and accept order",
      ].includes(current?.title ?? "")
        ? null
        : current,
    );
    setCoverageOpen(false);
    coverageOpener.current = null;
    setDecisionClaim(null);
    decisionOpener.current = null;
    setCarrierShipmentId(null);
    setCarrierReplacementId(null);
    setCanadaPostWarehouse(null);
    canadaPostOpener.current = null;
    carrierOpener.current = null;
    void request("/api/logout", { method: "POST" })
      .catch(() => {})
      .finally(() => clearSession());
  };
  const run = async (work: () => Promise<unknown>, refreshAfter = true) => {
    setBusy(true);
    setError("");
    try {
      const result = await work();
      if ((result as Item)?.sessionEnded) {
        clearSession("Saved. Your sessions have ended. Sign in again.");
        return result;
      }
      if ((result as Item)?.skipRefresh) return result;
      if (refreshAfter) await refresh();
      setNotice("Saved.");
      return result;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  };
  const open = (
    title: string,
    fields: Field[],
    perform: Dialog["perform"],
    description?: React.ReactNode,
    submitLabel?: string,
  ) => {
    setNotice("");
    setError("");
    setDialog({ title, fields, perform, description, submitLabel });
  };
  const options = (items: Item[], label: (i: Item) => string) =>
    (items ?? []).map((i) => ({ value: String(i.id), label: label(i) }));
  const reason: Field = {
    name: "reason",
    label: "Reason / evidence",
    type: "textarea",
  };
  const select = (
    name: string,
    label: string,
    items: Item[],
    display: (i: Item) => string,
    value?: string,
  ): Field => ({ name, label, options: options(items, display), value });
  const simple = (
    title: string,
    fields: Field[],
    name: string,
    transform: (v: Item) => unknown = (v) => v,
  ) => open(title, fields, (v) => command(name, transform(v)));
  const catalogRead = useRef<AbortController | null>(null);
  const stopCatalogRead = () => {
    catalogRead.current?.abort();
    catalogRead.current = null;
  };
  const reviewProductActivity = (productId: string, active: boolean) => {
    stopCatalogRead();
    const controller = new AbortController();
    catalogRead.current = controller;
    void run(async () => {
      const review = await request<CatalogReview>(
        `/api/catalog/products/${encodeURIComponent(productId)}/review`,
        { signal: controller.signal },
      ).catch((e) => {
        if (controller.signal.aborted) return null;
        throw e;
      });
      if (!review || controller.signal.aborted) return { skipRefresh: true };
      if (review.product.active === Number(active))
        throw Error("Product status changed; refresh the catalog.");
      open(
        active ? "Review product reactivation" : "Review product retirement",
        [reason],
        (v) =>
          command(active ? "product.reactivate" : "product.retire", {
            productId,
            expectedHash: review.expectedHash,
            reason: v.reason,
          }),
        <>
          <p>
            {review.product.sku} · {review.product.name} · Base price{" "}
            {money(review.product.unit_price, review.product.currency)} · Tax{" "}
            {review.product.tax_bp / 100}% ·{" "}
            {review.product.serialized
              ? "Serial tracking required"
              : "Bulk product"}
            .
          </p>
          <p>
            {active
              ? "Reactivation makes this product available for new customer quotes and order acceptance using its current prices and tax. Existing tier prices remain in place."
              : "Retirement removes this product from new customer selection and refuses new quotes and order acceptance. Stock, purchase commitments, accepted orders, invoice snapshots and warranty history remain. Retained saved carts require explicit removal review."}
          </p>
          <p>
            After a lost response, submit the same reason again to recover the
            original request. If this review becomes stale, cancel and reopen
            it.
          </p>
        </>,
        active ? "Reactivate product" : "Retire product",
      );
    }, false).catch(() => {});
  };
  const showCatalogHistory = async (
    productId: string,
    loaded: CatalogLifecycleRecord[] = [],
    after?: string,
  ) => {
    stopCatalogRead();
    const controller = new AbortController();
    catalogRead.current = controller;
    const result = await request<CatalogLifecyclePage>(
      `/api/catalog/products/${encodeURIComponent(productId)}/history${after ? `?after=${encodeURIComponent(after)}` : ""}`,
      { signal: controller.signal },
    ).catch((e) => {
      if (controller.signal.aborted) return null;
      throw e;
    });
    if (!result || controller.signal.aborted) return { skipRefresh: true };
    const items = [...loaded, ...result.items];
    open(
      "Product lifecycle history",
      [],
      async () => {
        if (!result.next) return { skipRefresh: true };
        await showCatalogHistory(productId, items, result.next);
        return { keepDialog: true, skipRefresh: true };
      },
      <CatalogHistoryRows items={items} />,
      result.next ? "Load older lifecycle changes" : "Close history",
    );
  };
  const supplierFields: Field[] = [
    { name: "reference", label: "Supplier follow-up reference (unique)" },
    {
      name: "evidence",
      label: "Supplier outcome / review evidence",
      type: "textarea",
      help: "Record the supplier document or physical receipt evidence and any reviewed differences.",
    },
  ];
  const supplierCommand = (
    r: Item,
    title: string,
    fields: Field[],
    name: string,
    details: Item = {},
  ) =>
    simple(title, [...fields, ...supplierFields], name, (v) => ({
      ...v,
      ...details,
      returnId: r.id,
      revision: r.followup.revision,
    }));
  const showShipmentDelivery = async (
    shipmentId: string,
    loaded: Item[] = [],
    after?: number,
  ) => {
    const result = await request(
        `/api/shipments/${shipmentId}/delivery/history${after ? `?after=${after}` : ""}`,
      ),
      rows = [...loaded, ...result.items];
    open(
      "Shipment delivery history",
      [],
      async () => {
        if (!result.next) return;
        await showShipmentDelivery(shipmentId, rows, result.next);
        return { keepDialog: true };
      },
      rows.length
        ? rows
            .map(
              (h: Item) =>
                `v${h.revision} · ${h.state} · ${h.observedAt}${h.reference ? ` · ${h.reference}: ${h.evidence}` : ""}`,
            )
            .join("\n\n")
        : "No delivery observations recorded. Handover remains recorded on the shipment.",
      result.next ? "Load more delivery observations" : "Close",
    );
  };
  const showReplacementShipping = async (
    replacementId: string,
    loaded: Item[] = [],
    after?: number,
  ) => {
    const result = await request(
      `/api/warranty/replacements/${replacementId}/shipping/history${after ? `?after=${after}` : ""}`,
    );
    const rows = [...loaded, ...result.items];
    open(
      "Replacement shipping history",
      [],
      async () => {
        if (!result.next) return;
        await showReplacementShipping(replacementId, rows, result.next);
        return { keepDialog: true };
      },
      rows
        .map(
          (h: Item) =>
            `v${h.revision} · ${h.state} · ${h.observedAt}${h.reference ? ` · ${h.reference}: ${h.evidence}` : ""}`,
        )
        .join("\n\n"),
      result.next ? "Load more shipping observations" : "Close",
    );
  };
  const showShortPicks = async (
    orderId: string,
    loaded: Item[] = [],
    after?: string,
  ) => {
    const result = await request(
        `/api/orders/${orderId}/short-picks${after ? `?after=${encodeURIComponent(after)}` : ""}`,
      ),
      reports = [...loaded, ...result.items];
    open(
      "Short-pick reports",
      [],
      async () => {
        if (!result.nextCursor) return;
        await showShortPicks(orderId, reports, result.nextCursor);
        return { keepDialog: true };
      },
      reports.length
        ? `${reports.length} reports loaded.\n${reports.map((r: Item) => `${r.created_at} · ${r.quantity} units · held stock ${r.held_unit_id} · ${r.reason}`).join("\n")}`
        : "No short picks have been reported for this order.",
      result.nextCursor ? "Load more reports" : "Close",
    );
  };
  const queueAccountingInvoice = (invoice: Item) =>
    open(
      "Queue QuickBooks invoice",
      [
        { name: "customerRef", label: "QuickBooks customer ID" },
        ...invoice.lines.map((l: Item) => ({
          name: `item-${l.product_id}`,
          label: `QuickBooks item ID · ${l.description}`,
        })),
        { name: "taxCodeRef", label: "QuickBooks tax code ID" },
        { name: "taxRateRef", label: "QuickBooks tax rate ID" },
      ],
      (v) =>
        command("quickbooks.invoice", {
          invoiceId: invoice.id,
          customerRef: v.customerRef,
          itemRefs: Object.fromEntries(
            invoice.lines.map((l: Item) => [
              l.product_id,
              v[`item-${l.product_id}`],
            ]),
          ),
          taxCodeRef: v.taxCodeRef,
          taxRateRef: v.taxRateRef,
        }),
      `Queue ${invoice.number} for ${money(invoice.total, invoice.currency)} using verified company mappings. Customer permission is required. Sending is a separate action; uncertain outcomes require reconciliation.`,
      "Queue invoice",
    );
  const receiptDraft = (po: Item, draft?: Item) => {
    const saved = draft?.input;
    open(
      draft ? "Resume receipt scans" : "Start receipt draft",
      [
        ...(draft
          ? []
          : [
              select(
                "lineId",
                "Purchase line",
                po.lines.filter((l: Item) => l.received < l.quantity),
                (l) =>
                  `${purchaseLineName(l)} · ${l.quantity - l.received} remaining`,
              ),
              { name: "deliveryRef", label: "Supplier delivery reference" },
            ]),
        {
          name: "observedSku",
          label: "Observed SKU on delivery",
          value: saved?.observedSku ?? "",
          scan: "single",
        },
        {
          name: "quantity",
          label: "Units",
          type: "number",
          min: 1,
          value: saved?.quantity ?? 1,
        },
        {
          name: "serials",
          label: "Serials, one per line (blank for bulk)",
          type: "textarea",
          optional: true,
          value: saved?.serials.join("\n") ?? "",
          scan: "lines",
        },
        { name: "bin", label: "Receiving bin", value: saved?.bin ?? "" },
        {
          name: "quarantine",
          label: "Requires inspection / quarantine",
          type: "checkbox",
          value: saved?.quarantine ?? true,
        },
      ],
      (v) =>
        command("purchase.draft.save", {
          ...v,
          draftId: draft?.id ?? null,
          revision: draft?.revision ?? 0,
          poId: po.id,
          lineId: saved?.lineId ?? v.lineId,
          deliveryRef: saved?.deliveryRef ?? v.deliveryRef,
          serials: v.serials
            .split(/\r?\n/)
            .map((serial: string) => serial.trim())
            .filter(Boolean),
        }),
      "Save incomplete scans to resume later. Stock changes only after Review and receive. Unsaved changes stay in this dialog; saving requires a connection.",
      "Save draft",
    );
  };
  const staff = actor?.role !== "buyer",
    admin = actor?.role === "admin",
    can = (...roles: string[]) => admin || roles.includes(actor?.role ?? "");
  const currency = data?.organization.currency ?? "CAD";
  const productName = (pid: string, description?: string) =>
    data?.products.find((p: Item) => p.id === pid)?.sku ?? description ?? pid;
  const warehouseName = (wid: string) =>
    data?.warehouses.find((w: Item) => w.id === wid)?.name ?? "Warehouse";
  const accountName = (aid: string) =>
    data?.accounts.find((a: Item) => a.id === aid)?.name ?? "Account";
  const publishDocument = (
    kind: "invoice" | "credit",
    documentId: string,
    number: string,
    accountId: string,
  ) => {
    void run(() => downloadDocument(kind, documentId))
      .then((downloadId) => {
        if (typeof downloadId !== "string" || !downloadId)
          throw new Error(
            "Reviewed download receipt is missing. Retry the PDF.",
          );
        open(
          "Publish reviewed PDF",
          [reason],
          (v) =>
            command("billing.portal.publish", { downloadId, reason: v.reason }),
          `Review the downloaded ${number} PDF for ${accountName(accountId)} before publishing it to this customer's inbox. Publication makes it available; the buyer must separately confirm receipt.`,
          "Publish to customer inbox",
        );
      })
      .catch(() => {});
  };
  const receiveDocument = (publication: Item) => {
    void run(() => downloadInboxDocument(publication.id))
      .then((downloadId) => {
        if (typeof downloadId !== "string" || !downloadId)
          throw new Error("Download receipt is missing. Retry the PDF.");
        if (
          publication.acknowledgments.some(
            (a: Item) => a.actor_id === actor?.id,
          )
        )
          return;
        open(
          "Confirm document receipt",
          [],
          () =>
            command("billing.portal.acknowledge", {
              publicationId: publication.id,
              downloadId,
              contentHash: publication.content_hash,
              confirmation: "received",
            }),
          `After checking the downloaded ${publication.number} PDF, confirm receipt for ${accountName(publication.account_id)}. This does not confirm payment or agreement with its contents.`,
          "Confirm receipt",
        );
      })
      .catch(() => {});
  };
  const reviewCart = async (cart: Item, current: () => boolean) => {
    if (!current()) return { keepDialog: true, skipRefresh: true };
    const quote = await command("cart.quote", {
      cartId: cart.id,
      revision: cart.revision,
    });
    if (!current()) return { keepDialog: true, skipRefresh: true };
    open(
      "Review and accept order",
      [
        {
          name: "allowBackorder",
          label: "Accept any unavailable units as backorders",
          type: "checkbox",
          value: false,
        },
      ],
      (v) =>
        command("order.accept", {
          quoteId: quote.id,
          allowBackorder: !!v.allowBackorder,
        }),
      `${quote.lines.map((l: Item) => `${l.quantity} × ${l.description} ${money(l.unitPrice, quote.currency)} + ${money(l.unitTax, quote.currency)} tax per unit`).join("\n")}\nTotal: ${money(quote.total, quote.currency)}. Quote valid for 15 minutes.`,
    );
    return { keepDialog: true };
  };
  const editCart = (
    accountId: string,
    warehouseId: string,
    catalogPage: CustomerProductPage,
    entry: OrderEntry,
  ) => {
    const editorVersion = cartEditorEpoch.current;
    const current = () => cartEditorEpoch.current === editorVersion;
    const old = entry.cart;
    const unavailableIds = new Set(
      entry.products
        .filter((product) => product.active !== 1)
        .map((product) => product.id),
    );
    const unavailableLines = (old?.lines ?? []).filter((line) =>
      unavailableIds.has(line.productId),
    );
    let revision = old?.revision ?? 0;
    let savedCart: Item | undefined;
    let savedLines: string | undefined;
    let pendingReview: CartSaveReview | undefined;
    let pendingSave:
      | {
          accountId: string;
          warehouseId: string;
          revision: number;
          lines: { productId: string; quantity: number }[];
        }
      | undefined;
    const finishSave = async () => {
      if (!pendingSave) return;
      // Recover the exact attempt before saving changed quantities. The command
      // key survives a lost response; never assume that a failed response means
      // the original save did not commit.
      try {
        savedCart = await saveReviewedCart(
          cartRecoveryKey(actor!.orgId, actor!.id),
          pendingSave,
          pendingReview,
        );
      } catch (error) {
        // A definite refusal can be corrected. A transport/server failure or
        // timeout retains the exact pending attempt for safe recovery.
        if (
          error instanceof RequestError &&
          ["VALIDATION", "REVISION"].includes(error.code ?? "")
        )
          pendingSave = undefined;
        throw error;
      }
      revision = savedCart!.revision;
      savedLines = JSON.stringify(pendingSave.lines);
      pendingSave = undefined;
    };
    const fields: Field[] = [
      {
        name: "basket",
        label: "Order quantities",
        content: (
          <CartQuantities
            accountId={accountId}
            initial={catalogPage}
            selected={entry.products}
            lines={old?.lines ?? []}
          />
        ),
      },
    ];
    if (unavailableLines.length)
      fields.push({
        name: "unavailableRemoval",
        label: "Review unavailable saved items",
        content: (
          <UnavailableCartItems
            products={entry.products}
            lines={unavailableLines}
          />
        ),
      });
    open(
      "Edit order quantities",
      fields,
      async (v) => {
        if (unavailableLines.length) {
          const removal = JSON.parse(v.unavailableRemoval) as string[];
          if (
            !Array.isArray(removal) ||
            new Set(removal).size !== unavailableLines.length ||
            !unavailableLines.every((line) => removal.includes(line.productId))
          )
            throw new Error(
              "Review removal of unavailable saved items before continuing.",
            );
        }
        const reviewedLines = JSON.parse(v.basket) as {
          productId: string;
          quantity: number;
          sku: string;
          name: string;
        }[];
        const lines = reviewedLines.map(({ productId, quantity }) => ({
          productId,
          quantity,
        }));
        await finishSave();
        if (!current()) return { keepDialog: true, skipRefresh: true };
        if (!savedCart || savedLines !== JSON.stringify(lines)) {
          pendingSave = { accountId, warehouseId, revision, lines };
          pendingReview = {
            account: accountName(accountId),
            warehouse: warehouseName(warehouseId),
            products: reviewedLines.map(({ productId, sku, name }) => ({
              id: productId,
              sku,
              name,
            })),
          };
          await finishSave();
        }
        // Quote retries reuse the observed saved revision rather than writing
        // again. A new native quote still refuses another session's newer cart.
        return reviewCart(savedCart!, current);
      },
      "Set the quantity for each product. Zero removes a product. Review the current price and total in the quote before accepting. Saved quantities are loaded before editing. If saving or quoting loses its response, retry to recover the saved attempt. If another session changes this cart, cancel and reopen it to review the latest quantities.",
    );
  };
  const placeOrder = (
    accountId?: string,
    warehouseId?: string,
    _existing?: Item[],
  ) =>
    open(
      "Prepare an order",
      [
        select(
          "accountId",
          "Customer",
          data!.accounts,
          (a) => a.name,
          accountId,
        ),
        select(
          "warehouseId",
          "Warehouse",
          data!.warehouses,
          (w) => w.name,
          warehouseId,
        ),
      ],
      async (v) => {
        stopOrderEntryRead();
        const controller = new AbortController();
        orderEntryRead.current = controller;
        try {
          const [entry, products] = await Promise.all([
            request<OrderEntry>(
              `/api/carts/selection?accountId=${encodeURIComponent(v.accountId)}&warehouseId=${encodeURIComponent(v.warehouseId)}`,
              { signal: controller.signal },
            ),
            request<CustomerProductPage>(
              `/api/catalog/customer-products/page?accountId=${encodeURIComponent(v.accountId)}`,
              { signal: controller.signal },
            ),
          ]);
          if (
            !controller.signal.aborted &&
            orderEntryRead.current === controller
          )
            editCart(v.accountId, v.warehouseId, products, entry);
          return { keepDialog: true, skipRefresh: true };
        } catch (error) {
          if (
            controller.signal.aborted ||
            orderEntryRead.current !== controller
          )
            return { keepDialog: true, skipRefresh: true };
          throw error;
        } finally {
          if (orderEntryRead.current === controller)
            orderEntryRead.current = null;
          controller.abort();
        }
      },
    );
  const table = (
    columns: string[],
    rows: Item[],
    cells: (row: Item) => React.ReactNode[],
    empty = "No records yet.",
  ) =>
    rows?.length ? (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, index) => (
              <tr key={r.id ?? index}>
                {cells(r).map((cell, i) => (
                  <td key={i}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <div className="empty">{empty}</div>
    );
  const button = (label: string, action: () => void, unavailable = false) => (
    <button
      className="secondary"
      disabled={busy || unavailable}
      onClick={action}
    >
      {label}
    </button>
  );
  if (!actor)
    return (
      <main className="login">
        <div className="brand">
          D<span>Distributor</span>
        </div>
        <h1>Sign in to your workspace</h1>
        <p>Orders, warehouses and customer accounts in one place.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const s = await request("/api/login", {
                method: "POST",
                body: JSON.stringify({
                  email,
                  password,
                  ...(mfaRequired ? { code: loginCode } : {}),
                }),
              });
              setCsrf(s.csrf);
              setPasswordChangeRequired(s.passwordChangeRequired);
              setMfaEnrollmentRequired(s.mfaEnrollmentRequired);
              setActor(s.actor);
              setPassword("");
              setLoginCode("");
              setMfaRequired(false);
            } catch (e) {
              if ((e as Error).message.includes("(MFA_REQUIRED)"))
                setMfaRequired(true);
              else setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {mfaRequired && (
            <label>
              Authenticator or recovery code
              <input
                autoComplete="one-time-code"
                spellCheck={false}
                value={loginCode}
                onChange={(e) => setLoginCode(e.target.value)}
                maxLength={64}
                required
                autoFocus
              />
            </label>
          )}
          {mfaRequired && (
            <p>
              Enter the six-digit code from your authenticator app, or an unused
              saved recovery code.
            </p>
          )}
          {notice && (
            <p role="status" className="notice">
              {notice}
            </p>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
      </main>
    );
  if (passwordChangeRequired)
    return (
      <main className="login">
        <h1>Change initial password</h1>
        <p>
          {actor.name}, choose a new password before entering the workspace.
          This ends all your sessions.
        </p>
        <PasswordChangeForm
          busy={busy}
          submit={(values) =>
            run(() => command("user.password.change", values))
          }
        />
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="secondary" onClick={signOut}>
          Back to sign in
        </button>
      </main>
    );
  if (mfaEnrollmentRequired)
    return <RequiredMfa sessionEnded={clearSession} signOut={signOut} />;
  if (!data)
    return (
      <main className="login">
        <p role="status">Loading your workspace…</p>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  const pages = staff
    ? [
        "Overview",
        "Orders",
        "Inventory",
        "Purchasing",
        "Catalog",
        "Billing",
        "Returns",
        "Customers",
        "Security",
        ...(can("support")
          ? ["Operations health", "Audit history", "Event reporting"]
          : []),
        ...(can("finance") ? ["Reconciliation"] : []),
        ...(admin ? ["Imports", "Administration"] : []),
      ]
    : ["Overview", "Orders", "Billing", "Returns", "Customers", "Security"];
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          D<span>Distributor</span>
        </div>
        <p className="workspace">{data.organization.name}</p>
        <nav aria-label="Workspace">
          {pages.map((p) => (
            <button
              key={p}
              aria-current={page === p ? "page" : undefined}
              onClick={() => {
                stopOrderEntryRead();
                stopCatalogRead();
                orderQueue.stop();
                purchaseQueue.stop();
                supplierReturnQueue.stop();
                invoiceQueue.stop();
                stockQueue.stop();
                claimQueue.stop();
                setPage(p);
                setStockHistory(null);
                setBinSelection(null);
                stockHistoryOpener.current = null;
                setPurchaseEntryOpen(false);
                setDialog((current) =>
                  [
                    "Serial history",
                    "Review product retirement",
                    "Review product reactivation",
                    "Product lifecycle history",
                    "Request return or warranty review",
                    "Approve replacement reservation",
                    "Prepare an order",
                    "Edit order quantities",
                    "Review and accept order",
                  ].includes(current?.title ?? "")
                    ? null
                    : current,
                );
                setCoverageOpen(false);
                coverageOpener.current = null;
                setDecisionClaim(null);
                decisionOpener.current = null;
                setCarrierShipmentId(null);
                setCarrierReplacementId(null);
                setCanadaPostWarehouse(null);
                canadaPostOpener.current = null;
                carrierOpener.current = null;
                setProviderHistoryAccount(null);
                setSupplierHistoryId(null);
                setReservationOrderId(null);
                reservationOpener.current = null;
                setAmendmentOrderId(null);
                amendmentOpener.current = null;
                setError("");
              }}
            >
              {p}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <strong>{actor.name}</strong>
          <span>
            {actor.role} · {data.organization.region}
          </span>
          <button onClick={signOut}>Sign out</button>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <p className="eyebrow">
              {staff ? "OPERATIONS" : "CUSTOMER PORTAL"}
            </p>
            <h1>{page}</h1>
          </div>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              void run(refresh, false).catch(() => {});
            }}
          >
            Refresh
          </button>
        </header>
        <div className="qualification">
          Development workspace · synthetic qualification pending · storage
          region {data.organization.region} · {currency}
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        {data.recoveryHold && (
          <p role="alert" className="notice">
            Recovery workspace: provider operations and payment links are on
            hold. An operator must reconcile this snapshot before activation.
          </p>
        )}
        {page === "Operations health" && can("support") && (
          <OperationsHealthPanel key={eventViewEpoch} />
        )}
        {page === "Reconciliation" && can("finance") && (
          <ReconciliationPanel key={eventViewEpoch} />
        )}
        {page === "Audit history" && can("support") && (
          <AuditHistory key={eventViewEpoch} />
        )}
        {page === "Event reporting" && can("support") && (
          <EventReporting
            key={eventViewEpoch}
            admin={admin}
            retry={(delivery) =>
              open(
                "Review event retry",
                [reason],
                (values) =>
                  command("events.retry", {
                    consumerId: "event-report",
                    eventId: delivery.event_id,
                    revision: delivery.revision,
                    reason: values.reason,
                  }),
                `Event ${delivery.event_id} · ${delivery.state} · failure ${delivery.last_error ?? "None"} · report version ${delivery.consumer_version}. Verify compatible report code and the original event before retrying. This queues a local report attempt and preserves history. After a lost response, submit the same reason again.`,
                "Queue reviewed retry",
              )
            }
          />
        )}
        {page === "Overview" && (
          <>
            <div className="metrics">
              {[
                ["Open orders", data.orderCounts.open],
                ["Invoice balance", money(data.invoiceSummary.due, currency)],
                [
                  "Open returns",
                  data.claims.filter(
                    (c: Item) => !["disposed", "rejected"].includes(c.state),
                  ).length,
                ],
                ...(staff
                  ? [["Available units", data.stockSummary.available]]
                  : []),
              ].map(([label, value]) => (
                <section key={String(label)}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </section>
              ))}
            </div>
            <section className="panel">
              <h2>Work queue</h2>
              {table(
                ["Customer", "Order", "Status", "Created"],
                data.orders.slice(0, 8),
                (o: Item) => [
                  accountName(o.account_id),
                  o.id.slice(0, 8),
                  o.state,
                  new Date(o.created_at).toLocaleString(),
                ],
              )}
            </section>
            <section className="panel">
              <h2>Next actions</h2>
              <div className="actions">
                {can("commercial", "buyer") &&
                  button("Prepare order", () => placeOrder())}
                {can("warehouse") &&
                  button("Review inventory", () => setPage("Inventory"))}
                {can("finance", "buyer") &&
                  button("Review invoices", () => setPage("Billing"))}
              </div>
            </section>
          </>
        )}
        {page === "Orders" && (
          <>
            {can("commercial", "buyer") && (
              <CartSaveRecovery
                key={`${actor!.orgId}:${actor!.id}`}
                scope={cartRecoveryKey(actor!.orgId, actor!.id)}
                disabled={busy || !!dialog}
                recovered={refresh}
              />
            )}
            <div className="actions">
              {can("commercial", "buyer") &&
                button("Prepare order", () => placeOrder())}
            </div>
            <OrderQueueControls queue={orderQueue} />
            {table(
              ["Customer / order", "Warehouse", "Lines", "Status", "Actions"],
              orderQueue.items,
              (o: Item) => [
                <>
                  <strong>{accountName(o.account_id)}</strong>
                  <small title={o.id}>{o.id.slice(0, 8)}</small>
                </>,
                warehouseName(o.warehouse_id),
                o.lines.map((l: Item) => (
                  <div key={l.id}>
                    {productName(l.product_id, l.description)} · {l.quantity}{" "}
                    ordered / {l.allocated} reserved / {l.shipped} shipped /{" "}
                    {l.canceled} canceled
                    {o.state === "open" &&
                      can("commercial", "buyer") &&
                      button(
                        `Amend quantity: ${productName(l.product_id, l.description)}`,
                        () =>
                          open(
                            "Amend ordered quantity",
                            [
                              {
                                name: "quantity",
                                label: "New total ordered units",
                                type: "number",
                                value: l.quantity,
                                min: Math.max(1, l.shipped + l.canceled),
                                help: `Currently ${l.quantity} ordered; minimum ${Math.max(1, l.shipped + l.canceled)} including shipped and canceled units.`,
                              },
                              {
                                name: "allowBackorder",
                                label: "Allow backorder for additional units",
                                type: "checkbox",
                              },
                              {
                                name: "reason",
                                label: "Buyer-visible reason for amendment",
                                type: "textarea",
                              },
                            ],
                            (v) =>
                              command("order.amend", {
                                orderId: o.id,
                                lineId: l.id,
                                revision: o.revision,
                                quantity: v.quantity,
                                allowBackorder: v.allowBackorder,
                                reason: v.reason,
                              }),
                            <>
                              <p>
                                {productName(l.product_id, l.description)}: the
                                quantity is the new total ordered, including
                                shipped and canceled units.
                              </p>
                              <p>
                                Accepted unit price{" "}
                                {money(l.unit_price, currency)} and unit tax{" "}
                                {money(l.unit_tax, currency)} are retained.
                                Product and warehouse stay the same.
                              </p>
                              <p>
                                Decreases remove backorder first. Picked stock
                                must be unpicked before it can be removed. The
                                reason is visible to the buyer.
                              </p>
                            </>,
                            "Save amendment",
                          ),
                      )}
                  </div>
                )),
                <div>
                  <span className="badge">{o.state}</span>
                  <ReservationStatus reservation={o.reservation} />
                </div>,
                <div className="actions">
                  {can(
                    "commercial",
                    "buyer",
                    "warehouse",
                    "finance",
                    "support",
                  ) &&
                    button("View amendment history", () => {
                      setReservationOrderId(null);
                      reservationOpener.current = null;
                      amendmentOpener.current =
                        document.activeElement as HTMLElement | null;
                      setAmendmentOrderId(o.id);
                    })}
                  {can(
                    "commercial",
                    "buyer",
                    "warehouse",
                    "finance",
                    "support",
                  ) &&
                    button("View reservation history", () => {
                      setAmendmentOrderId(null);
                      amendmentOpener.current = null;
                      reservationOpener.current =
                        document.activeElement as HTMLElement | null;
                      setReservationOrderId(o.id);
                    })}
                  {o.state === "open" && can("commercial") && (
                    <>
                      {button(
                        o.reservation?.expiresAt == null
                          ? "Set reservation deadline"
                          : "Renew reservation deadline",
                        () =>
                          open(
                            "Review reservation deadline",
                            [
                              {
                                name: "expiresAt",
                                label:
                                  "Future reservation deadline (local time)",
                                type: "datetime-local",
                                help: "Choose a future date and time. Allocation does not renew this deadline.",
                              },
                              {
                                name: "reason",
                                label:
                                  "Buyer-visible reason for reservation change",
                                type: "textarea",
                              },
                            ],
                            async (v) => {
                              const expiresAt = new Date(v.expiresAt).getTime();
                              if (!Number.isFinite(expiresAt))
                                throw new Error(
                                  "Choose a valid future date and time.",
                                );
                              return command("order.reservation.deadline", {
                                orderId: o.id,
                                revision: o.revision,
                                expiresAt,
                                reason: v.reason,
                              });
                            },
                            <p>
                              Review the future deadline before saving. Once
                              due, new reservations, quantity increases and new
                              picking require an explicit renewal or clearing of
                              the deadline. No stock is released until expiry is
                              reviewed. The reason is visible to the buyer.
                            </p>,
                            "Save reservation deadline",
                          ),
                      )}
                      {o.reservation?.expiresAt != null && (
                        <>
                          {button("Clear reservation deadline", () =>
                            open(
                              "Review clearing reservation deadline",
                              [
                                {
                                  name: "reason",
                                  label:
                                    "Buyer-visible reason for reservation change",
                                  type: "textarea",
                                },
                              ],
                              (v) =>
                                command("order.reservation.deadline", {
                                  orderId: o.id,
                                  revision: o.revision,
                                  expiresAt: null,
                                  reason: v.reason,
                                }),
                              <p>
                                Clearing removes the deadline and permits new
                                allocation and picking. This does not restore
                                stock already released to backorder. The reason
                                is visible to the buyer.
                              </p>,
                              "Clear reservation deadline",
                            ),
                          )}
                          {button("Expire unpicked reservations", () => {
                            if (
                              !o.reservation.overdue &&
                              o.reservation.expiresAt > Date.now()
                            ) {
                              setError(
                                "The reservation deadline is not due yet. Refresh to review its current status.",
                              );
                              return;
                            }
                            open(
                              "Review reservation expiry",
                              [
                                {
                                  name: "reason",
                                  label:
                                    "Buyer-visible reason for reservation expiry",
                                  type: "textarea",
                                },
                              ],
                              (v) =>
                                command("order.reservation.expire", {
                                  orderId: o.id,
                                  revision: o.revision,
                                  reason: v.reason,
                                }),
                              <p>
                                Release only unpicked reserved units to
                                backorder. Picked and packed stock is preserved.
                                The original ordered quantities, accepted
                                prices, tax, order total and credit exposure
                                stay intact. The deadline remains due until
                                explicitly renewed or cleared. The reason is
                                visible to the buyer.
                              </p>,
                              "Expire unpicked reservations",
                            );
                          })}
                        </>
                      )}
                    </>
                  )}
                  {o.state === "open" &&
                    can("commercial") &&
                    button("Allocate", () => {
                      void run(() =>
                        command("order.allocate", {
                          orderId: o.id,
                          revision: o.revision,
                        }),
                      ).catch(() => {});
                    })}
                  {o.state === "open" &&
                    can("commercial", "buyer") &&
                    button("Cancel units", () =>
                      simple(
                        "Cancel open units",
                        [
                          select(
                            "lineId",
                            "Order line",
                            o.lines,
                            (l) =>
                              `${productName(l.product_id, l.description)} · ${l.quantity - l.shipped - l.canceled} open`,
                          ),
                          {
                            name: "quantity",
                            label: "Units",
                            type: "number",
                            value: 1,
                          },
                          reason,
                        ],
                        "order.cancel",
                        (v) => ({ ...v, orderId: o.id, revision: o.revision }),
                      ),
                    )}
                  {o.state === "open" &&
                    can("warehouse") &&
                    button("Pick / pack", () => {
                      void request(`/api/orders/${o.id}/picks`)
                        .then((picks) =>
                          open(
                            "Confirm picked stock",
                            [
                              select(
                                "allocationId",
                                "Allocation",
                                picks.filter(
                                  (a: Item) =>
                                    a.quantity > a.consumed + a.released,
                                ),
                                (a) =>
                                  `${productName(a.product_id)} · ${a.serial ?? "bulk"} · bin ${a.bin}`,
                              ),
                              {
                                name: "serial",
                                scan: "single",
                                label: "Scan serial (leave blank for bulk)",
                                optional: true,
                              },
                              {
                                name: "unpick",
                                label: "Unpick instead",
                                type: "checkbox",
                              },
                            ],
                            (v) =>
                              command("fulfillment.pick", {
                                orderId: o.id,
                                allocationId: v.allocationId,
                                serial: v.serial || null,
                                unpick: !!v.unpick,
                              }),
                          ),
                        )
                        .catch((e) => setError(e.message));
                    })}
                  {o.state === "open" &&
                    can("warehouse") &&
                    button("Report short pick", () => {
                      void request(`/api/orders/${o.id}/picks`)
                        .then((picks) => {
                          const available = picks.filter(
                            (a: Item) =>
                              a.quantity - a.consumed - a.released - a.packed >
                              0,
                          );
                          if (!available.length) {
                            setError(
                              "No unpacked allocated units remain. Void conflicting packing first.",
                            );
                            return;
                          }
                          open(
                            "Report unavailable allocated stock",
                            [
                              select(
                                "allocationId",
                                "Short allocation",
                                available,
                                (a) =>
                                  `${productName(a.product_id)} · ${a.serial ?? "bulk"} · bin ${a.bin} · ${a.quantity - a.consumed - a.released - a.packed} unpacked`,
                              ),
                              {
                                name: "quantity",
                                label: "Unavailable units",
                                type: "number",
                                value: 1,
                              },
                              reason,
                            ],
                            (v) => {
                              const a = available.find(
                                (a: Item) => a.id === v.allocationId,
                              )!;
                              return command("fulfillment.short-pick", {
                                ...v,
                                orderId: o.id,
                                revision: o.revision,
                                unitRevision: a.unitRevision,
                              });
                            },
                            "Report only the allocated units you cannot supply. Their expected book stock is held in quarantine for a separate count or custody review. These units become backordered; reporting does not cancel or invoice them.",
                          );
                        })
                        .catch((e) => setError(e.message));
                    })}
                  {can("warehouse", "commercial", "support") &&
                    button("View short picks", () => {
                      void showShortPicks(o.id).catch((e) =>
                        setError(e.message),
                      );
                    })}
                  {o.state === "open" &&
                    can("warehouse") &&
                    button("Pack shipment", () => {
                      void request(`/api/orders/${o.id}/picks`)
                        .then((picks) => {
                          const available = picks.filter(
                            (a: Item) => a.packable > 0,
                          );
                          if (!available.length) {
                            setError(
                              "No picked units are available to pack. Pick stock or void active packing first.",
                            );
                            return;
                          }
                          open(
                            "Pack picked units",
                            [
                              {
                                name: "mode",
                                label: "Delivery method",
                                options: [
                                  {
                                    value: "collection",
                                    label: "Customer collection",
                                  },
                                  { value: "carrier", label: "Carrier" },
                                ],
                              },
                              {
                                name: "address",
                                label: "Destination / collection point",
                                type: "textarea",
                              },
                              ...available.map((a: Item): Field => ({
                                name: `pack-${a.id}`,
                                label: `${productName(a.product_id)} · ${a.serial ?? "bulk"} · bin ${a.bin} · units to pack`,
                                type: "number",
                                value: a.packable,
                                max: a.packable,
                                help: `${a.packable} available; ${a.packed} already packed. Use 0 to leave this allocation for a later shipment.`,
                              })),
                            ],
                            (v) => {
                              const lines = available
                                .map((a: Item) => ({
                                  allocationId: a.id,
                                  quantity: v[`pack-${a.id}`],
                                }))
                                .filter((l: Item) => l.quantity > 0);
                              if (!lines.length)
                                throw new Error(
                                  "Select at least one unit to pack.",
                                );
                              return command("fulfillment.pack", {
                                orderId: o.id,
                                revision: o.revision,
                                mode: v.mode,
                                address: v.address,
                                lines,
                              });
                            },
                            "Choose the picked quantities for this shipment. Remaining units stay on the order. Packing holds stock; handover creates the invoice.",
                          );
                        })
                        .catch((e) => setError(e.message));
                    })}
                </div>,
              ],
            )}
            {reservationOrderId &&
              orderQueue.items.some(
                (o: Item) => o.id === reservationOrderId,
              ) && (
                <OrderReservations
                  key={`${reservationOrderId}:${eventViewEpoch}`}
                  orderId={reservationOrderId}
                  lines={
                    orderQueue.items.find(
                      (o: Item) => o.id === reservationOrderId,
                    )!.lines
                  }
                  onClose={() => {
                    setReservationOrderId(null);
                    reservationOpener.current?.focus();
                    reservationOpener.current = null;
                  }}
                />
              )}
            {amendmentOrderId &&
              orderQueue.items.some((o: Item) => o.id === amendmentOrderId) && (
                <OrderAmendments
                  key={`${amendmentOrderId}:${eventViewEpoch}`}
                  orderId={amendmentOrderId}
                  lines={
                    orderQueue.items.find(
                      (o: Item) => o.id === amendmentOrderId,
                    )!.lines
                  }
                  currency={currency}
                  onClose={() => {
                    setAmendmentOrderId(null);
                    amendmentOpener.current?.focus();
                    amendmentOpener.current = null;
                  }}
                />
              )}
            <section aria-label="Shipment history">
              <h2 ref={shipmentHeading} tabIndex={-1}>
                Shipments
              </h2>
              <label htmlFor="shipment-status">Shipment status</label>
              <select
                id="shipment-status"
                value={shipmentFilter}
                disabled={busy}
                onChange={(e) =>
                  filterShipments(e.target.value as ShipmentQueueState | "")
                }
              >
                <option value="">All statuses</option>
                {shipmentQueueStates.map((state) => (
                  <option key={state} value={state}>
                    {state.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
              <p>
                Newest first. Loaded: {data.shipments.length}. Saved changes or
                refresh reload the newest page.
              </p>
              {shipmentFilterReady && !data.shipments.length && (
                <p role="status">No shipments match this status.</p>
              )}
              {shipmentsLoading && <p role="status">Loading shipments…</p>}
              {can("warehouse") && data.warehouses.length > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={(event) => {
                    canadaPostOpener.current = event.currentTarget;
                    setCarrierShipmentId(null);
                    setCarrierReplacementId(null);
                    setCanadaPostWarehouse(data.warehouses[0].id);
                  }}
                >
                  Review Canada Post warehouse groups
                </button>
              )}
              {canadaPostWarehouse && (
                <CanadaPostWarehouse
                  key={`${canadaPostWarehouse}:${eventViewEpoch}`}
                  warehouses={data.warehouses}
                  initialWarehouse={canadaPostWarehouse}
                  recoveryOwner={
                    actor.role === "admin"
                      ? `${actor.orgId}:${actor.id}`
                      : undefined
                  }
                  onClose={() => {
                    setCanadaPostWarehouse(null);
                    canadaPostOpener.current?.focus();
                    canadaPostOpener.current = null;
                  }}
                />
              )}
              {table(
                ["Shipment", "Destination", "Units", "Status", "Actions"],
                data.shipments,
                (s: Item) => [
                  s.id.slice(0, 8),
                  s.address,
                  s.lines.reduce(
                    (total: number, l: Item) => total + l.quantity,
                    0,
                  ),
                  `${s.state}${s.delivery ? ` · Delivery: ${s.delivery.state} · v${s.delivery.revision}` : ""}`,
                  <div className="actions">
                    {s.mode === "carrier" &&
                      ["packed", "shipped"].includes(s.state) &&
                      can("warehouse") && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={(event) => {
                            carrierOpener.current = event.currentTarget;
                            setCanadaPostWarehouse(null);
                            setCarrierShipmentId(s.id);
                          }}
                        >
                          Review carrier booking
                        </button>
                      )}
                    {s.state === "shipped" &&
                      button("View delivery history", () =>
                        showShipmentDelivery(s.id).catch((e) =>
                          setError(e.message),
                        ),
                      )}
                    {s.state === "shipped" &&
                      s.mode === "carrier" &&
                      !["delivered", "returned"].includes(s.delivery?.state) &&
                      can("warehouse", "commercial") &&
                      button("Record delivery outcome", () =>
                        open(
                          "Record shipment delivery outcome",
                          [
                            {
                              name: "state",
                              label: "Delivery outcome",
                              options: [
                                { value: "in_transit", label: "In transit" },
                                { value: "delayed", label: "Delayed" },
                                { value: "lost", label: "Lost" },
                                {
                                  value: "returned",
                                  label: "Returned to sender",
                                },
                                { value: "delivered", label: "Delivered" },
                              ],
                              value: "in_transit",
                            },
                            {
                              name: "observedAt",
                              label: "Observed time (UTC ISO)",
                              value: new Date().toISOString(),
                            },
                            {
                              name: "reference",
                              label: "Delivery evidence reference",
                            },
                            {
                              name: "evidence",
                              label: "Delivery observation",
                              type: "textarea",
                            },
                          ],
                          (v) =>
                            command("fulfillment.delivery.update", {
                              ...v,
                              shipmentId: s.id,
                              revision: s.delivery?.revision ?? 0,
                            }),
                          "Record the carrier observation. Loss or return does not restock goods, replace equipment or create credit/refund; use a separately approved return or remedy.",
                          "Record outcome",
                        ),
                      )}
                    {s.state === "packed" &&
                      can("warehouse") &&
                      button(
                        s.mode === "collection"
                          ? "Confirm collection"
                          : "Confirm shipment",
                        () =>
                          simple(
                            "Confirm handover",
                            [
                              ...(s.mode === "carrier"
                                ? ([
                                    { name: "carrier", label: "Carrier" },
                                    {
                                      name: "tracking",
                                      label: "Tracking / consignment",
                                    },
                                  ] as Field[])
                                : []),
                              {
                                name: "handoverEvidence",
                                label: "Handover evidence",
                                type: "textarea",
                              },
                            ],
                            "fulfillment.ship",
                            (v) => ({ ...v, shipmentId: s.id }),
                          ),
                      )}
                    {s.state === "packed" &&
                      can("warehouse") &&
                      button("Void packing", () =>
                        simple(
                          "Void packed shipment",
                          [reason],
                          "fulfillment.void",
                          (v) => ({ ...v, shipmentId: s.id }),
                        ),
                      )}
                  </div>,
                ],
              )}
              {carrierShipmentId &&
                data.shipments.some(
                  (s: Item) => s.id === carrierShipmentId,
                ) && (
                  <CarrierBooking
                    key={`${carrierShipmentId}:${eventViewEpoch}`}
                    recoveryOwner={
                      actor.role === "admin"
                        ? `${actor.orgId}:${actor.id}`
                        : undefined
                    }
                    shipmentId={carrierShipmentId}
                    packedDestination={
                      data.shipments.find(
                        (s: Item) => s.id === carrierShipmentId,
                      )!.address
                    }
                    packed={
                      data.shipments.find(
                        (s: Item) => s.id === carrierShipmentId,
                      )!.state === "packed"
                    }
                    onCanadaPost={() => {
                      setCanadaPostWarehouse(
                        data.shipments.find(
                          (s: Item) => s.id === carrierShipmentId,
                        )!.warehouse_id,
                      );
                      canadaPostOpener.current = carrierOpener.current;
                      setCarrierShipmentId(null);
                      setCarrierReplacementId(null);
                    }}
                    onClose={() => {
                      setCarrierShipmentId(null);
                      setCarrierReplacementId(null);
                      setCanadaPostWarehouse(null);
                      canadaPostOpener.current = null;
                      carrierOpener.current?.focus();
                      carrierOpener.current = null;
                    }}
                  />
                )}
              {(data.shipmentNext || !shipmentFilterReady) && (
                <button
                  type="button"
                  disabled={busy || shipmentsLoading}
                  onClick={() => void loadShipments()}
                >
                  {shipmentsLoading
                    ? "Loading shipments…"
                    : shipmentFilterReady
                      ? "Load more shipments"
                      : "Retry shipment filter"}
                </button>
              )}
            </section>
            {extra.carts && (
              <SavedCarts
                key={extra.cartRefresh}
                initial={extra.carts}
                accounts={data.accounts}
                warehouses={data.warehouses}
                accountName={accountName}
                warehouseName={warehouseName}
                resume={(accountId, warehouseId) =>
                  void placeOrder(accountId, warehouseId)
                }
                disabled={busy}
              />
            )}
          </>
        )}
        {page === "Inventory" && (
          <>
            <div className="actions">
              {admin &&
                button("Add warehouse", () =>
                  simple(
                    "Add warehouse",
                    [{ name: "name", label: "Warehouse name" }],
                    "warehouse.create",
                  ),
                )}
              {button("Find serial", () => {
                stockHistoryOpener.current =
                  document.activeElement as HTMLElement;
                open(
                  "Serial history",
                  [
                    {
                      name: "serial",
                      scan: "single",
                      label: "Scan or enter serial",
                    },
                  ],
                  async (v) => {
                    setDialog(null);
                    setStockHistory({ serial: v.serial });
                    return { keepDialog: true };
                  },
                  undefined,
                  "Find movement history",
                );
              })}
            </div>
            {stockHistory && (
              <StockHistory
                key={JSON.stringify(stockHistory)}
                selection={stockHistory}
                canReviewSerial={[
                  "admin",
                  "warehouse",
                  "commercial",
                  "finance",
                  "warranty",
                ].includes(actor.role)}
                currency={data.organization.currency}
                productName={productName}
                warehouseName={warehouseName}
                onClose={() => {
                  setStockHistory(null);
                  stockHistoryOpener.current?.focus();
                }}
              />
            )}
            {can("warehouse") && (
              <BinRelocation
                key={`${actor.orgId}:${actor.id}`}
                orgId={actor.orgId}
                actorId={actor.id}
                selection={binSelection}
                close={() => setBinSelection(null)}
                saved={async () => {
                  await refresh();
                  setNotice(
                    "Bin move confirmed. Review current Inventory before further physical work.",
                  );
                }}
              />
            )}
            <StockQueueControls
              queue={stockQueue}
              products={data.products}
              warehouses={data.warehouses}
            />
            {table(
              [
                "Product / serial",
                "Warehouse / bin",
                "Condition",
                "Book quantity / reserved / available",
                "Actions",
              ],
              stockQueue.items,
              (u: Item) => [
                <>
                  <strong>{productName(u.product_id)}</strong>
                  <small>
                    {u.serial ?? "Bulk lot"} · {u.state}
                  </small>
                </>,
                `${warehouseName(u.warehouse_id)} / ${u.bin}`,
                u.condition,
                `${u.quantity} / ${u.reserved} / ${u.available}`,
                <div className="actions">
                  {button("Movement history", () => {
                    stockHistoryOpener.current =
                      document.activeElement as HTMLElement;
                    setStockHistory({ unitId: u.id });
                  })}
                  {can("warehouse") &&
                    u.state === "stock" &&
                    !u.serial &&
                    button("Start count", () =>
                      simple(
                        "Start stock count",
                        [
                          {
                            name: "countRef",
                            label: "Count reference (unique)",
                          },
                        ],
                        "count.start",
                        (v) => ({ ...v, unitId: u.id, revision: u.revision }),
                      ),
                    )}
                  {can("warehouse") &&
                    u.state === "stock" &&
                    u.quantity > 0 &&
                    button("Prepare QR label", () =>
                      open(
                        "Prepare stock QR label",
                        [
                          {
                            name: "output",
                            label: "Label output",
                            value: "pdf",
                            options: [...stockLabelOutputs],
                          },
                          {
                            name: "copies",
                            label: "Copies (including deliberate duplicates)",
                            type: "number",
                            value: 1,
                            min: 1,
                            max: 20,
                          },
                        ],
                        (v) =>
                          downloadStockLabel(
                            u.id,
                            u.revision,
                            v.copies,
                            v.output,
                          ),
                        `100 × 50 mm identity label. SKU ${data.products.find((p: Item) => p.id === u.product_id)?.sku ?? "unavailable"}; ${u.serial ? `serial ${u.serial}` : "bulk product: QR contains the SKU"}. Review the identity and copy count. Download preparation does not confirm printing. Print PDFs at actual size. For Zebra ZPL, select the printer's actual 8 or 12 dots per mm head; verify 100 × 50 mm media, ZPL mode and calibration. Transfer the file using your approved printer tool and verify a sample scan before attaching labels.`,
                        "Prepare and download",
                      ),
                    )}
                  {can("warehouse") &&
                    u.state === "stock" &&
                    u.serial &&
                    u.quantity === 1 &&
                    u.condition === "quarantine" &&
                    u.reserved === 0 &&
                    button("Report missing serial", () =>
                      open(
                        "Record missing serial evidence",
                        [
                          {
                            name: "serial",
                            label: "Expected serial on stock record",
                          },
                          {
                            name: "reviewRef",
                            label: "Custody review reference (unique)",
                          },
                          reason,
                        ],
                        (v) =>
                          command("serial.missing.report", {
                            ...v,
                            unitId: u.id,
                            revision: u.revision,
                          }),
                        `Expected serial ${u.serial} at ${warehouseName(u.warehouse_id)} / ${u.bin}. Record the physical search evidence. Submission preserves the one expected unit and its original value; administrator approval is separate.`,
                      ),
                    )}
                  {can("warehouse") &&
                    u.state === "stock" &&
                    u.quantity > 0 &&
                    u.reserved === 0 &&
                    button("Move to bin", () =>
                      setBinSelection({
                        stock: u as BinSelection["stock"],
                        product: productName(u.product_id),
                        warehouse: warehouseName(u.warehouse_id),
                      }),
                    )}
                  {can("warehouse") &&
                    u.state === "stock" &&
                    u.quantity > 0 &&
                    button("Inspect", () =>
                      simple(
                        "Inspect stock",
                        [
                          {
                            name: "condition",
                            label: "Condition",
                            options: ["usable", "quarantine", "damaged"].map(
                              (v) => ({ value: v, label: v }),
                            ),
                          },
                          reason,
                        ],
                        "stock.inspect",
                        (v) => ({ ...v, unitId: u.id, revision: u.revision }),
                      ),
                    )}
                  {can("warehouse") &&
                    u.available > 0 &&
                    button(
                      "Transfer",
                      () =>
                        simple(
                          "Dispatch transfer",
                          [
                            select(
                              "destinationId",
                              "Destination",
                              extra.transferDestinations.filter(
                                (w: Item) => w.id !== u.warehouse_id,
                              ),
                              (w) => w.name,
                            ),
                            {
                              name: "quantity",
                              label: "Units",
                              type: "number",
                              value: 1,
                              max: u.available,
                            },
                            reason,
                          ],
                          "transfer.dispatch",
                          (v) => ({ ...v, unitId: u.id, revision: u.revision }),
                        ),
                      !Array.isArray(extra.transferDestinations),
                    )}
                </div>,
              ],
            )}
            {extra.labels?.length > 0 && (
              <>
                <h2>Prepared stock labels</h2>
                <p>
                  These receipts record file preparation only. Printing and
                  attachment require physical verification.
                </p>
                {table(
                  ["SKU / serial", "Output", "Copies", "Prepared", "Receipt"],
                  extra.labels,
                  (r: Item) => [
                    `${r.facts.sku} / ${r.facts.serial ?? "bulk SKU"}`,
                    stockLabelOutputs.find(
                      (o) => o.value === (r.facts.output ?? "pdf"),
                    )?.label ?? "Unrecognized output",
                    r.copies,
                    r.requested_at,
                    r.id,
                  ],
                )}
              </>
            )}
            {extra.serialReviews && (
              <SerialCustody
                key={extra.serialReviewRefresh}
                initial={extra.serialReviews}
                warehouseName={warehouseName}
                currency={currency}
                renderActions={(r: Item) => (
                  <div className="actions">
                    {admin &&
                      r.state === "submitted" &&
                      button("Approve serial loss", () =>
                        open(
                          "Approve missing serial writeoff",
                          [reason],
                          (v) =>
                            command("serial.missing.decide", {
                              ...v,
                              reviewId: r.id,
                              decision: "approve",
                            }),
                          `${r.review_ref}: ${r.serial} expected at ${warehouseName(r.warehouse_id)} / ${r.bin}. Approval removes one expected unit and ${money(r.unit_cost, currency)} of original stock value. It does not cancel the order, credit a customer or post an accounting entry.`,
                        ),
                      )}
                    {admin &&
                      r.state === "submitted" &&
                      button("Reject serial loss", () =>
                        simple(
                          "Reject missing serial review",
                          [reason],
                          "serial.missing.decide",
                          (v) => ({ ...v, reviewId: r.id, decision: "reject" }),
                        ),
                      )}
                    {can("warehouse") &&
                      r.state === "approved" &&
                      button("Recover serial", () =>
                        open(
                          "Record found serial recovery",
                          [
                            {
                              name: "serial",
                              label: "Scan recovered serial",
                              scan: "single",
                            },
                            {
                              name: "receiptRef",
                              label: "Recovery receipt reference (unique)",
                            },
                            { name: "bin", label: "Recovered stock bin" },
                            reason,
                          ],
                          (v) =>
                            command("serial.missing.recover", {
                              ...v,
                              reviewId: r.id,
                              revision: r.currentRevision,
                            }),
                          `Scan the exact lost serial ${r.serial}. Recovery restores one unit at its original ${money(r.unit_cost, currency)} cost in ${warehouseName(r.warehouse_id)}. It remains quarantined until inspection and is not automatically reallocated.`,
                        ),
                      )}
                  </div>
                )}
              />
            )}
            {extra.countReviewPolicy && (
              <section>
                <h2>Count review policy</h2>
                <p>
                  {extra.countReviewPolicy.mode === "independent"
                    ? "Independent review: a separate administrator must approve. The count starter and observer cannot approve; direct quantity corrections are disabled."
                    : "Administrator review: an administrator may approve their own count and make direct quantity corrections."}{" "}
                  Policy version {extra.countReviewPolicy.revision}.
                </p>
                {extra.countReviewPolicy.reason && (
                  <p>{extra.countReviewPolicy.reason}</p>
                )}
                {admin &&
                  button("Configure count review", () =>
                    open(
                      "Configure count review policy",
                      [
                        {
                          name: "mode",
                          label: "Approval duties",
                          options: [
                            {
                              value: "administrator",
                              label:
                                "Administrator review (self-review allowed)",
                            },
                            {
                              value: "independent",
                              label: "Independent administrator review",
                            },
                          ],
                          value: extra.countReviewPolicy.mode,
                        },
                        reason,
                      ],
                      (v) =>
                        command("count.policy", {
                          ...v,
                          revision: extra.countReviewPolicy.revision,
                        }),
                      "This affects all new bulk count approvals in this organization immediately. Existing observations and decisions remain intact. Independent review needs an administrator other than the count starter and observer. Selecting administrator review permits self-review and direct corrections; record the operating reason.",
                    ),
                  )}
              </section>
            )}
            {extra.counts?.length > 0 && (
              <>
                <h2>Cycle counts</h2>
                <p>
                  A saved snapshot does not freeze stock. Approval checks the
                  stock revision and current reservations; a changed snapshot
                  needs a new count. Serialized discrepancies need custody
                  review.
                </p>
                {table(
                  [
                    "Reference / stock",
                    "Snapshot / observation",
                    "Status / evidence",
                    "Actions",
                  ],
                  extra.counts,
                  (c: Item) => [
                    <>
                      <strong>{c.count_ref}</strong>
                      <small>
                        {productName(c.product_id)} ·{" "}
                        {warehouseName(c.warehouse_id)} / {c.bin} ·{" "}
                        {c.condition}
                      </small>
                    </>,
                    <>
                      {c.expected_quantity} expected ·{" "}
                      {c.observed_quantity ?? "not yet"} observed
                      <small>
                        {c.delta === null
                          ? "Awaiting observation"
                          : `${c.delta > 0 ? "+" : ""}${c.delta} units · ${money(c.valueDelta, currency)} value adjustment`}{" "}
                        · cutoff {new Date(c.created_at).toLocaleString()}
                      </small>
                    </>,
                    <>
                      {c.state}
                      <small>{c.observation_reason ?? ""}</small>
                      <small>{c.decision_reason ?? ""}</small>
                      {c.result?.reviewPolicy && (
                        <small>
                          Reviewed under {c.result.reviewPolicy.mode} policy
                          version {c.result.reviewPolicy.revision}
                        </small>
                      )}
                    </>,
                    <div className="actions">
                      {c.state === "draft" &&
                        can("warehouse") &&
                        button("Record observation", () =>
                          simple(
                            "Record count observation",
                            [
                              {
                                name: "quantity",
                                label: "Physical units observed",
                                type: "number",
                                value: c.expected_quantity,
                                max: 100000,
                              },
                              reason,
                            ],
                            "count.submit",
                            (v) => ({ ...v, countId: c.id }),
                          ),
                        )}
                      {c.state === "submitted" &&
                        c.canApprove &&
                        button("Approve count", () =>
                          open(
                            "Approve stock correction",
                            [reason],
                            (v) =>
                              command("count.decide", {
                                ...v,
                                countId: c.id,
                                decision: "approve",
                                policyRevision: c.reviewPolicy.revision,
                              }),
                            `${c.count_ref}: ${c.expected_quantity} expected, ${c.observed_quantity} observed. Adjustment ${c.delta} units / ${money(c.valueDelta, currency)} at original unit cost. Approval does not post an accounting entry.`,
                          ),
                        )}
                      {c.state === "submitted" && admin && !c.canApprove && (
                        <small>
                          A different administrator must review this count.
                        </small>
                      )}
                      {["draft", "submitted"].includes(c.state) &&
                        admin &&
                        button("Reject count", () =>
                          simple(
                            "Reject stock count",
                            [reason],
                            "count.decide",
                            (v) => ({
                              ...v,
                              countId: c.id,
                              decision: "reject",
                            }),
                          ),
                        )}
                    </div>,
                  ],
                )}
              </>
            )}
            {extra.transfers && (
              <>
                <h2>Transfers</h2>
                {table(
                  ["Route", "Status", "Quantities / arrivals", "Actions"],
                  extra.transfers,
                  (t: Item) => [
                    `${t.source_name} → ${t.destination_name}`,
                    t.state,
                    <div>
                      {t.lines.map((line: Item) => (
                        <div key={line.line_id}>
                          <strong>
                            {productName(line.product_id)} ·{" "}
                            {line.serial ?? "Bulk lot"}
                          </strong>
                          <small>
                            {line.quantity} dispatched · {line.receivedQuantity}{" "}
                            received · {line.remainingQuantity} in transit
                            {line.lossQuantity > 0 && (
                              <>
                                {" "}
                                · {line.lostQuantity} unrecovered loss ·{" "}
                                {line.recoveredQuantity} recovered
                              </>
                            )}
                          </small>
                          {line.legacyReceived && (
                            <small>
                              Historical whole receipt; portion evidence
                              unavailable
                            </small>
                          )}
                          {line.receipts.map((r: Item) => (
                            <small key={r.id}>
                              {r.receipt_ref} · {r.quantity} {r.condition} ·{" "}
                              {r.bin}
                            </small>
                          ))}
                          {line.losses.map((loss: Item) => (
                            <div key={loss.id}>
                              <small>
                                {loss.loss_ref} · {loss.quantity} loss approved
                                · {loss.remainingLostQuantity} unrecovered ·{" "}
                                {loss.reason}
                              </small>
                              {loss.recoveries.map((r: Item) => (
                                <small key={r.id}>
                                  {r.receipt_ref} · {r.quantity} recovered{" "}
                                  {r.condition} · {r.bin}
                                </small>
                              ))}
                              {actor?.role === "admin" &&
                                loss.remainingLostQuantity > 0 &&
                                button("Recover lost stock", () =>
                                  simple(
                                    "Recover lost stock",
                                    [
                                      {
                                        name: "quantity",
                                        label: "Units found",
                                        type: "number",
                                        value: loss.remainingLostQuantity,
                                        max: loss.remainingLostQuantity,
                                      },
                                      {
                                        name: "serial",
                                        scan: "single",
                                        label:
                                          "Scan recovered serial (leave blank for bulk)",
                                        optional: !line.serial,
                                      },
                                      {
                                        name: "receiptRef",
                                        label:
                                          "Recovery reference (unique per portion)",
                                      },
                                      { name: "bin", label: "Destination bin" },
                                      {
                                        name: "condition",
                                        label: "Condition",
                                        value: "quarantine",
                                        options: [
                                          "usable",
                                          "quarantine",
                                          "damaged",
                                        ].map((v) => ({ value: v, label: v })),
                                      },
                                      reason,
                                    ],
                                    "transfer.recover",
                                    (v) => ({
                                      ...v,
                                      serial: v.serial || null,
                                      lossId: loss.id,
                                    }),
                                  ),
                                )}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>,
                    can("warehouse") &&
                      (actor?.role === "admin" ||
                        actor?.sites.includes(t.destination_id)) && (
                        <div className="actions">
                          {t.lines
                            .filter((line: Item) => line.remainingQuantity > 0)
                            .map((line: Item) => (
                              <React.Fragment key={line.line_id}>
                                {button("Receive transfer", () =>
                                  simple(
                                    "Receive transfer",
                                    [
                                      {
                                        name: "quantity",
                                        label: "Units arriving",
                                        type: "number",
                                        value: line.remainingQuantity,
                                        max: line.remainingQuantity,
                                      },
                                      {
                                        name: "serial",
                                        scan: "single",
                                        label:
                                          "Scan transferred serial (leave blank for bulk)",
                                        optional: !line.serial,
                                      },
                                      {
                                        name: "receiptRef",
                                        label:
                                          "Arrival reference (unique per portion)",
                                        help: "Use a distinct reference for each quantity and condition received.",
                                      },
                                      { name: "bin", label: "Destination bin" },
                                      {
                                        name: "condition",
                                        label: "Condition",
                                        options: [
                                          "usable",
                                          "quarantine",
                                          "damaged",
                                        ].map((v) => ({ value: v, label: v })),
                                      },
                                      reason,
                                    ],
                                    "transfer.receive",
                                    (v) => ({
                                      ...v,
                                      serial: v.serial || null,
                                      transferId: t.id,
                                      lineId: line.line_id,
                                    }),
                                  ),
                                )}
                                {actor?.role === "admin" &&
                                  button("Approve transit loss", () =>
                                    simple(
                                      "Approve transit loss",
                                      [
                                        {
                                          name: "quantity",
                                          label: "Missing units to write off",
                                          type: "number",
                                          value: line.remainingQuantity,
                                          max: line.remainingQuantity,
                                        },
                                        {
                                          name: "serial",
                                          scan: "single",
                                          label:
                                            "Confirm missing serial (leave blank for bulk)",
                                          optional: !line.serial,
                                        },
                                        {
                                          name: "lossRef",
                                          label:
                                            "Loss evidence reference (unique per portion)",
                                        },
                                        reason,
                                      ],
                                      "transfer.loss",
                                      (v) => ({
                                        ...v,
                                        serial: v.serial || null,
                                        transferId: t.id,
                                        lineId: line.line_id,
                                        revision: line.transitRevision,
                                      }),
                                    ),
                                  )}
                              </React.Fragment>
                            ))}
                        </div>
                      ),
                  ],
                )}
              </>
            )}
          </>
        )}
        {page === "Purchasing" && (
          <>
            <div className="actions">
              {can("commercial") &&
                button("Add supplier", () =>
                  simple(
                    "Add supplier",
                    [{ name: "name", label: "Supplier name" }],
                    "supplier.create",
                  ),
                )}
              {can("commercial") &&
                button("Purchase order", () => setPurchaseEntryOpen(true))}
            </div>
            <PurchaseQueueControls queue={purchaseQueue} />
            {table(
              ["Purchase order", "Warehouse", "Lines", "Status", "Actions"],
              purchaseQueue.items,
              (po: Item) => [
                <span title={po.id}>{po.id.slice(0, 8)}</span>,
                warehouseName(po.warehouse_id),
                po.lines.map((l: Item) => (
                  <div key={l.id}>
                    {purchaseLineName(l)} · {l.received}/{l.quantity} received
                  </div>
                )),
                po.state,
                po.state === "open" &&
                  can("warehouse") &&
                  button("Start receipt draft", () => receiptDraft(po)),
              ],
            )}
            <h2>Saved receipt scans</h2>
            <p>
              Drafts do not reserve or receive stock. Review the saved SKU,
              quantity, serials, bin and inspection choice before receiving.
            </p>
            {table(
              ["Delivery", "Warehouse / SKU", "Scans", "Status", "Actions"],
              extra.purchases?.drafts ?? [],
              (draft: Item) => [
                draft.delivery_ref,
                `${warehouseName(draft.warehouse_id)} · ${draft.input.observedSku}`,
                <div>
                  {draft.input.serials.length} scans · {draft.input.quantity}{" "}
                  units · {draft.input.bin}
                  <br />
                  {draft.input.quarantine
                    ? "Inspection required"
                    : "Available on receipt"}
                </div>,
                `${draft.state} · v${draft.revision}`,
                <div className="actions">
                  {draft.state === "draft" && can("warehouse") && (
                    <>
                      {button("Resume scans", () =>
                        // The draft already owns the exact purchase and line IDs;
                        // resuming never depends on the visible queue page.
                        receiptDraft({ id: draft.po_id }, draft),
                      )}
                      {button("Review and receive", () =>
                        open(
                          "Review physical receipt",
                          [],
                          () =>
                            command("purchase.draft.confirm", {
                              draftId: draft.id,
                              revision: draft.revision,
                            }),
                          `Delivery ${draft.delivery_ref} · ${warehouseName(draft.warehouse_id)} · SKU ${draft.input.observedSku} · ${draft.input.quantity} units · bin ${draft.input.bin} · ${draft.input.quarantine ? "inspection required" : "available stock"}. Serials: ${draft.input.serials.join(", ") || "bulk (no serials)"}. Confirm only after checking the physical delivery.`,
                          "Receive stock",
                        ),
                      )}
                      {button("Discard draft", () =>
                        simple(
                          "Discard receipt draft",
                          [reason],
                          "purchase.draft.discard",
                          (v) => ({
                            draftId: draft.id,
                            revision: draft.revision,
                            reason: v.reason,
                          }),
                        ),
                      )}
                    </>
                  )}
                  {button(
                    "View draft history",
                    () =>
                      void run(async () => {
                        const history = await request(
                          `/api/purchases/drafts/${encodeURIComponent(draft.id)}/history`,
                        );
                        open(
                          "Receipt draft history",
                          [],
                          async () => ({}),
                          history
                            .map(
                              (entry: Item) =>
                                `v${entry.revision} · ${entry.state} · ${entry.created_at} · ${entry.actor_id} · ${entry.reason} · SKU ${entry.input.observedSku} · ${entry.input.quantity} units · ${entry.input.bin} · ${entry.input.serials.join(", ") || "bulk"}`,
                            )
                            .join("\n"),
                        );
                      }),
                  )}
                </div>,
              ],
            )}
            <h2>Purchase receipts and supplier returns</h2>
            <p>
              Confirm physical handover at original stock cost. Record supplier
              credit evidence or link a separately received replacement, then
              review the outcome. Accounting reconciliation remains separate;
              the original purchase order stays received.
            </p>
            {table(
              ["Delivery", "Purchased / returned", "Held stock", "Actions"],
              extra.purchases?.receipts ?? [],
              (receipt: Item) => [
                receipt.delivery_ref,
                `${receipt.quantity} purchased · ${receipt.returnedQuantity} returned`,
                receipt.candidates.map((u: Item) => (
                  <div key={u.id}>
                    {productName(u.product_id)} ·{" "}
                    {warehouseName(u.warehouse_id)} · {u.bin} ·{" "}
                    {u.serial ?? "bulk"} · {u.quantity - u.reserved} unreserved
                    · {u.condition}
                  </div>
                )),
                actor.role === "admin" &&
                  receipt.candidates.length > 0 &&
                  receipt.returnedQuantity < receipt.quantity &&
                  button("Return to supplier", () =>
                    simple(
                      "Confirm supplier return",
                      [
                        select(
                          "unitId",
                          "Held stock lot",
                          receipt.candidates,
                          (u) =>
                            `${productName(u.product_id)} · ${warehouseName(u.warehouse_id)} · ${u.bin} · ${u.serial ?? "bulk"} · ${u.quantity - u.reserved} units`,
                        ),
                        {
                          name: "quantity",
                          label: "Units handed over",
                          type: "number",
                          value: 1,
                          min: 1,
                          max: receipt.quantity - receipt.returnedQuantity,
                        },
                        {
                          name: "serial",
                          scan: "single",
                          label: "Scan serial (blank for bulk)",
                          optional: true,
                        },
                        {
                          name: "returnRef",
                          label: "Supplier return reference (unique)",
                        },
                        {
                          name: "handoverEvidence",
                          label: "Supplier handover evidence",
                        },
                        { name: "reason", label: "Reason / evidence" },
                      ],
                      "purchase.return",
                      (v) => ({
                        ...v,
                        receiptId: receipt.id,
                        revision: receipt.candidates.find(
                          (u: Item) => u.id === v.unitId,
                        ).revision,
                        serial: v.serial || null,
                      }),
                    ),
                  ),
              ],
            )}
            <SupplierReturnQueueControls
              queue={supplierReturnQueue}
              onSearch={() => {
                setSupplierHistoryId(null);
                supplierHistoryOpener.current = null;
              }}
            />
            {table(
              [
                "Return reference",
                "Custody",
                "Quantity / original cost",
                "Evidence",
                "Financial status",
                "Follow-up actions",
              ],
              supplierReturnQueue.items,
              (r: Item) => [
                r.return_ref,
                `${warehouseName(r.warehouse_id)} · ${r.serial ?? "bulk"}`,
                `${r.quantity} units · ${money(r.quantity * r.unit_cost, data.currency)} cost`,
                `${r.reason} · ${r.handover_evidence}`,
                <div>
                  {r.followup.state === "open"
                    ? r.followup.activeCount > 0
                      ? "Supplier outcomes recorded · follow-up open"
                      : "Supplier credit pending · follow-up open"
                    : `Follow-up closed · ${r.followup.resolution}`}
                  <p>
                    {money(r.followup.creditAmount, currency)} supplier credit
                    recorded · {r.followup.replacementQuantity} replacement
                    units linked · v{r.followup.revision}
                  </p>
                  <p>External accounting reconciliation required.</p>
                </div>,
                <div className="actions">
                  {button("Supplier history", () => {
                    supplierHistoryOpener.current =
                      document.activeElement as HTMLElement;
                    setSupplierHistoryId(r.id);
                  })}
                  {can("finance") && r.followup.state === "open" && (
                    <>
                      {button("Record supplier credit", () =>
                        supplierCommand(
                          r,
                          "Record supplier credit",
                          [
                            {
                              name: "amount",
                              label: "Supplier credit amount (cents)",
                              type: "number",
                              min: 1,
                              help: "Use the supplier's stated total. This may differ from original stock cost and requires finance reconciliation.",
                            },
                          ],
                          "purchase.return.credit",
                          { currency },
                        ),
                      )}
                      {button("Link replacement receipt", () =>
                        supplierCommand(
                          r,
                          "Link received supplier replacement",
                          [
                            select(
                              "receiptId",
                              "Received replacement delivery",
                              extra.purchases.receipts.filter(
                                (p: Item) =>
                                  p.po_id !== r.po_id &&
                                  p.supplier_id === r.supplier_id &&
                                  p.product_id === r.result.productId,
                              ),
                              (p) =>
                                `${p.delivery_ref} · ${p.quantity} received`,
                            ),
                            {
                              name: "quantity",
                              label: "Replacement units linked",
                              type: "number",
                              min: 1,
                              max: r.quantity,
                              value: 1,
                            },
                          ],
                          "purchase.return.replacement",
                        ),
                      )}
                      {button("Close supplier follow-up", () =>
                        supplierCommand(
                          r,
                          "Review supplier return outcome",
                          [
                            {
                              name: "resolution",
                              label: "Reviewed resolution",
                              options: [
                                {
                                  value: "reconciled",
                                  label: "Recorded outcomes reconciled",
                                },
                                {
                                  value: "no-remedy",
                                  label: "No credit or replacement accepted",
                                },
                              ],
                              help: "Reconciled requires recorded outcomes; no remedy requires none. Review external accounting and any cost differences.",
                            },
                          ],
                          "purchase.return.review",
                          { state: "closed" },
                        ),
                      )}
                    </>
                  )}
                  {can("finance") &&
                    r.followup.state === "closed" &&
                    button("Reopen supplier follow-up", () =>
                      supplierCommand(
                        r,
                        "Reopen supplier return follow-up",
                        [],
                        "purchase.return.review",
                        { state: "open", resolution: null },
                      ),
                    )}
                </div>,
              ],
            )}
            {supplierHistoryId &&
              (() => {
                const r = supplierReturnQueue.items.find(
                  (row: Item) => row.id === supplierHistoryId,
                );
                return (
                  r && (
                    <SupplierReturnHistory
                      key={`${r.id}:${eventViewEpoch}`}
                      returnId={r.id}
                      currency={currency}
                      canCorrect={can("finance") && r.followup.state === "open"}
                      onCorrect={(observationId) =>
                        supplierCommand(
                          r,
                          "Void supplier observation",
                          [],
                          "purchase.return.void",
                          { observationId },
                        )
                      }
                      onClose={() => {
                        setSupplierHistoryId(null);
                        supplierHistoryOpener.current?.focus();
                      }}
                    />
                  )
                );
              })()}
            <SupplierAvailability
              key={`${actor.orgId}:${actor.id}`}
              orgId={actor.orgId}
              actorId={actor.id}
              canManage={can("commercial")}
            />
          </>
        )}
        {page === "Catalog" && (
          <>
            <div className="actions">
              {can("commercial") &&
                button("Add product", () =>
                  simple(
                    "Add product",
                    [
                      { name: "sku", label: "SKU" },
                      { name: "name", label: "Product name" },
                      {
                        name: "serialized",
                        label: "Track each serial",
                        type: "checkbox",
                        value: true,
                      },
                      {
                        name: "unitPrice",
                        label: "Unit price in cents",
                        type: "number",
                      },
                      {
                        name: "taxBasisPoints",
                        label: "Tax rate in basis points",
                        type: "number",
                        help: "100 basis points = 1%. Tax registrations/rules require finance approval.",
                      },
                    ],
                    "product.create",
                  ),
                )}
            </div>
            <CatalogMaintenance
              key={eventViewEpoch}
              canManage={can("commercial")}
              busy={busy}
              review={reviewProductActivity}
              history={(id) =>
                void run(() => showCatalogHistory(id), false).catch(() => {})
              }
              price={(p) =>
                simple(
                  "Set tier price",
                  [
                    { name: "tier", label: "Customer price tier" },
                    {
                      name: "unitPrice",
                      label: "Unit price in cents",
                      type: "number",
                    },
                  ],
                  "product.price",
                  (v) => ({ ...v, productId: p.id }),
                )
              }
            />
          </>
        )}
        {page === "Billing" && (
          <>
            {can("finance") && <QuickBooksConnection key={eventViewEpoch} />}
            {can("finance") && <AccountingCosts />}
            <div className="actions">
              {can("finance") && (
                <a className="button secondary" href="/api/accounting.csv">
                  Export reconciliation CSV
                </a>
              )}
            </div>
            <InvoiceQueueControls queue={invoiceQueue} />
            {table(
              ["Invoice", "Customer", "Total", "Balance", "Actions"],
              invoiceQueue.items,
              (i: Item) => [
                <>
                  <strong>{i.number}</strong>
                  <small>{new Date(i.created_at).toLocaleDateString()}</small>
                  {i.opening && (
                    <small>
                      Historical opening document · source {i.opening.source_id}
                      <br />
                      Due {new Date(i.opening.due_at).toLocaleDateString()} ·
                      cutoff {i.opening.cutoff_at}
                      <br />
                      At cutoff: {money(i.opening.credited, i.currency)}{" "}
                      credited · {money(i.opening.paid, i.currency)} paid ·{" "}
                      {money(i.opening.refunded, i.currency)} refunded
                    </small>
                  )}
                </>,
                accountName(i.account_id),
                money(i.total, i.currency),
                money(i.balance, i.currency),
                <div className="actions">
                  {can("finance") &&
                    i.balance > 0 &&
                    button("Record payment", () =>
                      simple(
                        "Record verified manual payment",
                        [
                          {
                            name: "amount",
                            label: "Amount in cents",
                            type: "number",
                            value: i.balance,
                          },
                          {
                            name: "reference",
                            label: "Bank / payment reference",
                          },
                          reason,
                        ],
                        "billing.payment.manual",
                        (v) => ({ ...v, invoiceId: i.id }),
                      ),
                    )}
                  {can("finance", "buyer") &&
                    i.balance > 0 &&
                    button("Request Stripe checkout", () => {
                      void run(() =>
                        command("stripe.checkout", { invoiceId: i.id }),
                      ).catch(() => {});
                    })}
                  {can("finance") &&
                    !i.opening &&
                    !extra.effects?.some(
                      (e: Item) =>
                        e.provider === "quickbooks" &&
                        e.kind === "invoice" &&
                        e.reference === i.id,
                    ) &&
                    button("Queue QuickBooks invoice", () =>
                      queueAccountingInvoice(i),
                    )}
                  {can("finance") &&
                    i.balance < 0 &&
                    button("Request refund", () =>
                      simple(
                        "Request credited cash refund",
                        [
                          {
                            name: "paymentId",
                            label: "Original payment",
                            content: <RefundPaymentSelect invoiceId={i.id} />,
                          },
                          {
                            name: "amount",
                            label: "Amount in cents",
                            type: "number",
                            value: -i.balance,
                          },
                          {
                            name: "reference",
                            label: "Unique refund reference",
                          },
                          reason,
                        ],
                        "billing.refund.request",
                        (v) => ({ ...v, invoiceId: i.id }),
                      ),
                    )}
                  {can("finance") &&
                    i.lines.some((l: Item) => l.creditable_quantity > 0) &&
                    button("Credit units", () =>
                      simple(
                        "Issue credit against original invoice",
                        [
                          select(
                            "lineId",
                            "Invoice line",
                            i.lines.filter(
                              (l: Item) => l.creditable_quantity > 0,
                            ),
                            (l) =>
                              `${l.description} · ${l.quantity} invoiced · ${l.credited_quantity} credited · ${l.creditable_quantity} remaining`,
                          ),
                          {
                            name: "quantity",
                            label: "Units to credit",
                            type: "number",
                            value: 1,
                          },
                          {
                            name: "reference",
                            label: "Unique business reference",
                          },
                          reason,
                        ],
                        "billing.credit",
                        (v) => ({
                          invoiceId: i.id,
                          reference: v.reference,
                          reason: v.reason,
                          lines: [{ lineId: v.lineId, quantity: v.quantity }],
                        }),
                      ),
                    )}
                  {button("Download invoice PDF", () => {
                    void run(() => downloadDocument("invoice", i.id))
                      .then(() =>
                        setNotice(
                          "PDF download prepared. Receipt does not confirm delivery.",
                        ),
                      )
                      .catch(() => {});
                  })}
                  {can("finance") &&
                    !i.hasActivePublication &&
                    button("Review and publish invoice", () =>
                      publishDocument("invoice", i.id, i.number, i.account_id),
                    )}
                </div>,
              ],
            )}
            {extra.credits?.length > 0 && (
              <>
                <h2>Credit notes</h2>
                {table(
                  [
                    "Credit",
                    "Original invoice",
                    "Total",
                    ...(can("finance") || can("support")
                      ? ["QuickBooks handoff"]
                      : []),
                    "Actions",
                  ],
                  extra.credits,
                  (c: Item) => {
                    const posted = extra.effects?.find(
                        (e: Item) =>
                          e.provider === "quickbooks" &&
                          e.kind === "credit" &&
                          e.reference === c.id,
                      ),
                      parent = extra.effects?.find(
                        (e: Item) =>
                          e.provider === "quickbooks" &&
                          e.kind === "invoice" &&
                          e.reference === c.invoice_id &&
                          e.state === "completed",
                      );
                    return [
                      c.number,
                      c.invoice_number,
                      money(c.total, c.currency),
                      ...(can("finance") || can("support")
                        ? [
                            posted ? (
                              <div className="actions">
                                <span>{posted.state}</span>
                                {posted.creditApplication && (
                                  <small>
                                    Reserved{" "}
                                    {money(
                                      posted.creditApplication.reservedAmount,
                                      currency,
                                    )}
                                    ; remaining credit{" "}
                                    {money(
                                      posted.creditApplication.availableCredit,
                                      currency,
                                    )}
                                    ; invoice capacity{" "}
                                    {money(
                                      posted.creditApplication.availableInvoice,
                                      currency,
                                    )}
                                  </small>
                                )}
                                {can("finance") &&
                                  posted.state === "completed" &&
                                  posted.creditApplication?.availableCredit >
                                    0 &&
                                  posted.creditApplication?.availableInvoice >
                                    0 &&
                                  button("Apply QuickBooks credit", () =>
                                    open(
                                      "Apply QuickBooks credit",
                                      [
                                        {
                                          name: "amount",
                                          label: "Credit application (cents)",
                                          type: "number",
                                          value: 0,
                                          min: 1,
                                          max: Math.min(
                                            posted.creditApplication
                                              .availableCredit,
                                            posted.creditApplication
                                              .availableInvoice,
                                          ),
                                        },
                                      ],
                                      (v) =>
                                        command("quickbooks.credit.apply", {
                                          creditId: c.id,
                                          amount: v.amount,
                                        }),
                                      `Apply part or all of ${c.number} to its original invoice. Review the amount; pending and unknown applications reserve capacity. This applies existing credit without repaying or charging cash.`,
                                      "Queue application",
                                    ),
                                  )}
                              </div>
                            ) : can("finance") && parent ? (
                              button("Queue QuickBooks credit", () =>
                                open(
                                  "Queue QuickBooks credit",
                                  [],
                                  () =>
                                    command("quickbooks.credit", {
                                      creditId: c.id,
                                    }),
                                  `Record ${c.number} for ${money(c.total, currency)} using the original invoice mappings. The credit stays unapplied in QuickBooks; automatic credit application must be off. Applying it to an invoice or repaying cash requires separate reconciliation.`,
                                  "Queue credit",
                                ),
                              )
                            ) : (
                              "Reconcile QuickBooks invoice first"
                            ),
                          ]
                        : []),
                      <div className="actions">
                        {button("Download credit PDF", () => {
                          void run(() => downloadDocument("credit", c.id))
                            .then(() =>
                              setNotice(
                                "PDF download prepared. Receipt does not confirm delivery.",
                              ),
                            )
                            .catch(() => {});
                        })}
                        {can("finance") &&
                          !c.hasActivePublication &&
                          button("Review and publish credit", () =>
                            publishDocument(
                              "credit",
                              c.id,
                              c.number,
                              c.account_id,
                            ),
                          )}
                      </div>,
                    ];
                  },
                )}
              </>
            )}
            {extra.refundNotices && (
              <RefundNotices
                key={extra.refundNoticeRefresh}
                initial={extra.refundNotices}
                personal={actor.role === "buyer"}
                accountName={accountName}
                renderActions={(n) =>
                  n.acknowledged
                    ? "Read by you"
                    : button("Mark notice read", () =>
                        open(
                          "Review refund notice",
                          [],
                          () =>
                            command("billing.refund.notice.acknowledge", {
                              noticeId: n.id,
                              revision: n.revision,
                            }),
                          `${n.number}: ${n.message} Marking this notice read records only your acknowledgment. It does not confirm repayment, close the refund case or send another refund. Refresh to see later status changes.`,
                          "Mark notice read",
                        ),
                      )
                }
              />
            )}
            {extra.inbox && (
              <BillingInbox
                key={extra.inboxRefresh}
                initial={extra.inbox}
                personal={actor.role === "buyer"}
                accountName={accountName}
                renderActions={(p) => (
                  <div className="actions">
                    {actor.role === "buyer" &&
                      p.state === "available" &&
                      button(
                        p.acknowledgments.some(
                          (a: Item) => a.actor_id === actor.id,
                        )
                          ? "Download received PDF"
                          : "Download and review receipt",
                        () => receiveDocument(p),
                      )}
                    {can("finance") &&
                      p.state === "available" &&
                      button("Withdraw publication", () =>
                        open(
                          "Withdraw portal publication",
                          [reason],
                          (v) =>
                            command("billing.portal.withdraw", {
                              publicationId: p.id,
                              revision: p.revision,
                              reason: v.reason,
                            }),
                          `Withdraw ${p.number} from the customer inbox. Existing copies and receipt confirmations remain. This does not cancel or change the financial document.`,
                          "Withdraw from inbox",
                        ),
                      )}
                  </div>
                )}
              />
            )}
            {extra.aging && (
              <>
                <h2>Account aging</h2>
                <p>
                  Current ledger balances · due dates use UTC calendar days.
                  Missing due dates remain unknown. Credit balances and pending
                  refunds appear separately.
                </p>
                {can("finance") && (
                  <a className="button secondary" href="/api/billing/aging.csv">
                    Export aging CSV
                  </a>
                )}
                {table(
                  [
                    "Customer",
                    "Not due",
                    "1–30 days",
                    "31–60 days",
                    "61–90 days",
                    "Over 90 days",
                    "Unknown due",
                    "Credit balance",
                    "Net",
                    "Holds / pending refunds",
                  ],
                  extra.aging.accounts,
                  (a: Item) => [
                    a.name,
                    money(a.notDue, a.currency),
                    money(a.days1to30, a.currency),
                    money(a.days31to60, a.currency),
                    money(a.days61to90, a.currency),
                    money(a.daysOver90, a.currency),
                    money(a.unknownDue, a.currency),
                    money(a.creditBalance, a.currency),
                    money(a.net, a.currency),
                    `${money(a.holds, a.currency)} / ${money(a.pendingRefunds, a.currency)}`,
                  ],
                )}
                <small>Observed {extra.aging.observedAt}</small>
              </>
            )}
            {extra.billingProfiles && (
              <>
                <h2>Billing identities and terms</h2>
                <p>
                  Changes apply to new invoices. Existing native documents
                  retain issuance details; reconstructed documents identify
                  missing historical details.
                </p>
                {table(
                  ["Party", "Address", "Tax registration", "Terms", "Actions"],
                  [
                    { ...extra.billingProfiles.issuer, accountId: null },
                    ...extra.billingProfiles.customers,
                  ],
                  (p: Item) => [
                    p.name,
                    p.address || "Not recorded",
                    p.taxRegistration || "Not recorded",
                    p.accountId === null
                      ? "Issuer"
                      : p.termDays === null
                        ? "Not recorded"
                        : `${p.termDays} calendar days`,
                    button("Edit billing details", () =>
                      open(
                        "Edit billing details",
                        [
                          {
                            name: "name",
                            label: "Billing name",
                            value: p.name,
                          },
                          {
                            name: "address",
                            label: "Billing address",
                            type: "textarea",
                            value: p.address,
                            optional: true,
                          },
                          {
                            name: "taxRegistration",
                            label: "Tax registration",
                            value: p.taxRegistration,
                            optional: true,
                          },
                          ...(p.accountId === null
                            ? []
                            : [
                                {
                                  name: "termsChoice",
                                  label: "Terms basis",
                                  value:
                                    p.termDays === null
                                      ? "unknown"
                                      : "configured",
                                  options: [
                                    { value: "unknown", label: "Not recorded" },
                                    {
                                      value: "configured",
                                      label: "Specified calendar days",
                                    },
                                  ],
                                },
                                {
                                  name: "termDays",
                                  label: "Calendar days",
                                  type: "number" as const,
                                  value: p.termDays ?? 0,
                                  min: 0,
                                  max: 365,
                                },
                              ]),
                          reason,
                        ],
                        (v) =>
                          command("billing.profile", {
                            accountId: p.accountId,
                            name: v.name,
                            address: v.address,
                            taxRegistration: v.taxRegistration,
                            termDays:
                              p.accountId === null ||
                              v.termsChoice === "unknown"
                                ? null
                                : v.termDays,
                            version: p.version,
                            reason: v.reason,
                          }),
                      ),
                    ),
                  ],
                )}
              </>
            )}
            {extra.downloads?.length > 0 && (
              <>
                <h2>Prepared document downloads</h2>
                <p>
                  These receipts record an authorized request and prepared
                  bytes. They do not establish receipt, reading or delivery to
                  the customer.
                </p>
                {table(
                  ["Document", "Requested", "Bytes", "SHA-256", "State"],
                  extra.downloads,
                  (d: Item) => [
                    d.number,
                    d.requested_at,
                    d.size,
                    <code>{d.content_hash}</code>,
                    d.state,
                  ],
                )}
              </>
            )}
            {extra.payments && (
              <CashPayments
                key={extra.paymentRefresh}
                initial={extra.payments}
                renderActions={(p) => {
                  const posted = extra.effects?.find(
                      (e: Item) =>
                        e.provider === "quickbooks" &&
                        e.kind === "payment" &&
                        e.reference === p.id,
                    ),
                    parent = extra.effects?.find(
                      (e: Item) =>
                        e.provider === "quickbooks" &&
                        e.kind === "invoice" &&
                        e.reference === p.invoice_id &&
                        e.state === "completed",
                    );
                  return posted
                    ? posted.state
                    : can("finance") && parent
                      ? button("Queue QuickBooks payment", () =>
                          open(
                            "Queue QuickBooks payment",
                            [
                              {
                                name: "appliedAmount",
                                label: "Apply to invoice (cents)",
                                type: "number",
                                value: 0,
                                min: 0,
                                max: p.amount,
                              },
                              {
                                name: "depositAccountRef",
                                label: "QuickBooks deposit account ID",
                              },
                            ],
                            (v) =>
                              command("quickbooks.payment", {
                                ...v,
                                paymentId: p.id,
                              }),
                            `Record ${money(p.amount, p.currency)} already received. Choose the amount to apply to ${p.invoiceNumber}; the remainder stays unapplied in QuickBooks. Verify the deposit account and reconcile credits/refunds separately. This records cash without charging the customer.`,
                            "Queue payment",
                          ),
                        )
                      : "Reconcile QuickBooks invoice first";
                }}
              />
            )}
            {extra.refunds && (
              <CashRefunds
                key={extra.refundRefresh}
                initial={extra.refunds}
                renderActions={(r) => (
                  <div className="actions">
                    {can("finance") &&
                      r.state === "pending" &&
                      (r.provider === "manual"
                        ? button("Verify manual refund", () =>
                            simple(
                              "Verify bank refund",
                              [
                                {
                                  name: "reference",
                                  label: "Bank refund reference",
                                },
                                reason,
                              ],
                              "billing.refund.manual",
                              (v) => ({ ...v, refundId: r.id }),
                            ),
                          )
                        : !extra.effects?.some(
                            (e: Item) =>
                              e.kind === "refund" && e.reference === r.id,
                          ) &&
                          button("Queue Stripe refund", () => {
                            void run(() =>
                              command("stripe.refund", { refundId: r.id }),
                            ).catch(() => {});
                          }))}
                    {can("finance") &&
                      (() => {
                        const expense = extra.effects?.find(
                            (e: Item) =>
                              e.provider === "quickbooks" &&
                              e.kind === "refund-expense" &&
                              e.reference === r.id,
                          ),
                          application = extra.effects?.find(
                            (e: Item) =>
                              e.provider === "quickbooks" &&
                              e.kind === "refund-application" &&
                              e.reference === r.id,
                          ),
                          credits =
                            extra.credits?.filter(
                              (c: Item) =>
                                c.invoice_id === r.invoice_id &&
                                extra.effects?.some(
                                  (e: Item) =>
                                    e.provider === "quickbooks" &&
                                    e.kind === "credit" &&
                                    e.reference === c.id &&
                                    e.state === "completed" &&
                                    e.creditApplication?.availableCredit >=
                                      r.amount,
                                ),
                            ) ?? [],
                          payment = extra.effects?.some(
                            (e: Item) =>
                              e.provider === "quickbooks" &&
                              e.kind === "payment" &&
                              e.reference === r.payment_id &&
                              e.state === "completed",
                          );
                        if (expense && r.state !== "completed")
                          return (
                            <strong role="status">
                              Accounting refund requires review: native cash is{" "}
                              {r.state}. Reconcile the existing provider
                              outcome.
                            </strong>
                          );
                        if (application)
                          return (
                            <span>
                              QuickBooks refund link: {application.state}
                            </span>
                          );
                        if (expense)
                          return expense.state === "completed" ? (
                            button("Link refund expense to credit", () =>
                              open(
                                "Link refund expense to credit",
                                [],
                                () =>
                                  command("quickbooks.refund.apply", {
                                    refundId: r.id,
                                  }),
                                "Link the reconciled expense and its reserved original credit through a zero-cash accounting payment. Review the bank, receivable account and accounting date already saved on the expense. This records the earlier cash refund.",
                                "Queue refund link",
                              ),
                            )
                          ) : (
                            <span>
                              QuickBooks refund expense: {expense.state}
                            </span>
                          );
                        if (r.state !== "completed") return null;
                        if (!payment || !credits.length)
                          return (
                            <span>
                              Reconcile the original QuickBooks payment and an
                              available credit first.
                            </span>
                          );
                        return button("Queue QuickBooks refund expense", () =>
                          open(
                            "Queue QuickBooks refund expense",
                            [
                              select(
                                "creditId",
                                "Original QuickBooks credit",
                                credits,
                                (c: Item) => c.number,
                              ),
                              {
                                name: "bankAccountRef",
                                label: "QuickBooks refund bank account ID",
                              },
                              {
                                name: "receivableAccountRef",
                                label: "QuickBooks accounts receivable ID",
                              },
                              {
                                name: "nonTaxCodeRef",
                                label: "QuickBooks non-tax expense code ID",
                              },
                              {
                                name: "expenseDate",
                                label: "Refund accounting date",
                                type: "date",
                                value: new Date().toISOString().slice(0, 10),
                              },
                            ],
                            (v) =>
                              command("quickbooks.refund", {
                                ...v,
                                refundId: r.id,
                              }),
                            `Record ${money(r.amount, r.currency)} already returned to the customer. Choose the original credit and verify the bank, receivable account, non-tax code and open accounting period. Existing credit records the sales tax; this expense records cash once. After reconciliation, link the expense to its credit.`,
                            "Queue refund expense",
                          ),
                        );
                      })()}
                  </div>
                )}
              />
            )}
            {extra.effects && (
              <>
                <h2>Provider operations</h2>
                {table(
                  ["Provider", "Status", "Result", "Actions"],
                  extra.effects,
                  (e: Item) => [
                    `${e.provider} · ${e.kind}`,
                    <>
                      {e.accountingApplication?.cancellation
                        ? "canceled"
                        : e.result?.status
                          ? `${e.state} · ${e.result.status}`
                          : e.state}
                      {e.accountingRefund && (
                        <small>
                          Native refund: {e.accountingRefund.nativeState}
                          {e.accountingRefund.requiresReview
                            ? " · Finance review required; reconcile the existing accounting outcome."
                            : " · Confirmed cash already returned"}
                        </small>
                      )}
                      {e.accountingApplication && (
                        <small>
                          {e.accountingApplication.creditNumber} to{" "}
                          {e.accountingApplication.invoiceNumber}
                          {" · "}
                          {money(
                            e.accountingApplication.amount,
                            e.accountingApplication.currency,
                          )}
                          {e.accountingApplication.cancellation && (
                            <>
                              {" · Canceled: "}
                              {e.accountingApplication.cancellation.reason}
                              {" · "}
                              {e.accountingApplication.cancellation.created_at}
                              {" · Reserved capacity released"}
                            </>
                          )}
                        </small>
                      )}
                    </>,
                    e.checkout ? (
                      <div>
                        <CheckoutAction
                          key={e.id}
                          effectId={e.id}
                          checkout={e.checkout}
                        />
                        <small>
                          {e.checkout.state === "superseded"
                            ? "Superseded checkout"
                            : "Current checkout"}
                          {" · Current invoice balance: "}
                          {money(
                            e.checkout.currentBalance,
                            e.checkout.currency,
                          )}
                        </small>
                        {e.checkout.replacementReason && (
                          <small>
                            Replacement reason: {e.checkout.replacementReason}
                          </small>
                        )}
                        {e.error && <small role="alert">{e.error}</small>}
                        {["pending", "running", "unknown"].includes(
                          e.state,
                        ) && (
                          <small>
                            {e.state === "pending"
                              ? "Awaiting explicit provider send. No new payment has been recorded."
                              : "Reconciliation required. Verify the existing provider outcome before replacing checkout."}
                          </small>
                        )}
                      </div>
                    ) : (
                      (e.error ??
                      e.external_ref ??
                      "Awaiting configured provider processing")
                    ),
                    can("finance", "support") ? (
                      <div>
                        {e.provider === "stripe" &&
                          e.kind === "checkout" &&
                          e.state === "completed" && (
                            <button
                              onClick={() =>
                                void run(() =>
                                  request(
                                    `/api/effects/${encodeURIComponent(e.id)}/refresh-checkout`,
                                    { method: "POST" },
                                  ),
                                ).catch(() => {})
                              }
                            >
                              Refresh checkout status
                            </button>
                          )}

                        {can("finance") &&
                          !actor.accountId &&
                          e.checkout?.canClose &&
                          button("Close checkout link", () =>
                            open(
                              "Close checkout link",
                              [],
                              () =>
                                request(
                                  `/api/effects/${encodeURIComponent(e.id)}/close-checkout`,
                                  { method: "POST" },
                                ),
                              `Close the ${e.checkout.invoiceNumber} checkout for ${money(e.checkout.amount, e.checkout.currency)}. The buyer will no longer be able to use the old link. This does not record a payment or prepare a replacement. If the outcome is uncertain, refresh and reconcile before continuing.`,
                              "Confirm close checkout",
                            ),
                          )}
                        {can("finance") &&
                          !actor.accountId &&
                          e.checkout?.canRenew &&
                          Number.isSafeInteger(e.checkout.currentBalance) &&
                          e.checkout.currentBalance > 0 &&
                          button("Review checkout replacement", () => {
                            const reviewed = {
                              effectId: e.id,
                              reviewVersion: e.checkout.reviewVersion,
                              amount: e.checkout.currentBalance,
                            };
                            open(
                              "Review checkout replacement",
                              [
                                {
                                  name: "reason",
                                  label:
                                    "Buyer-visible reason for checkout replacement",
                                  type: "textarea",
                                  maxLength: 1000,
                                },
                              ],
                              (values) =>
                                command("stripe.checkout.renew", {
                                  ...reviewed,
                                  reason: values.reason,
                                }),
                              <>
                                <p>Invoice {e.checkout.invoiceNumber}</p>
                                <p>
                                  Original frozen amount:{" "}
                                  {money(
                                    e.checkout.amount,
                                    e.checkout.currency,
                                  )}
                                </p>
                                <p>
                                  Reviewed replacement amount (current invoice
                                  balance):{" "}
                                  {money(reviewed.amount, e.checkout.currency)}
                                </p>
                                <p>
                                  The old checkout will be superseded. The
                                  replacement remains pending until finance
                                  explicitly sends it. This records no payment.
                                  If the balance or checkout changes, refresh
                                  and review again.
                                </p>
                              </>,
                              "Prepare replacement checkout",
                            );
                          })}

                        {can("finance") &&
                          e.provider === "quickbooks" &&
                          e.kind === "invoice" &&
                          e.state === "completed" && (
                            <AccountingBalanceReview
                              effectId={e.id}
                              latest={e.accountingBalance ?? null}
                              refresh={refresh}
                            />
                          )}
                        <div className="actions">
                          {can("finance") &&
                            e.accountingApplication?.canCancel &&
                            button("Cancel unsent credit application", () => {
                              const reviewed = {
                                effectId: e.id,
                                reviewVersion:
                                  e.accountingApplication.reviewVersion,
                                amount: e.accountingApplication.amount,
                              };
                              open(
                                "Cancel unsent credit application",
                                [
                                  {
                                    name: "reason",
                                    label: "Cancellation reason",
                                    type: "textarea",
                                    maxLength: 1000,
                                  },
                                ],
                                (values) =>
                                  command("quickbooks.credit.cancel", {
                                    ...reviewed,
                                    reason: values.reason,
                                  }),
                                `Cancel ${money(reviewed.amount, e.accountingApplication.currency)} from ${e.accountingApplication.creditNumber} to ${e.accountingApplication.invoiceNumber}. This releases its reserved accounting capacity and retains the history. The native credit, invoice and cash remain unchanged. Only a never-started application can be canceled.`,
                                "Confirm cancellation",
                              );
                            })}
                          {(e.kind !== "refund" || can("finance")) &&
                            e.state === "pending" &&
                            e.checkout?.state !== "superseded" &&
                            button("Send to provider", () => {
                              void run(() =>
                                request(`/api/effects/${e.id}/execute`, {
                                  method: "POST",
                                }),
                              ).catch(() => {});
                            })}
                          {can("finance") &&
                            e.kind === "refund" &&
                            e.state === "completed" &&
                            button("Refresh refund status", () => {
                              void run(() =>
                                request(`/api/effects/${e.id}/refresh-refund`, {
                                  method: "POST",
                                }),
                              ).catch(() => {});
                            })}
                          {(e.kind !== "refund" || can("finance")) &&
                            e.state === "unknown" &&
                            button("Check provider outcome", () => {
                              void run(() =>
                                request(`/api/effects/${e.id}/reconcile`, {
                                  method: "POST",
                                }),
                              ).catch(() => {});
                            })}
                        </div>
                      </div>
                    ) : (
                      ""
                    ),
                  ],
                )}
              </>
            )}
            {extra.callbacks?.length > 0 && (
              <>
                <h2>Payment and refund confirmations</h2>
                {table(
                  ["Event", "Operation", "Status", "Review", "Actions"],
                  extra.callbacks,
                  (c: Item) => [
                    c.event_id,
                    c.kind === "refund" ? "Refund" : "Payment",
                    c.state,
                    c.error ?? "",
                    can("finance") &&
                    ["waiting", "blocked", "failed"].includes(c.state)
                      ? button("Retry verification", () => {
                          void run(() =>
                            request(`/api/provider-callbacks/${c.id}/retry`, {
                              method: "POST",
                            }),
                          ).catch(() => {});
                        })
                      : "",
                  ],
                )}
              </>
            )}
          </>
        )}
        {page === "Returns" && (
          <>
            {admin && extra.coveragePolicy && (
              <section>
                <h2>Warranty coverage policy</h2>
                <p>
                  Policy version {extra.coveragePolicy.revision}:{" "}
                  {extra.coveragePolicy.days} whole UTC days after shipment.
                  Settings are provisional; eligibility requires review.
                </p>
                {extra.coveragePolicy.reason && (
                  <p>{extra.coveragePolicy.reason}</p>
                )}
                {button("Configure warranty coverage", () =>
                  open(
                    "Configure warranty coverage policy",
                    [
                      {
                        name: "days",
                        label: "Coverage duration in days",
                        type: "number",
                        value: extra.coveragePolicy.days,
                      },
                      reason,
                    ],
                    (v) =>
                      command("warranty.policy", {
                        ...v,
                        revision: extra.coveragePolicy.revision,
                      }),
                    "This applies to future shipments and provisional assessments of historical sales without a retained shipment policy. Previously retained shipment dates, claim snapshots and inherited replacement dates remain unchanged. Saving a duration does not approve eligibility, expiry, transferability or vendor terms.",
                  ),
                )}
              </section>
            )}

            <div className="actions">
              {can("warranty", "commercial", "buyer") &&
                button("Submit claim / return", () => {
                  let selected: SoldSerial | null = data.soldUnits[0] ?? null;
                  let reviewed: WarrantyCoverage | null = null;
                  open(
                    "Request return or warranty review",
                    [
                      {
                        name: "unitId",
                        label: "Sold serial",
                        content: (
                          <ClaimSerialReview
                            initial={{
                              items: data.soldUnits,
                              next: data.soldUnitNext,
                            }}
                            onChange={(unit, coverage) => {
                              selected = unit;
                              reviewed = coverage;
                            }}
                          />
                        ),
                      },
                      {
                        name: "type",
                        label: "Request type",
                        options: [
                          { value: "return", label: "Return" },
                          { value: "warranty", label: "Warranty" },
                        ],
                      },
                      {
                        name: "issue",
                        label: "Issue / reason",
                        type: "textarea",
                      },
                      {
                        name: "evidence",
                        label: "Evidence reference",
                        type: "textarea",
                      },
                    ],
                    (v) => {
                      if (!selected || selected.id !== v.unitId)
                        throw new Error(
                          "Select a currently loaded sold serial.",
                        );
                      if (!reviewed)
                        throw new Error(
                          "Load and review the claim coverage dates before submitting.",
                        );
                      return command("warranty.submit", {
                        ...v,
                        accountId: selected.accountId,
                        ...(reviewed.policy
                          ? { policyRevision: reviewed.policy.revision }
                          : {}),
                      });
                    },
                  );
                })}
              {can("warranty", "commercial", "buyer") && (
                <button
                  className="secondary"
                  onClick={(event) => {
                    coverageOpener.current = event.currentTarget;
                    setCoverageOpen(true);
                  }}
                >
                  Check sold serial coverage
                </button>
              )}
            </div>
            {coverageOpen && (
              <SoldCoverage
                initial={{ items: data.soldUnits, next: data.soldUnitNext }}
                onClose={() => {
                  setCoverageOpen(false);
                  coverageOpener.current?.focus();
                }}
              />
            )}
            <ClaimQueueControls queue={claimQueue} />
            {table(
              ["Claim", "Customer", "Issue", "State", "Actions"],
              claimQueue.items,
              (c: Item) => [
                c.id.slice(0, 8),
                accountName(c.account_id),
                c.issue,
                c.state,
                <div className="actions">
                  <RetainedClaimCoverage
                    key={`${c.id}:${eventViewEpoch}`}
                    claimId={c.id}
                  />

                  <button
                    className="secondary"
                    onClick={(event) => {
                      evidenceOpener.current = event.currentTarget;
                      setEvidenceClaim(c.id);
                    }}
                  >
                    Evidence files
                  </button>
                  <button
                    className="secondary"
                    onClick={(event) => {
                      decisionOpener.current = event.currentTarget;
                      setDecisionClaim(c.id);
                    }}
                  >
                    Claim activity
                  </button>
                  {c.state === "submitted" &&
                    can("warranty") &&
                    button("Review", () =>
                      simple(
                        "Review request",
                        [
                          {
                            name: "approved",
                            label: "Approve return authorization",
                            type: "checkbox",
                          },
                          reason,
                        ],
                        "warranty.review",
                        (v) => ({ ...v, claimId: c.id }),
                      ),
                    )}
                  {c.state === "approved" &&
                    can("warehouse") &&
                    button("Receive return", () =>
                      simple(
                        "Receive authorized return",
                        [
                          select(
                            "warehouseId",
                            "Warehouse",
                            data.warehouses,
                            (w) => w.name,
                          ),
                          { name: "bin", label: "Quarantine bin" },
                          {
                            name: "serial",
                            scan: "single",
                            label: "Scan returned serial",
                          },
                        ],
                        "warranty.receive",
                        (v) => ({ ...v, claimId: c.id }),
                      ),
                    )}
                  {c.type === "warranty" &&
                    ["approved", "received", "inspected", "repair"].includes(
                      c.state,
                    ) &&
                    can("warranty") &&
                    !c.manufacturerCases?.some(
                      (m: Item) => m.state === "pending",
                    ) &&
                    button("Record manufacturer referral", () =>
                      open(
                        "Record manufacturer referral",
                        [
                          { name: "manufacturer", label: "Manufacturer" },
                          {
                            name: "reference",
                            label: "Manufacturer case reference",
                          },
                          {
                            name: "evidence",
                            label: "Referral evidence reference",
                            type: "textarea",
                          },
                          reason,
                        ],
                        (v) =>
                          command("warranty.manufacturer.refer", {
                            ...v,
                            claimId: c.id,
                          }),
                        "Record a referral already arranged outside Distributor. This does not contact the manufacturer, move equipment or authorize a customer credit.",
                        "Record referral",
                      ),
                    )}
                  {c.state === "received" &&
                    can("warehouse", "warranty") &&
                    button("Inspect", () =>
                      simple(
                        "Inspect returned equipment",
                        [
                          {
                            name: "findings",
                            label: "Inspection findings",
                            type: "textarea",
                          },
                        ],
                        "warranty.inspect",
                        (v) => ({ ...v, claimId: c.id }),
                      ),
                    )}
                  {["inspected", "repair"].includes(c.state) &&
                    !c.replacements?.some(
                      (r: Item) => r.state === "reserved",
                    ) &&
                    can("warranty") &&
                    button("Disposition", () =>
                      simple(
                        "Approve stock disposition",
                        [
                          {
                            name: "disposition",
                            label: "Disposition",
                            options: ["restock", "scrap", "repair"].map(
                              (v) => ({ value: v, label: v }),
                            ),
                          },
                          reason,
                        ],
                        "warranty.disposition",
                        (v) => ({ ...v, claimId: c.id }),
                      ),
                    )}
                  {["inspected", "repair"].includes(c.state) &&
                    !c.credit_id &&
                    !c.replacements?.some(
                      (r: Item) => r.state !== "cancelled",
                    ) &&
                    can("warranty") &&
                    button("Approve replacement", () =>
                      open(
                        "Approve replacement reservation",
                        [
                          {
                            name: "newUnitId",
                            label: "Replacement serial",
                            content: (
                              <ReplacementSerialSelect
                                claimId={c.id}
                                warehouseName={warehouseName}
                              />
                            ),
                          },
                          {
                            name: "oldDisposition",
                            label: "Returned unit at handover",
                            options: [
                              { value: "scrap", label: "Scrap" },
                              {
                                value: "restock",
                                label: "Restock after inspection / repair",
                              },
                            ],
                          },
                          {
                            name: "coveragePolicy",
                            label: "Replacement coverage",
                            options: [
                              {
                                value: "inherit_original",
                                label: "Retain original coverage end date",
                              },
                            ],
                          },
                          reason,
                        ],
                        (v) =>
                          command("warranty.replacement.reserve", {
                            ...v,
                            claimId: c.id,
                          }),
                        `Reserve one serial for customer collection or carrier dispatch. The returned unit stays in quarantine until handover. Coverage ends ${c.coverage_end}. Coverage and remedy policies require business qualification.`,
                        "Reserve replacement",
                      ),
                    )}
                  {c.state === "disposed" &&
                    !c.credit_id &&
                    !c.replacements?.some(
                      (r: Item) => r.state !== "cancelled",
                    ) &&
                    can("finance") &&
                    button("Issue return credit", () =>
                      simple(
                        "Approve return credit",
                        [reason],
                        "warranty.credit",
                        (v) => ({ ...v, claimId: c.id }),
                      ),
                    )}
                </div>,
              ],
            )}
            {evidenceClaim && (
              <WarrantyEvidence
                key={evidenceClaim}
                claimId={evidenceClaim}
                role={actor.role}
                onClose={() => {
                  setEvidenceClaim(null);
                  evidenceOpener.current?.focus();
                }}
              />
            )}
            {decisionClaim && (
              <WarrantyDecisions
                key={decisionClaim}
                claimId={decisionClaim}
                buyer={actor.role === "buyer"}
                onClose={() => {
                  setDecisionClaim(null);
                  decisionOpener.current?.focus();
                }}
              />
            )}
            <section aria-label="Replacement history">
              <h2>Replacement history</h2>
              <p>
                Approved serials are held for customer collection or carrier
                dispatch. Handover records the scanned serial and recipient,
                retains original invoice and coverage, and applies the approved
                returned-unit disposition.
              </p>
              {table(
                ["Claim", "Serials / coverage", "State", "Evidence", "Actions"],
                claimQueue.items.flatMap((c: Item) =>
                  (c.replacements ?? []).map((r: Item) => ({ ...r, claim: c })),
                ),
                (r: Item) => [
                  r.claimId.slice(0, 8),
                  <>
                    {r.oldSerial} → {r.newSerial}
                    <small>
                      Coverage ends {r.coverageEnd} · returned unit:{" "}
                      {r.oldDisposition}
                    </small>
                  </>,
                  `${r.state} · v${r.revision}`,
                  <>
                    {r.shipping && (
                      <>
                        <p>
                          Carrier: {r.shipping.carrier} · Tracking:{" "}
                          {r.shipping.tracking}
                        </p>
                        <p>
                          Shipping: {r.shipping.state} · v{r.shipping.revision}
                        </p>
                        <p>Observed: {r.shipping.observedAt}</p>
                        {r.shipping.address && (
                          <p>Delivery address: {r.shipping.address}</p>
                        )}
                      </>
                    )}
                    {r.recipient && <p>Recipient: {r.recipient}</p>}
                    {r.evidence && <p>{r.evidence}</p>}
                    {(r.history ?? []).map((h: Item) => (
                      <p key={h.revision}>
                        v{h.revision} · {h.state} · {h.reason}
                      </p>
                    ))}
                  </>,
                  <div className="actions">
                    {can("warehouse") &&
                      button("Review replacement carrier booking", () => {
                        carrierOpener.current =
                          document.activeElement as HTMLElement;
                        setCarrierReplacementId(r.id);
                      })}
                    {r.state === "reserved" &&
                      can("warranty") &&
                      button("Cancel replacement", () =>
                        simple(
                          "Cancel replacement reservation",
                          [reason],
                          "warranty.replacement.cancel",
                          (v) => ({
                            ...v,
                            replacementId: r.id,
                            revision: r.revision,
                          }),
                        ),
                      )}
                    {r.shipping &&
                      button("View shipping history", () => {
                        void showReplacementShipping(r.id).catch((e) =>
                          setError(e.message),
                        );
                      })}
                    {r.shipping &&
                      r.shipping.state !== "delivered" &&
                      can("warehouse") &&
                      button("Record shipping outcome", () =>
                        open(
                          "Record replacement shipping outcome",
                          [
                            {
                              name: "state",
                              label: "Shipping outcome",
                              options: [
                                { value: "in_transit", label: "In transit" },
                                { value: "delayed", label: "Delayed" },
                                { value: "lost", label: "Reported lost" },
                                { value: "delivered", label: "Delivered" },
                              ],
                            },
                            {
                              name: "observedAt",
                              label: "Observed time (UTC ISO)",
                              value: new Date().toISOString(),
                            },
                            {
                              name: "reference",
                              label: "Shipping evidence reference",
                            },
                            {
                              name: "evidence",
                              label: "Shipping observation",
                              type: "textarea",
                            },
                          ],
                          (v) =>
                            command("warranty.replacement.shipping.update", {
                              ...v,
                              replacementId: r.id,
                              revision: r.shipping.revision,
                            }),
                          `Review the external evidence for ${r.shipping.carrier} / ${r.shipping.tracking}. A delay or reported loss leaves sold custody and the original invoice unchanged.`,
                          "Record outcome",
                        ),
                      )}
                    {r.state === "reserved" &&
                      can("warehouse") &&
                      button("Dispatch replacement", () =>
                        open(
                          "Record replacement carrier handover",
                          [
                            {
                              name: "serial",
                              label: "Scan replacement serial",
                              scan: "single",
                            },
                            { name: "recipient", label: "Delivery recipient" },
                            {
                              name: "address",
                              label: "Delivery address",
                              type: "textarea",
                            },
                            { name: "carrier", label: "Carrier name" },
                            {
                              name: "tracking",
                              label: "Carrier tracking reference",
                            },
                            {
                              name: "evidence",
                              label: "Carrier handover evidence",
                              type: "textarea",
                            },
                          ],
                          (v) =>
                            command("warranty.replacement.dispatch", {
                              ...v,
                              replacementId: r.id,
                              revision: r.revision,
                            }),
                          `${r.newSerial} replaces ${r.oldSerial} for ${accountName(r.claim.account_id)}. Confirm physical handover to the carrier; returned unit disposition: ${r.oldDisposition}.`,
                          "Record dispatch",
                        ),
                      )}
                    {r.state === "reserved" &&
                      can("warehouse") &&
                      button("Hand over replacement", () =>
                        open(
                          "Record replacement collection",
                          [
                            {
                              name: "serial",
                              label: "Scan replacement serial",
                              scan: "single",
                            },
                            {
                              name: "recipient",
                              label: "Collection recipient",
                            },
                            {
                              name: "evidence",
                              label: "Collection evidence reference",
                              type: "textarea",
                            },
                          ],
                          (v) =>
                            command("warranty.replacement.handover", {
                              ...v,
                              replacementId: r.id,
                              revision: r.revision,
                            }),
                          `${r.newSerial} replaces ${r.oldSerial}. Confirm physical collection for ${accountName(r.claim.account_id)}; returned unit disposition: ${r.oldDisposition}.`,
                          "Record handover",
                        ),
                      )}
                  </div>,
                ],
                "No replacements have been recorded.",
              )}
              {carrierReplacementId &&
                claimQueue.items
                  .flatMap((c: Item) => c.replacements ?? [])
                  .some((r: Item) => r.id === carrierReplacementId) && (
                  <CarrierBooking
                    key={`replacement:${carrierReplacementId}:${eventViewEpoch}`}
                    shipmentId={carrierReplacementId}
                    replacementId={carrierReplacementId}
                    packedDestination=""
                    packed={
                      claimQueue.items
                        .flatMap((c: Item) => c.replacements ?? [])
                        .find((r: Item) => r.id === carrierReplacementId)!
                        .state === "reserved"
                    }
                    recoveryOwner={
                      actor.role === "admin"
                        ? `${actor.orgId}:${actor.id}`
                        : undefined
                    }
                    onCanadaPost={(warehouseId) => {
                      if (!warehouseId) return;
                      orderQueue.stop();
                      purchaseQueue.stop();
                      supplierReturnQueue.stop();
                      invoiceQueue.stop();
                      stockQueue.stop();
                      claimQueue.stop();
                      setPage("Orders");
                      setCanadaPostWarehouse(warehouseId);
                      canadaPostOpener.current = null;
                      setCarrierReplacementId(null);
                      carrierOpener.current = null;
                    }}
                    onClose={() => {
                      setCarrierReplacementId(null);
                      carrierOpener.current?.focus();
                      carrierOpener.current = null;
                    }}
                  />
                )}
            </section>
            {can("warranty", "warehouse", "finance", "commercial") && (
              <section aria-label="Manufacturer case history">
                <h2>Manufacturer case history</h2>
                <p>
                  Staff record referrals and responses obtained outside
                  Distributor. Acceptance does not move equipment, approve a
                  replacement or issue a credit. Follow the separate authorized
                  return and billing tasks.
                </p>
                {table(
                  [
                    "Claim",
                    "Manufacturer / reference",
                    "State",
                    "Evidence history",
                    "Actions",
                  ],
                  claimQueue.items.flatMap((c: Item) =>
                    (c.manufacturerCases ?? []).map((m: Item) => ({
                      ...m,
                      claim: c,
                    })),
                  ),
                  (m: Item) => [
                    m.claim.id.slice(0, 8),
                    <>
                      {m.manufacturer}
                      <small>{m.reference}</small>
                    </>,
                    `${m.state} · revision ${m.revision}`,
                    m.history.map((h: Item) => (
                      <div key={h.revision}>
                        <small>
                          {h.state} · {h.created_at} · {h.actor_id}
                        </small>
                        <small>
                          {h.evidence} · {h.reason}
                        </small>
                      </div>
                    )),
                    m.state === "pending" && can("warranty")
                      ? button("Record manufacturer response", () =>
                          open(
                            "Record manufacturer response",
                            [
                              {
                                name: "outcome",
                                label: "Manufacturer outcome",
                                options: [
                                  "accepted",
                                  "denied",
                                  "cancelled",
                                ].map((v) => ({ value: v, label: v })),
                              },
                              {
                                name: "evidence",
                                label: "Response evidence reference",
                                type: "textarea",
                              },
                              reason,
                            ],
                            (v) =>
                              command("warranty.manufacturer.decide", {
                                ...v,
                                caseId: m.id,
                                revision: m.revision,
                              }),
                            `${m.manufacturer} · ${m.reference} · ${m.state}. Record the actual external response or cancellation evidence. This does not change stock, claim disposition or money.`,
                            "Record response",
                          ),
                        )
                      : "",
                  ],
                  "No manufacturer cases have been recorded.",
                )}
              </section>
            )}
          </>
        )}
        {page === "Customers" && (
          <>
            <p>
              Each processor exception allows processing outside the application
              storage region. Review the applicable terms before accepting.
              Carrier services require separate setup and qualification.
            </p>
            <div className="actions">
              {can("commercial") &&
                button("Add customer", () =>
                  simple(
                    "Add customer account",
                    [
                      { name: "name", label: "Customer name" },
                      { name: "tier", label: "Price tier", value: "standard" },
                      {
                        name: "creditLimit",
                        label: "Credit limit in cents",
                        type: "number",
                      },
                    ],
                    "account.create",
                  ),
                )}
            </div>
            {admin && (
              <section className="panel">
                <h2>Provider disclosures</h2>
                <p>
                  Publish vendor-reviewed terms before offering an exception.
                  Each new version requires renewed customer acceptance.
                  Qualification evidence must refer to the applicable contract
                  and processing locations.
                </p>
                <DisclosureReview disclosures={data.providerDisclosures} />
                {button("Publish provider disclosure", () =>
                  open(
                    "Publish provider disclosure",
                    [
                      {
                        name: "provider",
                        label: "Named provider",
                        options: providerChoices.map((p) => ({
                          value: p.id,
                          label: p.label,
                        })),
                      },
                      { name: "version", label: "New disclosure version" },
                      {
                        name: "purposes",
                        label: "Processing purposes",
                        type: "textarea",
                      },
                      {
                        name: "minimumData",
                        label: "Minimum data fields",
                        type: "textarea",
                        help: "One entry per line.",
                      },
                      {
                        name: "processingCountries",
                        label: "Processing countries",
                        help: "Comma-separated uppercase two-letter country codes.",
                      },
                      {
                        name: "subprocessors",
                        label: "Subprocessors",
                        type: "textarea",
                        optional: true,
                        help: "One named entity per line; leave empty only if reviewed terms identify none.",
                      },
                      {
                        name: "retention",
                        label: "Retention and deletion",
                        type: "textarea",
                      },
                      {
                        name: "withdrawal",
                        label: "Withdrawal consequences",
                        type: "textarea",
                      },
                      {
                        name: "termsReference",
                        label: "Terms reference",
                        type: "textarea",
                      },
                      {
                        name: "reviewEvidence",
                        label: "Vendor and business qualification evidence",
                        type: "textarea",
                      },
                    ],
                    (v) =>
                      command("provider.disclosure.publish", {
                        provider: v.provider,
                        region: data.organization.region,
                        previousDisclosureId:
                          data.providerDisclosures.find(
                            (d: Item) => d.provider === v.provider,
                          )?.id ?? null,
                        version: v.version,
                        purposes: v.purposes,
                        minimumData: v.minimumData
                          .split("\n")
                          .map((x: string) => x.trim())
                          .filter(Boolean),
                        processingCountries: v.processingCountries
                          .split(",")
                          .map((x: string) => x.trim())
                          .filter(Boolean),
                        subprocessors: v.subprocessors
                          .split("\n")
                          .map((x: string) => x.trim())
                          .filter(Boolean),
                        retention: v.retention,
                        withdrawal: v.withdrawal,
                        termsReference: v.termsReference,
                        reviewEvidence: v.reviewEvidence,
                      }),
                  ),
                )}
                {data.providerDisclosures.map((d: Item) => (
                  <div key={d.id}>
                    {button(
                      `Withdraw ${providerChoices.find((p) => p.id === d.provider)?.label} disclosure`,
                      () =>
                        open(
                          "Withdraw provider disclosure",
                          [reason],
                          (v) =>
                            command("provider.disclosure.withdraw", {
                              provider: d.provider,
                              disclosureId: d.id,
                              reason: v.reason,
                            }),
                          "Withdrawal blocks subsequent provider processing. Historical terms and customer acceptance remain recorded.",
                        ),
                    )}
                  </div>
                ))}
              </section>
            )}
            {table(
              [
                "Customer",
                "Tier",
                "Credit limit",
                "Hold",
                "Residency",
                "Actions",
              ],
              data.accounts,
              (a: Item) => [
                a.name,
                a.tier,
                money(a.credit_limit, a.currency),
                a.held ? "On hold" : "Clear",
                `${data.organization.region} · ${a.residency_mode}${JSON.parse(a.provider_exceptions).includes("carrier") ? " · Previous carrier exception needs review; no named carrier is authorized by it." : ""}${providerNames
                  .filter(
                    (p) =>
                      JSON.parse(a.provider_exceptions).includes(p) &&
                      !a.providerReviews.some(
                        (r: Item) => r.provider === p && r.current === 1,
                      ),
                  )
                  .map(
                    (p) =>
                      ` · ${providerChoices.find((c) => c.id === p)?.label} terms require review`,
                  )
                  .join("")}`,
                <div className="actions">
                  {can("finance") &&
                    button(a.held ? "Clear hold" : "Apply hold", () =>
                      simple("Finance hold", [reason], "account.hold", (v) => ({
                        ...v,
                        accountId: a.id,
                        held: !a.held,
                      })),
                    )}
                  {can("commercial", "finance", "support", "buyer") &&
                    button("Acceptance history", () => {
                      providerHistoryOpener.current =
                        document.activeElement as HTMLElement;
                      setProviderHistoryAccount(a.id);
                    })}
                  {can("commercial", "buyer") &&
                    button("Residency choice", () =>
                      open(
                        "Choose data residency",
                        [
                          {
                            name: "region",
                            label: "Application storage region",
                            options: [
                              { value: "CA", label: "Canada" },
                              { value: "US", label: "United States" },
                            ],
                            value: data.organization.region,
                          },
                          {
                            name: "mode",
                            label: "Processor policy",
                            options: [
                              {
                                value: "strict",
                                label: "Strict regional residency",
                              },
                              {
                                value: "provider-exceptions",
                                label: "Accept selected processor exceptions",
                              },
                            ],
                            value: a.residency_mode,
                          },
                          ...providerChoices
                            .filter((p) =>
                              data.providerDisclosures.some(
                                (d: Item) => d.provider === p.id,
                              ),
                            )
                            .map(({ id, label }): Field => ({
                              name: id,
                              label: `Allow ${label} processing outside the storage region`,
                              type: "checkbox",
                              value:
                                JSON.parse(a.provider_exceptions).includes(
                                  id,
                                ) &&
                                a.providerReviews.some(
                                  (r: Item) =>
                                    r.provider === id && r.current === 1,
                                ),
                            })),
                          ...(actor.role === "buyer"
                            ? []
                            : [
                                {
                                  name: "representative",
                                  label: "Authorized customer representative",
                                  optional: true,
                                  help: "Required when staff records a customer exception.",
                                },
                                {
                                  name: "evidenceRef",
                                  label:
                                    "External customer acceptance evidence",
                                  type: "textarea" as const,
                                  optional: true,
                                  help: "Reference the customer acceptance of these exact terms; a staff acknowledgment alone is insufficient.",
                                },
                              ]),
                          {
                            name: "acknowledgment",
                            label: "Acknowledgment of reviewed processor terms",
                            type: "textarea",
                          },
                        ],
                        (v) =>
                          command("account.residency", {
                            accountId: a.id,
                            region: v.region,
                            mode: v.mode,
                            providers: providerNames.filter((p) => v[p]),
                            ...(providerNames.some((p) => v[p])
                              ? {
                                  acceptance: {
                                    basis:
                                      actor.role === "buyer"
                                        ? "buyer"
                                        : "recorded",
                                    ...(actor.role === "buyer"
                                      ? {}
                                      : {
                                          representative: v.representative,
                                          evidenceRef: v.evidenceRef,
                                        }),
                                    disclosures: providerNames
                                      .filter((p) => v[p])
                                      .map((provider) => ({
                                        provider,
                                        disclosureId:
                                          data.providerDisclosures.find(
                                            (d: Item) =>
                                              d.provider === provider,
                                          ).id,
                                      })),
                                  },
                                }
                              : {}),
                            version: a.residency_version,
                            acknowledgment: v.acknowledgment,
                          }),
                        <DisclosureReview
                          disclosures={data.providerDisclosures}
                        />,
                      ),
                    )}
                </div>,
              ],
            )}
            {providerHistoryAccount &&
              can("commercial", "finance", "support", "buyer") &&
              data.accounts.some(
                (a: Item) => a.id === providerHistoryAccount,
              ) && (
                <ProviderHistory
                  key={`${providerHistoryAccount}:${eventViewEpoch}`}
                  account={data.accounts.find(
                    (a: Item) => a.id === providerHistoryAccount,
                  )}
                  close={() => {
                    setProviderHistoryAccount(null);
                    providerHistoryOpener.current?.focus();
                  }}
                />
              )}
          </>
        )}
        {page === "Imports" && admin && (
          <>
            <section className="panel">
              <h2>Opening stock review</h2>
              <p>
                Import a reviewed opening balance before this product has stock
                at its destination warehouse. A dry run changes no stock. Any
                rejected row or unmatched quantity/value blocks the whole batch.
              </p>
              {button("Dry run opening stock", () =>
                open(
                  "Dry run opening stock",
                  [
                    {
                      name: "batchRef",
                      label: "Batch reference (new for each correction)",
                    },
                    {
                      name: "sourceRef",
                      label:
                        "Source dataset reference (keep for corrected batches)",
                    },
                    { name: "sourceHash", label: "Original source SHA-256" },
                    {
                      name: "cutoffAt",
                      label: "Source cutoff (UTC)",
                      value: new Date().toISOString(),
                    },
                    {
                      name: "expectedQuantity",
                      label: "Independent source quantity",
                      type: "number",
                      max: 1e9,
                    },
                    {
                      name: "expectedValue",
                      label: `Independent source cost (${currency} cents)`,
                      type: "number",
                      max: 1e12,
                    },
                    {
                      name: "acknowledgment",
                      label: "Source rights, mapping and cutoff evidence",
                      type: "textarea",
                    },
                    {
                      name: "rows",
                      label: "Opening rows (JSON)",
                      type: "textarea",
                      help: "Array of objects: sourceId, sku, warehouse (exact name), bin, serial (null for bulk), quantity, unitCost (cents), condition (usable/quarantine/damaged). Maximum 500 rows. Use the source evidence, not sample balances.",
                    },
                  ],
                  async (v) => {
                    let rows;
                    try {
                      rows = JSON.parse(v.rows);
                    } catch {
                      throw new Error(
                        "Opening rows must be valid JSON. Correct the file before creating a dry run.",
                      );
                    }
                    return command("import.opening.preview", {
                      ...v,
                      rows,
                      version: 1,
                      region: data.organization.region,
                      currency,
                    });
                  },
                ),
              )}
            </section>
            <section className="panel">
              <h2>Customer and catalog review</h2>
              <p>
                Dry runs create no accounts or products. Every row explicitly
                creates a new record (targetId null) or matches an existing ID
                with all reviewed fields equal. Approval applies the whole
                batch. New customers start with strict residency; matching
                preserves existing choices. No users, provider consent, stock,
                unpaid balances or accounting entries are imported here.
              </p>
              <details>
                <summary>Existing record IDs for explicit matching</summary>
                {table(
                  ["Type", "Target ID", "Name / SKU"],
                  [
                    ...data.accounts.map((a: Item) => ({
                      ...a,
                      kind: "customer",
                      label: a.name,
                    })),
                    ...data.products.map((p: Item) => ({
                      ...p,
                      kind: "catalog",
                      label: `${p.sku} · ${p.name}`,
                    })),
                  ],
                  (r: Item) => [r.kind, r.id, r.label],
                )}
              </details>
              {button("Dry run customer/catalog", () =>
                open(
                  "Dry run customer/catalog",
                  [
                    {
                      name: "kind",
                      label: "Import type",
                      options: [
                        { value: "customer", label: "Customers" },
                        { value: "catalog", label: "Catalog" },
                      ],
                      value: "customer",
                    },
                    {
                      name: "batchRef",
                      label: "Batch reference (new for each correction)",
                    },
                    {
                      name: "sourceRef",
                      label:
                        "Source dataset reference (keep for corrected batches)",
                    },
                    { name: "sourceHash", label: "Original source SHA-256" },
                    {
                      name: "cutoffAt",
                      label: "Source cutoff (UTC)",
                      value: new Date().toISOString(),
                    },
                    {
                      name: "expectedQuantity",
                      label: "Independent source record count",
                      type: "number",
                      max: 500,
                    },
                    {
                      name: "expectedValue",
                      label: `Independent control amount (${currency} cents)`,
                      type: "number",
                      max: 1e12,
                      help: "Sum of customer credit limits or catalog base unit prices. This is a migration control total, not stock value or an account balance.",
                    },
                    {
                      name: "acknowledgment",
                      label: "Source rights, mapping and cutoff evidence",
                      type: "textarea",
                    },
                    {
                      name: "rows",
                      label: "Master rows (JSON)",
                      type: "textarea",
                      help: "Maximum 500 objects. Customers: sourceId, targetId, name, tier, creditLimit (cents), held (boolean). Catalog: sourceId, targetId, sku, name, serialized (boolean), unitPrice (cents), taxBasisPoints. targetId is null for creation or an exact existing ID for matching; no other fields.",
                    },
                  ],
                  async (v) => {
                    let rows;
                    try {
                      rows = JSON.parse(v.rows);
                    } catch {
                      throw new Error(
                        "Master rows must be valid JSON. Correct the file before creating a dry run.",
                      );
                    }
                    return command("import.masters.preview", {
                      ...v,
                      rows,
                      version: 1,
                      region: data.organization.region,
                      currency,
                    });
                  },
                ),
              )}
            </section>
            <section className="panel">
              <h2>Unpaid document review</h2>
              <p>
                Carry forward original invoices and their reconciled outstanding
                balances. Historical credits, payments and refunds remain source
                evidence. Approval creates no stock, shipment, new cash receipt
                or accounting delivery.
              </p>
              <details>
                <summary>Customer and product IDs for document mapping</summary>
                {table(
                  ["Type", "ID", "Name / SKU"],
                  [
                    ...data.accounts.map((a: Item) => ({
                      id: a.id,
                      kind: "Customer",
                      label: a.name,
                    })),
                    ...data.products.map((p: Item) => ({
                      id: p.id,
                      kind: "Product",
                      label: `${p.sku} · ${p.name}`,
                    })),
                  ],
                  (r: Item) => [r.kind, r.id, r.label],
                )}
              </details>
              {button("Dry run unpaid documents", () =>
                open(
                  "Dry run unpaid documents",
                  [
                    {
                      name: "batchRef",
                      label: "Batch reference (new for each correction)",
                    },
                    {
                      name: "sourceRef",
                      label:
                        "Source dataset reference (keep for corrected batches)",
                    },
                    { name: "sourceHash", label: "Original source SHA-256" },
                    {
                      name: "cutoffAt",
                      label: "Source cutoff (UTC)",
                      value: new Date().toISOString(),
                    },
                    {
                      name: "expectedQuantity",
                      label: "Independent document count",
                      type: "number",
                      min: 1,
                      max: 500,
                    },
                    ...[
                      ["expectedNet", "Independent original net"],
                      ["expectedTax", "Independent original tax"],
                      ["expectedCredited", "Independent historical credits"],
                      ["expectedPaid", "Independent historical payments"],
                      ["expectedRefunded", "Independent historical refunds"],
                      ["expectedValue", "Independent outstanding balance"],
                    ].map(([name, label]) => ({
                      name: name!,
                      label: `${label} (${currency} cents)`,
                      type: "number" as const,
                      min: 0,
                      max: 1e12,
                    })),
                    {
                      name: "acknowledgment",
                      label: "Source rights, mapping and cutoff evidence",
                      type: "textarea",
                    },
                    {
                      name: "rows",
                      label: "Unpaid document rows (JSON)",
                      type: "textarea",
                      help: "Maximum 500 documents: sourceId, accountId, number, issuedAt, dueAt, net, tax, total, credited, paid, refunded, balance, lines. Each original line: productId, description, quantity, unitPrice, unitTax, creditedQuantity. Money is integer cents; dates are canonical UTC. Preserve original amounts and credited units; do not substitute the remaining balance for the invoice total.",
                    },
                  ],
                  async (v) => {
                    let rows;
                    try {
                      rows = JSON.parse(v.rows);
                    } catch {
                      throw new Error(
                        "Unpaid document rows must be valid JSON. Correct the file before creating a dry run.",
                      );
                    }
                    return command("import.documents.preview", {
                      ...v,
                      rows,
                      version: 1,
                      region: data.organization.region,
                      currency,
                    });
                  },
                ),
              )}
            </section>
            {(extra.documentImports ?? []).map((b: Item) => (
              <section
                className="panel"
                key={b.id}
                aria-label={`Document batch ${b.batchRef}`}
              >
                <h2>
                  {b.batchRef} · unpaid documents · {b.state}
                </h2>
                <p>
                  Source {b.sourceRef} · cutoff {b.cutoffAt}
                </p>
                <p>
                  Source hash: <code>{b.sourceHash}</code>
                </p>
                <p>{b.acknowledgment}</p>
                <p>
                  Independent source: {b.expectedQuantity} documents. Eligible:{" "}
                  {b.report.quantity} documents. {b.report.issues.length} review
                  issues.
                </p>
                {table(
                  ["Control", "Independent source", "Eligible documents"],
                  [
                    {
                      label: "Original net",
                      expected: b.expectedNet,
                      actual: b.report.net,
                    },
                    {
                      label: "Original tax",
                      expected: b.expectedTax,
                      actual: b.report.tax,
                    },
                    {
                      label: "Historical credits",
                      expected: b.expectedCredited,
                      actual: b.report.credited,
                    },
                    {
                      label: "Historical payments",
                      expected: b.expectedPaid,
                      actual: b.report.paid,
                    },
                    {
                      label: "Historical refunds",
                      expected: b.expectedRefunded,
                      actual: b.report.refunded,
                    },
                    {
                      label: "Outstanding balance",
                      expected: b.expectedValue,
                      actual: b.report.value,
                    },
                  ],
                  (r: Item) => [
                    r.label,
                    money(r.expected, b.currency),
                    money(r.actual, b.currency),
                  ],
                )}
                {table(
                  [
                    "Row / source",
                    "Original invoice / customer",
                    "Source fields",
                    "Outstanding",
                    "Review",
                  ],
                  b.report.rows,
                  (r: Item) => [
                    `${r.row} · ${r.sourceId ?? "missing source ID"}`,
                    r.entry
                      ? `${r.entry.matchKey} · ${r.entry.name}`
                      : "Unmapped",
                    <code>{JSON.stringify(r.source)}</code>,
                    r.entry ? money(r.entry.value, b.currency) : "Rejected",
                    r.issues.length
                      ? r.issues.map((i: Item) => i.message).join(" ")
                      : "Eligible",
                  ],
                )}
                {b.report.issues
                  .filter((i: Item) => i.row === null)
                  .map((i: Item, index: number) => (
                    <p role="alert" key={index}>
                      {i.message}
                    </p>
                  ))}
                <p>
                  Review fingerprint: <code>{b.reviewHash}</code>
                </p>
                {b.result ? (
                  <>
                    <p>
                      {b.result.decision} · {b.result.reason} ·{" "}
                      {b.result.quantity} documents /{" "}
                      {money(b.result.value, b.currency)} outstanding
                    </p>
                    {table(
                      [
                        "Source row",
                        "Original number",
                        "Permanent invoice",
                        "Original total",
                        "Opening outstanding",
                      ],
                      b.result.mappings,
                      (m: Item) => [
                        m.sourceId,
                        m.number,
                        m.invoiceId,
                        money(m.total, b.currency),
                        money(m.balance, b.currency),
                      ],
                    )}
                  </>
                ) : (
                  <div className="actions">
                    {b.state === "ready" &&
                      button("Approve document batch", () =>
                        open(
                          "Approve document batch",
                          [reason],
                          (v) =>
                            command("import.documents.decide", {
                              batchId: b.id,
                              reviewHash: b.reviewHash,
                              decision: "approve",
                              reason: v.reason,
                            }),
                          `Review the original documents, historical credits/cash/refunds and independent ${money(b.expectedValue, b.currency)} outstanding balance. This records historical debt without posting new cash or accounting entries.`,
                        ),
                      )}
                    {button("Reject document batch", () =>
                      open("Reject document batch", [reason], (v) =>
                        command("import.documents.decide", {
                          batchId: b.id,
                          reviewHash: b.reviewHash,
                          decision: "reject",
                          reason: v.reason,
                        }),
                      ),
                    )}
                  </div>
                )}
              </section>
            ))}
            {(extra.masterImports ?? []).map((b: Item) => (
              <section
                className="panel"
                key={b.id}
                aria-label={`Master batch ${b.batchRef}`}
              >
                <h2>
                  {b.batchRef} · {b.kind} · {b.state}
                </h2>
                <p>
                  Source {b.sourceRef} · cutoff {b.cutoffAt}
                </p>
                <p>
                  Source hash: <code>{b.sourceHash}</code>
                </p>
                <p>{b.acknowledgment}</p>
                <p>
                  Independent source: {b.expectedQuantity} records /{" "}
                  {money(b.expectedValue, b.currency)} control amount. Eligible:{" "}
                  {b.report.quantity} records /{" "}
                  {money(b.report.value, b.currency)}. {b.report.creates} create
                  / {b.report.matches} match. {b.report.issues.length} review
                  issues.
                </p>
                {table(
                  [
                    "Row / source",
                    "Reviewed record",
                    "Source fields",
                    "Action / control amount",
                    "Review",
                  ],
                  b.report.rows,
                  (r: Item) => [
                    `${r.row} · ${r.sourceId ?? "missing source ID"}`,
                    r.entry
                      ? `${r.entry.name} · ${r.entry.matchKey}`
                      : "Unmapped",
                    <code>{JSON.stringify(r.source)}</code>,
                    r.entry
                      ? `${r.entry.targetId ? `Match ${r.entry.targetId}` : "Create"} / ${money(r.entry.value, b.currency)}`
                      : "Rejected",
                    r.issues.length
                      ? r.issues.map((i: Item) => i.message).join(" ")
                      : "Eligible",
                  ],
                )}
                {b.report.issues
                  .filter((i: Item) => i.row === null)
                  .map((i: Item, index: number) => (
                    <p role="alert" key={index}>
                      {i.message}
                    </p>
                  ))}
                <p>
                  Review fingerprint: <code>{b.reviewHash}</code>
                </p>
                {b.result ? (
                  <>
                    <p>
                      {b.result.decision} · {b.result.reason} ·{" "}
                      {b.result.quantity} records /{" "}
                      {money(b.result.value, b.currency)}
                    </p>
                    {table(
                      [
                        "Source row",
                        "Permanent target",
                        "Action",
                        "Control amount",
                      ],
                      b.result.mappings,
                      (m: Item) => [
                        m.sourceId,
                        m.targetId,
                        m.action,
                        money(m.value, b.currency),
                      ],
                    )}
                  </>
                ) : (
                  <div className="actions">
                    {b.state === "ready" &&
                      button("Approve master batch", () =>
                        open(
                          "Approve master batch",
                          [reason],
                          (v) =>
                            command("import.masters.decide", {
                              batchId: b.id,
                              reviewHash: b.reviewHash,
                              decision: "approve",
                              reason: v.reason,
                            }),
                          `Review ${b.report.creates} creations and ${b.report.matches} exact matches. Control amount is ${money(b.expectedValue, b.currency)}; it is not an opening balance. Residency choices remain protected.`,
                        ),
                      )}
                    {button("Reject master batch", () =>
                      open("Reject master batch", [reason], (v) =>
                        command("import.masters.decide", {
                          batchId: b.id,
                          reviewHash: b.reviewHash,
                          decision: "reject",
                          reason: v.reason,
                        }),
                      ),
                    )}
                  </div>
                )}
              </section>
            ))}
            {(extra.openingImports ?? []).map((b: Item) => (
              <section
                className="panel"
                key={b.id}
                aria-label={`Opening batch ${b.batchRef}`}
              >
                <h2>
                  {b.batchRef} · {b.state}
                </h2>
                <p>
                  Source {b.sourceRef} · cutoff {b.cutoffAt}
                </p>
                <p>
                  Source hash: <code>{b.sourceHash}</code>
                </p>
                <p>{b.acknowledgment}</p>
                <p>
                  Independent source: {b.expectedQuantity} units /{" "}
                  {money(b.expectedValue, b.currency)}. Eligible rows:{" "}
                  {b.report.quantity} units /{" "}
                  {money(b.report.value, b.currency)}. {b.report.issues.length}{" "}
                  review issues.
                </p>
                {table(
                  ["Row / source", "Target stock", "Quantity / cost", "Review"],
                  b.report.rows,
                  (r: Item) => [
                    `${r.row} · ${r.sourceId ?? "missing source ID"}`,
                    r.entry
                      ? `${productName(r.entry.productId)} · ${warehouseName(r.entry.warehouseId)} / ${r.entry.bin} · ${r.entry.serial ?? "bulk"} · ${r.entry.condition}`
                      : "Unmapped",
                    r.entry
                      ? `${r.entry.quantity} × ${money(r.entry.unitCost, b.currency)}`
                      : "Rejected",
                    r.issues.length
                      ? r.issues.map((i: Item) => i.message).join(" ")
                      : "Eligible",
                  ],
                )}
                {b.report.issues
                  .filter((i: Item) => i.row === null)
                  .map((i: Item, index: number) => (
                    <p role="alert" key={index}>
                      {i.message}
                    </p>
                  ))}
                {b.result ? (
                  <>
                    <p>
                      {b.result.decision} · {b.result.reason} ·{" "}
                      {b.result.quantity} units /{" "}
                      {money(b.result.value, b.currency)}
                    </p>
                    {table(
                      [
                        "Source row",
                        "Permanent stock record",
                        "Applied quantity / value",
                      ],
                      b.result.mappings,
                      (m: Item) => [
                        m.sourceId,
                        m.unitId,
                        `${m.quantity} / ${money(m.value, b.currency)}`,
                      ],
                    )}
                  </>
                ) : (
                  <div className="actions">
                    {b.state === "ready" &&
                      button("Approve opening stock", () =>
                        open(
                          "Approve opening stock",
                          [reason],
                          (v) =>
                            command("import.opening.decide", {
                              batchId: b.id,
                              reviewHash: b.reviewHash,
                              decision: "approve",
                              reason: v.reason,
                            }),
                          `Review ${b.expectedQuantity} units valued at ${money(b.expectedValue, b.currency)} from ${b.sourceRef}. All rows apply together. This creates opening custody, without supplier purchase or accounting entries.`,
                        ),
                      )}
                    {button("Reject opening batch", () =>
                      open("Reject opening batch", [reason], (v) =>
                        command("import.opening.decide", {
                          batchId: b.id,
                          reviewHash: b.reviewHash,
                          decision: "reject",
                          reason: v.reason,
                        }),
                      ),
                    )}
                  </div>
                )}
              </section>
            ))}
          </>
        )}
        {page === "Security" && (
          <section className="panel">
            <h2>Your sign-in security</h2>
            <p>
              {extra.security?.email} · {extra.security?.sessions ?? 0} active
              sessions. Password changes end every session.
            </p>
            {extra.security?.mfa && (
              <MfaSecurity
                security={extra.security}
                sessionEnded={clearSession}
              />
            )}
            <hr />
            <PasswordChangeForm
              busy={busy}
              submit={(values) =>
                run(() => command("user.password.change", values))
              }
            />
            <hr />
            {button("End all my sessions", () =>
              open(
                "End all my sessions",
                [],
                () => command("user.sessions.end-own", {}),
                "This ends your signed-in sessions on every device.",
                "End sessions",
              ),
            )}
            <p>You will need to sign in again on every device.</p>
          </section>
        )}
        {page === "Administration" && admin && (
          <>
            <section className="panel">
              <h2>Staff and buyer access</h2>
              {button("Create user", () =>
                simple(
                  "Create user",
                  [
                    { name: "name", label: "Name" },
                    { name: "email", label: "Email" },
                    {
                      name: "password",
                      label: "Initial password (14+ characters)",
                      type: "password",
                    },
                    {
                      name: "currentPassword",
                      label: "Your current password",
                      type: "password",
                    },
                    {
                      name: "role",
                      label: "Role",
                      options: [
                        "warehouse",
                        "commercial",
                        "finance",
                        "warranty",
                        "buyer",
                        "support",
                        "admin",
                      ].map((v) => ({ value: v, label: v })),
                    },
                    {
                      ...select(
                        "accountId",
                        "Buyer account (buyer role only)",
                        data.accounts,
                        (a) => a.name,
                      ),
                      optional: true,
                    },
                    {
                      name: "sites",
                      label: "Permitted warehouses",
                      type: "multiselect",
                      options: options(data.warehouses, (w) => w.name),
                      optional: true,
                      help: "Select each warehouse this user may operate.",
                    },
                  ],
                  "user.create",
                  (v) => ({
                    ...v,
                    ...(v.role !== "buyer" ? { accountId: undefined } : {}),
                    requirePasswordChange: true,
                    sites: v.sites ?? [],
                  }),
                ),
              )}
              <p>
                New users must change their initial password. Access changes,
                resets and revocations end every session for the affected user.
              </p>
              {table(
                ["User", "Role / scope", "Status", "Sessions", "Actions"],
                extra.users ?? [],
                (u: Item) => [
                  <span>
                    {u.name}
                    <br />
                    {u.email}
                  </span>,
                  <span>
                    {u.role}
                    {u.accountId ? ` · ${accountName(u.accountId)}` : ""}
                    <br />
                    {u.sites.map(warehouseName).join(", ") ||
                      (u.role === "admin"
                        ? "All warehouses"
                        : "No warehouse operations")}
                  </span>,
                  `${u.active ? "Active" : "Inactive"}${u.passwordChangeRequired ? " · Password change required" : ""} · v${u.revision}`,
                  u.sessions,
                  <div className="actions">
                    {button(`Edit access: ${u.name}`, () =>
                      simple(
                        `Edit access: ${u.name}`,
                        [
                          { name: "name", label: "Name", value: u.name },
                          { name: "email", label: "Email", value: u.email },
                          {
                            name: "role",
                            label: "Role",
                            value: u.role,
                            options: [
                              "warehouse",
                              "commercial",
                              "finance",
                              "warranty",
                              "buyer",
                              "support",
                              "admin",
                            ].map((value) => ({ value, label: value })),
                          },
                          {
                            ...select(
                              "accountId",
                              "Buyer account (buyer role only)",
                              data.accounts,
                              (a) => a.name,
                              u.accountId ?? "",
                            ),
                            optional: true,
                          },
                          {
                            name: "sites",
                            label: "Permitted warehouses",
                            type: "multiselect",
                            options: options(data.warehouses, (w) => w.name),
                            optional: true,
                            value: u.sites,
                          },
                          {
                            name: "active",
                            label: "Active user",
                            type: "checkbox",
                            value: u.active,
                          },
                          {
                            name: "currentPassword",
                            label: "Your current password",
                            type: "password",
                          },
                          reason,
                        ],
                        "user.update",
                        (v) => ({
                          ...v,
                          accountId:
                            v.role === "buyer" ? v.accountId : undefined,
                          userId: u.id,
                          revision: u.revision,
                        }),
                      ),
                    )}
                    {button(`Reset password: ${u.name}`, () =>
                      simple(
                        `Reset password: ${u.name}`,
                        [
                          {
                            name: "password",
                            label: "New initial password (14+ characters)",
                            type: "password",
                          },
                          {
                            name: "currentPassword",
                            label: "Your current password",
                            type: "password",
                          },
                          reason,
                        ],
                        "user.password.reset",
                        (v) => ({ ...v, userId: u.id, revision: u.revision }),
                      ),
                    )}
                    {button(`Revoke sessions: ${u.name}`, () =>
                      simple(
                        `Revoke sessions: ${u.name}`,
                        [
                          {
                            name: "currentPassword",
                            label: "Your current password",
                            type: "password",
                          },
                          reason,
                        ],
                        "user.sessions.revoke",
                        (v) => ({ ...v, userId: u.id, revision: u.revision }),
                      ),
                    )}
                  </div>,
                ],
              )}
            </section>
          </>
        )}
      </main>
      {purchaseEntryOpen && page === "Purchasing" && can("commercial") && (
        <PurchaseEntry
          suppliers={extra.purchases?.suppliers ?? []}
          warehouses={data.warehouses}
          currency={data.organization.currency}
          orgId={actor.orgId}
          actorId={actor.id}
          close={() => setPurchaseEntryOpen(false)}
          created={(id) => {
            setPurchaseEntryOpen(false);
            void refresh()
              .then(() =>
                setNotice(`Purchase order ${id.slice(0, 8)} created.`),
              )
              .catch((e) =>
                setError(
                  `Purchase order ${id.slice(0, 8)} created; refresh failed: ${e.message}`,
                ),
              );
          }}
        />
      )}
      {dialog && (
        <Modal
          dialog={dialog}
          busy={busy}
          error={error}
          close={() => {
            stopOrderEntryRead();
            stopCatalogRead();
            setDialog(null);
          }}
          submit={async (values) => {
            try {
              if (dialog.title === "Serial history") {
                await dialog.perform(values);
                return;
              }
              const result = await run(() => dialog.perform(values));
              if (!(result as Item)?.keepDialog) setDialog(null);
            } catch {}
          }}
        />
      )}
    </div>
  );
}
function PasswordChangeForm({
  busy,
  submit,
}: {
  busy: boolean;
  submit: (values: {
    currentPassword: string;
    password: string;
  }) => Promise<unknown>;
}) {
  const [currentPassword, setCurrentPassword] = useState(""),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [error, setError] = useState("");
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        if (password !== confirmation) {
          setError("New passwords must match.");
          return;
        }
        try {
          await submit({ currentPassword, password });
          setCurrentPassword("");
          setPassword("");
          setConfirmation("");
        } catch {}
      }}
    >
      <label>
        Current password
        <input
          type="password"
          autoComplete="current-password"
          required
          maxLength={256}
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
      </label>
      <label>
        New password (14–256 characters)
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={14}
          maxLength={256}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label>
        Confirm new password
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={14}
          maxLength={256}
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button disabled={busy}>Change password</button>
    </form>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {location.pathname === "/quickbooks/callback" ? (
      <QuickBooksCallback />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
