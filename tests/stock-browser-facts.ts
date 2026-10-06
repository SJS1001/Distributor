import { expect, type Page } from "@playwright/test";

// Synthetic fixture inspection only. The application still renders bounded
// stock pages; queue journeys assert the raw dashboard and UI independently.
export async function stockFactsDashboard(page: Page) {
  const response = await page.request.get("/api/dashboard");
  expect(response.status()).toBe(200);
  const dashboard = await response.json();
  let after = dashboard.stockNext;
  const seen = new Set<string>();
  while (after) {
    expect(seen.has(after)).toBe(false);
    seen.add(after);
    const response = await page.request.get(
      `/api/stock/page?${new URLSearchParams({ after })}`,
    );
    expect(response.status()).toBe(200);
    const next = await response.json();
    expect(next.items.length).toBeLessThanOrEqual(20);
    dashboard.stock.push(...next.items);
    after = next.next;
  }
  expect(new Set(dashboard.stock.map((unit: any) => unit.id)).size).toBe(
    dashboard.stock.length,
  );
  return dashboard;
}

// Dashboard reports are stamped with their request time ("as of"). Compare the
// remaining facts when two reads must describe the same business state.
export function withoutReportTime(value: any): any {
  return Array.isArray(value)
    ? value.map(withoutReportTime)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([key]) => key !== "asOf" && key !== "agingAsOf")
            .map(([key, item]) => [key, withoutReportTime(item)]),
        )
      : value;
}
