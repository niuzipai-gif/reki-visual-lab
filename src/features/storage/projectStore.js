import { DEFAULT_STYLE } from "../../domain/project.js";
import {
  legacyFiltersToEffectStack,
  normalizeEffectStack,
} from "../filters/effectStack.js";

const DATABASE_NAME = "reki-projects";
const STORE_NAME = "reki-projects";
const DATABASE_VERSION = 1;
const INDEX_KEY = "project-index";
const PROJECT_PREFIX = "project:";
const SOURCE_PREFIX = "source:";
const TOMBSTONE_PREFIX = "tombstone:";
const THUMBNAIL_PREFIX = "thumbnail:";
const CURRENT_VERSION = 2;
const MAX_INDEX_ENTRIES = 100;
const MAX_PROJECT_JSON_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 256 * 1024;
const VALID_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

let databasePromise;
let changeChannel;
const localSubscribers = new Set();

export class ProjectStorageError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "ProjectStorageError";
    this.code = code;
  }
}

function typedError(code, message, cause) {
  return new ProjectStorageError(code, message, cause);
}

function validateId(id) {
  if (typeof id !== "string" || !VALID_ID.test(id)) {
    throw typedError("INVALID_PROJECT_ID", "项目标识无效");
  }
  return id;
}

function isQuotaError(error) {
  return (
    error?.name === "QuotaExceededError" ||
    error?.code === 22 ||
    /quota|storage.*full/i.test(String(error?.message ?? ""))
  );
}

function storageError(error) {
  if (error instanceof ProjectStorageError) return error;
  if (isQuotaError(error)) {
    return typedError(
      "STORAGE_FULL",
      "本机存储空间不足，无法保存项目。请删除不需要的项目后重试。",
      error,
    );
  }
  if (error?.name === "VersionError") {
    return typedError(
      "STORAGE_UPGRADE_REQUIRED",
      "本机项目数据库版本已更新，请刷新页面后重试。",
      error,
    );
  }
  return typedError(
    "STORAGE_UNAVAILABLE",
    "本机项目存储暂时不可用，请稍后重试。",
    error,
  );
}

