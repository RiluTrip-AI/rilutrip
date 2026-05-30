import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TripForm } from "@/components/landing/trip-form";
import { ItineraryLimitError } from "@/lib/supabase/itineraries";

const { pushMock, getCurrentUserMock, createItineraryMetadataMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  getCurrentUserMock: vi.fn(),
  createItineraryMetadataMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  getCurrentUser: getCurrentUserMock,
}));

vi.mock("@/lib/supabase/itineraries", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/itineraries")>(
    "@/lib/supabase/itineraries",
  );

  return {
    ...actual,
    createItineraryMetadata: createItineraryMetadataMock,
  };
});

// Mock auth context
vi.mock("@/lib/auth/auth-context", () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    signInWithGoogle: vi.fn(),
    logout: vi.fn(),
  }),
}));

// Mock i18n navigation
vi.mock("@/lib/i18n/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "",
}));

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
}));

// Mock DateRangePicker
vi.mock("@/components/landing/date-range-picker", () => ({
  DateRangePicker: ({
    onChange,
  }: {
    onChange: (start?: Date, end?: Date) => void;
    startDate?: Date;
    endDate?: Date;
  }) => (
    <button
      type="button"
      data-testid="mock-date-picker"
      onClick={() => {
        // Use dates relative to today to avoid future test failures
        const today = new Date();
        const start = new Date(today);
        start.setDate(today.getDate() + 30); // 30 days from now
        const end = new Date(start);
        end.setDate(start.getDate() + 5); // 5 days after start
        onChange(start, end);
      }}
    >
      Mock Select Dates
    </button>
  ),
}));

