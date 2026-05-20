import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { App } from "./App";

describe("App", () => {
  it("runs the core Friendy product path through chat", () => {
    render(<App />);

    expect(screen.getAllByText(/Photon Residency Dinner/i).length).toBeGreaterThan(0);

    const input = screen.getByLabelText("Message Friendy");
    const send = screen.getByRole("button", { name: "Send" });

    fireEvent.change(input, { target: { value: "yes" } });
    fireEvent.click(send);

    expect(screen.getByText("Maya Chen")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "save Maya: played piano, AI recruiting founder" } });
    fireEvent.click(send);

    expect(screen.getByText(/Saved Maya Chen/i)).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "who was playing piano at dinner" } });
    fireEvent.click(send);

    expect(screen.getByText(/Likely Maya Chen/i)).toBeInTheDocument();
  });
});
