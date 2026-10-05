// UTC calendar days, including today, compared with the preceding equal period.
export function analyticsPeriod(asOf = new Date().toISOString()) {
  const end =
    new Date(asOf.slice(0, 10) + "T00:00:00.000Z").getTime() + 86400000;
  const start = end - 28 * 86400000;
  const previousStart = start - 28 * 86400000;
  const date = (n: number) => new Date(n).toISOString().slice(0, 10);
  return {
    asOf,
    start: date(start),
    endExclusive: date(end),
    previousStart: date(previousStart),
    days: Array.from({ length: 56 }, (_, n) =>
      date(previousStart + n * 86400000),
    ),
  };
}
export type AnalyticsPeriod = ReturnType<typeof analyticsPeriod>;
