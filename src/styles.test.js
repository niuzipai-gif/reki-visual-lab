import fs from "node:fs";
import zlib from "node:zlib";
import { describe, expect, test } from "vitest";

const css = fs.readFileSync("src/styles.css", "utf8");
const indexHtml = fs.readFileSync("index.html", "utf8");
const markSvg = fs.readFileSync("public/reki-mark.svg", "utf8");
const brandCharacter = fs.readFileSync("public/brand/reki-character.png");
const brandCharacterMark = fs.readFileSync("public/brand/reki-character-mark.png");

function readPngInfo(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(buffer.subarray(0, 8).equals(signature)).toBe(true);
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer[24];
  const colorType = buffer[25];
  const idat = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") idat.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
    if (type === "IEND") break;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  let cursor = 0;
  let previous = Buffer.alloc(stride);
  const alpha = [];
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor++];
    const row = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const value = raw[cursor++];
      const left = x >= 4 ? row[x - 4] : 0;
      const up = previous[x];
      const upLeft = x >= 4 ? previous[x - 4] : 0;
      row[x] = (value + (filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : filter === 4 ? paeth(left, up, upLeft) : 0)) & 0xff;
    }
    for (let x = 3; x < stride; x += 4) alpha.push(row[x]);
    previous = row;
  }
  return { width, height, bitDepth, colorType, alpha };
}

describe("Reki CSS contracts", () => {
  test("defines and uses only the exact public design tokens", () => {
    const tokens = {
      "--reki-bg": "#efe4d4",
      "--reki-surface": "rgba(255, 255, 255, .58)",
      "--reki-surface-strong": "rgba(250, 248, 241, .78)",
      "--reki-edge": "rgba(49, 43, 27, .13)",
      "--reki-ink": "#29271f",
      "--reki-muted": "#716c61",
      "--reki-yolk": "#b02f3e",
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

  test("uses the dedicated hand-drawn Reki mark and favicon assets", () => {
    expect(indexHtml).toContain('href="/favicon.svg"');
    expect(indexHtml).toContain('<link rel="icon" type="image/png" href="/brand/reki-character-mark.png" />');
    expect(indexHtml).toContain('<meta name="theme-color" content="#efe4d4" />');
    expect(markSvg).toContain("reki-character-mark.png");
    expect(fs.existsSync("public/brand/reki-character.png")).toBe(true);
    expect(fs.existsSync("public/brand/reki-character-mark.png")).toBe(true);
    expect(brandCharacter.length).toBeGreaterThan(100);
    expect(brandCharacterMark.length).toBeGreaterThan(100);
    const full = readPngInfo(brandCharacter);
    const mark = readPngInfo(brandCharacterMark);
    expect(full).toMatchObject({ width: 640, height: 640, bitDepth: 8, colorType: 6 });
    expect(mark).toMatchObject({ width: 540, height: 540, bitDepth: 8, colorType: 6 });
    expect(mark.alpha.some((value) => value === 0)).toBe(true);
    expect(mark.alpha.some((value) => value > 0)).toBe(true);
    expect(css).toContain(".entry-brand-mark");
    expect(css).toContain(".brand-icon img");
  });

  test("keeps the canvas branding decorative and pointer-transparent", () => {
    expect(css).toMatch(
      /\.canvas-brand-mark\s*\{[^}]*position:\s*absolute;[^}]*pointer-events:\s*none;/,
    );
    expect(css).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.canvas-brand-mark\s*\{[^}]*opacity:/,
    );
    const legacyMobileRules = css.match(
      /@media \(max-width: 759px\)\s*\{[\s\S]*?(?=@media \(max-width: 420px\))/,
    )?.[0] ?? "";
    expect(legacyMobileRules).not.toContain(".canvas-brand-mark");
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

  test("keeps import and pixel controls compact within the approved glass system", () => {
    expect(css).toMatch(
      /\.import-drop-zone\s*\{[^}]*border:[^}]*var\(--reki-edge\);[^}]*border-radius:/,
    );
    expect(css).toMatch(
      /\.filter-panel fieldset\s*\{[^}]*border:\s*0;/,
    );
    expect(css).toMatch(
      /\.filter-reset\s*\{[^}]*border:[^}]*var\(--reki-edge\);/,
    );
  });

  test("hides only inactive pixel sources without affecting annotation layers", () => {
    expect(css).toMatch(
      /\.canvas-background \.hidden\s*\{[^}]*visibility:\s*hidden;/,
    );
    expect(css).toMatch(
      /\.background-source\s*\{[^}]*position:\s*absolute;/,
    );
  });

  test("keeps AI controls compact in the approved glass and yolk system", () => {
    expect(css).toMatch(
      /\.ai-scan-panel fieldset\s*\{[^}]*border:\s*0;/,
    );
    expect(css).toMatch(
      /\.ai-scan-panel input\[type="range"\]\s*\{[^}]*accent-color:\s*var\(--reki-yolk\);/,
    );
    expect(css).toMatch(
      /\.ai-actions\s*\{[^}]*display:\s*grid;[^}]*gap:/,
    );
    expect(css).toMatch(
      /\.ai-privacy\s*\{[^}]*color:\s*var\(--reki-muted\);/,
    );
  });
});
