import { API_BASE_URL } from "./config";
import {
  DEFAULT_INTEGRATION,
  DEFAULT_PRESERVE,
  DEFAULT_VALIDATION,
  type AnalysisCard,
  type AssetUrl,
  type CreateTaskInput,
  type EditPlan,
  type EditPlanInput,
  type MaskStroke,
  type Region,
  type TaskError,
  type TaskView,
  type VersionView,
} from "../domain/task";

export type ErrorRecoveryAction = "invite" | "reupload" | "retry" | "back" | "review";

export interface UserSafeErrorState {
  code: string;
  message: string;
  action: ErrorRecoveryAction;
  actionLabel: string;
  retryable: boolean;
}

interface UserErrorCopy {
  message: string;
  action: ErrorRecoveryAction;
  actionLabel: string;
}

const USER_ERROR_COPY: Record<string, UserErrorCopy> = {
  INVALID_INVITE: {
    message: "邀请 token 无效，请重新输入。",
    action: "invite",
    actionLabel: "重新输入邀请 token",
  },
  UNAUTHORIZED: {
    message: "邀请 token 无效，请重新输入。",
    action: "invite",
    actionLabel: "重新输入邀请 token",
  },
  UNSUPPORTED_IMAGE: {
    message: "图片格式不受支持，请上传 JPG 或 PNG。",
    action: "reupload",
    actionLabel: "重新上传图片",
  },
  INVALID_FILE: {
    message: "文件类型、文件名或文件大小无效。",
    action: "reupload",
    actionLabel: "重新上传图片",
  },
  UPLOAD_FAILED: {
    message: "原图上传失败，请重试或重新上传。",
    action: "retry",
    actionLabel: "重试上传",
  },
  ANALYSIS_FAILED: {
    message: "原图分析失败，请重试分析。",
    action: "retry",
    actionLabel: "重试分析",
  },
  TASK_NOT_READY: {
    message: "任务还未准备好，请回到上一步完成确认。",
    action: "back",
    actionLabel: "回到上一步",
  },
  PROVIDER_TIMEOUT: {
    message: "图片处理超时，请重试。",
    action: "retry",
    actionLabel: "重试处理",
  },
  PROVIDER_QUOTA: {
    message: "图片处理额度暂时不足，请稍后重试。",
    action: "retry",
    actionLabel: "稍后重试",
  },
  VALIDATION_REVIEW: {
    message: "候选图需要人工复核，请查看结果后再决定。",
    action: "review",
    actionLabel: "查看复核结果",
  },
  TASK_EXPIRED: {
    message: "任务已过期，请重新上传原图。",
    action: "reupload",
    actionLabel: "重新上传原图",
  },
  INVALID_PLAN: {
    message: "修图计划格式无效，请重新确认修图区域。",
    action: "back",
    actionLabel: "回到上一步",
  },
  NOT_FOUND: {
    message: "任务不存在或已不可用。",
    action: "reupload",
    actionLabel: "重新上传图片",
  },
  PROVIDER_ERROR: {
    message: "图片处理暂时不可用，请稍后重试。",
    action: "retry",
    actionLabel: "重试处理",
  },
  DOWNLOAD_URL_INVALID: {
    message: "下载链接暂不可用，请重试。",
    action: "retry",
    actionLabel: "重试下载",
  },
  IDEMPOTENCY_CONFLICT: {
    message: "请求正在处理中，请稍后重试。",
    action: "retry",
    actionLabel: "重试处理",
  },
  CANDIDATE_LIMIT: {
    message: "一个任务最多生成两个候选版本。",
    action: "review",
    actionLabel: "查看已有结果",
  },
  INVALID_IDEMPOTENCY_KEY: {
    message: "请求校验失败，请重试当前步骤。",
    action: "retry",
    actionLabel: "重试当前步骤",
  },
  REQUEST_FAILED: {
    message: "请求失败，请稍后重试。",
    action: "retry",
    actionLabel: "重试当前步骤",
  },
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

function errorCopy(code: string): UserErrorCopy {
  return USER_ERROR_COPY[code] || USER_ERROR_COPY.REQUEST_FAILED;
}

const MAX_DOWNLOAD_URL_TTL_MS = 24 * 60 * 60 * 1000;

function invalidDownloadUrlError(): ApiError {
  return new ApiError(
    "DOWNLOAD_URL_INVALID",
    errorCopy("DOWNLOAD_URL_INVALID").message,
    502,
    true,
  );
}

function parseDownloadUrlPayload(payload: unknown): string {
  if (!isRecord(payload)) throw invalidDownloadUrlError();

  const rawUrl = payload.url;
  const rawExpiresAt = payload.expires_at;
  if (typeof rawUrl !== "string" || !rawUrl.trim() || typeof rawExpiresAt !== "string") {
    throw invalidDownloadUrlError();
  }

  const url = rawUrl.trim();
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      throw invalidDownloadUrlError();
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw invalidDownloadUrlError();
  }

  const expiresAt = Date.parse(rawExpiresAt);
  const remainingTtl = expiresAt - Date.now();
  if (
    !Number.isFinite(expiresAt) ||
    remainingTtl <= 0 ||
    remainingTtl > MAX_DOWNLOAD_URL_TTL_MS
  ) {
    throw invalidDownloadUrlError();
  }

  return url;
}

