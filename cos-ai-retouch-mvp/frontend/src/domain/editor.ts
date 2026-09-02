export type EditorLayerKind = "image" | "adjustment" | "ai" | "group";
export type EditorBlendMode = "normal" | "multiply" | "screen" | "overlay" | "soft-light";
export type EditorScope = "global" | "local";

export interface AdjustmentValues {
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
  sharpness: number;
  grain: number;
  vignette: number;
}

export const DEFAULT_ADJUSTMENTS: AdjustmentValues = {
  exposure: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  sharpness: 0,
  grain: 0,
  vignette: 0,
};

export interface EditorPoint {
  x: number;
  y: number;
}

export interface EditorMaskStroke {
  mode: "add" | "erase";
  width: number;
  points: EditorPoint[];
}

export interface EditorOperationStep {
  id: string;
  label: string;
  module: "light" | "skin" | "hair" | "costume" | "body" | "background" | "style";
  kind: "adjustment" | "ai";
  scope: EditorScope;
  adjustments: Partial<AdjustmentValues>;
  preserve: string[];
  requiresRemoteAi?: boolean;
}

export interface EditorLayer {
  id: string;
  name: string;
  kind: EditorLayerKind;
  module: EditorOperationStep["module"] | "original";
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: EditorBlendMode;
  scope: EditorScope;
  adjustments: AdjustmentValues;
  maskStrokes: EditorMaskStroke[];
  operation?: EditorOperationStep;
}

export interface EditorDocument {
  id: string;
  filename: string;
  width: number;
  height: number;
  sourceDataUrl: string | null;
  layers: EditorLayer[];
  history: string[];
}

export type EditorPresetId = "natural-studio" | "clear-japanese" | "retro-film" | "dark-cinema";

