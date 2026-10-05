import React, { useEffect, useState } from "react";

type Report = { id: string; label: string; content: React.ReactNode };
type Preferences = { order: string[]; hidden: string[] };
export function readReportPreferences(raw: string | null): Preferences {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object") throw new Error();
    const { order, hidden } = value as Preferences;
    const clean = (items: unknown) =>
      Array.isArray(items)
        ? [
            ...new Set(
              items.filter(
                (id): id is string =>
                  typeof id === "string" && /^[a-z-]{1,40}$/.test(id),
              ),
            ),
          ].slice(0, 30)
        : [];
    return { order: clean(order), hidden: clean(hidden) };
  } catch {
    return { order: [], hidden: [] };
  }
}

export function DashboardReports({
  reports,
  scope,
}: {
  reports: Report[];
  scope?: string;
}) {
  const key = scope
    ? `distributor:report-layout:v1:${encodeURIComponent(scope)}`
    : null;
  const [saved, setSaved] = useState<{
    key: string | null;
    preferences: Preferences;
  }>({ key: null, preferences: { order: [], hidden: [] } });
  const [notice, setNotice] = useState("");
  const preferences =
    saved.key === key ? saved.preferences : { order: [], hidden: [] };
  useEffect(() => {
    try {
      setSaved({
        key,
        preferences: readReportPreferences(
          key ? localStorage.getItem(key) : null,
        ),
      });
    } catch {
      setSaved({ key, preferences: { order: [], hidden: [] } });
    }
    setNotice("");
  }, [key]);
  const ordered = [...reports].sort((a, b) => {
    const position = (id: string) => {
      const index = preferences.order.indexOf(id);
      return index < 0
        ? preferences.order.length + reports.findIndex((r) => r.id === id)
        : index;
    };
    return position(a.id) - position(b.id);
  });
  const save = (next: Preferences) => {
    setSaved({ key, preferences: next });
    try {
      if (key) localStorage.setItem(key, JSON.stringify(next));
      setNotice(
        key
          ? "Report layout saved for your account on this browser."
          : "Report layout updated for this visit.",
      );
    } catch {
      setNotice(
        "Layout updated for this visit. Browser storage is unavailable.",
      );
    }
  };
  const move = (index: number, direction: number) => {
    const order = ordered.map((r) => r.id);
    const current = order[index];
    const adjacent = order[index + direction];
    if (current === undefined || adjacent === undefined) return;
    order[index] = adjacent;
    order[index + direction] = current;
    save({ ...preferences, order });
  };
  const visible = ordered.filter((r) => !preferences.hidden.includes(r.id));
  return (
    <section className="dashboard-reports" aria-label="Workspace reports">
      <div className="report-toolbar">
        <div>
          <span className="section-kicker">Your workspace</span>
          <h2>Reports & insights</h2>
        </div>
        <details className="report-customizer">
          <summary>Customize reports</summary>
          <p>
            Choose which reports appear and their order. Saved for your account
            on this browser.
          </p>
          {ordered.map((report, index) => (
            <div className="report-preference" key={report.id}>
              <label>
                <input
                  type="checkbox"
                  checked={!preferences.hidden.includes(report.id)}
                  onChange={(event) =>
                    save({
                      ...preferences,
                      hidden: event.target.checked
                        ? preferences.hidden.filter((id) => id !== report.id)
                        : [...preferences.hidden, report.id],
                    })
                  }
                />
                {report.label}
              </label>
              <div>
                <button
                  aria-label={`Move ${report.label} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  aria-label={`Move ${report.label} down`}
                  disabled={index === ordered.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
              </div>
            </div>
          ))}
          <button
            className="secondary"
            onClick={() => save({ order: [], hidden: [] })}
          >
            Restore default reports
          </button>
          {notice && <p role="status">{notice}</p>}
        </details>
      </div>
      {visible.length ? (
        <div className="overview-charts">
          {visible.map((report) => (
            <React.Fragment key={report.id}>{report.content}</React.Fragment>
          ))}
        </div>
      ) : (
        <div className="dashboard-card">
          <h3>Your workspace, your choice</h3>
          <p>
            All report cards are hidden. Open Customize reports to add them
            back.
          </p>
        </div>
      )}
    </section>
  );
}
