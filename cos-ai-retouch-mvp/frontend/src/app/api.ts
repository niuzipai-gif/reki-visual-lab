import { API_BASE_URL } from "./config";
import {
  DEFAULT_INTEGRATION,
  DEFAULT_PRESERVE,
  DEFAULT_VALIDATION,
  type AnalysisCard,
  type AssetUrl,
  type CreateTaskInput,
  type DownloadUrl,
  type EditPlan,
  type EditPlanInput,
  type Region,
  type TaskError,
  type TaskView,
  type VersionView,
} from "../domain/task";

const USER_ERROR_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: "邀请 token 无效或已过期。",
  INVALID_FILE: "文件类型、文件名或文件大小无效。",
  TASK_NOT_READY: "任务还未准备好，请完成前一步操作。",
  INVALID_PLAN: "修图计划格式无效，请重新确认修图区域。",
  NOT_FOUND: "任务不存在或已不可用。",
  TASK_EXPIRED: "任务已过期，请重新上传原图。",
  PROVIDER_ERROR: "图片处理暂时不可用，请稍后重试。",
  IDEMPOTENCY_CONFLICT: "请求正在处理中，请稍后重试。",
  CANDIDATE_LIMIT: "一个任务最多生成两个候选版本。",
  UPLOAD_FAILED: "原图上传失败，请稍后重试。",
};

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: string, message: string, status: number, retryable = false) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeApiMessage(code: string, value: unknown): string {
  if (USER_ERROR_MESSAGES[code]) {
    return USER_ERROR_MESSAGES[code];
  }
  if (typeof value === "string" && value.length <= 500) {
    const trimmed = value.trim();
    if (trimmed && !trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      return trimmed;
    }
  }
  return "请求失败，请稍后重试。";
}

export function getUserSafeErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "请求失败，请稍后重试。";
}

function mapAsset(value: unknown): AssetUrl | null {
  if (!isRecord(value)) return null;
  const kind = value.kind;
  if (kind !== "original" && kind !== "mask" && kind !== "version") return null;
  const url = stringValue(value.url);
  const expiresAt = stringValue(value.expires_at ?? value.expiresAt);
  if (!url || !expiresAt) return null;
  return { kind, url, expiresAt };
}

function mapRegion(value: unknown): Region {
  const region = isRecord(value) ? value : {};
  return {
    id: stringValue(region.id, "region"),
    label: stringValue(region.label, "局部区域"),
    x: numberValue(region.x) ?? 0,
    y: numberValue(region.y) ?? 0,
    width: numberValue(region.width) ?? 0,
    height: numberValue(region.height) ?? 0,
    source: stringValue(region.source, "analysis"),
    maskAssetUrl: mapAsset(region.mask_asset_url ?? region.maskAssetUrl),
  };
}

function mapAnalysisCard(value: unknown): AnalysisCard {
  const card = isRecord(value) ? value : {};
  const regions = Array.isArray(card.regions) ? card.regions.map(mapRegion) : [];
  return {
    id: stringValue(card.id, "analysis-card"),
    category: stringValue(card.category, "background"),
    title: stringValue(card.title, "局部细节"),
    summary: stringValue(card.summary),
    confidence: numberValue(card.confidence),
    risk: stringValue(card.risk),
    enabled: card.enabled === true,
    regions,
  };
}

function mapPlan(value: unknown): EditPlan | null {
  if (!isRecord(value)) return null;
  const operations = Array.isArray(value.operations)
    ? value.operations.map((operation) => {
        const item = isRecord(operation) ? operation : {};
        return {
          id: stringValue(item.id) || undefined,
          kind: stringValue(item.kind),
          goal: item.goal === "structure_repair" ? "structure_repair" as const : "natural_retouch" as const,
          regionIds: Array.isArray(item.region_ids)
            ? item.region_ids.filter((id): id is string => typeof id === "string")
            : [],
          intensity: numberValue(item.intensity) ?? 55,
          enabled: item.enabled !== false,
          instructions: typeof item.instructions === "string" ? item.instructions : null,
        };
      })
    : [];
  return {
    goals: Array.isArray(value.goals)
      ? value.goals.filter((goal): goal is "natural_retouch" | "structure_repair" =>
          goal === "natural_retouch" || goal === "structure_repair",
        )
      : [],
    preserve: Array.isArray(value.preserve)
      ? value.preserve.filter((item): item is string => typeof item === "string")
      : [...DEFAULT_PRESERVE],
    regions: Array.isArray(value.regions) ? value.regions.map(mapRegion) : [],
    operations,
    intensity: numberValue(value.intensity) ?? 55,
    integration: Array.isArray(value.integration)
      ? value.integration.filter((item): item is string => typeof item === "string")
      : [...DEFAULT_INTEGRATION],
    validation: Array.isArray(value.validation)
      ? value.validation.filter((item): item is string => typeof item === "string")
      : [...DEFAULT_VALIDATION],
    notes: typeof value.notes === "string" ? value.notes : null,
  };
}

