import React, { useCallback, useEffect, useState } from "react";
import { FolderOpen, ImagePlus, Pencil, Trash2 } from "lucide-react";
import * as projectStore from "./projectStore.js";

const ERROR_MESSAGES = {
  CORRUPT_PROJECT: "项目数据已损坏，无法打开",
  UNSUPPORTED_PROJECT_VERSION: "此项目来自更新版本，当前版本无法打开",
  STORAGE_FULL: "本机存储空间不足，无法完成操作",
  STORAGE_UNAVAILABLE: "本机项目存储暂时不可用",
};

function errorMessage(error) {
  return (
    ERROR_MESSAGES[error?.code] ??
    error?.message ??
    "无法完成项目操作，请稍后重试"
  );
}

function formattedTime(timestamp, now = Date.now()) {
  const date = new Date(timestamp);
  const absolute = Number.isNaN(date.getTime())
    ? "未知时间"
    : new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
  const elapsed = Math.max(0, now - timestamp);
  const relative =
    elapsed < 60_000
      ? "刚刚"
      : elapsed < 3_600_000
        ? `${Math.floor(elapsed / 60_000)} 分钟前`
        : elapsed < 86_400_000
          ? `${Math.floor(elapsed / 3_600_000)} 小时前`
          : absolute;
  return {
    absolute,
    relative,
    dateTime: Number.isNaN(date.getTime()) ? "" : date.toISOString(),
  };
}

function ProjectThumbnail({ project, store }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (
      !project.thumbnailAvailable ||
      typeof store.loadThumbnail !== "function"
    ) {
      setUrl(null);
      return undefined;
    }
    let active = true;
    let ownedUrl = null;
    Promise.resolve(store.loadThumbnail(project.id)).then(
      (blob) => {
        if (
          !active ||
          !(blob instanceof Blob) ||
          typeof URL.createObjectURL !== "function"
        ) {
          return;
        }
        ownedUrl = URL.createObjectURL(blob);
        setUrl(ownedUrl);
      },
      () => {
        if (active) setUrl(null);
      },
    );
    return () => {
      active = false;
      if (ownedUrl) URL.revokeObjectURL(ownedUrl);
    };
  }, [project.id, project.thumbnailAvailable, store]);
  return url ? (
    <img
      className="project-thumbnail"
      src={url}
      alt={`${project.name} 缩略图`}
    />
  ) : (
    <span className="project-thumbnail-placeholder" aria-hidden="true" />
  );
}

export function ProjectBrowser({
  store = projectStore,
  onOpen,
  onNewImage,
}) {
  const [projects, setProjects] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [busyIds, setBusyIds] = useState(() => new Set());

  const refresh = useCallback(async () => {
    try {
      const items = await store.listProjects();
      setProjects(
        [...items].sort(
          (first, second) =>
            (Number(second.updatedAt) || 0) -
            (Number(first.updatedAt) || 0),
        ),
      );
      setFeedback(null);
    } catch (error) {
      setProjects([]);
      setFeedback({ kind: "error", message: errorMessage(error) });
    }
  }, [store]);

  useEffect(() => {
    let active = true;
    Promise.resolve(store.listProjects()).then(
      (items) => {
        if (!active) return;
        setProjects(
          [...items].sort(
            (first, second) =>
              (Number(second.updatedAt) || 0) -
              (Number(first.updatedAt) || 0),
          ),
        );
      },
      (error) => {
        if (!active) return;
        setProjects([]);
        setFeedback({ kind: "error", message: errorMessage(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [store]);

  useEffect(() => {
    if (typeof store.subscribeProjectChanges !== "function") return undefined;
    return store.subscribeProjectChanges(() => {
      void refresh();
    });
  }, [refresh, store]);

  const perform = async (id, operation) => {
    setBusyIds((current) => new Set(current).add(id));
    setFeedback(null);
    try {
      await operation();
    } catch (error) {
      setFeedback({ kind: "error", message: errorMessage(error) });
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };

  const rename = (project) => {
    const name = window.prompt("项目名称", project.name)?.trim();
    if (!name || name === project.name) return;
    void perform(project.id, async () => {
      const loaded = await store.loadProject(project.id);
      if (!loaded) {
        const error = new Error("项目不存在");
        error.code = "CORRUPT_PROJECT";
        throw error;
      }
      await store.saveProject(
        {
          ...loaded.project,
          name,
          updatedAt: Date.now(),
        },
        undefined,
        {
          expectedRevision:
            loaded.revision ??
            loaded.project.revision ??
            project.revision ??
            0,
          sourceMode: "preserve",
        },
      );
      await refresh();
    });
  };

  const remove = (project) => {
    if (!window.confirm(`确定删除“${project.name}”吗？此操作无法撤销。`)) {
      return;
    }
    void perform(project.id, async () => {
      await store.deleteProject(project.id, project.revision);
      await refresh();
    });
  };

  return (
    <section className="project-browser" aria-labelledby="recent-projects-title">
      <header>
        <div>
          <p className="project-browser-kicker">DEVICE LIBRARY</p>
          <h2 id="recent-projects-title">最近项目</h2>
        </div>
        <button type="button" className="project-new-button" onClick={onNewImage}>
          <ImagePlus size={15} />
          新图片
        </button>
      </header>

      {projects === null ? (
        <p className="project-browser-state" role="status">
          正在读取最近项目…
        </p>
      ) : projects.length ? (
        <ul className="project-list">
          {projects.map((project) => {
            const time = formattedTime(project.updatedAt);
            const busy = busyIds.has(project.id);
            return (
              <li key={project.id}>
                <ProjectThumbnail project={project} store={store} />
                <div className="project-summary">
                  <b>{project.name}</b>
                  <span>
                    {project.width} × {project.height} · {project.layerCount} 个图层
                  </span>
                  <time dateTime={time.dateTime} title={time.absolute}>
                    {time.relative}
                  </time>
                  {project.sourceStatus === "missing" ? (
                    <span className="project-source-missing">原始照片缺失</span>
                  ) : null}
                </div>
                <div className="project-actions">
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`打开 ${project.name}`}
                    onClick={() =>
                      void perform(project.id, () => onOpen?.(project.id))
                    }
                  >
                    <FolderOpen size={15} />
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`重命名 ${project.name}`}
                    onClick={() => rename(project)}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`删除 ${project.name}`}
                    onClick={() => remove(project)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : feedback?.kind !== "error" ? (
        <p className="project-browser-state">还没有本机项目</p>
      ) : null}

      {feedback ? (
        <p
          className={`project-browser-feedback ${feedback.kind}`}
          role={feedback.kind === "error" ? "alert" : "status"}
        >
          {feedback.message}
        </p>
      ) : null}
    </section>
  );
}
