import React from "react";

// Responsive daily bar chart. Bars stretch with the card while axis labels stay
// HTML text, so labels keep a readable size from phone to desktop. Callers keep
// exact values available as text (tables) alongside the image.
export type BarSeries = {
  values: number[];
  color: string;
  // Position and width inside each day's slot, as fractions of the slot.
  offset: number;
  width: number;
};
export function DailyBars({
  label,
  series,
  max,
  ticks,
  start,
  end,
}: {
  label: string;
  series: BarSeries[];
  max: number;
  ticks: { value: number; label: string }[];
  start: string;
  end: string;
}) {
  const days = Math.max(1, ...series.map((s) => s.values.length));
  const top = Math.max(1, max);
  return (
    <div className="daily-bars">
      <div className="daily-bars-y" aria-hidden="true">
        {ticks.map((tick) => (
          <span
            key={tick.value}
            style={{ top: `${100 - (tick.value / top) * 100}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${days * 10} 100`}
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
      >
        {ticks.map((tick) => (
          <line
            key={tick.value}
            x1="0"
            x2={days * 10}
            y1={100 - (tick.value / top) * 100}
            y2={100 - (tick.value / top) * 100}
            stroke={tick.value === 0 ? "#98a2b3" : "#e3e8ef"}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {series.map((s, index) =>
          s.values.map((value, day) =>
            value > 0 ? (
              <rect
                key={`${index}-${day}`}
                x={day * 10 + s.offset * 10}
                width={s.width * 10}
                y={100 - (value / top) * 100}
                height={(value / top) * 100}
                fill={s.color}
              />
            ) : null,
          ),
        )}
      </svg>
      <div className="daily-bars-x" aria-hidden="true">
        <span>{start}</span>
        <span>{end}</span>
      </div>
    </div>
  );
}
export const compactNumber = (value: number) =>
  new Intl.NumberFormat("en-CA", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
export const shortDate = (date: string | undefined) =>
  date
    ? new Intl.DateTimeFormat("en-CA", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${date}T00:00:00Z`))
    : "";
export const plural = (count: number, one: string, many = `${one}s`) =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`;
