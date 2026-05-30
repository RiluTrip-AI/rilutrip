import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TimeSelect } from "@/components/ui/time-select";

describe("TimeSelect", () => {
  it("renders the current value", () => {
    render(<TimeSelect value="09:30" onChange={() => {}} aria-label="Start time" />);
    const input = screen.getByLabelText("Start time") as HTMLInputElement;
    expect(input.value).toBe("09:30");
    expect(input.type).toBe("time");
  });

  it("calls onChange with the new value when user changes input", () => {
    const onChange = vi.fn();
    render(<TimeSelect value="09:00" onChange={onChange} aria-label="Start time" />);
    const input = screen.getByLabelText("Start time");
    fireEvent.change(input, { target: { value: "14:15" } });
    expect(onChange).toHaveBeenCalledWith("14:15");
  });

  it("respects the disabled prop", () => {
    render(<TimeSelect value="09:00" onChange={() => {}} disabled aria-label="Start time" />);
    expect(screen.getByLabelText("Start time")).toBeDisabled();
  });
});
