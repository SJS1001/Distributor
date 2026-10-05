import { referenceHref } from "./reference-context.ts";
import { useEffect, useState } from "react";
import catalogData from "./gree-catalog-data.json" with { type: "json" };
import "./gree-product-library.css";

export type GreeProduct = {
  id: string;
  handle: string;
  title: string;
  category: string;
  categoryId: string;
  description: string;
  images: { url: string; alt: string }[];
  documents: { title: string; url: string; kind: string }[];
  sourceUrl: string;
  specifications?: { label: string; value: string }[];
  models?: {
    id: string;
    title: string;
    manufacturerModel?: string;
    specifications: { label: string; value: string }[];
  }[];
};
export const greeProducts = catalogData.products as GreeProduct[];
export const greeCategories = catalogData.categories;
export const productHref = (product: GreeProduct) =>
  `#product=${encodeURIComponent(product.id)}`;
export function ProductImage({
  product,
  className,
  eager = false,
}: {
  product: GreeProduct;
  className?: string;
  eager?: boolean;
}) {
  const image = product.images[0];
  return image ? (
    <img
      className={className}
      src={image.url}
      alt={image.alt || product.title}
      loading={eager ? "eager" : "lazy"}
    />
  ) : (
    <div className="gree-image-unavailable">Product image unavailable</div>
  );
}
export function GreeProductLibrary({
  detail = false,
  authenticated = false,
  customerAuthenticated = false,
}: {
  detail?: boolean;
  authenticated?: boolean;
  customerAuthenticated?: boolean;
}) {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const update = () => {
      setHash(window.location.hash);
      document.querySelector<HTMLElement>(".public-main")?.focus();
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  const categoryFromHash =
    new URLSearchParams(hash.split("?")[1] || "").get("category") || "all";
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(categoryFromHash);
  useEffect(() => {
    setCategory(categoryFromHash);
  }, [categoryFromHash]);
  const selectedId = (() => {
    try {
      return decodeURIComponent(
        hash.slice("#product=".length).split("&")[0] ?? "",
      );
    } catch {
      return "";
    }
  })();
  const selected = greeProducts.find(
    (product) => product.id === selectedId || product.handle === selectedId,
  );
  if (detail)
    return selected ? (
      <GreeProductDetail
        key={`${selected.id}:${hash}`}
        product={selected}
        authenticated={authenticated}
        customerAuthenticated={customerAuthenticated}
      />
    ) : (
      <section className="gree-library">
        <h1>Product not found</h1>
        <p>This product link is unavailable.</p>
        <a className="public-primary" href="#products">
          Browse products →
        </a>
      </section>
    );
  const selectedCategory = greeCategories.find((item) => item.id === category);
  const visible = greeProducts.filter(
    (product) =>
      (!selectedCategory || selectedCategory.productIds.includes(product.id)) &&
      `${product.title} ${product.category} ${product.description} ${product.models?.map((model) => `${model.title} ${model.manufacturerModel || ""}`).join(" ") || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <section className="gree-library">
      <div className="gree-library-heading">
        <div>
          <p className="public-eyebrow">GREE CANADA • PRODUCT LIBRARY</p>
          <h1>Find your next system.</h1>
          <p>
            Explore heating and cooling equipment, product information and
            technical documents.
          </p>
        </div>
        {customerAuthenticated && (
          <a className="public-primary" href="#page=Shop">
            View account pricing ↗
          </a>
        )}
      </div>
      <div className="gree-library-tools">
        <label>
          Search product families
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or equipment type"
          />
        </label>
        <label>
          Product category
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="all">All products</option>
            {greeCategories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="gree-results-heading">
        <h2>{selectedCategory?.title || "All products"}</h2>
        <span aria-live="polite">{visible.length} product families</span>
      </div>
      <div className="gree-product-grid">
        {visible.map((product) => (
          <a
            className="gree-product-card"
            href={productHref(product)}
            key={product.id}
          >
            <div className="gree-card-image">
              <ProductImage product={product} />
            </div>
            <div className="gree-card-copy">
              <p>{product.category}</p>
              <h3>{product.title}</h3>
              <span>
                Explore product <b aria-hidden="true">→</b>
              </span>
            </div>
          </a>
        ))}
      </div>
      {!visible.length && (
        <div className="gree-empty">
          <h3>No matching products</h3>
          <p>Try another name or category.</p>
          <button
            onClick={() => {
              setQuery("");
              setCategory("all");
            }}
          >
            Clear filters
          </button>
        </div>
      )}
      <p className="gree-source-note">
        Manufacturer reference library from{" "}
        <a href="https://www.gree.ca" target="_blank" rel="noreferrer">
          GREE Canada ↗
        </a>
        . Sign in for equipment offered to your account, current pricing and
        availability.
      </p>
    </section>
  );
}
function DescriptionContent({ text }: { text: string }) {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const features = lines.filter((line) => /^[■●•]/.test(line));
  return (
    <>
      {lines
        .filter((line) => !/^[■●•]/.test(line))
        .map((line, index) =>
          line.length < 90 &&
          (line === line.toUpperCase() || /^Key Features/i.test(line)) ? (
            <h3 key={index}>{line.replace(/\s*:\s*$/, "")}</h3>
          ) : (
            <p key={index}>{line}</p>
          ),
        )}
      {!!features.length && (
        <ul>
          {features.map((line, index) => (
            <li key={index}>{line.replace(/^[■●•]\s*/, "")}</li>
          ))}
        </ul>
      )}
    </>
  );
}
function GreeProductDetail({
  product,
  authenticated,
  customerAuthenticated,
}: {
  product: GreeProduct;
  authenticated: boolean;
  customerAuthenticated: boolean;
}) {
  const [imageIndex, setImageIndex] = useState(0);
  const [tab, setTab] = useState("overview");
  const image = product.images[imageIndex];
  const [modelId, setModelId] = useState(
    () =>
      new URLSearchParams(window.location.hash.slice(1)).get(
        "referenceModel",
      ) ||
      product.models?.[0]?.id ||
      "",
  );
  const selectedModel = product.models?.find((model) => model.id === modelId);
  const specifications =
    selectedModel?.specifications || product.specifications || [];
  const kinds = [
    ...new Set(
      product.documents.map(
        (document) => document.kind || "Technical documents",
      ),
    ),
  ];
  return (
    <article className="gree-detail">
      <nav className="gree-breadcrumb" aria-label="Breadcrumb">
        <a href="#home">Home</a>
        <span aria-hidden="true">/</span>
        <a href="#products">Products</a>
        <span aria-hidden="true">/</span>
        <a
          href={`#products?category=${encodeURIComponent(product.categoryId)}`}
        >
          {product.category}
        </a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{product.title}</span>
      </nav>
      <div className="gree-detail-top">
        <div className="gree-gallery">
          <div className="gree-gallery-stage">
            {image ? (
              <img src={image.url} alt={image.alt || product.title} />
            ) : (
              <div>Product image unavailable</div>
            )}
          </div>
          {product.images.length > 1 && (
            <div className="gree-thumbnails" aria-label="Product image gallery">
              {product.images.map((image, index) => (
                <button
                  key={`${image.url}-${index}`}
                  aria-label={`View image ${index + 1} of ${product.title}`}
                  aria-pressed={index === imageIndex}
                  onClick={() => setImageIndex(index)}
                >
                  <img src={image.url} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="gree-detail-copy">
          <p className="public-eyebrow">GREE • {product.category}</p>
          <h1>{product.title}</h1>
          <p className="gree-detail-summary">
            {product.description
              ? product.description
                  .split(/\n/)
                  .find((line) => line.length > 90) ||
                product.description.split(/\n/)[0]
              : `Explore ${product.title} equipment and manufacturer technical information.`}
          </p>
          <div className="gree-detail-actions">
            <a
              className="public-primary"
              href={referenceHref(
                customerAuthenticated
                  ? "#page=Shop"
                  : authenticated
                    ? "#page=Overview"
                    : "#customer-sign-in",
                { familyId: product.id, modelId: modelId || null },
              )}
            >
              {customerAuthenticated
                ? "View reviewed purchasing matches ↗"
                : authenticated
                  ? "Open staff workspace ↗"
                  : "Sign in for pricing & availability ↗"}
            </a>
            {!authenticated && (
              <a
                href={referenceHref("#apply", {
                  familyId: product.id,
                  modelId: modelId || null,
                })}
              >
                Apply for a trade account →
              </a>
            )}
          </div>
          <p className="gree-purchasing-note">
            Purchasing options depend on your approved trade account. Match the
            exact model and system combination before ordering.
          </p>
          <a
            className="public-text-link"
            href={product.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            View on GREE Canada ↗
          </a>
        </div>
      </div>
      <div
        className="gree-detail-tabs"
        role="tablist"
        aria-label="Product information"
        onKeyDown={(event) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const next =
              event.key === "Home"
                ? "overview"
                : event.key === "End"
                  ? "documents"
                  : tab === "overview"
                    ? "documents"
                    : "overview";
            setTab(next);
            document.getElementById(`gree-tab-${next}`)?.focus();
          }
        }}
      >
        <button
          id="gree-tab-overview"
          role="tab"
          aria-selected={tab === "overview"}
          aria-controls="product-overview"
          tabIndex={tab === "overview" ? 0 : -1}
          onClick={() => setTab("overview")}
        >
          Overview
        </button>
        <button
          id="gree-tab-documents"
          role="tab"
          aria-selected={tab === "documents"}
          aria-controls="product-documents"
          tabIndex={tab === "documents" ? 0 : -1}
          onClick={() => setTab("documents")}
        >
          Documents <span>{product.documents.length}</span>
        </button>
      </div>
      <section
        className="gree-overview"
        id="product-overview"
        role="tabpanel"
        aria-labelledby="gree-tab-overview"
        hidden={tab !== "overview"}
      >
        <div>
          <p className="public-eyebrow">PRODUCT INFORMATION</p>
          <h2>Built for your application.</h2>
        </div>
        <div className="gree-description">
          <DescriptionContent
            text={
              product.description ||
              "Refer to the manufacturer documentation for model-specific details."
            }
          />
          {!!product.models?.length && (
            <div className="gree-model-selector">
              <label htmlFor="gree-model">Model configuration</label>
              <select
                id="gree-model"
                value={modelId}
                onChange={(event) => {
                  setModelId(event.target.value);
                  window.history.replaceState(
                    null,
                    "",
                    referenceHref(productHref(product), {
                      familyId: product.id,
                      modelId: event.target.value,
                    }),
                  );
                }}
              >
                {product.models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.title}
                  </option>
                ))}
              </select>
              {selectedModel?.manufacturerModel && (
                <p>
                  <strong>Manufacturer model:</strong>{" "}
                  {selectedModel.manufacturerModel}
                </p>
              )}
            </div>
          )}
          {!!specifications.length && (
            <details className="gree-specification-details">
              <summary>
                View specifications ·{" "}
                {selectedModel?.title || "Published configuration"}
              </summary>
              <dl className="gree-specifications">
                {specifications.map((specification, index) => (
                  <div key={index}>
                    <dt>{specification.label}</dt>
                    <dd>{specification.value}</dd>
                  </div>
                ))}
              </dl>
              <p>
                Specifications apply to the selected manufacturer configuration.
                Verify the matching indoor and outdoor equipment in the
                technical documents.
              </p>
            </details>
          )}
        </div>
      </section>
      <section
        className="gree-documents"
        id="product-documents"
        role="tabpanel"
        aria-labelledby="gree-tab-documents"
        hidden={tab !== "documents"}
      >
        <p className="public-eyebrow">DOWNLOAD CENTRE</p>
        <h2>Technical documents.</h2>
        <p>
          Select the document for your exact model. Downloads open the
          manufacturer’s published file.
        </p>
        {kinds.length ? (
          <div className="gree-document-groups">
            {kinds.map((kind) => (
              <div key={kind}>
                <h3>{kind.replace(/[-_]/g, " ")}</h3>
                {product.documents
                  .filter(
                    (document) =>
                      (document.kind || "Technical documents") === kind,
                  )
                  .map((document, index) => (
                    <a
                      key={`${document.url}-${index}`}
                      href={document.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span className="gree-document-icon" aria-hidden="true">
                        ↓
                      </span>
                      <span>
                        {document.title}
                        <small>Manufacturer document · Open/download ↗</small>
                      </span>
                    </a>
                  ))}
              </div>
            ))}
          </div>
        ) : (
          <p>
            No direct downloads are listed in this reference.{" "}
            <a href={product.sourceUrl} target="_blank" rel="noreferrer">
              Check the manufacturer product page ↗
            </a>
          </p>
        )}
      </section>
      <div className="gree-detail-bottom">
        <h2>Ready for your next installation?</h2>
        <a
          className="public-primary"
          href={referenceHref(
            customerAuthenticated
              ? "#page=Shop"
              : authenticated
                ? "#page=Overview"
                : "#customer-sign-in",
            { familyId: product.id, modelId: modelId || null },
          )}
        >
          {authenticated
            ? customerAuthenticated
              ? "Open your trade account ↗"
              : "Open staff workspace ↗"
            : "Sign in to your trade account ↗"}
        </a>
      </div>
    </article>
  );
}
