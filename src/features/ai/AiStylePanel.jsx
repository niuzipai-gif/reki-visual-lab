import React, { useEffect, useRef, useState } from "react";
import {
  analyzeImageFeatures,
  getOfflineRecommendations,
  validateStyleAdvice,
} from "./styleAdvisor.js";
import { getStyleAdvice } from "./styleAdvisorClient.js";

function completeRecommendations(input) {
  const validated = validateStyleAdvice({ recommendations: input }).ok
    ? validateStyleAdvice({ recommendations: input }).recommendations
    : [];
  const seen = new Set(validated.map(({ id }) => id));
  for (const recommendation of getOfflineRecommendations()) {
    if (validated.length >= 3 || seen.has(recommendation.id)) continue;
    seen.add(recommendation.id);
    validated.push(recommendation);
  }
  return validated.slice(0, 3);
}

export function AiStylePanel({
  imageSource,
  analyzeFeatures = analyzeImageFeatures,
  getAdvice = getStyleAdvice,
  dispatch,
  onApply,
}) {
  const [status, setStatus] = useState({ type: "idle" });
  const [recommendations, setRecommendations] = useState([]);
  const requestId = useRef(0);

  useEffect(() => () => {
    requestId.current += 1;
  }, []);

  async function requestAdvice() {
    const id = ++requestId.current;
    setStatus({ type: "loading" });
    let features;
    try {
      features = analyzeFeatures(imageSource ?? {});
      const result = await getAdvice(features);
      if (id !== requestId.current) return;
      const remoteValidation = validateStyleAdvice({ recommendations: result?.recommendations });
      const nextRecommendations = completeRecommendations(
        remoteValidation.ok ? remoteValidation.recommendations : [],
      );
      setRecommendations(nextRecommendations);
      setStatus({
        type: result?.source === "remote" && remoteValidation.ok ? "remote" : "offline",
        error: result?.error ?? null,
      });
    } catch (error) {
      if (id !== requestId.current) return;
      setRecommendations(completeRecommendations([]));
      setStatus({
        type: "offline",
        error: error instanceof Error ? error.message : "REQUEST_FAILED",
      });
    }
  }

  function applyRecommendation(recommendation) {
    const action = { type: "style/apply", recommendation };
    if (dispatch) dispatch(action);
    onApply?.(recommendation, action);
  }

  const canRequest = Boolean(imageSource) && status.type !== "loading";

  return (
    <section className="ai-style-panel" aria-label="AI 风格建议">
      <header>
        <div>
          <small>STYLE ADVISOR</small>
          <h2>AI 风格建议</h2>
        </div>
        <span className="type-badge">EDIT</span>
      </header>
      <p className="ai-privacy">
        仅分析图片特征并建议编辑风格，不生成图片；原图不会上传，浏览器只发送去标识化特征摘要。
      </p>
      {status.type === "idle" ? (
        <p className="ai-feedback">
          {imageSource ? "先做一次本地分析，再获取三套可应用的编辑方案。" : "图片加载完成后即可分析并获取风格建议。"}
        </p>
      ) : null}
      {status.type === "loading" ? (
        <p className="ai-feedback" role="status" aria-live="polite">正在分析图片并请求风格建议…</p>
      ) : null}
      {status.type === "remote" ? (
        <p className="ai-feedback ai-success" role="status">来自云端 AI 建议</p>
      ) : null}
      {status.type === "offline" ? (
        <p className="ai-feedback" role="status">离线风格建议{status.error ? `（${status.error}）` : ""}</p>
      ) : null}
      {recommendations.length ? (
        <div className="ai-style-cards">
          {recommendations.map((recommendation, index) => (
            <article
              key={recommendation.id}
              className="ai-style-card"
              aria-label={`风格方案 ${index + 1}：${recommendation.name}`}
            >
              <div className="ai-style-card-heading">
                <div>
                  <small>方案 {String(index + 1).padStart(2, "0")}</small>
                  <h3>{recommendation.name}</h3>
                </div>
                <span>{recommendation.annotationType}</span>
              </div>
              <p>{recommendation.description}</p>
              <small className="ai-style-risk">注意：{recommendation.risk}</small>
              <button
                type="button"
                className="primary-button"
                onClick={() => applyRecommendation(recommendation)}
              >
                应用此方案
              </button>
            </article>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className="primary-button ai-style-request"
        onClick={requestAdvice}
        disabled={!canRequest}
      >
        {recommendations.length ? "重新获取建议" : "获取 AI 风格建议"}
      </button>
    </section>
  );
}

export default AiStylePanel;
