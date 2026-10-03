import "../src/web/style.css";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { InventoryQuantity } from "../src/web/inventory-quantity.tsx";
import { request, setCsrf } from "../src/web/api.ts";
setCsrf("synthetic");
function Harness() {
  const [unit, setUnit] = useState<string | null>("bulk"),
    [actor, setActor] = useState("creator"),
    [org, setOrg] = useState("org");
  return (
    <>
      <button onClick={() => setUnit(null)}>Remove selected row</button>
      <button onClick={() => setUnit("bulk")}>Select bulk</button>
      <button onClick={() => setUnit("other")}>Switch unit</button>
      <button
        onClick={() =>
          setActor((x) => (x === "creator" ? "finance" : "creator"))
        }
      >
        Switch finance principal
      </button>
      <button onClick={() => setOrg((x) => (x === "org" ? "org2" : "org"))}>
        Switch organization
      </button>
      <InventoryQuantity
        key={`${org}:${actor}`}
        orgId={org}
        actorId={actor}
        region="CA"
        currency="CAD"
        selection={
          unit
            ? {
                unitId: unit,
                product: "Synthetic bulk",
                warehouse: "Warehouse",
              }
            : null
        }
        close={() => setUnit(null)}
        saved={(signal) => request("/api/stock-refresh", { signal })}
      />
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
