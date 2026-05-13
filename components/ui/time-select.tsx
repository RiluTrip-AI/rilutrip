"use client";

const HOURS = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, "0"));
const MINUTES = ["00", "15", "30", "45"];

function snapMinute(mm: string): string {
  if (MINUTES.includes(mm)) return mm;
  const m = parseInt(mm, 10);
  if (isNaN(m)) return "00";
  return MINUTES.reduce((best, opt) =>
    Math.abs(parseInt(opt) - m) < Math.abs(parseInt(best) - m) ? opt : best,
  );
}

interface TimeSelectProps {
  value: string;
  onChange: (v: string) => void;
  size?: "sm" | "md";
}

export function TimeSelect({ value, onChange, size = "md" }: TimeSelectProps) {
  const [rawHH, rawMM] = value.split(":");
  const hh = HOURS.includes(rawHH) ? rawHH : "09";
  const mm = snapMinute(rawMM ?? "00");

  const selectClasses = size === "sm" ? "h-7 text-xs w-11 px-1" : "h-8 text-sm w-14 px-1";

  return (
    <div className="flex items-center gap-0.5">
      <select
        value={hh}
        onChange={(e) => onChange(`${e.target.value}:${mm}`)}
        className={`bg-background border border-border rounded text-center cursor-pointer ${selectClasses}`}
      >
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span className={`text-muted-foreground ${size === "sm" ? "text-xs" : "text-sm"}`}>:</span>
      <select
        value={mm}
        onChange={(e) => onChange(`${hh}:${e.target.value}`)}
        className={`bg-background border border-border rounded text-center cursor-pointer ${selectClasses}`}
      >
        {MINUTES.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </div>
  );
}
