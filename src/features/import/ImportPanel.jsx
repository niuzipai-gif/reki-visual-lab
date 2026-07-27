import React, { useEffect, useRef, useState } from "react";
import { createProject } from "../../domain/project.js";
import {
  SUPPORTED_IMAGE_TYPES,
  decodeImage,
  validateImageFile,
} from "./decodeImage.js";
import { publicAsset } from "../../publicAsset.js";

const ACCEPTED_TYPES = SUPPORTED_IMAGE_TYPES.join(",");

export function ImportPanel({ onProject, decode = decodeImage, children }) {
  const inputRef = useRef(null);
  const mountedRef = useRef(false);
  const requestRef = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
    };
  }, []);

  const chooseFile = () => inputRef.current?.click();

  const importFile = async (file) => {
    const request = ++requestRef.current;
    const validation = validateImageFile(file);
    if (!validation.ok) {
      setFeedback({ kind: "error", message: validation.message });
      return;
    }

    setFeedback({ kind: "loading", message: "正在读取照片…" });
    try {
      const decoded = await decode(file);
      if (!mountedRef.current || request !== requestRef.current) {
        decoded.dispose?.();
        return;
      }
      const project = {
        ...createProject({ width: decoded.width, height: decoded.height }),
        name: file.name.replace(/\.[^.]+$/, "") || "未命名项目",
        image: {
          ...decoded,
          fileName: file.name,
          type: file.type,
          size: file.size,
        },
      };
      setFeedback({ kind: "success", message: "照片已准备好" });
      onProject?.(project);
    } catch (error) {
      if (!mountedRef.current || request !== requestRef.current) return;
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "无法读取这张图片",
      });
    }
  };

  const handleFiles = (files) => {
    const [file] = files ?? [];
    if (file) void importFile(file);
  };

  return (
    <main className="entry-shell">
      <section className="entry-panel" aria-labelledby="reki-title">
        <img className="entry-brand-mark" src={publicAsset("brand/reki-character-mark.png")} alt="" />
        <p className="entry-kicker">视觉标注实验室</p>
        <h1 id="reki-title">REKI</h1>
        <p className="entry-copy">从一张照片开始你的静态视觉实验。</p>
        <input
          ref={inputRef}
          id="reki-photo-input"
          className="sr-only"
          type="file"
          accept={ACCEPTED_TYPES}
          aria-label="选择照片"
          onChange={(event) => {
            handleFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <button
          className="upload-button primary-button"
          type="button"
          onClick={chooseFile}
        >
          选择照片
        </button>
        <div
          className="import-drop-zone"
          role="button"
          tabIndex={0}
          aria-label="拖放照片或选择照片"
          data-dragging={String(dragging)}
          onClick={chooseFile}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              chooseFile();
            }
          }}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setDragging(false);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            handleFiles(event.dataTransfer?.files);
          }}
        >
          <span className="drop-hint">或将 JPG、PNG、WebP 拖到这里</span>
        </div>
        {feedback ? (
          <p
            className={`import-feedback ${feedback.kind}`}
            role={feedback.kind === "error" ? "alert" : "status"}
          >
            {feedback.message}
          </p>
        ) : null}
        <p className="privacy-note">照片仅在本机处理</p>
        {children}
      </section>
    </main>
  );
}
