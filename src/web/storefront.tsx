import { ReferenceMatches } from "./gree-reference-loader.tsx";
import { InfoBubble } from "./info-bubble.tsx";
import { createPortal } from "react-dom";
import { ControlIcon } from "./control-icon.tsx";
import type { ReferenceRequest } from "./reference-context.ts";
import { CustomerPrice } from "./customer-pricing.tsx";
import { AvailabilityBadge } from "./product-availability.tsx";
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { request } from "./api.ts";
import { usePages } from "./billing-inbox.tsx";
import { PageSection, PageSections } from "./workspace.tsx";
import type {
  CustomerProduct,
  CustomerProductPage,
} from "../shared/customer-products.ts";
import {
  catalogImageLinkUrl,
  type CatalogResource,
} from "../shared/catalog-media.ts";
import {
  AddToCart,
  CartFeedbackContext,
  ShopCart,
  useShopCart,
  type ShopWarehouse,
} from "./shop-cart.tsx";
import { AddonSuggestions, useAddonSuggestions } from "./product-addons.tsx";
import "./storefront.css";

export const displayMoney = (cents: number, currency: string) =>
  new Intl.NumberFormat("en", { style: "currency", currency }).format(
    cents / 100,
  );
export const resourcePath = (productId: string, resourceId?: string) =>
  `/api/catalog/products/${encodeURIComponent(productId)}/resources${resourceId ? `/${encodeURIComponent(resourceId)}` : ""}`;