function mapVersion(value: unknown): VersionView {
  const version = isRecord(value) ? value : {};
  const validation: Record<string, "pass" | "review"> = {};
  if (isRecord(version.validation)) {
    for (const [key, result] of Object.entries(version.validation)) {
      if (result === "pass" || result === "review") validation[key] = result;
    }
  }
  return {
    id: stringValue(version.id),
    assetUrl: mapAsset(version.asset_url ?? version.assetUrl) ?? {
      kind: "version",
      url: "",
      expiresAt: "",
    },
    createdAt: stringValue(version.created_at ?? version.createdAt),
    validation,
    selected: version.selected === true,
  };
}

function mapError(value: unknown): TaskError | null {
  if (!isRecord(value)) return null;
  const code = stringValue(value.code, "REQUEST_FAILED");
  return {
    code,
    message: safeApiMessage(code, value.message),
    retryable: value.retryable === true,
  };
}

export function normalizeTask(value: unknown): TaskView {
  const task = isRecord(value) ? value : {};
  const status = stringValue(task.status, "created");
  const validStatus = [
    "created",
    "uploading",
    "analyzing",
    "awaiting_confirmation",
    "generating",
    "validating",
    "succeeded",
    "failed",
    "expired",
  ].includes(status)
    ? (status as TaskView["status"])
    : "failed";
  return {
    taskId: stringValue(task.task_id ?? task.taskId),
    status: validStatus,
    createdAt: stringValue(task.created_at ?? task.createdAt) || undefined,
    updatedAt: stringValue(task.updated_at ?? task.updatedAt) || undefined,
    uploadUrl: stringValue(task.upload_url ?? task.uploadUrl) || undefined,
    expiresAt: stringValue(task.expires_at ?? task.expiresAt) || undefined,
    originalAssetUrl: mapAsset(task.original_asset_url ?? task.originalAssetUrl),
    maskAssetUrl: mapAsset(task.mask_asset_url ?? task.maskAssetUrl),
    analysis: Array.isArray(task.analysis) ? task.analysis.map(mapAnalysisCard) : [],
    plan: mapPlan(task.plan),
    versions: Array.isArray(task.versions) ? task.versions.map(mapVersion) : [],
    error: mapError(task.error),
  };
}

function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

async function request<T>(
  path: string,
  options: RequestInit,
  inviteToken?: string,
  mapper?: (payload: unknown) => T,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (inviteToken) headers.set("X-Invite-Token", inviteToken);
  const response = await fetch(apiUrl(path), { ...options, headers });
  const payload = await readPayload(response);
  if (!response.ok) {
    const errorPayload = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
    const code = stringValue(errorPayload.code, "REQUEST_FAILED");
    throw new ApiError(
      code,
      safeApiMessage(code, errorPayload.message),
      response.status,
      errorPayload.retryable === true,
    );
  }
  return mapper ? mapper(payload) : (payload as T);
}

function jsonBody(value: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  };
}

