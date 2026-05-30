"use client";

interface TimeSelectProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  "aria-label"?: string;
}

/**
 * Thin wrapper around the native `<input type="time">`. Locked to whole-minute
 * granularity (step=60) and unstyled beyond minimal layout — keep it dumb so
 * forms drive validation and parents control labels/error display.
 */
export function TimeSelect({
  value,
  onChange,
  disabled,
  "aria-label": ariaLabel,
}: TimeSelectProps) {
  return (
    <input
      type="time"
      step={60}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      className="bg-background border border-border rounded px-3 h-9 text-sm"
    />
  );
}
