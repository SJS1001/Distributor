import { ReferenceMatches } from "./gree-reference-loader.tsx";
import type { ReferenceRequest } from "./reference-context.ts";
import { CustomerPrice } from "./customer-pricing.tsx";
import { AvailabilityBadge } from "./product-availability.tsx";
import { ManufacturerCollection } from "./manufacturer-collection.tsx";
import React, { useEffect, useRef, useState } from "react";
import { request } from "./api.ts";
import { usePages } from "./billing-inbox.tsx";
import { PageSection, PageSections } from "./workspace.tsx";
import type { CustomerProduct } from "../shared/customer-products.ts";
import type { CatalogResource } from "../shared/catalog-media.ts";
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
    [busy, setBusy] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setItems([]);
    setError("");
    setBusy(true);
    void request<{ items: CatalogResource[] }>(resourcePath(productId), {
      signal: controller.signal,
    })
      .then((r) => {
        if (!controller.signal.aborted) setItems(r.items);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [productId, epoch]);
  return { items, error, busy };
}
export function ProductImage({
  product,
  resource,
}: {
  product: { name: string; sku: string };
  resource?: CatalogResource;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [resource?.id, resource?.version]);
  return resource && !resource.externalUrl && !failed ? (
    <img
      className="product-image"
      src={`${resourcePath(resource.productId, resource.id)}/bytes?v=${resource.version}`}
      alt={resource.altText}
      loading="lazy"
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
        <path d="M35 183h270" opacity=".2" />
        <path d="m48 58 16-12h214l16 12v54l-16 13H64l-16-13Z" />
        <path d="M48 58h246M64 125v-15h214v15M71 100h200M74 105h194M62 65v20M280 65v20" />
        <path d="M74 74h164M74 81h164" opacity=".25" />
        <path d="M261 77h8M261 82h4" />
        <rect x="98" y="144" width="146" height="32" rx="3" />
        <path
          d="M109 151h82M109 157h82M109 163h82M212 151v16M219 151v16M226 151v16M106 176v7M234 176v7"
          opacity=".55"
        />
        <path
          d="M66 145v27m-5-5 5 5 5-5M268 154v-22m-5 5 5-5 5 5"
          opacity=".3"
        />
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
  buttonRef,
}: {
  product: CustomerProduct;
  select: () => void;
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
      </div>
    </article>
  );
}
export function ProductDetail({
  product,
  back,
  prepare,
}: {
  product: CustomerProduct;
  back: () => void;
  prepare: () => void;
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
      <button className="sf-back" onClick={back}>
        <Arrow back /> Back to products
      </button>
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
            <button className="sf-primary" onClick={prepare}>
              Prepare order with this product <Arrow />
            </button>
            <p className="sf-purchase-note">
              Review quantities and current terms before submitting. Distributor
              approval may be required; availability is confirmed at acceptance.
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
                <h3>Product documents</h3>
                <p>Check model, language and revision before use.</p>
              </div>
              <div>
                {resources.busy && <p role="status">Loading documents…</p>}
                {resources.error && <p role="alert">{resources.error}</p>}
                {!resources.busy && !documents.length && (
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
    </section>
  );
}
function ProductResults({
  accountId,
  search,
  category,
  prepare,
  filters,
}: {
  accountId: string;
  search: string;
  category: string;
  prepare: (product: CustomerProduct) => void;
  filters: React.ReactNode;
}) {
  const rows = usePages<CustomerProduct>(
      `/api/catalog/customer-products/page?accountId=${encodeURIComponent(accountId)}&q=${encodeURIComponent(search)}`,
    ),
    [selected, setSelected] = useState<CustomerProduct | null>(null),
    [featuredIndex, setFeaturedIndex] = useState(0);
  const triggers = useRef(new Map<string, HTMLButtonElement>()),
    returnTo = useRef<{ key: string; scroll: number } | null>(null);
  useEffect(() => {
    if (!selected && returnTo.current) {
      triggers.current
        .get(returnTo.current.key)
        ?.focus({ preventScroll: true });
      window.scrollTo({ top: returnTo.current.scroll, behavior: "instant" });
      returnTo.current = null;
    }
  }, [selected]);
  const products = rows.items.filter(
      (p) => !category || !!p.serialized === (category === "serialized"),
    ),
    featured = products[featuredIndex % Math.max(1, products.length)];
  function select(product: CustomerProduct, key: string) {
    returnTo.current = { key, scroll: window.scrollY };
    setSelected(product);
  }
  function trigger(key: string) {
    return (element: HTMLButtonElement | null) => {
      if (element) triggers.current.set(key, element);
      else triggers.current.delete(key);
    };
  }
  if (selected)
    return (
      <ProductDetail
        product={selected}
        back={() => setSelected(null)}
        prepare={() => prepare(selected)}
      />
    );
  return (
    <>
      {rows.error && (
        <p role="alert" className="error">
          {rows.error}
        </p>
      )}
      {!search && !category && featured && (
        <section
          className="sf-showcase"
          aria-label="Featured products"
          aria-roledescription="carousel"
        >
          <div className="sf-showcase-copy">
            <p className="sf-kicker">From your approved catalog</p>
            <p className="sf-showcase-label">
              Equipment for your next project.
            </p>
            <div
              className="sf-featured-description"
              aria-live="polite"
              aria-atomic="true"
            >
              <p className="sf-sku">{featured.sku}</p>
              <h2>{featured.name}</h2>
              <AvailabilityBadge product={featured} />
              <div className="sf-showcase-price">
                <CustomerPrice product={featured} />
                <span>Before tax</span>
              </div>
            </div>
            <button
              className="sf-showcase-link"
              ref={trigger("featured")}
              onClick={() => select(featured, "featured")}
            >
              Explore featured product <Arrow />
            </button>
            <div className="sf-carousel-controls">
              <button
                className="sf-arrow"
                aria-label="Previous featured product"
                disabled={products.length < 2}
                onClick={() =>
                  setFeaturedIndex(
                    (featuredIndex + products.length - 1) % products.length,
                  )
                }
              >
                <Arrow back />
              </button>
              <span className="sf-carousel-position">
                <strong>
                  {String((featuredIndex % products.length) + 1).padStart(
                    2,
                    "0",
                  )}
                </strong>
                <span>/ {String(products.length).padStart(2, "0")}</span>
              </span>
              <button
                className="sf-arrow"
                aria-label="Next featured product"
                disabled={products.length < 2}
                onClick={() =>
                  setFeaturedIndex((featuredIndex + 1) % products.length)
                }
              >
                <Arrow />
              </button>
            </div>
          </div>
          <div className="sf-showcase-media">
            <span className="sf-showcase-marker" aria-hidden="true">
              PRODUCT SPOTLIGHT
            </span>
            <FeaturedImage key={featured.id} product={featured} />
          </div>
        </section>
      )}
      <section className="sf-catalog" aria-label="Product catalog">
        <div className="sf-catalog-heading">
          <div>
            <p className="sf-kicker">Made for your account</p>
            <h2>Browse your catalog</h2>
          </div>
          <p>
            Approved products.
            <br />
            Your account pricing.
          </p>
        </div>
        {filters}
        <div className="sf-results-summary">
          <p role="status">
            {products.length} matching products loaded
            {rows.busy ? " · Loading…" : ""}
          </p>
          <span>Prices before tax</span>
        </div>
        <div className="sf-grid">
          {products.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              buttonRef={trigger(p.id)}
              select={() => select(p, p.id)}
            />
          ))}
        </div>
        {rows.loaded && !rows.busy && !products.length && (
          <div className="sf-empty">
            {search || category
              ? "No matching products in the loaded catalog. Try another search or load the next page."
              : "Your approved catalog is not available yet. Contact your distributor to arrange product access."}
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
function FeaturedImage({ product }: { product: CustomerProduct }) {
  const resources = useResources(product.id);
  return (
    <ProductImage
      product={product}
      resource={resources.items.find(
        (r) => r.kind === "image" && r.state === "published",
      )}
    />
  );
}
export function Storefront({
  reference,
  accountId,
  accountName,
  prepare,
}: {
  accountId: string;
  accountName: string;
  reference?: ReferenceRequest;
  prepare: (product: CustomerProduct) => void;
}) {
  const [search, setSearch] = useState(""),
    [category, setCategory] = useState(""),
    [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null),
    restoreSearchFocus = useRef(false);
  useEffect(() => {
    // A new query remounts usePages to discard the old cursor and cancel its request.
    // Return focus to the replacement search field after that remount.
    if (restoreSearchFocus.current) {
      searchInput.current?.focus();
      restoreSearchFocus.current = false;
    }
  }, [query]);
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
          onChange={(e) => setCategory(e.target.value)}
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
  return (
    <div className="storefront">
      {reference && (
        <ReferenceMatches
          reference={reference}
          accountId={accountId}
          prepare={prepare}
        />
      )}
      <ManufacturerCollection />
      <p className="sf-account-context">
        Curated for <strong>{accountName}</strong>
        <span>Approved products & account pricing</span>
      </p>
      <ProductResults
        key={`${accountId}:${query}`}
        accountId={accountId}
        search={query}
        category={category}
        prepare={prepare}
        filters={filters}
      />
    </div>
  );
}
