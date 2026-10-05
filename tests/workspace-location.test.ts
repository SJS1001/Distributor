import { test } from "node:test";
import assert from "node:assert/strict";
import {
  navigationHash,
  readNavigation,
  authorizeNavigation,
  authorizedPages,
} from "../src/web/navigation.ts";
import { readSavedFilters, savedFilterKey } from "../src/web/saved-filters.tsx";
test("workspace locations retain allowlisted task intent without draft or credential fields", () => {
  const hash = navigationHash({
    page: "Orders",
    section: "orders-queue",
    orderState: "open",
    orderReservation: "overdue",
    orderId: "queue-044",
  });
  assert.deepEqual(readNavigation(hash), {
    page: "Orders",
    section: "orders-queue",
    orderState: "open",
    orderReservation: "overdue",
    orderId: "queue-044",
  });
  assert.deepEqual(
    readNavigation(
      "#page=Billing&section=inventory-counts&invoices=invalid&token=secret&order=foreign",
    ),
    { page: "Billing" },
  );
  assert.equal(
    navigationHash({ page: "Missing", section: "whatever" }),
    "#page=Overview",
  );
  assert.deepEqual(
    readNavigation(
      "#page=Inventory&stock=quarantine&counts=submitted&warehouse=w1",
    ),
    {
      page: "Inventory",
      stockView: "quarantine",
      countState: "submitted",
      warehouseId: "w1",
    },
  );
  assert.equal(
    readNavigation("#page=Orders&order=%3Cscript%3E").orderId,
    undefined,
  );
});
test("destination permissions fall back to Overview and safe filters isolate organization/user", () => {
  assert.deepEqual(
    authorizeNavigation({ page: "Inventory" }, authorizedPages("buyer")),
    { page: "Overview" },
  );
  assert.equal(
    authorizeNavigation({ page: "Billing" }, authorizedPages("buyer")).page,
    "Billing",
  );
  assert.notEqual(
    savedFilterKey("org-a", "user", "orders"),
    savedFilterKey("org-b", "user", "orders"),
  );
  assert.notEqual(
    savedFilterKey("org", "user-a", "orders"),
    savedFilterKey("org", "user-b", "orders"),
  );
  assert.deepEqual(
    readSavedFilters('["open","credential","closed","open",{},4]', [
      "open",
      "closed",
    ]),
    ["open", "closed"],
  );
  assert.deepEqual(readSavedFilters("{corrupt", ["open"]), []);
});
