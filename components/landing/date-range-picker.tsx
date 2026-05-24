"use client";

import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslations, useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface DateRangePickerProps {
  startDate?: Date;
  endDate?: Date;
  onChange: (start?: Date, end?: Date) => void;
  disabled?: boolean;
  error?: boolean;
  helperText?: string;
}

export function DateRangePicker({
  startDate,
  endDate,
  onChange,
  disabled,
  error,
  helperText,
}: DateRangePickerProps) {
  const t = useTranslations("landing.datePicker");
  const locale = useLocale();
  const [isOpen, setIsOpen] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [hoverDate, setHoverDate] = useState<Date | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Update position when opening
  useLayoutEffect(() => {
    if (isOpen && buttonRef.current) {
      const updatePosition = () => {
        const rect = buttonRef.current!.getBoundingClientRect();
        setPosition({
          top: rect.bottom + window.scrollY + 8,
          left: rect.left + window.scrollX,
        });
      };

      updatePosition();
      window.addEventListener("resize", updatePosition);
      window.addEventListener("scroll", updatePosition);

      return () => {
        window.removeEventListener("resize", updatePosition);
        window.removeEventListener("scroll", updatePosition);
      };
    }
  }, [isOpen]);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (year: number, month: number) => {
    return new Date(year, month, 1).getDay();
  };

  const isSameDay = (d1?: Date, d2?: Date) => {
    if (!d1 || !d2) return false;
    return (
      d1.getDate() === d2.getDate() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getFullYear() === d2.getFullYear()
    );
  };

  const isBetween = (date: Date, start?: Date, end?: Date) => {
    if (!start || !end) return false;
    return date > start && date < end;
  };

  const handleDateClick = (date: Date) => {
    // If we have nothing or we already have a full range, start fresh
    if (!startDate || endDate) {
      onChange(date, undefined);
    } else {
      // We only have a startDate, complete the selection
      if (date < startDate) {
        onChange(date, undefined); // Reset with new startDate
      } else {
        onChange(startDate, date);
        setIsOpen(false);
      }
    }
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString(locale, {
      month: locale === "zh-TW" ? "numeric" : "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const renderMonth = (offset: number) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const monthDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + offset, 1);
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);

    const days = [];
    // Empty slots for start of month
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${offset}-${i}`} className="h-10 w-10" />);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      const isPast = date < today;

      let isSelected = isSameDay(date, startDate) || isSameDay(date, endDate);
      let isRange = false;

      // Check range logic (including hover)
      if (startDate && endDate) {
        isRange = isBetween(date, startDate, endDate);
      } else if (startDate && hoverDate && !endDate && hoverDate > startDate) {
        // Preview range on hover (only when hovering after startDate)
        isRange = isBetween(date, startDate, hoverDate);
        if (isSameDay(date, hoverDate)) isSelected = true;
      }

      // Start/End rounded corners
      const isStart = startDate && isSameDay(date, startDate);
      const isEnd =
        (endDate && isSameDay(date, endDate)) ||
        (!endDate && hoverDate && startDate && hoverDate > startDate && isSameDay(date, hoverDate));

      days.push(
        <button
          key={d}
          type="button" // Prevent form submission
          disabled={isPast}
          onClick={() => handleDateClick(date)}
          onMouseEnter={() => setHoverDate(date)}
          className={cn(
            "h-10 w-10 text-sm flex items-center justify-center relative z-10",
            "hover:bg-[hsl(var(--primary))]/20 transition-colors rounded-full",
            "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent",
            isSelected &&
              "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary))]",
            isRange && !isSelected && "bg-[hsl(var(--primary))]/10 rounded-none",
            isStart && isRange && "rounded-l-full rounded-r-none",
            isEnd && isRange && "rounded-r-full rounded-l-none",
          )}
        >
          {d}
        </button>,
      );
    }

    const weekdayLabels = t.raw("weekdays.short") as string[];

    return (
      <div className="p-4 w-72">
        <div className="font-semibold text-center mb-4">
          {monthDate.toLocaleDateString(locale, {
            month: "long",
            year: "numeric",
          })}
        </div>
        <div className="grid grid-cols-7 gap-y-2 text-center">
          {weekdayLabels.map((d, i) => (
            <div
              key={`${d}-${i}`}
              className="text-[hsl(var(--muted-foreground))] text-xs font-medium"
            >
              {d}
            </div>
          ))}
          {days}
        </div>
      </div>
    );
  };

  const duration =
    startDate && endDate
      ? Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1
      : 0;

  return (
    <div>
      <Button
        ref={buttonRef}
        type="button"
        variant="outline"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={cn(
          "w-[300px] justify-start text-left font-normal",
          !startDate && "text-[hsl(var(--muted-foreground))]",
          error && "border-destructive dark:border-destructive hover:border-destructive",
        )}
      >
        <span className="mr-2">📅</span>
        {startDate
          ? endDate
            ? `${formatDate(startDate)} - ${formatDate(endDate)} (${duration} ${t("days")})`
            : `${formatDate(startDate)} - ${t("selectEndDate")}`
          : t("selectDates")}
      </Button>

      <p
        className={cn(
          "mt-1.5 text-sm transition-colors duration-200 text-destructive",
          !helperText && "invisible",
        )}
      >
        {helperText ?? "\u00A0"}
      </p>

      {isOpen &&
        createPortal(
          <div
            ref={popoverRef}
            style={{
              top: position.top,
              left: position.left,
            }}
            className="absolute z-50 bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] rounded-xl border shadow-xl flex flex-col md:flex-row overflow-hidden"
          >
            {/* Navigation */}
            <div className="absolute top-4 left-4 z-20">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={prevMonth}
                className="h-7 w-7"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </div>
            <div className="absolute top-4 right-4 z-20 md:hidden">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={nextMonth}
                className="h-7 w-7"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="absolute top-4 right-4 z-20 hidden md:block">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={nextMonth}
                className="h-7 w-7"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <div className="border-b md:border-b-0 md:border-r">{renderMonth(0)}</div>
            <div className="hidden md:block">{renderMonth(1)}</div>
          </div>,
          document.body,
        )}
    </div>
  );
}
