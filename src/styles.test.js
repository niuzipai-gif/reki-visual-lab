import fs from "node:fs";
import { describe, expect, test } from "vitest";

const css = fs.readFileSync("src/styles.css", "utf8");

describe("Reki CSS contracts", () => {
  test("defines and uses only the exact public design tokens", () => {
    const tokens = {
      "--reki-bg": "#ece8dd",
      "--reki-surface": "rgba(255, 255, 255, .58)",
      "--reki-surface-strong": "rgba(250, 248, 241, .78)",
      "--reki-edge": "rgba(49, 43, 27, .13)",
      "--reki-ink": "#29271f",
      "--reki-muted": "#716c61",
      "--reki-yolk": "#efbe3b",
      "--reki-radius-panel": "22px",
      "--reki-blur": "24px",
    };

    for (const [token, value] of Object.entries(tokens)) {
      expect(css).toContain(`${token}: ${value};`);
      expect(css).toContain(`var(${token})`);
    }
    for (const alias of [
      "--bg",
      "--surface",
      "--surface-strong",
      "--edge",
      "--ink",
      "--muted",
      "--yolk",
      "--panel-radius",
      "--blur",
    ]) {
      expect(css).not.toMatch(new RegExp(`${alias.replaceAll("-", "\\-")}\\s*:`));
    }
  });

  test("uses the dynamic viewport without a fixed mobile minimum height", () => {
    expect(css).not.toMatch(/min-height:\s*520px/);
    expect(css).toMatch(
      /@media \(max-width: 759px\)[\s\S]*?\.workbench-shell\s*\{[^}]*height:\s*100dvh;[^}]*min-height:\s*0;/,
    );
    expect(css).toMatch(
      /@media \(max-width: 759px\)[\s\S]*?\.canvas-workspace\s*\{[^}]*min-height:\s*0;/,
    );
  });

  test("keeps both history controls visible on mobile", () => {
    const mobileRules = css.match(
      /@media \(max-width: 759px\)\s*\{[\s\S]*?(?=@media \(max-width: 420px\))/,
    )?.[0] ?? "";

    expect(mobileRules).not.toMatch(
      /\.top-history\s+\.icon-button:nth-child\(2\)\s*\{\s*display:\s*none/,
    );
  });

  test("defines a visible, pointer-transparent canvas grid overlay", () => {
    expect(css).toMatch(
      /\.canvas-grid-overlay\s*\{[^}]*position:\s*absolute;[^}]*pointer-events:\s*none;[^}]*background-image:/,
    );
  });

  test("layers filtered backgrounds below unfiltered stage and grid siblings", () => {
    expect(css).toMatch(
      /\.canvas-background\s*\{[^}]*position:\s*absolute;[^}]*z-index:\s*0;/,
    );
    expect(css).toMatch(
      /\.canvas-surface\s+\.konvajs-content\s*\{[^}]*z-index:\s*1;/,
    );
    expect(css).toMatch(
      /\.canvas-grid-overlay\s*\{[^}]*z-index:\s*2;/,
    );
    expect(
      css.match(/\.canvas-surface\s*\{[^}]*\}/)?.[0] ?? "",
    ).not.toMatch(/\bfilter\s*:/);
  });
});
