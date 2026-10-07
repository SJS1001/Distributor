import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { IncomingSupplyWorkspace } from "../src/web/incoming-supply.tsx";
import { OrderRequests } from "../src/web/order-requests.tsx";
import { CustomerMinimumOrderControls } from "../src/web/customer-minimum-order.tsx";
function Fixture() {
  const [refreshToken, setRefreshToken] = useState(0);
  return (
    <>
      <button
        type="button"
        onClick={() => setRefreshToken((value) => value + 1)}
      >
        Global refresh fixture
      </button>
      {new URL(location.href).searchParams.get("mode") === "minimum" ? (
        <CustomerMinimumOrderControls
          accountId="account"
          recoveryScope="synthetic-refresh"
          editable
          refreshKey={refreshToken}
        />
      ) : new URL(location.href).searchParams.get("mode") === "incoming" ? (
        <IncomingSupplyWorkspace
          scope="synthetic-refresh"
          editable
          accountName={() => "Synthetic buyer"}
          warehouseName={() => "Synthetic warehouse"}
          refreshToken={refreshToken}
        />
      ) : (
        <OrderRequests
          buyer={false}
          canReview
          resubmit={() => {}}
          order={() => {}}
          refreshToken={refreshToken}
        />
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
