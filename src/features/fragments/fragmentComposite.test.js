import { describe, expect, test } from "vitest";
import {
  composeProjectFrameToContext,
  drawFragmentToContext,
} from "./fragmentComposite.js";

function color(value, alpha = 255) {
  return [value, 0, 0, alpha];
}

function parseFillStyle(style) {
  if (style === "#000") return [0, 0, 0, 255];
  if (style === "#fff") return [255, 255, 255, 255];
  return [0, 0, 0, 255];
}

function drawablePixels(image) {
  if (image?.data instanceof Uint8ClampedArray) return image;
  if (image?.getContext) {
    const context = image.getContext("2d");
    return context.getImageData(0, 0, image.width, image.height);
  }
  throw new Error("Synthetic test drawable is missing pixels");
}

function createRasterCanvas(width, height, calls = []) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const context = {
    canvas: { width, height },
    fillStyle: "#000",
    globalAlpha: 1,
    clearRect(x, y, rectWidth, rectHeight) {
      for (let py = Math.max(0, Math.floor(y)); py < Math.min(height, Math.ceil(y + rectHeight)); py += 1) {
        for (let px = Math.max(0, Math.floor(x)); px < Math.min(width, Math.ceil(x + rectWidth)); px += 1) {
          pixels.set([0, 0, 0, 0], (py * width + px) * 4);
        }
      }
    },
    fillRect(x, y, rectWidth, rectHeight) {
      const fill = parseFillStyle(this.fillStyle);
      for (let py = Math.max(0, Math.floor(y)); py < Math.min(height, Math.ceil(y + rectHeight)); py += 1) {
        for (let px = Math.max(0, Math.floor(x)); px < Math.min(width, Math.ceil(x + rectWidth)); px += 1) {
          pixels.set(fill, (py * width + px) * 4);
        }
      }
    },
    drawImage(image, ...args) {
      const source = drawablePixels(image);
      const [sx, sy, sw, sh, dx, dy, dw, dh] = args.length === 8
        ? args
        : [0, 0, source.width, source.height, args[0] ?? 0, args[1] ?? 0, args[2] ?? source.width, args[3] ?? source.height];
      for (let py = Math.max(0, Math.floor(dy)); py < Math.min(height, Math.ceil(dy + dh)); py += 1) {
        for (let px = Math.max(0, Math.floor(dx)); px < Math.min(width, Math.ceil(dx + dw)); px += 1) {
          const sampleX = Math.min(source.width - 1, Math.max(0, Math.floor(sx + ((px - dx) / dw) * sw)));
          const sampleY = Math.min(source.height - 1, Math.max(0, Math.floor(sy + ((py - dy) / dh) * sh)));
          const target = (py * width + px) * 4;
          const from = (sampleY * source.width + sampleX) * 4;
          pixels[target] = source.data[from];
          pixels[target + 1] = source.data[from + 1];
          pixels[target + 2] = source.data[from + 2];
          pixels[target + 3] = Math.round(source.data[from + 3] * this.globalAlpha);
        }
      }
    },
    getImageData(x, y, readWidth, readHeight) {
      const data = new Uint8ClampedArray(readWidth * readHeight * 4);
      for (let py = 0; py < readHeight; py += 1) {
        for (let px = 0; px < readWidth; px += 1) {
          data.set(pixels.slice(((py + y) * width + px + x) * 4, ((py + y) * width + px + x) * 4 + 4), (py * readWidth + px) * 4);
        }
      }
      return new ImageData(data, readWidth, readHeight);
    },
    putImageData(imageData, x, y) {
      for (let py = 0; py < imageData.height; py += 1) {
        for (let px = 0; px < imageData.width; px += 1) {
          pixels.set(imageData.data.slice((py * imageData.width + px) * 4, (py * imageData.width + px) * 4 + 4), ((py + y) * width + px + x) * 4);
        }
      }
    },
    save() { calls.push(["save"]); },
    restore() { calls.push(["restore"]); },
    translate(x, y) { calls.push(["translate", x, y]); },
    rotate(value) { calls.push(["rotate", value]); },
    scale(x, y) { calls.push(["scale", x, y]); },
    beginPath() {}, rect() {}, clip() {},
  };
  return {
    width,
    height,
    getContext: () => context,
    pixels,
    context,
  };
}

function source() {
  return {
    width: 4,
    height: 1,
    data: new Uint8ClampedArray([
      ...color(100), ...color(40), ...color(60), ...color(80),
    ]),
  };
}

function fragment(sourceFill) {
  return {
    id: `fragment-${sourceFill}`,
    type: "extractedFragment",
    visible: true,
    sourceRect: { x: 0, y: 0, width: 0.25, height: 1 },
    transform: { x: 0.75, y: 0, width: 0.25, height: 1 },
    sourceFill,
    opacity: 1,
    effects: [{
      id: "local-brightness", type: "brightness", name: "亮度", visible: true,
      opacity: 1, settings: { amount: 2 },
    }],
    animation: { type: "none" },
  };
}

describe("fragment export compositor", () => {
  test.each([
    ["black", [0, 0, 0, 255]],
    ["white", [255, 255, 255, 255]],
    ["transparent", [0, 0, 0, 0]],
  ])("cuts a %s source hole and composites a moved locally-effected fragment", (sourceFill, expectedHole) => {
    const output = createRasterCanvas(4, 1);
    composeProjectFrameToContext(output.context, {
      project: {
        canvas: { width: 4, height: 1 },
        effectStack: [],
        layers: [fragment(sourceFill)],
      },
      sourceBitmap: source(),
      scale: 1,
      canvasFactory: (width, height) => createRasterCanvas(width, height),
    });

    expect(Array.from(output.pixels.slice(0, 4))).toEqual(expectedHole);
    // The moved copy samples red=100 from the unfiltered source and local brightness doubles it.
    expect(Array.from(output.pixels.slice(12, 16))).toEqual([200, 0, 0, 255]);
  });

  test("uses the requested export-frame time for a fragment's individual motion", () => {
    const initialCalls = [];
    const animatedCalls = [];
    const layer = {
      ...fragment("preserve"),
      effects: [],
      animation: { type: "orbit", durationMs: 1000, delayMs: 0, loop: true, amplitude: 1, direction: "normal" },
    };

    drawFragmentToContext(createRasterCanvas(4, 1, initialCalls).context, {
      layer,
      source: source(),
      canvasSize: { width: 4, height: 1 },
      timeMs: 0,
      canvasFactory: (width, height) => createRasterCanvas(width, height),
    });
    drawFragmentToContext(createRasterCanvas(4, 1, animatedCalls).context, {
      layer,
      source: source(),
      canvasSize: { width: 4, height: 1 },
      timeMs: 250,
      canvasFactory: (width, height) => createRasterCanvas(width, height),
    });

    expect(initialCalls.filter(([name]) => name === "translate")[0]).not.toEqual(
      animatedCalls.filter(([name]) => name === "translate")[0],
    );
  });
});
