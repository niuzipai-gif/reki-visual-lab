import React, {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { ImportPanel } from "./features/import/ImportPanel.jsx";
import { decodeImage } from "./features/import/decodeImage.js";
import { ProjectBrowser } from "./features/storage/ProjectBrowser.jsx";
import * as projectStore from "./features/storage/projectStore.js";
import { createProjectThumbnail } from "./features/storage/thumbnail.js";

const LazyWorkbench = lazy(() => import("./Workbench.jsx"));

export function useOwnedImageResource(image) {
  const pendingDisposals = useRef(new Map());

  useEffect(() => {
    if (typeof image?.dispose !== "function") return undefined;
    const pending = pendingDisposals.current.get(image);
    if (pending !== undefined) {
      clearTimeout(pending);
      pendingDisposals.current.delete(image);
    }

    return () => {
      const timeout = setTimeout(() => {
        pendingDisposals.current.delete(image);
        image.dispose();
      }, 0);
      pendingDisposals.current.set(image, timeout);
    };
  }, [image]);
}

export function App({
  initialDemoProject =
    globalThis.location?.search.includes("demo=1") ?? false,
  decode = decodeImage,
  storage = projectStore,
} = {}) {
  const [project, setProject] = useState(
    initialDemoProject ? initialDemoProject : null,
  );
  const [saveStatus, setSaveStatus] = useState("idle");
  const projectRef = useRef(project);
  const pendingProjectRef = useRef(null);
  const saveTimerRef = useRef(null);
  const saveInFlightRef = useRef(false);
  const dirtyRevisionRef = useRef(0);
  const baseRevisionRef = useRef(0);
  const baseRevisionByProjectRef = useRef(new Map());
  const openSequenceRef = useRef(0);
  useOwnedImageResource(
    project && project !== true ? project.image : null,
  );

  const commitProject = useCallback((nextProject) => {
    projectRef.current = nextProject;
    setProject(nextProject);
  }, []);

  const flushSave = useCallback(
    (reportStatus = true) => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const pending = pendingProjectRef.current;
      if (!pending) return;
      if (pending.transition !== openSequenceRef.current) {
        if (pendingProjectRef.current === pending) {
          pendingProjectRef.current = null;
        }
        return;
      }
      if (saveInFlightRef.current) return;
      saveInFlightRef.current = true;
      if (reportStatus) setSaveStatus("saving");
      Promise.resolve(
        storage.saveProject(pending.project, pending.sourceResource ?? undefined, {
          expectedRevision:
            baseRevisionByProjectRef.current.get(pending.project.id) ??
            baseRevisionRef.current,
          sourceMode: pending.sourceResource ? "auto" : "preserve",
          sourceToken: pending.sourceToken,
          thumbnail: pending.thumbnail,
        }),
      ).then(
        (saved) => {
          saveInFlightRef.current = false;
          const savedRevision =
            Number(saved?.revision) ||
            (baseRevisionByProjectRef.current.get(pending.project.id) ?? 0) +
              1;
          baseRevisionByProjectRef.current.set(
            pending.project.id,
            savedRevision,
          );
          if (projectRef.current?.id === pending.project.id) {
            baseRevisionRef.current = savedRevision;
          }
          if (pending.transition !== openSequenceRef.current) {
            if (
              pendingProjectRef.current?.transition === openSequenceRef.current
            ) {
              saveTimerRef.current = setTimeout(() => flushSave(true), 0);
            }
            return;
          }
          const latest = pendingProjectRef.current;
          if (latest?.dirtyRevision === pending.dirtyRevision) {
            pendingProjectRef.current = null;
            setSaveStatus(
              reportStatus
                ? saved?.evictedIds?.length
                  ? "saved-pruned"
                  : "saved"
                : "idle",
            );
            return;
          }
          if (latest) {
            if (latest.sourceToken === pending.sourceToken) {
              if (latest.sourceResource === pending.sourceResource) {
                latest.sourceResource = null;
              }
              if (latest.thumbnail === pending.thumbnail) {
                latest.thumbnail = null;
              }
            }
            setSaveStatus("idle");
            saveTimerRef.current = setTimeout(() => flushSave(true), 700);
          }
        },
        (error) => {
          saveInFlightRef.current = false;
          if (pending.transition !== openSequenceRef.current) {
            if (
              pendingProjectRef.current?.transition === openSequenceRef.current
            ) {
              saveTimerRef.current = setTimeout(() => flushSave(true), 0);
            }
            return;
          }
          setSaveStatus(error?.code === "CONFLICT" ? "conflict" : "error");
          if (error?.code !== "CONFLICT" && pendingProjectRef.current) {
            saveTimerRef.current = setTimeout(() => flushSave(true), 1_500);
          }
        },
      );
    },
    [storage],
  );

  const scheduleSave = useCallback(
    (nextProject, sourceOptions = {}) => {
      if (!nextProject || nextProject === true) return;
      const dirtyRevision = ++dirtyRevisionRef.current;
      const previous = pendingProjectRef.current;
      pendingProjectRef.current = {
        project: {
          ...nextProject,
          updatedAt: Date.now(),
        },
        dirtyRevision,
        transition: openSequenceRef.current,
        sourceResource:
          sourceOptions.sourceResource ?? previous?.sourceResource ?? null,
        sourceToken: sourceOptions.sourceToken ?? previous?.sourceToken ?? null,
        thumbnail: sourceOptions.thumbnail ?? previous?.thumbnail ?? null,
      };
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
      }
      setSaveStatus("idle");
      saveTimerRef.current = setTimeout(() => flushSave(true), 700);
      return dirtyRevision;
    },
    [flushSave],
  );

  useEffect(() => {
    const flushWithoutClaimingCompletion = () => flushSave(false);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushWithoutClaimingCompletion();
      }
    };
    window.addEventListener("beforeunload", flushWithoutClaimingCompletion);
    window.addEventListener("pagehide", flushWithoutClaimingCompletion);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", flushWithoutClaimingCompletion);
      window.removeEventListener("pagehide", flushWithoutClaimingCompletion);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
    };
  }, [flushSave]);

  useEffect(() => {
    if (typeof storage.subscribeProjectChanges !== "function") return undefined;
    return storage.subscribeProjectChanges((change) => {
      const current = projectRef.current;
      if (
        current &&
        current !== true &&
        change?.id === current.id &&
        Number(change.revision) > baseRevisionRef.current
      ) {
        setSaveStatus("conflict");
      }
    });
  }, [storage]);

  const importProject = useCallback(
    (nextProject) => {
      const transition = ++openSequenceRef.current;
      const sourceResource = nextProject?.image?.originalFile ?? null;
      const sourceToken = sourceResource
        ? `${nextProject.id}:${crypto.randomUUID()}`
        : null;
      baseRevisionRef.current = 0;
      baseRevisionByProjectRef.current.set(nextProject.id, 0);
      dirtyRevisionRef.current = 0;
      pendingProjectRef.current = null;
      commitProject(nextProject);
      setSaveStatus("idle");
      scheduleSave(nextProject, {
        sourceResource,
        sourceToken,
      });
      void createProjectThumbnail(nextProject?.image).then((thumbnail) => {
        if (
          thumbnail &&
          transition === openSequenceRef.current &&
          projectRef.current?.id === nextProject.id
        ) {
          scheduleSave(projectRef.current, { thumbnail });
        }
      });
    },
    [commitProject, scheduleSave],
  );

  const openProject = useCallback(
    async (id) => {
      const request = ++openSequenceRef.current;
      const loaded = await storage.loadProject(id);
      if (request !== openSequenceRef.current) return;
      if (!loaded) {
        const error = new Error("项目数据已损坏，无法打开");
        error.code = "CORRUPT_PROJECT";
        throw error;
      }

      let nextProject = loaded.project;
      if (loaded.sourceResource) {
        const decoded = await decode(loaded.sourceResource);
        if (request !== openSequenceRef.current) {
          decoded.dispose?.();
          return;
        }
        nextProject = {
          ...loaded.project,
          image: {
            ...(loaded.project.image ?? {}),
            ...decoded,
            originalFile: loaded.sourceResource,
          },
          sourceStatus: "available",
        };
      } else {
        nextProject = {
          ...loaded.project,
          image: null,
          sourceStatus: "missing",
        };
      }
      if (request !== openSequenceRef.current) {
        nextProject?.image?.dispose?.();
        return;
      }
      pendingProjectRef.current = null;
      dirtyRevisionRef.current = 0;
      baseRevisionRef.current =
        Number(loaded.revision ?? loaded.project.revision) || 0;
      baseRevisionByProjectRef.current.set(
        nextProject.id,
        baseRevisionRef.current,
      );
      setSaveStatus("idle");
      if (request !== openSequenceRef.current) {
        nextProject?.image?.dispose?.();
        return;
      }
      commitProject(nextProject);
    },
    [commitProject, decode, storage],
  );

  const replacePhoto = useCallback(
    async (file) => {
      const transition = ++openSequenceRef.current;
      const decoded = await decode(file);
      if (transition !== openSequenceRef.current) {
        decoded.dispose?.();
        return null;
      }
      const nextProject = {
        ...projectRef.current,
        image: {
          ...decoded,
          originalFile: file,
          fileName:
            file.name ?? projectRef.current?.image?.fileName ?? "本机照片",
          type: file.type,
          size: file.size,
        },
        sourceStatus: "available",
      };
      if (transition !== openSequenceRef.current) {
        decoded.dispose?.();
        return null;
      }
      commitProject(nextProject);
      const sourceToken = `${nextProject.id}:${crypto.randomUUID()}`;
      scheduleSave(nextProject, {
        sourceResource: file,
        sourceToken,
      });
      void createProjectThumbnail(decoded).then((thumbnail) => {
        if (
          thumbnail &&
          transition === openSequenceRef.current &&
          projectRef.current?.id === nextProject.id
        ) {
          scheduleSave(projectRef.current, { thumbnail });
        }
      });
      return nextProject;
    },
    [commitProject, decode, scheduleSave],
  );

  if (!project) {
    return (
      <ImportPanel onProject={importProject} decode={decode}>
        <ProjectBrowser
          store={storage}
          onOpen={openProject}
          onNewImage={() => {
            openSequenceRef.current += 1;
            document.getElementById("reki-photo-input")?.click();
          }}
        />
      </ImportPanel>
    );
  }

  return (
    <Suspense
      fallback={
        <main className="entry-shell" role="status">
          正在加载编辑器…
        </main>
      }
    >
      <LazyWorkbench
        initialDemoProject={project}
        onProjectChange={(nextProject) => {
          commitProject(nextProject);
          scheduleSave(nextProject);
        }}
        onReplacePhoto={replacePhoto}
        saveStatus={saveStatus}
      />
    </Suspense>
  );
}

export default App;