function plainObject(value) {
  if (!value || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isBlob(value) {
  return (
    value instanceof Blob ||
    (value &&
      typeof value === "object" &&
      Number.isFinite(value.size) &&
      typeof value.type === "string" &&
      typeof value.slice === "function")
  );
}

function sanitizeValue(value, depth = 0) {
  if (depth > 12) return undefined;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 20_000)
      .map((item) => sanitizeValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (!plainObject(value)) return undefined;

  const result = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    const sanitized = sanitizeValue(item, depth + 1);
    if (sanitized !== undefined) result[key] = sanitized;
  }
  return result;
}

function positiveDimension(value) {
  return Number.isFinite(value) && value > 0
    ? Math.min(Math.round(value), 100_000)
    : null;
}

function imageMetadata(image) {
  if (!plainObject(image)) return null;
  const metadata = {};
  if (typeof image.fileName === "string") {
    metadata.fileName = image.fileName.slice(0, 512);
  }
  if (typeof image.type === "string") metadata.type = image.type.slice(0, 128);
  if (Number.isFinite(image.size) && image.size >= 0) metadata.size = image.size;
  return Object.keys(metadata).length ? metadata : null;
}

function sanitizeLayers(layers) {
  return layers.flatMap((layer, index) => {
    const sanitized = sanitizeValue(layer);
    if (!plainObject(sanitized) || typeof sanitized.id !== "string") return [];
    const style = plainObject(sanitized.style) ? sanitized.style : {};
    return [
      {
        ...sanitized,
        type: typeof sanitized.type === "string" ? sanitized.type : "label",
        name:
          typeof sanitized.name === "string"
            ? sanitized.name
            : `layer_${index + 1}`,
        points: Array.isArray(sanitized.points) ? sanitized.points : [],
        visible: sanitized.visible !== false,
        locked: sanitized.locked === true,
        label:
          typeof sanitized.label === "string" ? sanitized.label : "label_01",
        value: sanitized.value ?? null,
        style: {
          ...DEFAULT_STYLE,
          ...style,
          dash: Array.isArray(style.dash) ? style.dash : [],
        },
      },
    ];
  });
}

function migrateProject(rawProject) {
  if (!plainObject(rawProject)) {
    throw typedError("CORRUPT_PROJECT", "项目数据已损坏，无法打开");
  }
  let project = rawProject;
  let version = Number.isInteger(project.version) ? project.version : 0;
  if (version > CURRENT_VERSION) {
    throw typedError(
      "UNSUPPORTED_PROJECT_VERSION",
      "此项目由更新版本的 REKI 创建，当前版本无法打开",
    );
  }
  while (version < CURRENT_VERSION) {
    if (version === 0) {
      project = {
        ...project,
        version: 1,
        canvas:
          project.canvas ??
          {
            width: project.width,
            height: project.height,
            backgroundVisible: true,
          },
        layers: project.layers ?? project.annotations ?? [],
        filters: project.filters ?? {},
        image: project.image ?? null,
        updatedAt: project.updatedAt ?? 0,
      };
      version = 1;
      continue;
    }
    if (version === 1) {
      project = {
        ...project,
        version: 2,
        filters: {},
        effectStack: Array.isArray(project.effectStack)
          ? normalizeEffectStack(project.effectStack)
          : legacyFiltersToEffectStack(project.filters ?? {}),
      };
      version = 2;
      continue;
    }
    throw typedError("CORRUPT_PROJECT", "项目版本信息无效");
  }
  return project;
}

function normalizeProject(rawProject, sourceStatus, revision, sourceToken) {
  const project = migrateProject(rawProject);
  validateId(project.id);
  const width = positiveDimension(project.canvas?.width);
  const height = positiveDimension(project.canvas?.height);
  if (!width || !height || !Array.isArray(project.layers ?? [])) {
    throw typedError("CORRUPT_PROJECT", "项目数据已损坏，无法打开");
  }
  const effectStack = normalizeEffectStack(
    sanitizeValue(project.effectStack) ?? [],
  );
  const normalized = {
    id: project.id,
    version: CURRENT_VERSION,
    revision: Number.isInteger(revision)
      ? revision
      : Math.max(0, Number(project.revision) || 0),
    name:
      typeof project.name === "string" && project.name.trim()
        ? project.name.trim().slice(0, 160)
        : "未命名项目",
    updatedAt: Number.isFinite(project.updatedAt) ? project.updatedAt : 0,
    canvas: {
      width,
      height,
      backgroundVisible: project.canvas.backgroundVisible !== false,
    },
    image: imageMetadata(project.image),
    filters: {},
    effectStack,
    layers: sanitizeLayers(project.layers),
    sourceStatus: sourceStatus === "available" ? "available" : "missing",
    sourceToken:
      sourceStatus === "available" && typeof sourceToken === "string"
        ? sourceToken
        : null,
  };
  if (new Blob([JSON.stringify(normalized)]).size > MAX_PROJECT_JSON_BYTES) {
    throw typedError("PROJECT_TOO_LARGE", "项目内容过大，无法安全保存到本机");
  }
  return normalized;
}

function metadataFor(project, thumbnailAvailable = false) {
  return {
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt,
    revision: project.revision,
    width: project.canvas.width,
    height: project.canvas.height,
    layerCount: project.layers.length,
    sourceStatus: project.sourceStatus,
    thumbnailAvailable: Boolean(thumbnailAvailable),
    ...(thumbnailAvailable
      ? { thumbnailKey: `${THUMBNAIL_PREFIX}${project.id}` }
      : {}),
  };
}

function normalizeIndex(index, limit = MAX_INDEX_ENTRIES) {
  if (index == null) return [];
  if (!Array.isArray(index)) {
    throw typedError("CORRUPT_PROJECT_INDEX", "本机项目列表已损坏");
  }
  const seen = new Set();
  const normalized = [];
  for (const item of index) {
    if (!plainObject(item) || typeof item.id !== "string") continue;
    if (!VALID_ID.test(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    normalized.push({
      id: item.id,
      name:
        typeof item.name === "string" && item.name.trim()
          ? item.name.trim().slice(0, 160)
          : "未命名项目",
      updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : 0,
      revision: Math.max(0, Number(item.revision) || 0),
      width: positiveDimension(item.width) ?? 1,
      height: positiveDimension(item.height) ?? 1,
      layerCount: Math.max(0, Math.min(20_000, Number(item.layerCount) || 0)),
      sourceStatus: item.sourceStatus === "available" ? "available" : "missing",
      thumbnailAvailable: item.thumbnailAvailable === true,
      ...(item.thumbnailAvailable === true
        ? { thumbnailKey: `${THUMBNAIL_PREFIX}${item.id}` }
        : {}),
    });
    if (normalized.length === limit) break;
  }
  return normalized;
}

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = undefined;
      };
      resolve(database);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(
        typedError(
          "STORAGE_BLOCKED",
          "另一个页面正在使用旧版项目存储，请关闭其他页面后重试。",
        ),
      );
  }).catch((error) => {
    databasePromise = undefined;
    throw error;
  });
  return databasePromise;
}

