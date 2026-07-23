import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ImportPanel } from "./features/import/ImportPanel.jsx";

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
  decode,
} = {}) {
  const [project, setProject] = useState(
    initialDemoProject ? initialDemoProject : null,
  );
  useOwnedImageResource(
    project && project !== true ? project.image : null,
  );

  if (!project) {
    return <ImportPanel onProject={setProject} decode={decode} />;
  }

  return (
    <Suspense
      fallback={
        <main className="entry-shell" role="status">
          正在加载编辑器…
        </main>
      }
    >
      <LazyWorkbench initialDemoProject={project} />
    </Suspense>
  );
}
