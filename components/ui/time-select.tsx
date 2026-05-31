"use client";

import { useEffect, useRef, useState } from "react";

interface TimeSelectProps {
  /** Empty string means "not set"; otherwise HH:MM in 24-hour format. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  "aria-label"?: string;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, "0"));
const MINUTES = ["00", "15", "30", "45"] as const;
const TIME_RE = /^([01][0-9]|2[0-3]):(00|15|30|45)$/;

function parseValue(value: string): { hh: string; mm: string } {
  if (TIME_RE.test(value)) {
    const [hh, mm] = value.split(":");
    return { hh, mm };
  }
  return { hh: "", mm: "" };
}

interface UnitDropdownProps {
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
}

/**
 * Custom dropdown for a single time unit (hour or minute). Renders a button
 * trigger and a fixed-height scrollable listbox so the open dropdown never
 * grows beyond the screen — unlike native `<select>`, where the dropdown
 * length is OS-controlled and 24 hour options will overflow upward and
 * cover whatever sits above the form.
 */
function UnitDropdown({ value, options, onChange, disabled, ariaLabel }: UnitDropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside; reset listener on each open transition.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  const itemClass = (selected: boolean) =>
    `block w-full px-2 py-1 text-sm text-center hover:bg-accent ${selected ? "bg-accent" : ""}`;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((o) => !o)}
        className="bg-background border border-border rounded px-2 h-9 text-sm cursor-pointer w-14 text-center"
      >
        {value || "--"}
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label={ariaLabel}
          className="absolute z-50 mt-1 left-0 bg-popover border border-border rounded shadow-md max-h-48 overflow-y-auto w-14"
        >
          <li>
            <button
              type="button"
              role="option"
              aria-selected={value === ""}
              onClick={() => pick("")}
              className={itemClass(value === "")}
            >
              --
            </button>
          </li>
          {options.map((opt) => (
            <li key={opt}>
              <button
                type="button"
                role="option"
                aria-selected={opt === value}
                onClick={() => pick(opt)}
                className={itemClass(opt === value)}
              >
                {opt}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * 24-hour HH/MM dropdown picker. Empty until both sides are chosen; emits
 * "HH:MM" once both are set, and empty as soon as either is cleared back to
 * "--". Uses a custom dropdown internally to bypass the OS-controlled
 * native `<select>` dropdown (which 1) can't be height-limited and 2) on
 * zh-TW Chrome injects an AM/PM column with awkward ordering).
 */
export function TimeSelect({
  value,
  onChange,
  disabled,
  "aria-label": ariaLabel,
}: TimeSelectProps) {
  const [{ hh, mm }, setLocal] = useState(() => parseValue(value));

  // Resync if the parent updates `value` externally (form reset, default
  // values). Local state otherwise tracks half-picked selections without
  // losing them across renders.
  useEffect(() => {
    setLocal(parseValue(value));
  }, [value]);

  const update = (newHH: string, newMM: string) => {
    setLocal({ hh: newHH, mm: newMM });
    onChange(newHH && newMM ? `${newHH}:${newMM}` : "");
  };

  return (
    <div className="flex items-center gap-0.5" role="group" aria-label={ariaLabel}>
      <UnitDropdown
        value={hh}
        options={HOURS}
        onChange={(v) => update(v, mm)}
        disabled={disabled}
        ariaLabel={ariaLabel ? `${ariaLabel} hour` : undefined}
      />
      <span className="text-muted-foreground text-sm">:</span>
      <UnitDropdown
        value={mm}
        options={MINUTES}
        onChange={(v) => update(hh, v)}
        disabled={disabled}
        ariaLabel={ariaLabel ? `${ariaLabel} minute` : undefined}
      />
    </div>
  );
}