function transactionCompletion(transaction, failure) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () =>
      reject(failure.error ?? transaction.error ?? new Error("IDB error"));
    transaction.onabort = () =>
      reject(failure.error ?? transaction.error ?? new Error("IDB aborted"));
  });
}

function trackRequest(request, failure) {
  request.addEventListener("error", () => {
    failure.error ??= request.error;
  });
  return request;
}

function requestResult(request, failure) {
  trackRequest(request, failure);
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("IDB request failed")),
    );
  });
}

async function transact(mode, operation) {
  let transaction;
  let completion;
  const failure = { error: null };
  try {
    const database = await openDatabase();
    transaction = database.transaction(STORE_NAME, mode);
    completion = transactionCompletion(transaction, failure);
    const objectStore = transaction.objectStore(STORE_NAME);
    const api = {
      get: (key) => requestResult(objectStore.get(key), failure),
      put: (value, key) => trackRequest(objectStore.put(value, key), failure),
      delete: (key) => trackRequest(objectStore.delete(key), failure),
      clear: () => trackRequest(objectStore.clear(), failure),
    };
    const result = await operation(api);
    await completion;
    return result;
  } catch (error) {
    if (transaction) {
      try {
        transaction.abort();
      } catch {
        // The transaction may already be complete or aborted.
      }
      try {
        await completion;
      } catch {
        // Preserve the originating request or typed protocol error.
      }
    }
    throw storageError(failure.error ?? error);
  }
}

function sourceFrom(project, sourceResource, sourceMode) {
  if (sourceMode === "preserve" || sourceMode === "remove") return null;
  const candidate = sourceResource ?? project?.image?.originalFile ?? null;
  if (!isBlob(candidate)) return null;
  if (candidate.size > MAX_SOURCE_BYTES) {
    throw typedError("SOURCE_TOO_LARGE", "原始照片不能超过 40 MB，项目将不会写入存储。");
  }
  return candidate;
}

function validThumbnail(value) {
  return isBlob(value) && value.size <= MAX_THUMBNAIL_BYTES ? value : null;
}

function broadcastChange(change) {
  try {
    channel()?.postMessage(change);
  } catch {
    // BroadcastChannel is an enhancement; storage remains usable without it.
  }
}

function channel() {
  if (changeChannel !== undefined) return changeChannel;
  if (typeof globalThis.BroadcastChannel !== "function") {
    changeChannel = null;
    return changeChannel;
  }
  try {
    changeChannel = new BroadcastChannel("reki-projects");
    changeChannel.onmessage = (event) => {
      for (const subscriber of localSubscribers) subscriber(event.data);
    };
  } catch {
    changeChannel = null;
  }
  return changeChannel;
}

