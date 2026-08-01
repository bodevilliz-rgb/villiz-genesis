// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlatformBadge } from "@/components/publishing/platform-badge";

describe("PlatformBadge — accessible name", () => {
  it("exposes an unambiguous 'Publishing destination: <platform>' accessible name, with or without a visible label", () => {
    const { rerender } = render(<PlatformBadge platform="linkedin" />);
    expect(screen.getByRole("img", { name: "Publishing destination: LinkedIn" })).toBeInTheDocument();

    rerender(<PlatformBadge platform="x" showLabel={false} />);
    expect(screen.getByRole("img", { name: "Publishing destination: X" })).toBeInTheDocument();
  });

  it("renders the correct label text for every platform", () => {
    const { rerender } = render(<PlatformBadge platform="facebook" />);
    expect(screen.getByText("Facebook")).toBeInTheDocument();

    rerender(<PlatformBadge platform="instagram" />);
    expect(screen.getByText("Instagram")).toBeInTheDocument();
  });
});
