import { createStore, get, set } from "idb-keyval";
import { Blob as NodeBlob } from "node:buffer";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createAnnotation, createProject } from "../../domain/project.js";
import {
  __resetProjectStoreForTests,
  deleteProject,
  listProjects,
  loadThumbnail,
  loadProject,
  saveProject,
} from "./projectStore.js";

const rawStore = createStore("reki-projects", "reki-projects");

function storedProject(overrides = {}) {
  return {
    ...createProject({ width: 960, height: 1280 }),
    id: "project-alpha",
    name: "Alpha",
    updatedAt: 100,
    image: {
      source: { close() {} },
      bitmap: { width: 1 },
      url: "blob:unsafe",
      originalFile: new NodeBlob(["source"], { type: "image/png" }),
      fileName: "alpha.png",
      type: "image/png",
      size: 6,
      dispose() {},
    },
    layers: [
      createAnnotation("label", [{ x: 0.25, y: 0.5 }], {
        id: "layer-alpha",
        transient: undefined,
        style: {
          lineColor: "#123456",
          lineWidth: 3,
          dash: [3, 4],
          callback() {},
          element: document.createElement("canvas"),
        },
      }),
    ],
    filters: {
      contrast: 1.2,
      ignored: () => {},
    },
    ...overrides,
  };
}

async function withRequestFailure(method, key, error, operation) {
  const original = IDBObjectStore.prototype[method];
  const spy = vi
    .spyOn(IDBObjectStore.prototype, method)
    .mockImplementation(function injectedFailure(...args) {
      if (args.at(-1) === key) throw error;
      return original.apply(this, args);
    });
  try {
    return await operation();
  } finally {
    spy.mockRestore();
  }
}

beforeEach(async () => {
  await __resetProjectStoreForTests();
});

