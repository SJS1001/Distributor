import React, { useEffect, useRef, useState } from "react";
import { request } from "./api.ts";
import { usePages } from "./billing-inbox.tsx";
import { PageSection, PageSections } from "./workspace.tsx";
import type { CustomerProduct } from "../shared/customer-products.ts";
import type { CatalogResource } from "../shared/catalog-media.ts";

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
      <svg viewBox="0 0 160 110" aria-hidden="true">
        <rect x="20" y="22" width="120" height="64" rx="8" />
        <path d="M34 40h92M34 48h92M34 56h92M34 72h55" />
        <circle cx="119" cy="72" r="3" />
      </svg>
      <span>{product.sku}</span>
      <small>Image not available</small>
    </div>
  );
}
function ProductCard({
  product,
  select,
}: {
  product: CustomerProduct;
  select: () => void;
}) {
  const resources = useResources(product.id);
  return (
    <article className="shop-card">
      <ProductImage
        product={product}
        resource={resources.items.find(
          (r) => r.kind === "image" && r.state === "published",
        )}
      />
      <div className="shop-card-body">
        <small>{product.sku}</small>
        <h3>{product.name}</h3>
        <p>
          <strong>{displayMoney(product.unit_price, product.currency)}</strong>{" "}
          <small>
            + {displayMoney(product.unit_tax, product.currency)} tax / unit
          </small>
        </p>
        <button onClick={select} aria-label={`View ${product.name}`}>
          View product
        </button>
      </div>
    </article>
  );
}
function ProductDetail({
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
    <section className="panel product-detail">
      <button onClick={back}>Back to products</button>
      <div className="product-detail-top">
        <div>
          <ProductImage product={product} resource={images[imageIndex]} />
          {images.length > 1 && (
            <div className="actions" aria-label="Product images">
              <button
                aria-label="Previous image"
                onClick={() =>
                  setImageIndex(
                    (imageIndex + images.length - 1) % images.length,
                  )
                }
              >
                Previous
              </button>
              <span role="status">
                Image {imageIndex + 1} of {images.length}
              </span>
              <button
                aria-label="Next image"
                onClick={() => setImageIndex((imageIndex + 1) % images.length)}
              >
                Next
              </button>
            </div>
          )}
        </div>
        <div>
          <p className="eyebrow">{product.sku}</p>
          <h2 tabIndex={-1} ref={heading}>
            {product.name}
          </h2>
          <p className="shop-price">
            {displayMoney(product.unit_price, product.currency)}
          </p>
          <p>
            + {displayMoney(product.unit_tax, product.currency)} tax per unit ·
            Your account price
          </p>
          <button onClick={prepare}>Prepare order with this product</button>
          <p>
            Review quantities and current terms before submitting. Distributor
            approval may be required; availability is confirmed at acceptance.
          </p>
        </div>
      </div>
      <PageSections
        label="Product information"
        items={[
          { id: "product-overview", label: "Overview" },
          { id: "product-specifications", label: "Specifications" },
          { id: "product-documents", label: "Documents" },
        ]}
      >
        <PageSection id="product-overview">
          <h3>Product overview</h3>
          <p>{product.name}</p>
          <p>
            Check the exact model, components and installation requirements in
            the published documents. A family photograph does not confirm
            included components.
          </p>
        </PageSection>
        <PageSection id="product-specifications">
          <h3>Specifications</h3>
          <dl>
            <dt>SKU</dt>
            <dd>{product.sku}</dd>
            <dt>Tracking</dt>
            <dd>
              {product.serialized ? "Individually serialized" : "Bulk quantity"}
            </dd>
          </dl>
          <p>
            Model specifications are provided in the applicable published
            documents. Contact the distributor if an exact-model document is
            missing.
          </p>
        </PageSection>
        <PageSection id="product-documents">
          <h3>Product documents</h3>
          {resources.busy && <p role="status">Loading documents…</p>}
          {resources.error && <p role="alert">{resources.error}</p>}
          {!resources.busy && !documents.length && (
            <p>No documents have been published for this product.</p>
          )}
          <ul className="resource-list">
            {documents.map((r) => (
              <li key={r.id}>
                <a
                  href={
                    r.externalUrl || `${resourcePath(product.id, r.id)}/bytes`
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
              </li>
            ))}
          </ul>
        </PageSection>
      </PageSections>
    </section>
  );
}
function ProductResults({
  accountId,
  search,
  category,
  prepare,
}: {
  accountId: string;
  search: string;
  category: string;
  prepare: (product: CustomerProduct) => void;
}) {
  const rows = usePages<CustomerProduct>(
      `/api/catalog/customer-products/page?accountId=${encodeURIComponent(accountId)}&q=${encodeURIComponent(search)}`,
    ),
    [selected, setSelected] = useState<CustomerProduct | null>(null),
    [featuredIndex, setFeaturedIndex] = useState(0);
  const products = rows.items.filter(
      (p) => !category || !!p.serialized === (category === "serialized"),
    ),
    featured = products[featuredIndex % Math.max(1, products.length)];
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
          className="shop-featured"
          aria-label="Featured products"
          aria-roledescription="carousel"
        >
          <div>
            <p className="eyebrow">Explore your catalog</p>
            <h2>{featured.name}</h2>
            <p>
              {featured.sku} ·{" "}
              {displayMoney(featured.unit_price, featured.currency)} before tax
            </p>
            <button onClick={() => setSelected(featured)}>
              Explore featured product
            </button>
            <div className="actions">
              <button
                aria-label="Previous featured product"
                disabled={products.length < 2}
                onClick={() =>
                  setFeaturedIndex(
                    (featuredIndex + products.length - 1) % products.length,
                  )
                }
              >
                Previous
              </button>
              <span aria-live="polite">
                {(featuredIndex % products.length) + 1} / {products.length}
              </span>
              <button
                aria-label="Next featured product"
                disabled={products.length < 2}
                onClick={() =>
                  setFeaturedIndex((featuredIndex + 1) % products.length)
                }
              >
                Next
              </button>
            </div>
          </div>
          <FeaturedImage key={featured.id} product={featured} />
        </section>
      )}
      <p role="status">
        {products.length} matching products loaded
        {rows.busy ? " · Loading…" : ""}
      </p>
      <div className="shop-grid">
        {products.map((p) => (
          <ProductCard key={p.id} product={p} select={() => setSelected(p)} />
        ))}
      </div>
      {rows.loaded && !rows.busy && !products.length && (
        <div className="empty">
          {search || category
            ? "No matching products in the loaded catalog. Try another search or load the next page."
            : "Your approved catalog is not available yet. Contact your distributor to arrange product access."}
        </div>
      )}
      {(rows.next || rows.error) && (
        <button disabled={rows.busy} onClick={() => void rows.load()}>
          {rows.error ? "Retry products" : "Load more products"}
        </button>
      )}
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
  accountId,
  accountName,
  prepare,
}: {
  accountId: string;
  accountName: string;
  prepare: (product: CustomerProduct) => void;
}) {
  const [search, setSearch] = useState(""),
    [category, setCategory] = useState(""),
    [query, setQuery] = useState("");
  return (
    <>
      <p>
        Approved products and account pricing for <strong>{accountName}</strong>
        .
      </p>
      <form
        className="shop-search"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(search.trim());
        }}
      >
        <label>
          Search products
          <input
            type="search"
            value={search}
            maxLength={120}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Product name or SKU"
          />
        </label>
        <label>
          Category
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All products</option>
            <option value="serialized">Serialized equipment</option>
            <option value="bulk">Bulk products</option>
          </select>
        </label>
        <button type="submit">Search</button>
      </form>
      <ProductResults
        key={`${accountId}:${query}`}
        accountId={accountId}
        search={query}
        category={category}
        prepare={prepare}
      />
    </>
  );
}
