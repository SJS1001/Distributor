import { useState } from "react";
import catalog from "./gree-catalog-data.json" with { type: "json" };

export type ManufacturerImage = {
  url: string;
  alt: string;
  title: string;
  source: string;
};

export default function ManufacturerImagePicker({
  choose,
  reset,
}: {
  choose: (image: ManufacturerImage) => void;
  reset: () => void;
}) {
  const [familyId, setFamilyId] = useState("");
  const family = catalog.products.find((p) => p.id === familyId);
  return (
    <section aria-label="Manufacturer image library">
      <label>
        GREE library product
        <select
          value={familyId}
          onChange={(e) => {
            setFamilyId(e.target.value);
            reset();
          }}
        >
          <option value="">Choose the matching manufacturer product</option>
          {catalog.products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title} · {p.category}
            </option>
          ))}
        </select>
      </label>
      <p>
        Choose a photograph only when it matches this product. Family
        photographs may show multiple components; confirm the supplied
        configuration before publishing.
      </p>
      {family && (
        <div className="manufacturer-image-options">
          {family.images.map((image, index) => (
            <figure key={image.url}>
              <img
                src={image.url}
                alt={image.alt || family.title}
                loading="lazy"
                referrerPolicy="no-referrer"
              />
              <figcaption>
                <button
                  type="button"
                  onClick={() =>
                    choose({
                      ...image,
                      alt: image.alt || family.title,
                      title: `${family.title} manufacturer photograph`,
                      source: family.sourceUrl,
                    })
                  }
                >
                  Use image {index + 1} for {family.title}
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}