export function useResources(productId: string, epoch = 0) {
  const [items, setItems] = useState<CatalogResource[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setItems([]);
    setError("");
    setBusy(true);
    setLoaded(false);
    void request<{ items: CatalogResource[] }>(resourcePath(productId), {
      signal: controller.signal,
    })
      .then((r) => {
        if (!controller.signal.aborted) {
          setItems(r.items);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [productId, epoch]);
  return { items, error, busy, loaded };
}
export function ProductImage({
  product,
  resource,
}: {
  product: { name: string; sku: string };
  resource?: CatalogResource;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(
    () => setFailed(false),
    [resource?.id, resource?.version, resource?.externalUrl],
  );
  const source = resource?.externalUrl
    ? catalogImageLinkUrl(resource.externalUrl)
    : resource &&
      `${resourcePath(resource.productId, resource.id)}/bytes?v=${resource.version}`;
  return resource && source && !failed ? (
    <img
      className="product-image"
      src={source}
      alt={resource.altText}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  ) : (
    <div
      className="product-placeholder"
      role="img"
      aria-label={`Product image unavailable for ${product.name}`}
    >
      <svg
        viewBox="0 0 340 220"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="95" y="45" width="150" height="120" rx="8" />
        <circle cx="135" cy="82" r="12" />
        <path d="m105 150 45-42 28 25 24-22 33 39M95 165 150 45" />
      </svg>
      <span>{product.sku}</span>
      <small>Image not available</small>
    </div>
  );
}
function Arrow({ back = false }: { back?: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
      style={back ? { transform: "rotate(180deg)" } : undefined}
    >
      <path d="M4 12h15m-6-6 6 6-6 6" />
    </svg>
  );
}
function ProductCard({
  product,
  select,
  add,
  buttonRef,
}: {
  product: CustomerProduct;
  select: () => void;
  add: (quantity: number) => void;
  buttonRef: (element: HTMLButtonElement | null) => void;
}) {
  const resources = useResources(product.id);
  return (
    <article className="sf-card">
      <div className="sf-card-media">
        <ProductImage
          product={product}
          resource={resources.items.find(
            (r) => r.kind === "image" && r.state === "published",
          )}
        />
      </div>
      <div className="sf-card-body">
        <p className="sf-sku">{product.sku}</p>
        <h3>{product.name}</h3>
        <AvailabilityBadge product={product} />
        <div className="sf-card-price">
          <CustomerPrice product={product} compact />
        </div>
        <p className="sf-tax">
          + {displayMoney(product.unit_tax, product.currency)} tax / unit
        </p>
        <button
          className="sf-card-link"
          ref={buttonRef}
          onClick={select}
          aria-label={`View ${product.name}`}
        >
          View product <Arrow />
        </button>
        <AddToCart product={product} add={add} compact />
      </div>
    </article>
  );
}
export function ProductDetail({
  product,
  back,
  add,
  addons,
}: {
  product: CustomerProduct;
  back: () => void;
  add: (quantity: number) => void;
  // Suggested add-ons for this unit, when the caller knows the account.
  addons?: React.ReactNode;
}) {
  const resources = useResources(product.id),
    [imageIndex, setImageIndex] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const images = resources.items.filter(
      (r) => r.kind === "image" && r.state === "published",
    ),
    documents = resources.items.filter(
      (r) => r.kind !== "image" && r.state === "published",
    );
  return (
    <section className="sf-detail">
      <nav className="sf-product-breadcrumb" aria-label="Product breadcrumb">
        <button className="sf-back" onClick={back}>
          <Arrow back /> Shop
        </button>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{product.name}</span>
      </nav>
      <div className="sf-detail-top">
        <div className="sf-gallery">
          <div className="sf-gallery-image">
            <ProductImage product={product} resource={images[imageIndex]} />
          </div>
          {images.length > 1 && (
            <div className="sf-gallery-controls" aria-label="Product images">
              <button
                className="sf-arrow"
                aria-label="Previous image"
                onClick={() =>
                  setImageIndex(
                    (imageIndex + images.length - 1) % images.length,
                  )
                }
              >
                <Arrow back />
              </button>
              <span role="status">
                Image {imageIndex + 1} of {images.length}
              </span>
              <button
                className="sf-arrow"
                aria-label="Next image"
                onClick={() => setImageIndex((imageIndex + 1) % images.length)}
              >
                <Arrow />
              </button>
            </div>
          )}
          <p className="sf-image-note">
            Refer to the published documents for exact-model details and
            included components.
          </p>
        </div>
        <div className="sf-detail-summary">
          <p className="sf-kicker">Your approved catalog</p>
          <p className="sf-sku">{product.sku}</p>
          <h2 tabIndex={-1} ref={heading}>
            {product.name}
          </h2>
          <AvailabilityBadge product={product} />
          <div className="sf-purchase-panel">
            <p className="sf-price-label">Your account price</p>
            <CustomerPrice product={product} />
            <p className="sf-tax">
              + {displayMoney(product.unit_tax, product.currency)} tax per unit
            </p>
            <AddToCart product={product} add={add} />
            <p className="sf-purchase-note">
              Choose the warehouse in your cart. Review quantities and current
              terms before submitting. Distributor approval may be required;
              availability is confirmed at acceptance.
            </p>
          </div>
        </div>
      </div>
      <div className="sf-information">
        <PageSections
          label="Product information"
          items={[
            { id: "product-overview", label: "Overview" },
            { id: "product-specifications", label: "Specifications" },
            { id: "product-documents", label: "Documents" },
          ]}
        >
          <PageSection id="product-overview">
            <div className="sf-information-layout">
              <div>
                <p className="sf-kicker">Product information</p>
                <h3>Product overview</h3>
              </div>
              <div>
                <p>{product.name}</p>
                <p>
                  Check the exact model, components and installation
                  requirements in the published documents. A family photograph
                  does not confirm included components.
                </p>
              </div>
            </div>
          </PageSection>
          <PageSection id="product-specifications">
            <div className="sf-information-layout">
              <div>
                <p className="sf-kicker">Product reference</p>
                <h3>Specifications</h3>
              </div>
              <div>
                <dl className="sf-specifications">
                  <div>
                    <dt>SKU</dt>
                    <dd>{product.sku}</dd>
                  </div>
                  <div>
                    <dt>Tracking</dt>
                    <dd>
                      {product.serialized
                        ? "Individually serialized"
                        : "Bulk quantity"}
                    </dd>
                  </div>
                </dl>
                <p>
                  Model specifications are provided in the applicable published
                  documents. Contact the distributor if an exact-model document
                  is missing.
                </p>
              </div>
            </div>
          </PageSection>
          <PageSection id="product-documents">
            <div className="sf-information-layout">
              <div>
                <p className="sf-kicker">Technical library</p>
                <div className="info-heading">
                  <h3>Product documents</h3>
                  <InfoBubble label="Product documents">
                    Check model, language and revision before use.
                  </InfoBubble>
                </div>
              </div>
              <div>
                {resources.busy && <p role="status">Loading documents…</p>}
                {resources.error && <p role="alert">{resources.error}</p>}
                {resources.loaded &&
                  !resources.busy &&
                  !resources.error &&
                  !documents.length && (
                    <p className="sf-empty">
                      No documents have been published for this product.
                    </p>
                  )}
                <ul className="sf-documents">
                  {documents.map((r) => (
                    <li key={r.id}>
                      <span className="sf-document-icon" aria-hidden="true">
                        <svg
                          width="25"
                          height="30"
                          viewBox="0 0 25 30"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.3"
                        >
                          <path d="M4 2h11l6 6v20H4Zm11 0v7h6M8 15h9M8 20h9" />
                        </svg>
                      </span>
                      <div>
                        <a
                          href={
                            r.externalUrl ||
                            `${resourcePath(product.id, r.id)}/bytes`
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {r.title}
                          {r.externalUrl ? " (external website)" : " (PDF)"}
                        </a>
                        <p>
                          {[r.kind, r.models, r.language, r.revision]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        {r.source && <small>Source: {r.source}</small>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </PageSection>
        </PageSections>
      </div>
      {addons}
    </section>
  );
}
function ProductAddons({
  accountId,
  product,
  add,
}: {
  accountId: string;
  product: CustomerProduct;
  add: (product: CustomerProduct, quantity: number) => void;
}) {
  const suggestions = useAddonSuggestions(accountId, [product.id]);
  return (
    <AddonSuggestions
      title="Suggested add-ons"
      addons={suggestions[0]?.addons ?? []}
      add={(addon) => add(addon, 1)}
    />
  );
}
function FocusedProduct({
  accountId,
  productId,
  back,
  add,
}: {
  accountId: string;
  productId: string;
  back: () => void;
  add: (product: CustomerProduct, quantity: number) => void;
}) {
  const [product, setProduct] = useState<CustomerProduct | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setProduct(null);
    setError("");
    void request<CustomerProductPage>(
      `/api/catalog/customer-products/page?accountId=${encodeURIComponent(accountId)}&productId=${encodeURIComponent(productId)}`,
      { signal: controller.signal },
    )
      .then((page) => {
        if (controller.signal.aborted) return;
        if (page.items[0]) setProduct(page.items[0]);
        else
          setError(
            "This product is unavailable in your current approved catalog.",
          );
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : "Product could not be loaded.",
          );
      });
    return () => controller.abort();
  }, [accountId, productId, attempt]);
  if (product)
    return (
      <ProductDetail
        key={product.id}
        product={product}
        back={back}
        add={(quantity) => add(product, quantity)}
        addons={
          <ProductAddons accountId={accountId} product={product} add={add} />
        }
      />
    );
  return (
    <section aria-label="Selected product">
      <button className="sf-back" onClick={back}>
        Return to Shop
      </button>
      {error ? (
        <>
          <p role="alert">{error}</p>
          <button onClick={() => setAttempt((value) => value + 1)}>
            Retry product
          </button>
        </>
      ) : (
        <p role="status">Checking current product access and pricing…</p>
      )}
    </section>
  );
}
function ProductResults({
  accountId,
  search,
  category,
  add,
  clearFilters,
  productId,
  selectProduct,
  currency,
}: {
  currency?: string;
  accountId: string;
  search: string;
  category: string;
  add: (product: CustomerProduct, quantity: number) => void;
  clearFilters: () => void;
  productId?: string;
  selectProduct: (productId?: string) => void;
}) {
  const rows = usePages<CustomerProduct>(
    `/api/catalog/customer-products/page?accountId=${encodeURIComponent(accountId)}&q=${encodeURIComponent(search)}${category ? `&category=${encodeURIComponent(category)}` : ""}`,
  );
  const triggers = useRef(new Map<string, HTMLButtonElement>()),
    returnTo = useRef<{ key: string; scroll: number } | null>(null);
  useEffect(() => {
    if (!productId && returnTo.current) {
      triggers.current
        .get(returnTo.current.key)
        ?.focus({ preventScroll: true });
      window.scrollTo({ top: returnTo.current.scroll, behavior: "instant" });
      returnTo.current = null;
    }
  }, [productId]);
  const products = rows.items;
  function select(product: CustomerProduct, key: string) {
    returnTo.current = { key, scroll: window.scrollY };
    selectProduct(product.id);
  }
  function trigger(key: string) {
    return (element: HTMLButtonElement | null) => {
      if (element) triggers.current.set(key, element);
      else triggers.current.delete(key);
    };
  }
  if (productId)
    return (
      <FocusedProduct
        key={`${accountId}:${productId}`}
        accountId={accountId}
        productId={productId}
        back={() => selectProduct(undefined)}
        add={add}
      />
    );
  return (
    <>
      {rows.error && (
        <p role="alert" className="error">
          {rows.error}
        </p>
      )}
      <section className="sf-catalog" aria-label="Product catalog">
        <div className="sf-catalog-heading">
          <h2>Browse your catalog</h2>
          <div className="sf-results-summary">
            <p role="status">
              {products.length} matching{" "}
              {products.length === 1 ? "product" : "products"} loaded
              {rows.busy ? " · Loading…" : ""}
            </p>
            <span>
              {currency || products[0]?.currency
                ? `${currency || products[0]?.currency} · `
                : ""}
              Prices before tax
            </span>
          </div>
        </div>
        <div className="sf-grid">
          {products.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              buttonRef={trigger(p.id)}
              select={() => select(p, p.id)}
              add={(quantity) => add(p, quantity)}
            />
          ))}
        </div>
        {rows.loaded && !rows.busy && !products.length && (
          <div className="sf-empty">
            <p>
              {search || category
                ? "No matching products. Try another search or category."
                : "Your approved catalog is not available yet. Contact your distributor to arrange product access."}
            </p>
            {(search || category) && (
              <button type="button" className="sf-back" onClick={clearFilters}>
                Clear search and filters
              </button>
            )}
          </div>
        )}
        {(rows.next || rows.error) && (
          <button
            className="sf-more"
            disabled={rows.busy}
            onClick={() => void rows.load()}
          >
            {rows.error ? "Retry products" : "Load more products"}
          </button>
        )}
      </section>
    </>
  );
}
export function Storefront({
  reference,
  accountId,
  cartScope,
  warehouses,
  checkout,
  productId,
  selectProduct,
  refreshKey,
  currency,
}: {
  currency?: string;
  refreshKey?: string;
  productId?: string;
  selectProduct: (productId?: string) => void;
  accountId: string;
  reference?: ReferenceRequest;
  cartScope: string;
  warehouses: ShopWarehouse[];
  // Saves the lines into the warehouse cart and opens the quantity review;
  // `saved` runs once the server cart holds them.
  checkout: (
    warehouseId: string,
    lines: { productId: string; quantity: number }[],
    saved: () => void,
    returnFocus?: HTMLElement | null,
  ) => Promise<unknown>;
}) {
  const cart = useShopCart(cartScope),
    [cartOpen, setCartOpen] = useState(false),
    [added, setAdded] = useState(""),
    [addedProductId, setAddedProductId] = useState("");
  const units = cart.lines.reduce((sum, l) => sum + l.quantity, 0);
  function add(product: CustomerProduct, quantity: number) {
    const refused = cart.add(product, quantity);
    setAddedProductId(product.id);
    setAdded(refused || `Added ${quantity} × ${product.name} to your cart.`);
  }
  useEffect(() => {
    // Opening a product shows that product from the top of the page.
    if (productId) window.scrollTo({ top: 0, behavior: "instant" });
    setAdded("");
  }, [productId]);
  const [search, setSearch] = useState(""),
    [category, setCategory] = useState(""),
    [query, setQuery] = useState(""),
    [searchOpen, setSearchOpen] = useState(false);
  const [cartSlot, setCartSlot] = useState<HTMLElement | null>(null),
    [searchSlot, setSearchSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setCartSlot(document.getElementById("workspace-cart-slot"));
    setSearchSlot(document.getElementById("workspace-search-slot"));
  }, []);
  const searchId = useId(),
    searchWrapper = useRef<HTMLDivElement>(null),
    searchTrigger = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null),
    restoreSearchFocus = useRef(false);
  useEffect(() => {
    if (restoreSearchFocus.current) {
      searchInput.current?.focus();
      restoreSearchFocus.current = false;
    }
  }, [query, category]);
  useEffect(() => {
    if (!searchOpen) return;
    searchInput.current?.focus();
    const outside = (event: Event) => {
      if (!searchWrapper.current?.contains(event.target as Node))
        setSearchOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setSearchOpen(false);
      searchTrigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [searchOpen]);
  const filters = (
    <form
      className="sf-search"
      onSubmit={(e) => {
        e.preventDefault();
        const nextQuery = search.trim();
        if (nextQuery !== query) restoreSearchFocus.current = true;
        setQuery(nextQuery);
      }}
    >
      <label>
        Search products
        <div className="sf-search-input">
          <svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <circle cx="10" cy="10" r="6.5" />
            <path d="m15 15 6 6" />
          </svg>
          <input
            ref={searchInput}
            type="search"
            value={search}
            maxLength={120}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Product name or SKU"
          />
        </div>
      </label>
      <label>
        Category
        <select
          aria-label="Category"
          value={category}
          onChange={(e) => {
            restoreSearchFocus.current = true;
            setCategory(e.target.value);
          }}
        >
          <option value="">All products</option>
          <option value="serialized">Serialized equipment</option>
          <option value="bulk">Bulk products</option>
        </select>
      </label>
      <button className="sf-primary" type="submit">
        Search <Arrow />
      </button>
    </form>
  );
  const cartFeedback = useMemo(
    () => ({
      productId: addedProductId,
      message: added,
      viewCart: () => {
        setCartOpen(true);
        document
          .querySelector(".sf-cart-entry")
          ?.scrollIntoView({ block: "start" });
      },
    }),
    [addedProductId, added],
  );
  const searchDropdown = (
    <div ref={searchWrapper}>
      <button
        ref={searchTrigger}
        type="button"
        className="secondary icon-button search-icon-button"
        aria-label="Search products"
        title="Search products"
        aria-expanded={searchOpen}
        aria-controls={searchId}
        onMouseDown={(event) => {
          // Safari can move focus to the page before click, dismissing and then
          // reopening this disclosure. Keep the pointer transition inside it.
          event.preventDefault();
          event.currentTarget.focus();
        }}
        onClick={() => setSearchOpen(!searchOpen)}
      >
        <ControlIcon name="search" />
        {(query || category) && (
          <span className="search-active-dot" aria-hidden="true" />
        )}
      </button>
      <div
        id={searchId}
        className="storefront workspace-search-panel"
        role="region"
        aria-label="Product search"
        hidden={!searchOpen}
      >
        {filters}
      </div>
    </div>
  );
  const cartLabel = cartOpen
    ? "Close cart"
    : `View cart (${units} ${units === 1 ? "item" : "items"})`;
  const cartButton = (
    <button
      type="button"
      className="secondary icon-button cart-icon-button"
      aria-label={cartLabel}
      title={cartLabel}
      aria-expanded={cartOpen}
      onClick={() => {
        setCartOpen(!cartOpen);
        setSearchOpen(false);
        setAdded("");
      }}
    >
      <ControlIcon name="cart" />
      <span className="cart-count" aria-hidden="true">
        {units > 99 ? "99+" : units}
      </span>
    </button>
  );
  return (
    <CartFeedbackContext.Provider value={cartFeedback}>
      {cartSlot && createPortal(cartButton, cartSlot)}
      {searchSlot && createPortal(searchDropdown, searchSlot)}
      <div className="storefront">
        <div className="sf-cart-entry">
          <p className="sf-cart-status" role="status">
            {added}
          </p>
          {!cartSlot && <div className="sf-cart-actions">{cartButton}</div>}
          {!searchSlot && searchDropdown}
        </div>
        {cartOpen && (
          <ShopCart
            accountId={accountId}
            add={add}
            lines={cart.lines}
            warehouses={warehouses}
            setQuantity={cart.setQuantity}
            remove={cart.remove}
            close={() => setCartOpen(false)}
            checkout={async (warehouseId, returnFocus) => {
              await checkout(
                warehouseId,
                cart.lines.map((l) => ({
                  productId: l.product.id,
                  quantity: l.quantity,
                })),
                () => {
                  cart.clear();
                  setCartOpen(false);
                },
                returnFocus,
              );
            }}
          />
        )}
        {/* Product results stay mounted behind the cart to keep loaded pages. */}
        <div hidden={cartOpen}>
          {reference && !productId && (
            <ReferenceMatches
              reference={reference}
              accountId={accountId}
              add={add}
            />
          )}

          <ProductResults
            key={`${accountId}:${query}:${category}:${refreshKey ?? ""}`}
            accountId={accountId}
            currency={currency}
            productId={productId}
            selectProduct={selectProduct}
            search={query}
            category={category}
            add={add}
            clearFilters={() => {
              setSearchOpen(true);
              restoreSearchFocus.current = true;
              setSearch("");
              setQuery("");
              setCategory("");
            }}
          />
        </div>
      </div>
    </CartFeedbackContext.Provider>
  );
}
