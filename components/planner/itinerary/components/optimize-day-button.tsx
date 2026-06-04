"use client";

import { Route, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useProfile } from "@/hooks/use-profile";
import type { OptimizeDayResult } from "@/components/planner/itinerary/store";

interface OptimizeDayButtonProps {
  dayNumber: number;
  locatedActivityCount: number;
  isOptimizing: boolean;
  // Optional like the other day-header callbacks: undefined => read-only => disabled.
  onOptimize?: (dayNumber: number) => Promise<OptimizeDayResult>;
}

export function OptimizeDayButton({
  dayNumber,
  locatedActivityCount,
  isOptimizing,
  onOptimize,
}: OptimizeDayButtonProps) {
  const t = useTranslations("planner.optimizeRoute");
  const { refreshProfile } = useProfile();
  const disabled = !onOptimize || isOptimizing || locatedActivityCount < 2;

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled || !onOptimize) return;
    const result = await onOptimize(dayNumber);
    if (result.ok) {
      if (result.unfitCount > 0) {
        toast.warning(t("warningUnfit", { count: result.unfitCount }));
      } else {
        toast.success(t("success"));
      }
    } else if (result.reason === "MISSING_SETTINGS") {
      toast.warning(t("warningMissingSettings"));
    } else if (result.reason === "NOT_ENOUGH_LOCATED") {
      toast.warning(t("warningNotEnoughLocated"));
    } else if (result.reason === "UNAUTHORIZED") {
      toast.error(t("errorUnauthorized"));
    } else if (result.reason === "INSUFFICIENT_CREDITS") {
      toast.error(t("errorInsufficientCredits"));
    } else if (result.reason === "ERROR") {
      toast.error(t("errorGeneric"));
    }

    // Credits are captured server-side. Skip the balance refetch for the local
    // pre-checks that never reach the server (nothing could have been charged).
    const reachedServer =
      result.ok || (result.reason !== "MISSING_SETTINGS" && result.reason !== "NOT_ENOUGH_LOCATED");
    if (reachedServer) {
      refreshProfile().catch((err) => {
        console.error("Failed to refresh profile:", err);
      });
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className="flex items-center gap-1 text-xs text-muted-foreground transition-colors px-1 py-0.5 rounded hover:text-foreground hover:bg-accent cursor-pointer disabled:opacity-50 disabled:cursor-default"
    >
      {isOptimizing ? (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
      ) : (
        <Route className="h-3 w-3" aria-hidden="true" />
      )}
      <span>{isOptimizing ? t("optimizing") : t("button")}</span>
    </button>
  );
}
