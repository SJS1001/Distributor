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