export function subscribeProjectChanges(subscriber) {
  if (typeof subscriber !== "function") return () => {};
  localSubscribers.add(subscriber);
  channel();
  return () => localSubscribers.delete(subscriber);
}

export async function saveProject(project, sourceResource, options = {}) {
  const id = validateId(project?.id);
  const sourceMode = options.sourceMode ?? "auto";
  const source = sourceFrom(project, sourceResource, sourceMode);
  const thumbnail = validThumbnail(options.thumbnail);
  const projectKey = `${PROJECT_PREFIX}${id}`;
  const sourceKey = `${SOURCE_PREFIX}${id}`;
  const tombstoneKey = `${TOMBSTONE_PREFIX}${id}`;
  const thumbnailKey = `${THUMBNAIL_PREFIX}${id}`;

  const metadata = await transact("readwrite", async (tx) => {
    const [rawIndex, existing, tombstone, existingSource, existingThumbnail] =
      await Promise.all([
        tx.get(INDEX_KEY),
        tx.get(projectKey),
        tx.get(tombstoneKey),
        tx.get(sourceKey),
        tx.get(thumbnailKey),
      ]);
    const index = normalizeIndex(rawIndex, Infinity);
    const currentRevision = Math.max(
      Number(existing?.revision) || 0,
      Number(tombstone?.revision) || 0,
    );
    const expectedRevision =
      options.expectedRevision ?? (Number(project.revision) || 0);
    if (expectedRevision !== currentRevision) {
      throw typedError(
        "CONFLICT",
        "项目已在另一个页面更新，请重新打开后再保存。",
      );
    }

    const removeSource = sourceMode === "remove";
    const sourceAvailable = removeSource
      ? false
      : Boolean(source || isBlob(existingSource));
    const sourceToken = source
      ? String(
          options.sourceToken ??
            `${source.type}:${source.size}:${source.lastModified ?? 0}`,
        )
      : sourceAvailable
        ? existing?.sourceToken ?? null
        : null;
    const revision = currentRevision + 1;
    const normalized = normalizeProject(
      project,
      sourceAvailable ? "available" : "missing",
      revision,
      sourceToken,
    );
    const thumbnailAvailable = removeSource
      ? false
      : Boolean(thumbnail || isBlob(existingThumbnail));
    const nextMetadata = metadataFor(normalized, thumbnailAvailable);
    const nextIndex = normalizeIndex([
      nextMetadata,
      ...index.filter((item) => item.id !== id),
    ]);
    const retainedIds = new Set(nextIndex.map((item) => item.id));
    const evicted = index.filter((item) => !retainedIds.has(item.id));

    tx.put(normalized, projectKey);
    if (removeSource) tx.delete(sourceKey);
    else if (
      source &&
      (!isBlob(existingSource) || existing?.sourceToken !== sourceToken)
    ) {
      tx.put(source, sourceKey);
    }
    if (removeSource) tx.delete(thumbnailKey);
    else if (thumbnail) tx.put(thumbnail, thumbnailKey);
    for (const item of evicted) {
      tx.delete(`${PROJECT_PREFIX}${item.id}`);
      tx.delete(`${SOURCE_PREFIX}${item.id}`);
      tx.delete(`${THUMBNAIL_PREFIX}${item.id}`);
      tx.put(
        {
          id: item.id,
          revision: Math.max(0, Number(item.revision) || 0) + 1,
          deletedAt: Date.now(),
        },
        `${TOMBSTONE_PREFIX}${item.id}`,
      );
    }
    tx.delete(tombstoneKey);
    tx.put(nextIndex, INDEX_KEY);
    return {
      ...nextMetadata,
      evictedIds: evicted.map((item) => item.id),
    };
  });
  broadcastChange({ type: "saved", id, revision: metadata.revision });
  return metadata;
}

