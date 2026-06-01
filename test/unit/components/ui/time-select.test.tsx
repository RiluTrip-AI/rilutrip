import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TimeSelect } from "@/components/ui/time-select";

describe("TimeSelect", () => {
  it("renders both triggers as -- when value is empty", () => {
    render(<TimeSelect value="" onChange={() => {}} aria-label="Start time" />);
    expect(screen.getByRole("button", { name: "Start time hour" })).toHaveTextContent("--");
    expect(screen.getByRole("button", { name: "Start time minute" })).toHaveTextContent("--");
  });

  it("renders HH and MM in the trigger labels when value is valid", () => {
    render(<TimeSelect value="09:30" onChange={() => {}} aria-label="Start time" />);
    expect(screen.getByRole("button", { name: "Start time hour" })).toHaveTextContent("09");
    expect(screen.getByRole("button", { name: "Start time minute" })).toHaveTextContent("30");
  });

  it("opens the listbox when the trigger is clicked", () => {
    render(<TimeSelect value="" onChange={() => {}} aria-label="Start time" />);
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start time hour" }));
    expect(screen.getByRole("listbox", { name: "Start time hour" })).toBeInTheDocument();
  });

  it("emits the half-filled 'HH:' when only the hour is picked so the form can flag it", () => {
    const onChange = vi.fn();
    render(<TimeSelect value="" onChange={onChange} aria-label="Start time" />);
    fireEvent.click(screen.getByRole("button", { name: "Start time hour" }));
    fireEvent.click(screen.getByRole("option", { name: "08" }));
    expect(onChange).toHaveBeenLastCalledWith("08:");
  });

  it("emits HH:MM once both are picked", () => {
    const onChange = vi.fn();
    render(<TimeSelect value="" onChange={onChange} aria-label="Start time" />);
    fireEvent.click(screen.getByRole("button", { name: "Start time hour" }));
    fireEvent.click(screen.getByRole("option", { name: "08" }));
    fireEvent.click(screen.getByRole("button", { name: "Start time minute" }));
    fireEvent.click(screen.getByRole("option", { name: "30" }));
    expect(onChange).toHaveBeenLastCalledWith("08:30");
  });

  it("keeps the other unit as a partial when one side is cleared to --", () => {
    const onChange = vi.fn();
    render(<TimeSelect value="08:30" onChange={onChange} aria-label="Start time" />);
    fireEvent.click(screen.getByRole("button", { name: "Start time hour" }));
    fireEvent.click(screen.getByRole("option", { name: "--" }));
    expect(onChange).toHaveBeenLastCalledWith(":30");
  });

  it("emits empty only when both units are cleared to --", () => {
    const onChange = vi.fn();
    render(<TimeSelect value="08:30" onChange={onChange} aria-label="Start time" />);
    fireEvent.click(screen.getByRole("button", { name: "Start time hour" }));
    fireEvent.click(screen.getByRole("option", { name: "--" }));
    fireEvent.click(screen.getByRole("button", { name: "Start time minute" }));
    fireEvent.click(screen.getByRole("option", { name: "--" }));
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("disables both triggers when the disabled prop is set", () => {
    render(<TimeSelect value="" onChange={() => {}} disabled aria-label="Start time" />);
    expect(screen.getByRole("button", { name: "Start time hour" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Start time minute" })).toBeDisabled();
  });
});
