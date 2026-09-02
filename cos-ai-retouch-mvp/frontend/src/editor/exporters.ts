import { writePsdUint8Array, type Layer as PsdLayer, type PixelData, type Psd } from "ag-psd";

import type { AdjustmentValues, EditorDocument, EditorLayer } from "../domain/editor";
import { applyAdjustments, rasterizeMask } from "./operations";

export interface AuraProjectExport {
  exportVersion: 1;
  id: string;
  filename: string;
  width: number;
  height: number;
  sourceDataUrl: null;
  layers: Array<{
    id: string;
    name: string;
    kind: EditorLayer["kind"];
    module: EditorLayer["module"];
    visible: boolean;
    locked: boolean;
    opacity: number;
    blendMode: EditorLayer["blendMode"];
    scope: EditorLayer["scope"];
    adjustments: AdjustmentValues;
    maskStrokes: EditorLayer["maskStrokes"];
    operation?: EditorLayer["operation"];
  }>;
  history: string[];
}

function pixelDataFromImageData(imageData: ImageData): PixelData {
  return {
    data: new Uint8ClampedArray(imageData.data),
    width: imageData.width,
    height: imageData.height,
  };
}

function imageDataFromPixels(data: Uint8ClampedArray, width: number, height: number): ImageData {
  if (typeof ImageData === "function") return new ImageData(data, width, height);
  return { data, width, height, colorSpace: "srgb" } as ImageData;
}

function maskPixelData(strokes: EditorLayer["maskStrokes"], width: number, height: number): PixelData {
  const alpha = rasterizeMask(strokes, width, height);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < alpha.length; index += 1) {
    const offset = index * 4;
    data[offset] = 255;
    data[offset + 1] = 255;
    data[offset + 2] = 255;
    data[offset + 3] = alpha[index];
  }
  return { data, width, height };
}

function layerPixelData(layer: EditorLayer, source: ImageData): PixelData {
  return pixelDataFromImageData(
    layer.kind === "image" ? source : applyAdjustments(source, layer.adjustments),
  );
}

function toPsdLayer(layer: EditorLayer, source: ImageData): PsdLayer {
  const output: PsdLayer = {
    name: layer.name,
    imageData: layerPixelData(layer, source),
    opacity: layer.opacity,
    hidden: !layer.visible,
    blendMode: layer.blendMode === "soft-light" ? "soft light" : layer.blendMode,
    top: 0,
    left: 0,
    bottom: source.height,
    right: source.width,
  };

  if (layer.kind !== "image" && layer.maskStrokes.length > 0) {
    output.mask = {
      top: 0,
      left: 0,
      bottom: source.height,
      right: source.width,
      defaultColor: 0,
      imageData: maskPixelData(layer.maskStrokes, source.width, source.height),
    };
  }

  return output;
}

function blendChannel(base: number, overlay: number, mode: EditorLayer["blendMode"]): number {
  switch (mode) {
    case "multiply": return (base * overlay) / 255;
    case "screen": return 255 - ((255 - base) * (255 - overlay)) / 255;
    case "overlay": return base < 128 ? (2 * base * overlay) / 255 : 255 - (2 * (255 - base) * (255 - overlay)) / 255;
    case "soft-light": {
      const b = base / 255;
      const o = overlay / 255;
      const result = (1 - 2 * o) * b * b + 2 * o * b;
      return result * 255;
    }
    default: return overlay;
  }
}

function compositeLayer(base: ImageData, overlay: ImageData, layer: EditorLayer): ImageData {
  const output = new Uint8ClampedArray(base.data);
  const mask = layer.maskStrokes.length > 0 ? rasterizeMask(layer.maskStrokes, base.width, base.height) : null;
  const opacity = Math.min(1, Math.max(0, layer.opacity));

  for (let index = 0; index < output.length; index += 4) {
    const maskAlpha = mask ? mask[index / 4] / 255 : 1;
    const alpha = opacity * maskAlpha * (overlay.data[index + 3] / 255);
    if (alpha <= 0) continue;
    output[index] = Math.round(output[index] * (1 - alpha) + blendChannel(output[index], overlay.data[index], layer.blendMode) * alpha);
    output[index + 1] = Math.round(output[index + 1] * (1 - alpha) + blendChannel(output[index + 1], overlay.data[index + 1], layer.blendMode) * alpha);
    output[index + 2] = Math.round(output[index + 2] * (1 - alpha) + blendChannel(output[index + 2], overlay.data[index + 2], layer.blendMode) * alpha);
  }

  return imageDataFromPixels(output, base.width, base.height);
}

/** Render the current non-destructive document to a flattened ImageData preview/export. */
export function renderDocumentToImageData(document: EditorDocument, source: ImageData): ImageData {
  let output = imageDataFromPixels(new Uint8ClampedArray(source.data), source.width, source.height);
  for (const layer of document.layers) {
    if (layer.kind === "image" || !layer.visible) continue;
    output = compositeLayer(output, applyAdjustments(source, layer.adjustments), layer);
  }
  return output;
}

/** Write a Photoshop-compatible layered PSD while preserving each editor layer and bitmap mask. */
export function buildPsdBytes(document: EditorDocument, source: ImageData): Uint8Array {
  const psd: Psd = {
    width: source.width,
    height: source.height,
    bitsPerChannel: 8,
    imageData: pixelDataFromImageData(renderDocumentToImageData(document, source)),
    children: document.layers.map((layer) => toPsdLayer(layer, source)),
  };
  return writePsdUint8Array(psd, { compress: true });
}

/** Serialize editable AURA state without embedding the user's photo or any provider secret. */
export function createAuraProjectJson(document: EditorDocument): AuraProjectExport {
  return {
    exportVersion: 1,
    id: document.id,
    filename: document.filename,
    width: document.width,
    height: document.height,
    sourceDataUrl: null,
    layers: document.layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      kind: layer.kind,
      module: layer.module,
      visible: layer.visible,
      locked: layer.locked,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      scope: layer.scope,
      adjustments: { ...layer.adjustments },
      maskStrokes: layer.maskStrokes.map((stroke) => ({
        mode: stroke.mode,
        width: stroke.width,
        points: stroke.points.map((point) => ({ ...point })),
      })),
      ...(layer.operation ? { operation: { ...layer.operation, preserve: [...layer.operation.preserve], adjustments: { ...layer.operation.adjustments } } } : {}),
    })),
    history: [...document.history],
  };
}

export function loadImageData(sourceUrl: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = window.document.createElement("canvas");
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("当前浏览器无法创建图像画布"));
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(context.getImageData(0, 0, canvas.width, canvas.height));
    };
    image.onerror = () => reject(new Error("照片读取失败，请重新导入原图"));
    image.src = sourceUrl;
  });
}

export function createJpgBlob(document: EditorDocument, source: ImageData): Promise<Blob> {
  const canvas = window.document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("当前浏览器无法创建导出画布"));
  context.putImageData(renderDocumentToImageData(document, source), 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("JPG 导出失败")), "image/jpeg", 0.94);
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadJson(value: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" });
  downloadBlob(blob, filename);
}