export function createIdempotencyKey(): string {
  const randomUuid = globalThis.crypto?.randomUUID;
  if (typeof randomUuid === "function") return randomUuid.call(globalThis.crypto);
  return `client-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function withIdempotencyKey(key?: string): string {
  return key?.trim() || createIdempotencyKey();
}

function toWireRegion(region: Region): Record<string, unknown> {
  return {
    id: region.id,
    label: region.label,
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
    source: region.source ?? "analysis",
    mask_asset_url: region.maskAssetUrl
      ? {
          kind: region.maskAssetUrl.kind,
          url: region.maskAssetUrl.url,
          expires_at: region.maskAssetUrl.expiresAt,
        }
      : null,
  };
}

function toWirePlan(plan: EditPlanInput): Record<string, unknown> {
  return {
    goals: plan.goals,
    preserve: plan.preserve ?? [...DEFAULT_PRESERVE],
    regions: (plan.regions ?? []).map(toWireRegion),
    operations: plan.operations.map((operation) => ({
      ...(operation.id ? { id: operation.id } : {}),
      kind: operation.kind,
      goal: operation.goal,
      region_ids: operation.regionIds ?? [],
      intensity: operation.intensity,
      enabled: operation.enabled,
      instructions: operation.instructions ?? null,
    })),
    intensity: plan.intensity ?? 55,
    integration: plan.integration ?? [...DEFAULT_INTEGRATION],
    validation: plan.validation ?? [...DEFAULT_VALIDATION],
    notes: plan.notes ?? null,
  };
}

export async function createTask(
  input: CreateTaskInput,
  inviteToken: string,
): Promise<TaskView> {
  return request(
    "/api/v1/tasks",
    jsonBody({
      invite_token: inviteToken,
      filename: input.filename,
      content_type: input.contentType,
      byte_size: input.byteSize,
    }),
    undefined,
    normalizeTask,
  );
}

export async function uploadOriginal(uploadUrl: string, file: File): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!response.ok) {
    throw new ApiError("UPLOAD_FAILED", USER_ERROR_MESSAGES.UPLOAD_FAILED, response.status);
  }
}

export async function startAnalysis(
  taskId: string,
  inviteToken: string,
  idempotencyKey?: string,
): Promise<TaskView> {
  return request(
    `/api/v1/tasks/${encodeURIComponent(taskId)}/analyze`,
    {
      ...jsonBody(undefined),
      body: undefined,
      headers: { "Idempotency-Key": withIdempotencyKey(idempotencyKey) },
    },
    inviteToken,
    normalizeTask,
  );
}

export async function getTask(taskId: string, inviteToken: string): Promise<TaskView> {
  return request(
    `/api/v1/tasks/${encodeURIComponent(taskId)}`,
    { method: "GET" },
    inviteToken,
    normalizeTask,
  );
}

export async function savePlan(
  taskId: string,
  plan: EditPlanInput,
  inviteToken: string,
): Promise<TaskView> {
  return request(
    `/api/v1/tasks/${encodeURIComponent(taskId)}/plan`,
    jsonBody(toWirePlan(plan)),
    inviteToken,
    normalizeTask,
  );
}

export async function startGeneration(
  taskId: string,
  inviteToken: string,
  idempotencyKey?: string,
): Promise<TaskView> {
  return request(
    `/api/v1/tasks/${encodeURIComponent(taskId)}/generate`,
    {
      ...jsonBody(undefined),
      body: undefined,
      headers: { "Idempotency-Key": withIdempotencyKey(idempotencyKey) },
    },
    inviteToken,
    normalizeTask,
  );
}

export async function getDownloadUrl(
  taskId: string,
  inviteToken: string,
): Promise<DownloadUrl> {
  return request(
    `/api/v1/tasks/${encodeURIComponent(taskId)}/download`,
    { method: "GET" },
    inviteToken,
    (payload) => {
      const value = isRecord(payload) ? payload : {};
      return {
        url: stringValue(value.url),
        expiresAt: stringValue(value.expires_at ?? value.expiresAt),
      };
    },
  );
}

export interface ApiClient {
  createTask: typeof createTask;
  uploadOriginal: typeof uploadOriginal;
  startAnalysis: typeof startAnalysis;
  getTask: typeof getTask;
  savePlan: typeof savePlan;
  startGeneration: typeof startGeneration;
  getDownloadUrl: typeof getDownloadUrl;
}

export const apiClient: ApiClient = {
  createTask,
  uploadOriginal,
  startAnalysis,
  getTask,
  savePlan,
  startGeneration,
  getDownloadUrl,
};

export const api = apiClient;

export default apiClient;
