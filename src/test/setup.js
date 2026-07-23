import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

let uuidSequence = 0;

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {},
  });
}

Object.defineProperty(globalThis.crypto, "randomUUID", {
  configurable: true,
  value: () =>
    `00000000-0000-4000-8000-${String(++uuidSequence).padStart(12, "0")}`,
});

beforeEach(() => {
  uuidSequence = 0;
});

afterEach(cleanup);

if (!globalThis.ImageData) {
  class ImageDataPolyfill {
    constructor(dataOrWidth, widthOrHeight, height) {
      if (typeof dataOrWidth === "number") {
        this.width = dataOrWidth;
        this.height = widthOrHeight;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      } else {
        this.data = dataOrWidth;
        this.width = widthOrHeight;
        this.height = height ?? dataOrWidth.length / (4 * widthOrHeight);
      }

      this.colorSpace = "srgb";
    }
  }

  globalThis.ImageData = ImageDataPolyfill;
}

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
