import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { toast } from "sonner";
import { OptimizeDayButton } from "@/components/planner/itinerary/components/optimize-day-button";

const messages = {
  planner: {
    optimizeRoute: {
      button: "Optimize route",
      optimizing: "Optimizing…",
      success: "Route optimized",
      warningUnfit: "{count} activities couldn't be scheduled and were moved to the end",
      warningMissingSettings: "Set this day's time range and transport mode before optimizing",
      errorUnauthorized: "Please log in to optimize this route.",
      errorInsufficientCredits: "Not enough credits",
      errorGeneric: "Could not optimize",
    },
  },
};

const mocks = vi.hoisted(() => ({
  refreshProfile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/hooks/use-profile", () => ({
  useProfile: () => ({
    profile: null,
    credits: 0,
    tier: "free",
    refreshProfile: mocks.refreshProfile,
  }),
}));

function renderButton(props: Partial<React.ComponentProps<typeof OptimizeDayButton>> = {}) {
  const onOptimize = props.onOptimize ?? vi.fn().mockResolvedValue({ ok: true, unfitCount: 0 });
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <OptimizeDayButton
        dayNumber={1}
        locatedActivityCount={props.locatedActivityCount ?? 2}
        isOptimizing={props.isOptimizing ?? false}
        onOptimize={onOptimize}
      />
    </NextIntlClientProvider>,
  );
  return { onOptimize };
}

beforeEach(() => vi.clearAllMocks());

describe("OptimizeDayButton", () => {
  it("is disabled when fewer than 2 located activities", () => {
    renderButton({ locatedActivityCount: 1 });
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("calls onOptimize when clicked", async () => {
    const { onOptimize } = renderButton();
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(onOptimize).toHaveBeenCalledWith(1));
  });

  it("shows the optimizing label while in progress", () => {
    renderButton({ isOptimizing: true });
    expect(screen.getByText("Optimizing…")).toBeInTheDocument();
  });

  it("shows a success toast after optimizing", async () => {
    renderButton();
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Route optimized"));
  });

  it("warns when some activities could not be scheduled", async () => {
    const onOptimize = vi.fn().mockResolvedValue({ ok: true, unfitCount: 2 });
    renderButton({ onOptimize });
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        "2 activities couldn't be scheduled and were moved to the end",
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("warns the user to fill day settings when they are missing", async () => {
    const onOptimize = vi.fn().mockResolvedValue({ ok: false, reason: "MISSING_SETTINGS" });
    renderButton({ onOptimize });
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        "Set this day's time range and transport mode before optimizing",
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("asks the user to log in when optimization requires authentication", async () => {
    const onOptimize = vi.fn().mockResolvedValue({ ok: false, reason: "UNAUTHORIZED" });
    renderButton({ onOptimize });
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Please log in to optimize this route."),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("refreshes the credit balance after optimizing", async () => {
    renderButton();
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(mocks.refreshProfile).toHaveBeenCalledTimes(1));
  });
});
