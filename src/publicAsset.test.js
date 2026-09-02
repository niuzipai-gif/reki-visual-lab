import { describe, expect, it } from "vitest";
import { publicAsset } from "./publicAsset.js";

describe("publicAsset", () => {
  it("keeps public files inside a configured deployment subpath", () => {
    expect(
      publicAsset("/brand/reki-character-mark.png", "/reki-visual-lab/"),
    ).toBe("/reki-visual-lab/brand/reki-character-mark.png");
  });

  it("uses a root-relative path for the primary deployment", () => {
    expect(publicAsset("cosplay-reference.png", "/")).toBe(
      "/cosplay-reference.png",
    );
  });
});
