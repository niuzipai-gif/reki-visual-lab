import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("test DOM isolation", () => {
  it("renders content for one test", () => {
    render(<div>first-test-marker</div>);

    expect(screen.getByText("first-test-marker")).toBeInTheDocument();
  });

  it("starts the next test with a clean document", () => {
    expect(screen.queryByText("first-test-marker")).not.toBeInTheDocument();
  });
});