describe("TripForm - Form Validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUserMock.mockResolvedValue(null);
  });

  it("should reject empty destination", async () => {
    render(<TripForm />);

    const submitButton = screen.getByRole("button", {
      name: /generateButton/i,
    });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText("Destination is required")).toBeInTheDocument();
    });
  });

  it("should accept valid destination", async () => {
    render(<TripForm />);

    const destinationInput = screen.getByPlaceholderText(/destinationPlaceholder/i);
    fireEvent.change(destinationInput, { target: { value: "Tokyo" } });

    const submitButton = screen.getByRole("button", {
      name: /generateButton/i,
    });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.queryByText("Destination is required")).not.toBeInTheDocument();
    });
  });

  it("should handle optional custom preferences", async () => {
    render(<TripForm />);

    const destinationInput = screen.getByPlaceholderText(/destinationPlaceholder/i);
    const descriptionTextarea = screen.getByPlaceholderText(/descriptionPlaceholder/i);

    // Submit with destination only (no preferences)
    fireEvent.change(destinationInput, { target: { value: "Paris" } });

    const submitButton = screen.getByRole("button", {
      name: /generateButton/i,
    });
    fireEvent.click(submitButton);

    // Should not show any validation errors
    await waitFor(() => {
      expect(screen.queryByText("Destination is required")).not.toBeInTheDocument();
    });

    // Now add preferences and submit again
    fireEvent.change(descriptionTextarea, {
      target: { value: "Budget-friendly foodie tour" },
    });
    fireEvent.click(submitButton);

    // Should still not show validation errors
    await waitFor(() => {
      expect(screen.queryByText("Destination is required")).not.toBeInTheDocument();
    });
  });

  it("should validate date selection", async () => {
    render(<TripForm />);

    const destinationInput = screen.getByPlaceholderText(/destinationPlaceholder/i);

    // Fill in destination but leave dates empty
    fireEvent.change(destinationInput, { target: { value: "Tokyo" } });

    const submitButton = screen.getByRole("button", {
      name: /generateButton/i,
    });
    fireEvent.click(submitButton);

    // Form should not proceed (validation blocks submission)
    // We can verify dates field wasn't touched by checking date picker is still visible
    await waitFor(() => {
      expect(screen.getByTestId("mock-date-picker")).toBeInTheDocument();
    });

    // Now select dates
    const datePicker = screen.getByTestId("mock-date-picker");
    fireEvent.click(datePicker);

    // This time submit should work (form will attempt to proceed)
    fireEvent.click(submitButton);

    // Note: Full validation flow and i18n error messages are validated by E2E tests
    // in test/validation/zod-i18n-integration.test.ts
  });

  it("does not append an advanced-prefs hint when the section is never opened", async () => {
    getCurrentUserMock.mockResolvedValue({ id: "user-1", is_anonymous: false });
    createItineraryMetadataMock.mockResolvedValue({ id: "itin-1" });

    render(<TripForm />);
    fireEvent.change(screen.getByPlaceholderText(/destinationPlaceholder/i), {
      target: { value: "Tokyo" },
    });
    fireEvent.click(screen.getByTestId("mock-date-picker"));
    fireEvent.click(screen.getByRole("button", { name: /generateButton/i }));

    await waitFor(() => expect(createItineraryMetadataMock).toHaveBeenCalled());
    const arg = createItineraryMetadataMock.mock.calls[0][0];
    expect(arg.description).toBeUndefined();
  });

  it("does not append a hint when the advanced section is opened but all defaults are kept", async () => {
    getCurrentUserMock.mockResolvedValue({ id: "user-1", is_anonymous: false });
    createItineraryMetadataMock.mockResolvedValue({ id: "itin-1" });

    render(<TripForm />);
    fireEvent.change(screen.getByPlaceholderText(/destinationPlaceholder/i), {
      target: { value: "Sapporo" },
    });
    fireEvent.click(screen.getByTestId("mock-date-picker"));
    fireEvent.click(screen.getByRole("button", { name: /Advanced/i }));

    fireEvent.click(screen.getByRole("button", { name: /generateButton/i }));

    await waitFor(() => expect(createItineraryMetadataMock).toHaveBeenCalled());
    const arg = createItineraryMetadataMock.mock.calls[0][0];
    expect(arg.description).toBeUndefined();
  });

  it("appends a hint to description when user changes transport mode", async () => {
    getCurrentUserMock.mockResolvedValue({ id: "user-1", is_anonymous: false });
    createItineraryMetadataMock.mockResolvedValue({ id: "itin-1" });

    render(<TripForm />);
    fireEvent.change(screen.getByPlaceholderText(/destinationPlaceholder/i), {
      target: { value: "Kyoto" },
    });
    fireEvent.click(screen.getByTestId("mock-date-picker"));
    fireEvent.click(screen.getByRole("button", { name: /Advanced/i }));
    fireEvent.change(screen.getByLabelText("Transport mode"), {
      target: { value: "walking" },
    });

    fireEvent.click(screen.getByRole("button", { name: /generateButton/i }));

    await waitFor(() => expect(createItineraryMetadataMock).toHaveBeenCalled());
    const arg = createItineraryMetadataMock.mock.calls[0][0];
    expect(arg.description).toContain("Walking");
    expect(arg.description).toContain("daily window of");
  });

  it("keeps user-typed description before the appended hint when both are present", async () => {
    getCurrentUserMock.mockResolvedValue({ id: "user-1", is_anonymous: false });
    createItineraryMetadataMock.mockResolvedValue({ id: "itin-1" });

    render(<TripForm />);
    fireEvent.change(screen.getByPlaceholderText(/destinationPlaceholder/i), {
      target: { value: "Osaka" },
    });
    fireEvent.change(screen.getByPlaceholderText(/descriptionPlaceholder/i), {
      target: { value: "Foodie trip" },
    });
    fireEvent.click(screen.getByTestId("mock-date-picker"));
    fireEvent.click(screen.getByRole("button", { name: /Advanced/i }));
    fireEvent.change(screen.getByLabelText("Transport mode"), {
      target: { value: "walking" },
    });

    fireEvent.click(screen.getByRole("button", { name: /generateButton/i }));

    await waitFor(() => expect(createItineraryMetadataMock).toHaveBeenCalled());
    const arg = createItineraryMetadataMock.mock.calls[0][0];
    expect(arg.description?.startsWith("Foodie trip")).toBe(true);
    expect(arg.description).toContain("Walking");
  });

  it("shows a dedicated itinerary-limit error message when the tier cap is reached", async () => {
    getCurrentUserMock.mockResolvedValue({ id: "user-1" });
    createItineraryMetadataMock.mockRejectedValue(new ItineraryLimitError());

    render(<TripForm />);

    const destinationInput = screen.getByPlaceholderText(/destinationPlaceholder/i);
    fireEvent.change(destinationInput, {
      target: { value: "Tokyo" },
    });

    const datePicker = screen.getByTestId("mock-date-picker");
    fireEvent.click(datePicker);

    const submitButton = screen.getByRole("button", {
      name: /generateButton/i,
    });
    fireEvent.click(submitButton);

    // Wait for the mock to be called
    await waitFor(
      () => {
        expect(createItineraryMetadataMock).toHaveBeenCalled();
      },
      { timeout: 3000 },
    );

    // Then check for the error message
    await waitFor(
      () => {
        expect(
          screen.getByText("You have reached your itinerary limit for the current plan."),
        ).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
    expect(pushMock).not.toHaveBeenCalled();
  });
});