export function getUserSafeErrorState(error: unknown): UserSafeErrorState {
  const rawCode = error instanceof ApiError
    ? error.code
    : isRecord(error) && typeof error.code === "string"
      ? error.code
      : "REQUEST_FAILED";
  const code = USER_ERROR_COPY[rawCode] ? rawCode : "REQUEST_FAILED";
  const copy = errorCopy(code);
  const retryable = error instanceof ApiError
    ? error.retryable
    : isRecord(error) && error.retryable === true;
  return { code, ...copy, retryable };
}

export function getUserSafeErrorMessage(error: unknown): string {
  return getUserSafeErrorState(error).message;
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

function mapMaskStroke(value: unknown): MaskStroke | null {
  if (!isRecord(value)) return null;
  const mode = value.mode === "erase" ? "erase" : value.mode === "add" ? "add" : null;
  const width = numberValue(value.width);
  const points = Array.isArray(value.points)
    ? value.points.flatMap((point) => {
        if (!isRecord(point)) return [];
        const x = numberValue(point.x);
        const y = numberValue(point.y);
        return x === null || y === null ? [] : [{ x, y }];
      })
    : [];
  if (!mode || width === null || points.length === 0) return null;
  return { mode, width, points };
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
  const rawMaskStrokes = value.mask_strokes ?? value.maskStrokes;
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
    maskStrokes: Array.isArray(rawMaskStrokes)
      ? rawMaskStrokes.flatMap((stroke: unknown) => {
          const mapped = mapMaskStroke(stroke);
          return mapped ? [mapped] : [];
        })
      : [],
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
  const state = getUserSafeErrorState(value);
  return {
    code: state.code,
    message: state.message,
    retryable: state.retryable,
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
      errorCopy(code).message,
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
    mask_strokes: plan.maskStrokes ?? [],
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
    throw new ApiError("UPLOAD_FAILED", errorCopy("UPLOAD_FAILED").message, response.status);
  }
}

export async function startAnalysis(
  taskId: string,
  inviteToken: string,
  idempotencyKey?: string,
): Promise<void> {
  await request(
    `/api/v1/tasks/${encodeURIComponent(taskId)}/analyze`,
    {
      ...jsonBody(undefined),
      body: undefined,
      headers: { "Idempotency-Key": withIdempotencyKey(idempotencyKey) },
    },
    inviteToken,
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
): Promise<void> {
  await request(
    `/api/v1/tasks/${encodeURIComponent(taskId)}/plan`,
    jsonBody(toWirePlan(plan)),
    inviteToken,
  );
}

export async function startGeneration(
  taskId: string,
  inviteToken: string,
  idempotencyKey?: string,
): Promise<void> {
  await request(
    `/api/v1/tasks/${encodeURIComponent(taskId)}/generate`,
    {
      ...jsonBody(undefined),
      body: undefined,
      headers: { "Idempotency-Key": withIdempotencyKey(idempotencyKey) },
    },
    inviteToken,
  );
}

export async function getDownloadUrl(
  taskId: string,
  inviteToken: string,
): Promise<string> {
  return request(
    `/api/v1/tasks/${encodeURIComponent(taskId)}/download`,
    { method: "GET" },
    inviteToken,
    parseDownloadUrlPayload,
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
