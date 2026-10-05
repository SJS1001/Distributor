import React from "react";
import collection from "./gree-catalog-preview.json" with { type: "json" };

/** Informational manufacturer content never grants purchasing authority. */
export function ManufacturerCollection({ staff = false }: { staff?: boolean }) {
  const featured = collection.products[0];
  return (
    <section
      className={`manufacturer-collection${staff ? " is-staff" : ""}`}
      aria-label="GREE manufacturer collection"
    >
      <div className="manufacturer-copy">
        <p className="collection-eyebrow">GREE · Canadian collection</p>
        <h2>
          {staff
            ? "A product library your team can use."
            : "Find the right system for the job."}
        </h2>
        <p>
          {staff
            ? "Browse equipment, compare model specifications and open manufacturer literature while managing your saleable catalog below."
            : "Explore residential and commercial equipment, model specifications and technical literature. Your approved products and account prices are below."}
        </p>
        <div className="collection-links">
          <a href="#products">
            Explore GREE products <span aria-hidden="true">→</span>
          </a>
          <span>
            {collection.productCount} product pages · {collection.documentCount}{" "}
            documents
          </span>
        </div>
      </div>
      {featured && (
        <a
          className="manufacturer-feature"
          href={`#product=${encodeURIComponent(featured.id)}`}
        >
          <img
            src={featured.imageUrl}
            alt={featured.title}
            loading="lazy"
            referrerPolicy="no-referrer"
          />
          <span>
            <small>Featured equipment</small>
            <strong>{featured.title}</strong>
            <span aria-hidden="true">↗</span>
          </span>
        </a>
      )}
    </section>
  );
}
