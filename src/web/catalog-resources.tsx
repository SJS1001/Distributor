import { ProductAddonsEditor } from "./product-addons.tsx";
import { InfoBubble } from "./info-bubble.tsx";
import { RecordNotes } from "./record-notes.tsx";
import { UnitCostEditor } from "./price-authority.tsx";
import { ReferenceMappingEditor } from "./gree-reference-loader.tsx";
import React, { lazy, Suspense, useState } from "react";
import { resourceMutation } from "./api.ts";
import { PageSection, PageSections } from "./workspace.tsx";
import {
  ProductImage,
  resourcePath,
  useResources,
  displayMoney,
} from "./storefront.tsx";
import { ProductAvailabilityEditor } from "./product-availability.tsx";
import { ProductMsrpEditor } from "./customer-pricing.tsx";
import { ProductPurchasingRules } from "./purchasing-rules.tsx";
import "./record-forms.css";
import {
  catalogImageMaxBytes,
  catalogDocumentMaxBytes,
  catalogImageLinkUrl,
  type CatalogResource,
  type ResourceKind,
  type ResourceMetadata,
} from "../shared/catalog-media.ts";
import type { CatalogProduct } from "../shared/catalog-lifecycle.ts";
const ManufacturerImagePicker = lazy(
  () => import("./manufacturer-image-picker.tsx"),
);
const defaults: ResourceMetadata = {
  kind: "image",
  title: "",
  altText: "",
  models: "",
  language: "en",
  revision: "",
  source: "",
  position: 0,
};
function MetadataFields({
  value,
  change,
}: {
  value: ResourceMetadata;
  change: (value: ResourceMetadata) => void;
}) {
  return (
    <div className="resource-metadata">
      <div className="resource-field-group">
        <div className="info-heading">
          <h4>Identify the resource</h4>
          <InfoBubble label="Identify the resource">
            Name it clearly and specify the equipment it applies to.
          </InfoBubble>
        </div>
        <label>
          Resource title
          <input
            required
            maxLength={160}
            value={value.title}
            onChange={(e) => change({ ...value, title: e.target.value })}
          />
        </label>
        {value.kind === "image" && (
          <label>
            Alternative text
            <input
              required
              maxLength={500}
              value={value.altText ?? ""}
              onChange={(e) => change({ ...value, altText: e.target.value })}
            />
          </label>
        )}
        <label>
          Applicable models
          <input
            maxLength={500}
            value={value.models ?? ""}
            onChange={(e) => change({ ...value, models: e.target.value })}
          />
        </label>
      </div>
      <div className="resource-field-group">
        <div className="info-heading">
          <h4>Edition &amp; source</h4>
          <InfoBubble label="Edition & source">
            Keep the language, revision and publisher reference together.
          </InfoBubble>
        </div>
        <label>
          Language
          <input
            maxLength={40}
            value={value.language ?? ""}
            onChange={(e) => change({ ...value, language: e.target.value })}
          />
        </label>
        <label>
          Document revision
          <input
            maxLength={100}
            value={value.revision ?? ""}
            onChange={(e) => change({ ...value, revision: e.target.value })}
          />
        </label>
        <label>
          Source and provenance
          <input
            maxLength={1000}
            value={value.source ?? ""}
            onChange={(e) => change({ ...value, source: e.target.value })}
          />
        </label>
        <label>
          Display position
          <input
            type="number"
            min={0}
            max={9999}
            required
            value={value.position ?? 0}
            onChange={(e) => {
              const position = e.target.valueAsNumber;
              if (Number.isFinite(position)) change({ ...value, position });
            }}
          />
        </label>
      </div>
    </div>
  );
}
function ResourceEditor({
  resource,
  product,
  changed,
  canManage,
}: {
  resource: CatalogResource;
  canManage: boolean;
  product: CatalogProduct;
  changed: () => void;
}) {
  const [metadata, setMetadata] = useState<ResourceMetadata>({ ...resource }),
    [permission, setPermission] = useState(false),
    [basis, setBasis] = useState(""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const run = async (
    path: string,
    payload: unknown,
    method: "POST" | "PATCH" = "POST",
  ) => {
    setBusy(true);
    setError("");
    try {
      await resourceMutation(path, method, payload);
      changed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="resource-editor">
      <h4>{resource.title}</h4>
      <p>
        {resource.state} · Version {resource.version} · {resource.inspection} ·{" "}
        {resource.bytes.toLocaleString()} bytes
      </p>
      {resource.kind === "image" ? (
        <ProductImage product={product} resource={resource} />
      ) : (
        <a
          href={
            resource.externalUrl ||
            `${resourcePath(product.id, resource.id)}/bytes`
          }
          target="_blank"
          rel="noopener noreferrer"
        >
          Preview resource
          {resource.externalUrl ? " (external website)" : " (download PDF)"}
        </a>
      )}
      {resource.inspection === "quarantined" && (
        <p>
          PDF is quarantined. Publication requires a configured trusted
          inspection result.
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {canManage && (
        <>
          <details>
            <summary>Edit resource metadata</summary>
            <p>
              Saving metadata returns this resource to draft. Review and publish
              it again to make the changes available to buyers.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(
                  resourcePath(product.id, resource.id),
                  {
                    kind: metadata.kind,
                    title: metadata.title,
                    altText: metadata.altText,
                    models: metadata.models,
                    language: metadata.language,
                    revision: metadata.revision,
                    source: metadata.source,
                    position: metadata.position,
                    expectedVersion: resource.version,
                  },
                  "PATCH",
                );
              }}
            >
              <fieldset disabled={busy}>
                <MetadataFields value={metadata} change={setMetadata} />
                <button type="submit">Save metadata</button>
              </fieldset>
            </form>
          </details>
          {resource.state !== "published" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(`${resourcePath(product.id, resource.id)}/publish`, {
                  expectedVersion: resource.version,
                  permissionAffirmed: permission,
                  permissionBasis: basis,
                });
              }}
            >
              <fieldset disabled={busy}>
                <legend>Publish resource</legend>
                <label>
                  <input
                    type="checkbox"
                    required
                    checked={permission}
                    onChange={(e) => setPermission(e.target.checked)}
                  />
                  I confirm ownership or permission to distribute this resource
                </label>
                <label>
                  Permission basis
                  <textarea
                    required
                    maxLength={1000}
                    value={basis}
                    onChange={(e) => setBasis(e.target.value)}
                  />
                </label>
                <button
                  type="submit"
                  disabled={resource.inspection === "quarantined"}
                >
                  Publish to eligible buyers
                </button>
              </fieldset>
            </form>
          )}
          {resource.state !== "retired" && (
            <details>
              <summary>Retire resource</summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(`${resourcePath(product.id, resource.id)}/retire`, {
                    expectedVersion: resource.version,
                    reason,
                  });
                }}
              >
                <fieldset disabled={busy}>
                  <label>
                    Reason for retirement
                    <input
                      required
                      maxLength={1000}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  <button type="submit">Retire resource</button>
                </fieldset>
              </form>
            </details>
          )}
        </>
      )}
    </article>
  );
}
async function prepareResourceUpload(
  metadata: ResourceMetadata,
  mode: string,
  url: string,
  file: File | null,
  images: boolean,
) {
  let upload: Record<string, unknown> = { ...metadata };
  if (mode !== "upload") {
    if (images && !catalogImageLinkUrl(url))
      throw Error(
        "Use an HTTPS image URL hosted on cdn.shopify.com, or upload the image file.",
      );
    upload.externalUrl = url;
  } else {
    if (!file) throw Error("Choose a file.");
    const limit = images ? catalogImageMaxBytes : catalogDocumentMaxBytes;
    if (file.size > limit)
      throw Error(`File exceeds ${limit / 1024 / 1024} MB.`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 32768)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    upload = {
      ...upload,
      mediaType: file.type,
      contentBase64: btoa(binary),
    };
  }
  return upload;
}
function ResourceDraftForm({
  product,
  images,
  busy,
  setBusy,
  changed,
}: {
  product: CatalogProduct;
  images: boolean;
  busy: boolean;
  setBusy: (value: boolean) => void;
  changed: () => void;
}) {
  const [metadata, setMetadata] = useState<ResourceMetadata>({
      ...defaults,
      kind: images ? "image" : "literature",
    }),
    [file, setFile] = useState<File | null>(null),
    [url, setUrl] = useState(""),
    [mode, setMode] = useState("upload"),
    [expanded, setExpanded] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  return (
    <>
      <div className="resource-add">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          Add {images ? "image" : "document"}
        </button>
        {expanded && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              setNotice("");
              try {
                const upload = await prepareResourceUpload(
                  metadata,
                  mode,
                  url,
                  file,
                  images,
                );
                await resourceMutation(
                  resourcePath(product.id),
                  "POST",
                  upload,
                );
                setNotice(
                  "Draft resource added. Review metadata and permission before publishing.",
                );
                changed();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <fieldset disabled={busy}>
              <legend>Add draft resource</legend>
              {!images && (
                <label>
                  Document category
                  <select
                    value={metadata.kind}
                    onChange={(e) =>
                      setMetadata({
                        ...metadata,
                        kind: e.target.value as ResourceKind,
                      })
                    }
                  >
                    <option value="literature">Sales literature</option>
                    <option value="installation">Installation guide</option>
                    <option value="maintenance">
                      Maintenance / service guide
                    </option>
                    <option value="other">Other document</option>
                  </select>
                </label>
              )}
              <label>
                {images ? "Image source" : "Resource source"}
                <select
                  aria-label={images ? "Image source" : "Resource source"}
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                >
                  <option value="upload">
                    {images ? "Upload image" : "Upload PDF"}
                  </option>
                  <option value="link">
                    {images
                      ? "Manufacturer image URL"
                      : "Official HTTPS document link"}
                  </option>
                  {images && (
                    <option value="library">Choose from GREE library</option>
                  )}
                </select>
              </label>
              {mode === "library" && (
                <Suspense
                  fallback={<p role="status">Loading manufacturer images…</p>}
                >
                  <ManufacturerImagePicker
                    reset={() => setUrl("")}
                    choose={(image) => {
                      setUrl(image.url);
                      setMetadata({
                        ...metadata,
                        title: image.title,
                        altText: image.alt,
                        source: image.source,
                      });
                    }}
                  />
                </Suspense>
              )}
              {mode !== "upload" ? (
                <>
                  <label>
                    {images ? "HTTPS image URL" : "HTTPS document URL"}
                    <input
                      type="url"
                      required
                      pattern="https://.*"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                    />
                  </label>
                  {images && (
                    <p>
                      Links support cdn.shopify.com. For other image hosts,
                      upload a JPEG, PNG or WebP file. Linked photographs load
                      from the publisher; confirm permission and the matching
                      equipment before publishing.
                    </p>
                  )}
                </>
              ) : (
                <label>
                  {images
                    ? "Image file (JPEG, PNG or WebP; maximum 8 MB)"
                    : "PDF file (maximum 16 MB)"}
                  <input
                    type="file"
                    required
                    accept={
                      images
                        ? "image/jpeg,image/png,image/webp"
                        : "application/pdf"
                    }
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              )}
              <MetadataFields value={metadata} change={setMetadata} />
              <button type="submit">Save draft resource</button>
            </fieldset>
          </form>
        )}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </>
  );
}
function ResourceCollection({
  product,
  images,
  canManage,
}: {
  product: CatalogProduct;
  images: boolean;
  canManage: boolean;
}) {
  const [epoch, setEpoch] = useState(0),
    rows = useResources(product.id, epoch),
    [busy, setBusy] = useState(false);
  return (
    <>
      <h3>{images ? "Product images" : "Product documents"}</h3>
      <p>
        {images
          ? "The first published image by display position is the primary image. Add a replacement as a draft, publish it, then retire the previous resource."
          : "Attach literature, installation and service documents to the exact applicable models."}
      </p>
      {rows.error && <p role="alert">{rows.error}</p>}
      {rows.busy && <p role="status">Loading resources…</p>}
      <button disabled={busy} onClick={() => setEpoch(epoch + 1)}>
        Refresh resources
      </button>
      {rows.loaded &&
        !rows.busy &&
        !rows.error &&
        !rows.items.some((r) => (r.kind === "image") === images) && (
          <p className="empty">
            No {images ? "images" : "documents"} recorded.
            {canManage
              ? ` Use Add ${images ? "image" : "document"} to attach a resource.`
              : " Ask an administrator to attach a resource."}
          </p>
        )}
      {canManage && (
        <ResourceDraftForm
          product={product}
          images={images}
          busy={busy}
          setBusy={setBusy}
          changed={() => setEpoch((value) => value + 1)}
        />
      )}
      <div className="resource-grid">
        {rows.items
          .filter((r) => (r.kind === "image") === images)
          .map((r) => (
            <ResourceEditor
              key={`${r.id}:${r.version}`}
              resource={r}
              canManage={canManage}
              product={product}
              changed={() => setEpoch((value) => value + 1)}
            />
          ))}
      </div>
    </>
  );
}
export function CatalogResourceWorkspace({
  product,
  canManageAvailability,
  recoveryScope,
  close,
  initialSection = "catalog-details",
}: {
  product: CatalogProduct;
  canManageAvailability: boolean;
  recoveryScope: string;
  close: () => void;
  initialSection?: string;
}) {
  const [section, setSection] = useState(initialSection);
  return (
    <section className="panel catalog-product-manager">
      <header className="catalog-product-header">
        <div>
          <nav
            aria-label="Product breadcrumbs"
            className="catalog-product-breadcrumbs"
          >
            <button type="button" className="text-action" onClick={close}>
              Catalog
            </button>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{product.name}</span>
          </nav>
          <h2>
            <code>{product.sku}</code> {product.name}
          </h2>
          <p>
            <span
              className="record-status"
              data-status={product.active ? undefined : "due"}
            >
              {product.active ? "Active" : "Retired"}
            </span>
          </p>
        </div>
        <button className="secondary" onClick={close}>
          Close product management
        </button>
      </header>
      <PageSections
        label="Catalog product management"
        selectedSection={section}
        selectSection={setSection}
        items={[
          { id: "catalog-details", label: "Details" },
          { id: "catalog-notes", label: "Staff notes" },
          ...(canManageAvailability
            ? [
                { id: "catalog-pricing", label: "Pricing" },
                { id: "catalog-reference", label: "Reference mapping" },
                { id: "catalog-addons", label: "Add-ons" },
              ]
            : []),
          { id: "catalog-images", label: "Images" },
          { id: "catalog-documents", label: "Documents" },
          { id: "catalog-rules", label: "Purchasing rules" },
        ]}
      >
        <PageSection id="catalog-details">
          <h3>Product details</h3>
          <dl>
            <dt>SKU</dt>
            <dd>{product.sku}</dd>
            <dt>Name</dt>
            <dd>{product.name}</dd>
            <dt>Base price</dt>
            <dd>{displayMoney(product.unit_price, product.currency)}</dd>
            <dt>Tracking</dt>
            <dd>{product.serialized ? "Serialized" : "Bulk"}</dd>
          </dl>
          <p className="record-detail-note">
            Use the catalog actions to change tier prices or product lifecycle.
            Customer quotes use their account prices.
          </p>
          {canManageAvailability && (
            <ProductAvailabilityEditor
              productId={product.id}
              initial={product.availability}
            />
          )}
        </PageSection>
        {canManageAvailability && (
          <PageSection id="catalog-pricing">
            <ProductMsrpEditor
              productId={product.id}
              currency={product.currency}
              recoveryScope={recoveryScope}
            />
            <UnitCostEditor
              productId={product.id}
              recoveryScope={recoveryScope}
            />
          </PageSection>
        )}
        {canManageAvailability && (
          <PageSection id="catalog-reference">
            <ReferenceMappingEditor
              productId={product.id}
              recoveryScope={recoveryScope}
            />
          </PageSection>
        )}
        {canManageAvailability && (
          <PageSection id="catalog-addons">
            <ProductAddonsEditor
              productId={product.id}
              recoveryScope={recoveryScope}
            />
          </PageSection>
        )}
        <PageSection id="catalog-notes">
          <RecordNotes
            expanded
            kind="product"
            recordId={product.id}
            recoveryScope={recoveryScope}
            actorId={recoveryScope.split(":").at(-1)!}
          />
        </PageSection>
        <PageSection id="catalog-images">
          <ResourceCollection
            product={product}
            images
            canManage={canManageAvailability}
          />
        </PageSection>
        <PageSection id="catalog-documents">
          <ResourceCollection
            product={product}
            images={false}
            canManage={canManageAvailability}
          />
        </PageSection>
        <PageSection id="catalog-rules">
          <ProductPurchasingRules productId={product.id} />
        </PageSection>
      </PageSections>
    </section>
  );
}