describe("device-local project store", () => {
  test("saves, lists, loads, and idempotently deletes a project", async () => {
    const project = storedProject();

    await saveProject(project);

    expect(await listProjects()).toEqual([
      expect.objectContaining({
        id: "project-alpha",
        name: "Alpha",
        width: 960,
        height: 1280,
        layerCount: 1,
        sourceStatus: "available",
      }),
    ]);
    const loaded = await loadProject(project.id);
    expect(loaded.project).toMatchObject({
      id: "project-alpha",
      image: {
        fileName: "alpha.png",
        type: "image/png",
        size: 6,
      },
      sourceStatus: "available",
    });
    expect(loaded.sourceResource).toEqual(
      expect.objectContaining({ size: 6, type: "image/png" }),
    );

    await deleteProject(project.id);
    await deleteProject(project.id);
    expect(await listProjects()).toEqual([]);
    expect(await loadProject(project.id)).toBeNull();
  });

  test("sorts metadata newest-first without reading corrupt project payloads", async () => {
    await saveProject(storedProject({ id: "older", updatedAt: 100 }));
    await saveProject(
      storedProject({ id: "newer", name: "Newest", updatedAt: 300 }),
    );
    await set("project:newer", { corrupt: true }, rawStore);

    const metadata = await listProjects();

    expect(metadata.map(({ id }) => id)).toEqual(["newer", "older"]);
    expect(metadata[0].name).toBe("Newest");
  });

  test("persists only bounded serializable project fields", async () => {
    await saveProject(storedProject());

    const raw = await get("project:project-alpha", rawStore);
    expect(raw.image).toEqual({
      fileName: "alpha.png",
      type: "image/png",
      size: 6,
    });
    expect(raw.layers[0].style).toMatchObject({
      lineColor: "#123456",
      lineWidth: 3,
      dash: [3, 4],
    });
    expect(raw.layers[0].style).not.toHaveProperty("callback");
    expect(raw.layers[0].style).not.toHaveProperty("element");
    expect(raw.filters).toEqual({ contrast: 1.2 });
    expect(JSON.stringify(raw)).not.toContain("blob:unsafe");
    expect(() => structuredClone(raw)).not.toThrow();
  });

  test("round-trips an explicitly owned source Blob", async () => {
    const source = new NodeBlob(["owned pixels"], { type: "image/webp" });
    await saveProject(
      storedProject({
        image: { fileName: "owned.webp", type: "image/webp", size: source.size },
      }),
      source,
    );

    const loaded = await loadProject("project-alpha");
    expect(await loaded.sourceResource.text()).toBe("owned pixels");
    expect(loaded.sourceResource.type).toBe("image/webp");
  });

  test("loads project, source, tombstone, and thumbnail from one readonly transaction", async () => {
    const thumbnail = new NodeBlob(["thumb"], { type: "image/webp" });
    await saveProject(
      storedProject({ id: "atomic-load" }),
      new NodeBlob(["source"], { type: "image/png" }),
      { expectedRevision: 0, sourceToken: "source-v1", thumbnail },
    );
    const transactions = [];
    const original = IDBObjectStore.prototype.get;
    const spy = vi
      .spyOn(IDBObjectStore.prototype, "get")
      .mockImplementation(function trackedGet(key) {
        if (
          [
            "project:atomic-load",
            "source:atomic-load",
            "tombstone:atomic-load",
            "thumbnail:atomic-load",
          ].includes(key)
        ) {
          transactions.push(this.transaction);
        }
        return original.call(this, key);
      });

    const loaded = await loadProject("atomic-load");
    spy.mockRestore();

    expect(transactions).toHaveLength(4);
    expect(new Set(transactions).size).toBe(1);
    expect(loaded.revision).toBe(1);
    expect(await loaded.thumbnailResource.text()).toBe("thumb");
  });

  test("marks projects without an owned source as missing", async () => {
    await saveProject(storedProject({ image: { fileName: "gone.png" } }));

    const loaded = await loadProject("project-alpha");
    expect(loaded.sourceResource).toBeNull();
    expect(loaded.project.sourceStatus).toBe("missing");
    expect((await listProjects())[0].sourceStatus).toBe("missing");
  });

  test("rejects stale saves and tombstone resurrection across logical clients", async () => {
    const initial = await saveProject(
      storedProject({ id: "shared", name: "Initial" }),
      undefined,
      { expectedRevision: 0 },
    );
    const clientA = await loadProject("shared");
    const clientB = await loadProject("shared");

    const updated = await saveProject(
      { ...clientA.project, name: "Client A" },
      undefined,
      { expectedRevision: initial.revision },
    );
    await expect(
      saveProject(
        { ...clientB.project, name: "Client B" },
        undefined,
        { expectedRevision: clientB.revision },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const deleted = await deleteProject("shared", updated.revision);
    expect(deleted.revision).toBe(updated.revision + 1);
    expect(await loadProject("shared")).toBeNull();
    await expect(
      saveProject(
        { ...clientA.project, name: "Resurrected" },
        undefined,
        { expectedRevision: updated.revision },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  test("writes a source once and preserves it across annotation autosaves", async () => {
    const originalPut = IDBObjectStore.prototype.put;
    let sourcePuts = 0;
    const spy = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(function countSource(value, key) {
        if (key === "source:write-once") sourcePuts += 1;
        return originalPut.call(this, value, key);
      });
    const first = await saveProject(
      storedProject({ id: "write-once", name: "First" }),
      new NodeBlob(["pixels"], { type: "image/png" }),
      { expectedRevision: 0, sourceToken: "pixels-v1" },
    );
    await saveProject(
      storedProject({
        id: "write-once",
        name: "Edited annotations",
        layers: [],
      }),
      undefined,
      { expectedRevision: first.revision, sourceMode: "preserve" },
    );
    spy.mockRestore();

    expect(sourcePuts).toBe(1);
    const loaded = await loadProject("write-once");
    expect(await loaded.sourceResource.text()).toBe("pixels");
    expect(loaded.project.sourceStatus).toBe("available");
  });

  test("stores bounded thumbnails separately and keeps the metadata index lightweight", async () => {
    const thumbnail = new NodeBlob(["preview"], { type: "image/webp" });
    await saveProject(
      storedProject({ id: "thumbnail-project" }),
      undefined,
      { expectedRevision: 0, thumbnail },
    );

    const index = await get("project-index", rawStore);
    expect(index[0]).toMatchObject({
      id: "thumbnail-project",
      thumbnailAvailable: true,
      thumbnailKey: "thumbnail:thumbnail-project",
    });
    expect(index[0]).not.toHaveProperty("thumbnail");
    expect(JSON.stringify(index)).not.toMatch(/blob:|data:image/);
    expect(await (await loadThumbnail("thumbnail-project")).text()).toBe(
      "preview",
    );
  });

  test("migrates legacy v0 projects through the sequential migration chain", async () => {
    await set(
      "project:legacy-zero",
      {
        id: "legacy-zero",
        name: "Legacy zero",
        width: 320,
        height: 240,
        annotations: [],
      },
      rawStore,
    );
    await set(
      "project-index",
      [{ id: "legacy-zero", name: "Legacy zero" }],
      rawStore,
    );

    const loaded = await loadProject("legacy-zero");
    expect(loaded.project).toMatchObject({
      version: 1,
      canvas: { width: 320, height: 240, backgroundVisible: true },
      layers: [],
      filters: {},
      sourceStatus: "missing",
    });
  });

  test("closes and reopens the managed connection after versionchange", async () => {
    await __resetProjectStoreForTests();
    const originalOpen = indexedDB.open.bind(indexedDB);
    const opened = [];
    const spy = vi.spyOn(indexedDB, "open").mockImplementation((...args) => {
      const request = originalOpen(...args);
      request.addEventListener("success", () => opened.push(request.result));
      return request;
    });
    await listProjects();
    expect(opened).toHaveLength(1);

    opened[0].onversionchange();
    await listProjects();
    expect(opened).toHaveLength(2);
    spy.mockRestore();
  });

  test("reports blocked and upgrade-required database opens with typed errors", async () => {
    await __resetProjectStoreForTests();
    const blocked = vi.spyOn(indexedDB, "open").mockImplementation(() => {
      const request = {};
      queueMicrotask(() => request.onblocked?.());
      return request;
    });
    await expect(listProjects()).rejects.toMatchObject({
      code: "STORAGE_BLOCKED",
    });
    blocked.mockRestore();

    const upgrade = vi.spyOn(indexedDB, "open").mockImplementation(() => {
      const request = {
        error: new DOMException("newer database", "VersionError"),
      };
      queueMicrotask(() => request.onerror?.());
      return request;
    });
    await expect(listProjects()).rejects.toMatchObject({
      code: "STORAGE_UPGRADE_REQUIRED",
    });
    upgrade.mockRestore();
  });

  test("blocks prototype pollution and bounds and deduplicates the metadata index", async () => {
    const polluted = Object.create(null);
    polluted.safe = 1;
    polluted.__proto__ = { polluted: true };
    polluted.constructor = { polluted: true };
    polluted.prototype = { polluted: true };
    await saveProject(
      storedProject({
        id: "safe-project",
        filters: polluted,
      }),
      undefined,
      { expectedRevision: 0 },
    );
    const raw = await get("project:safe-project", rawStore);
    expect(raw.filters).toEqual({ safe: 1 });
    expect({}.polluted).toBeUndefined();

    await set(
      "project-index",
      Array.from({ length: 140 }, (_, index) => ({
        id: `bounded-${index % 110}`,
        name: `Project ${index}`,
        updatedAt: index,
        width: 1,
        height: 1,
        layerCount: 0,
        sourceStatus: "missing",
      })),
      rawStore,
    );
    const projects = await listProjects();
    expect(projects.length).toBeLessThanOrEqual(100);
    expect(new Set(projects.map(({ id }) => id)).size).toBe(projects.length);
  });

  test("atomically deletes every resource for metadata evicted by the 100-project limit", async () => {
    const baseline = await saveProject(
      storedProject({ id: "evicted", name: "Oldest", updatedAt: 1 }),
      new NodeBlob(["old-source"], { type: "image/png" }),
      {
        expectedRevision: 0,
        sourceToken: "old-source-v1",
        thumbnail: new NodeBlob(["old-thumb"], { type: "image/webp" }),
      },
    );
    await set(
      "project-index",
      [
        ...Array.from({ length: 99 }, (_, index) => ({
          id: `kept-${index}`,
          name: `Kept ${index}`,
          updatedAt: 200 - index,
          revision: 1,
          width: 1,
          height: 1,
          layerCount: 0,
          sourceStatus: "missing",
        })),
        {
          id: "evicted",
          name: "Oldest",
          updatedAt: 1,
          revision: baseline.revision,
          width: 960,
          height: 1280,
          layerCount: 1,
          sourceStatus: "available",
          thumbnailAvailable: true,
        },
      ],
      rawStore,
    );

    const result = await saveProject(
      storedProject({ id: "newest", name: "Newest", updatedAt: 999 }),
      undefined,
      { expectedRevision: 0, sourceMode: "preserve" },
    );

    expect(result.evictedIds).toContain("evicted");
    expect(await loadProject("evicted")).toBeNull();
    expect(await get("project:evicted", rawStore)).toBeUndefined();
    expect(await get("source:evicted", rawStore)).toBeUndefined();
    expect(await get("thumbnail:evicted", rawStore)).toBeUndefined();
    expect((await listProjects()).map(({ id }) => id)).not.toContain("evicted");
  });

  test("migrates version 1 defaults and rejects future versions with a typed error", async () => {
    await set(
      "project:legacy",
      {
        id: "legacy",
        version: 1,
        name: "Legacy",
        canvas: { width: 640, height: 480 },
        layers: [
          {
            id: "legacy-layer",
            type: "label",
            points: [{ x: 0.5, y: 0.5 }],
            style: { lineWidth: 3 },
          },
        ],
      },
      rawStore,
    );
    await set(
      "project-index",
      [
        {
          id: "legacy",
          name: "Legacy",
          updatedAt: 0,
          width: 640,
          height: 480,
          layerCount: 0,
          sourceStatus: "missing",
        },
      ],
      rawStore,
    );

    const migrated = await loadProject("legacy");
    expect(migrated.project).toMatchObject({
      version: 1,
      updatedAt: 0,
      filters: {},
      sourceStatus: "missing",
      canvas: { width: 640, height: 480, backgroundVisible: true },
    });
    expect(migrated.project.layers[0]).toMatchObject({
      id: "legacy-layer",
      visible: true,
      locked: false,
      label: "label_01",
      style: {
        lineWidth: 3,
        lineColor: "#e5484d",
        textColor: "#fff7ed",
        anchorColor: "#ff6b6b",
        fontSize: 14,
        anchorSize: 5,
        dash: [],
        opacity: 1,
        curveTension: 0,
      },
    });

    await set(
      "project:future",
      {
        id: "future",
        version: 99,
        name: "Future",
        updatedAt: 0,
        canvas: { width: 1, height: 1 },
        image: null,
        filters: {},
        layers: [],
      },
      rawStore,
    );
    await expect(loadProject("future")).rejects.toMatchObject({
      code: "UNSUPPORTED_PROJECT_VERSION",
    });
  });

  test("reports corrupt records and rejects malformed IDs and oversized state", async () => {
    await set("project:broken", { id: "different", version: 1 }, rawStore);
    await expect(loadProject("broken")).rejects.toMatchObject({
      code: "CORRUPT_PROJECT",
    });
    await expect(loadProject("../escape")).rejects.toMatchObject({
      code: "INVALID_PROJECT_ID",
    });
    await expect(
      saveProject(storedProject({ filters: { huge: "x".repeat(9_000_000) } })),
    ).rejects.toMatchObject({ code: "PROJECT_TOO_LARGE" });
  });

  test("serializes concurrent saves without losing either metadata entry", async () => {
    await Promise.all([
      saveProject(
        storedProject({ id: "concurrent-a", name: "A", updatedAt: 100 }),
      ),
      saveProject(
        storedProject({ id: "concurrent-b", name: "B", updatedAt: 200 }),
      ),
    ]);

    expect((await listProjects()).map(({ id }) => id)).toEqual([
      "concurrent-b",
      "concurrent-a",
    ]);
    expect(await loadProject("concurrent-a")).not.toBeNull();
    expect(await loadProject("concurrent-b")).not.toBeNull();
  });

  test.each([
    ["put", "project:atomic-save", "project"],
    ["put", "source:atomic-save", "source"],
    ["put", "project-index", "index"],
  ])(
    "aborts the complete save when the %s %s request fails at the %s stage",
    async (method, key) => {
      const oldSource = new NodeBlob(["old"], { type: "image/png" });
      const baseline = await saveProject(
        storedProject({
          id: "atomic-save",
          name: "Before",
          updatedAt: 100,
        }),
        oldSource,
      );

      await expect(
        withRequestFailure(
          method,
          key,
          new DOMException("request failed", "UnknownError"),
          () =>
            saveProject(
              storedProject({
                id: "atomic-save",
                name: "After",
                updatedAt: 200,
              }),
              new NodeBlob(["new"], { type: "image/png" }),
              {
                expectedRevision: baseline.revision,
                sourceToken: "replacement-v2",
              },
            ),
        ),
      ).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });

      const loaded = await loadProject("atomic-save");
      expect(loaded.project.name).toBe("Before");
      expect(await loaded.sourceResource.text()).toBe("old");
      expect(await listProjects()).toEqual([
        expect.objectContaining({
          id: "atomic-save",
          name: "Before",
          updatedAt: 100,
        }),
      ]);
    },
  );

  test.each([
    ["delete", "project:atomic-delete", "project delete"],
    ["delete", "source:atomic-delete", "source delete"],
    ["put", "project-index", "index update"],
  ])(
    "aborts the complete delete when the %s request fails at %s",
    async (method, key) => {
      await saveProject(
        storedProject({
          id: "atomic-delete",
          name: "Keep me",
          updatedAt: 100,
        }),
        new NodeBlob(["keep"], { type: "image/png" }),
      );

      await expect(
        withRequestFailure(
          method,
          key,
          new DOMException("request failed", "UnknownError"),
          () => deleteProject("atomic-delete"),
        ),
      ).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });

      const loaded = await loadProject("atomic-delete");
      expect(loaded.project.name).toBe("Keep me");
      expect(await loaded.sourceResource.text()).toBe("keep");
      expect(await listProjects()).toEqual([
        expect.objectContaining({ id: "atomic-delete", name: "Keep me" }),
      ]);
    },
  );

  test("maps a transaction quota failure to STORAGE_FULL without changing old records", async () => {
    const baseline = await saveProject(
      storedProject({
        id: "quota-project",
        name: "Before",
        updatedAt: 100,
      }),
    );

    await expect(
      withRequestFailure(
        "put",
        "project:quota-project",
        new DOMException("quota exhausted", "QuotaExceededError"),
        () =>
          saveProject(
            storedProject({
              id: "quota-project",
              name: "After",
              updatedAt: 200,
            }),
            undefined,
            { expectedRevision: baseline.revision },
          ),
      ),
    ).rejects.toMatchObject({
      code: "STORAGE_FULL",
      message: expect.stringContaining("存储空间"),
    });
    expect((await loadProject("quota-project")).project.name).toBe("Before");
  });
});
