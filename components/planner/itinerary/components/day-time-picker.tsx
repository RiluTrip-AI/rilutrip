"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { TimeSelect } from "@/components/ui/time-select";

interface DayTimePickerProps {
  dayNumber: number;
  startTime: string;
  endTime: string;
  onSave?: (dayNumber: number, start: string, end: string) => Promise<void>;
  onApplyAll?: (start: string, end: string) => Promise<void>;
}

export function DayTimePicker({
  dayNumber,
  startTime,
  endTime,
  onSave,
  onApplyAll,
}: DayTimePickerProps) {
  const [localStartTime, setLocalStartTime] = useState(startTime);
  const [localEndTime, setLocalEndTime] = useState(endTime);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ startTime: localStartTime, endTime: localEndTime });
  const [saving, setSaving] = useState(false);
  const [timeError, setTimeError] = useState(false);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const t = useTranslations("planner.dayTimeDisplay");

  const isEditable = !!(onSave && onApplyAll);

  useEffect(() => {
    setLocalStartTime(startTime);
    setLocalEndTime(endTime);
  }, [startTime, endTime]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const handleOpen = () => {
    if (!isEditable) return;

    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPanelPos({ top: rect.bottom + 4, left: rect.left });
    }
    setDraft({ startTime: localStartTime, endTime: localEndTime });
    setOpen((v) => !v);
  };

  const isValidRange = () => draft.startTime < draft.endTime;

  const handleSave = async () => {
    if (!onSave || !isValidRange()) {
      setTimeError(true);
      return;
    }
    setTimeError(false);
    setSaving(true);
    try {
      await onSave(dayNumber, draft.startTime, draft.endTime);
      setLocalStartTime(draft.startTime);
      setLocalEndTime(draft.endTime);
      setOpen(false);
    } catch (err) {
      console.error("[DayTimePicker] save failed:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleApplyAll = async () => {
    if (!onApplyAll || !isValidRange()) {
      setTimeError(true);
      return;
    }
    setTimeError(false);
    setSaving(true);
    try {
      await onApplyAll(draft.startTime, draft.endTime);
      setLocalStartTime(draft.startTime);
      setLocalEndTime(draft.endTime);
      setOpen(false);
    } catch (err) {
      console.error("[DayTimePicker] applyAll failed:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <button
        ref={buttonRef}
        className={`flex items-center gap-1 text-xs text-muted-foreground transition-colors px-1 py-0.5 rounded ${
          isEditable
            ? "hover:text-foreground hover:bg-accent cursor-pointer"
            : "cursor-default opacity-75"
        }`}
        onClick={handleOpen}
        type="button"
        disabled={!isEditable}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-3 w-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        {localStartTime} - {localEndTime}
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: "fixed", top: panelPos.top, left: panelPos.left }}
            className="z-[9999] bg-popover border border-border rounded-md shadow-md p-3 w-60"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <p className="text-xs font-medium mb-2">{t("title", { dayNumber })}</p>
            <div className="flex items-center gap-2 mb-3">
              <TimeSelect
                size="sm"
                value={draft.startTime}
                onChange={(v) => setDraft((d) => ({ ...d, startTime: v }))}
              />
              <span className="text-xs text-muted-foreground shrink-0">-</span>
              <TimeSelect
                size="sm"
                value={draft.endTime}
                onChange={(v) => setDraft((d) => ({ ...d, endTime: v }))}
              />
            </div>
            {timeError && <p className="text-xs text-destructive mb-2">{t("errorTimeRange")}</p>}
            <div className="flex gap-2">
              <Button
                size="sm"
                className="h-7 text-xs flex-1"
                onClick={handleSave}
                disabled={saving}
              >
                {t("save")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs flex-1"
                onClick={handleApplyAll}
                disabled={saving}
              >
                {t("applyAll")}
              </Button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
