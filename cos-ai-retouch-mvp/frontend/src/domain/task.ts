export const TASK_STATUSES = [
  "created",
  "uploading",
  "analyzing",
  "awaiting_confirmation",
  "generating",
  "validating",
  "succeeded",
  "failed",
  "expired",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export type Goal = "natural_retouch" | "structure_repair";

export type TaskCategory =
  | "face"
  | "hair"
  | "clothing"
  | "body_pose"
  | "background"
  | "lighting";

export type AnalysisCategory = TaskCategory;

export const TASK_CATEGORIES: TaskCategory[] = [
  "face",
  "hair",
  "clothing",
  "body_pose",
  "background",
  "lighting",
];

export interface AssetUrl {
  kind: "original" | "mask" | "version";
  url: string;
  expiresAt: string;
}

export interface Region {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  source?: string;
  maskAssetUrl?: AssetUrl | null;
}

export interface AnalysisCard {
  id: string;
  category: string;
  title: string;
  summary: string;
  confidence: number | null;
  risk: string;
  enabled: boolean;
  regions: Region[];
}

export interface OperationInput {
  id?: string;
  kind: string;
  goal: Goal;
  regionIds?: string[];
  intensity: number;
  enabled: boolean;
  instructions?: string | null;
}

export interface EditPlanInput {
  goals: Goal[];
  preserve?: string[];
  regions?: Region[];
  operations: OperationInput[];
  intensity?: number;
  integration?: string[];
  validation?: string[];
  notes?: string | null;
}

export interface EditPlan extends EditPlanInput {
  preserve: string[];
  regions: Region[];
  intensity: number;
  integration: string[];
  validation: string[];
}

export interface VersionView {
  id: string;
  assetUrl: AssetUrl;
  createdAt: string;
  validation: Record<string, "pass" | "review">;
  selected: boolean;
}

export interface TaskError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface TaskView {
  taskId: string;
  status: TaskStatus;
  createdAt?: string;
  updatedAt?: string;
  uploadUrl?: string;
  expiresAt?: string;
  originalAssetUrl?: AssetUrl | null;
  maskAssetUrl?: AssetUrl | null;
  analysis: AnalysisCard[];
  plan: EditPlan | null;
  versions: VersionView[];
  error: TaskError | null;
}

export interface CreateTaskInput {
  filename: string;
  contentType: string;
  byteSize: number;
}

export const DEFAULT_PRESERVE = [
  "face identity",
  "composition",
  "main pose",
  "costume design",
  "background structure",
  "original light direction",
  "perspective",
  "depth of field",
  "noise consistency",
] as const;

export const DEFAULT_INTEGRATION = [
  "original light direction",
  "perspective",
  "depth of field",
  "noise consistency",
] as const;

export const DEFAULT_VALIDATION = [
  "face identity",
  "pose and composition",
  "hands and costume",
  "background geometry",
  "lighting and noise",
] as const;