export async function loadProject(id) {
  validateId(id);
  return transact("readonly", async (tx) => {
    const [record, source, tombstone, thumbnail] = await Promise.all([
      tx.get(`${PROJECT_PREFIX}${id}`),
      tx.get(`${SOURCE_PREFIX}${id}`),
      tx.get(`${TOMBSTONE_PREFIX}${id}`),
      tx.get(`${THUMBNAIL_PREFIX}${id}`),
    ]);
    if (
      record === undefined ||
      (tombstone !== undefined &&
        (Number(tombstone?.revision) || 0) >= (Number(record?.revision) || 0))
    ) {
      return null;
    }
    if (!plainObject(record) || record.id !== id) {
      throw typedError("CORRUPT_PROJECT", "项目数据已损坏，无法打开");
    }
    const migrated = migrateProject(record);
    const sourceResource = isBlob(source) ? source : null;
    const revision = Math.max(0, Number(record.revision) || 0);
    return {
      project: normalizeProject(
        migrated,
        sourceResource ? "available" : "missing",
        revision,
        record.sourceToken,
      ),
      sourceResource,
      thumbnailResource: isBlob(thumbnail) ? thumbnail : null,
      revision,
    };
  });
}

export async function loadThumbnail(id) {
  validateId(id);
  return transact("readonly", async (tx) => {
    const [thumbnail, tombstone] = await Promise.all([
      tx.get(`${THUMBNAIL_PREFIX}${id}`),
      tx.get(`${TOMBSTONE_PREFIX}${id}`),
    ]);
    return tombstone || !isBlob(thumbnail) ? null : thumbnail;
  });
}

export async function listProjects() {
  const projects = await transact("readonly", async (tx) =>
    normalizeIndex(await tx.get(INDEX_KEY)),
  );
  return projects.sort(
    (first, second) =>
      (Number(second.updatedAt) || 0) - (Number(first.updatedAt) || 0),
  );
}

export async function deleteProject(id, expectedRevision) {
  validateId(id);
  const projectKey = `${PROJECT_PREFIX}${id}`;
  const sourceKey = `${SOURCE_PREFIX}${id}`;
  const tombstoneKey = `${TOMBSTONE_PREFIX}${id}`;
  const thumbnailKey = `${THUMBNAIL_PREFIX}${id}`;
  const result = await transact("readwrite", async (tx) => {
    const [rawIndex, existing, tombstone] = await Promise.all([
      tx.get(INDEX_KEY),
      tx.get(projectKey),
      tx.get(tombstoneKey),
    ]);
    const index = normalizeIndex(rawIndex);
    const currentRevision = Math.max(
      Number(existing?.revision) || 0,
      Number(tombstone?.revision) || 0,
    );
    if (existing === undefined) return { revision: currentRevision };
    if (
      expectedRevision !== undefined &&
      Number(expectedRevision) !== currentRevision
    ) {
      throw typedError(
        "CONFLICT",
        "项目已在另一个页面更新，请刷新列表后再删除。",
      );
    }
    const revision = currentRevision + 1;
    tx.delete(projectKey);
    tx.delete(sourceKey);
    tx.delete(thumbnailKey);
    tx.put({ id, revision, deletedAt: Date.now() }, tombstoneKey);
    tx.put(
      normalizeIndex(index.filter((item) => item.id !== id)),
      INDEX_KEY,
    );
    return { revision };
  });
  broadcastChange({ type: "deleted", id, revision: result.revision });
  return result;
}

export async function __resetProjectStoreForTests() {
  await transact("readwrite", async (tx) => {
    tx.clear();
  });
  if (databasePromise) {
    try {
      const database = await databasePromise;
      database.close();
    } catch {
      // A failed open has already cleared the cached promise.
    }
    databasePromise = undefined;
  }
  localSubscribers.clear();
  if (changeChannel) changeChannel.close();
  changeChannel = undefined;
}
