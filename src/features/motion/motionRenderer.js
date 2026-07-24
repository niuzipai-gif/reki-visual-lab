import { GIFEncoder, applyPalette, quantize } from "gifenc";
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { strToU8, zipSync } from "fflate";
import { renderProjectFrameToBlob } from "../export/exportImage.js";

export const MOTION_PRESET = Object.freeze({
  durationMs: 4000,
  fps: 24,
  maxEdge: 720,
  gifMaxEdge: 640,
});

function abortError() {
  return new DOMException("导出已取消", "AbortError");
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function boundedDuration(value) {
  const numeric = Math.round(Number(value));
  return Number.isFinite(numeric) ? Math.max(1000, Math.min(10_000, numeric)) : MOTION_PRESET.durationMs;
}

function roundedEven(value) {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

export function createMotionPlan(canvas, options = {}) {
  const width = Number(canvas?.width);
  const height = Number(canvas?.height);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error("无法计算动态导出尺寸");
  }
  const fps = Math.max(1, Math.min(30, Math.round(Number(options.fps) || MOTION_PRESET.fps)));
  const maxEdge = Math.max(64, Math.min(MOTION_PRESET.maxEdge, Math.round(Number(options.maxEdge) || MOTION_PRESET.maxEdge)));
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const durationMs = boundedDuration(options.durationMs);
  return {
    width: roundedEven(width * scale),
    height: roundedEven(height * scale),
    scale,
    fps,
    durationMs,
    frameDurationMs: 1000 / fps,
    frameCount: Math.max(1, Math.round((durationMs / 1000) * fps)),
    maxEdge,
  };
}

export async function selectVideoEncoder(environment = globalThis) {
  const VideoEncoder = environment?.VideoEncoder;
  if (typeof VideoEncoder?.isConfigSupported === "function") {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec: "avc1.42001f",
        width: 720,
        height: 720,
        bitrate: 2_500_000,
        framerate: MOTION_PRESET.fps,
      });
      if (support?.supported) return { container: "mp4", extension: "mp4", mimeType: "video/mp4", strategy: "webcodecs" };
    } catch {
      // Try the universally named browser fallback below.
    }
  }
  return selectWebmEncoder(environment);
}

function selectWebmEncoder(environment) {
  if (typeof environment?.MediaRecorder === "function") {
    const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
    const mimeType = candidates.find((candidate) => {
      try {
        return typeof environment.MediaRecorder.isTypeSupported !== "function" || environment.MediaRecorder.isTypeSupported(candidate);
      } catch {
        return false;
      }
    });
    if (mimeType) return { container: "webm", extension: "webm", mimeType, strategy: "media-recorder" };
  }
  throw new Error("当前浏览器不支持本地视频导出，请使用 GIF 或静态图片。");
}

function waitForRealtimeFrame(milliseconds, signal) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, Math.max(0, milliseconds));
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    function done() {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function createCanvas(width, height) {
  if (typeof globalThis.OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  if (typeof document?.createElement === "function") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error("当前浏览器不支持动态导出画布");
}

async function blobToDrawable(blob) {
  if (typeof globalThis.createImageBitmap === "function") return globalThis.createImageBitmap(blob);
  if (typeof Image === "function" && typeof URL?.createObjectURL === "function") {
    const url = URL.createObjectURL(blob);
    try {
      return await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("无法读取动画帧"));
        image.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  throw new Error("当前浏览器无法读取动画帧");
}

function waitForStop(recorder, signal) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const abort = () => {
      try { recorder.stop(); } catch { /* already stopped */ }
      reject(abortError());
    };
    signal?.addEventListener("abort", abort, { once: true });
    recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
    recorder.onerror = () => reject(new Error("浏览器无法编码该视频"));
    recorder.onstop = () => {
      signal?.removeEventListener("abort", abort);
      resolve(chunks);
    };
  });
}

async function renderWebm({ plan, project, sourceBitmap, signal, onProgress, renderFrame, capability, environment, canvasFactory, decodeFrame, waitForFrame }) {
  const canvas = canvasFactory(plan.width, plan.height);
  if (typeof canvas.captureStream !== "function") throw new Error("当前浏览器不支持 WebM 视频导出");
  const context = canvas.getContext("2d");
  // Manual frames plus the real clock make the WebM duration match the 24fps timeline.
  const stream = canvas.captureStream(0);
  const recorder = new environment.MediaRecorder(stream, { mimeType: capability.mimeType });
  const stopped = waitForStop(recorder, signal);
  recorder.start();
  try {
    for (let frameIndex = 0; frameIndex < plan.frameCount; frameIndex += 1) {
      throwIfAborted(signal);
      const frame = await renderFrame({ project, sourceBitmap, frameIndex, timeMs: frameIndex * plan.frameDurationMs, plan, format: "png" });
      throwIfAborted(signal);
      const drawable = await decodeFrame(frame);
      context.clearRect(0, 0, plan.width, plan.height);
      context.drawImage(drawable, 0, 0, plan.width, plan.height);
      drawable.close?.();
      stream.getVideoTracks?.()[0]?.requestFrame?.();
      onProgress?.(frameIndex + 1, plan.frameCount);
      await waitForFrame(plan.frameDurationMs, signal);
    }
    recorder.stop();
    const chunks = await stopped;
    return { blob: new Blob(chunks, { type: capability.mimeType }), ...capability, plan };
  } catch (error) {
    try { recorder.stop(); } catch { /* noop */ }
    await stopped.catch(() => {});
    throw error;
  }
}

async function renderMp4({ plan, project, sourceBitmap, signal, onProgress, renderFrame, capability, environment, decodeFrame }) {
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, fastStart: "in-memory", video: { codec: "avc", width: plan.width, height: plan.height, frameRate: plan.fps } });
  let encoder;
  const flushed = new Promise((resolve, reject) => {
    encoder = new environment.VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: reject,
    });
    encoder.configure({ codec: "avc1.42001f", width: plan.width, height: plan.height, bitrate: 2_500_000, framerate: plan.fps, avc: { format: "avc" } });
    resolve();
  });
  await flushed;
  try {
    for (let frameIndex = 0; frameIndex < plan.frameCount; frameIndex += 1) {
      throwIfAborted(signal);
      const frame = await renderFrame({ project, sourceBitmap, frameIndex, timeMs: frameIndex * plan.frameDurationMs, plan, format: "png" });
      throwIfAborted(signal);
      const drawable = await decodeFrame(frame);
      const videoFrame = new environment.VideoFrame(drawable, { timestamp: Math.round(frameIndex * 1_000_000 / plan.fps), duration: Math.round(1_000_000 / plan.fps) });
      encoder.encode(videoFrame, { keyFrame: frameIndex % plan.fps === 0 });
      videoFrame.close();
      drawable.close?.();
      onProgress?.(frameIndex + 1, plan.frameCount);
    }
    await encoder.flush();
    throwIfAborted(signal);
    muxer.finalize();
    return { blob: new Blob([target.buffer], { type: "video/mp4" }), ...capability, plan };
  } catch (error) {
    encoder?.close?.();
    throw error;
  }
}

async function renderGif({ plan, project, sourceBitmap, signal, onProgress, renderFrame, canvasFactory, decodeFrame }) {
  const canvas = canvasFactory(plan.width, plan.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const gif = GIFEncoder();
  for (let frameIndex = 0; frameIndex < plan.frameCount; frameIndex += 1) {
    throwIfAborted(signal);
    const frame = await renderFrame({ project, sourceBitmap, frameIndex, timeMs: frameIndex * plan.frameDurationMs, plan, format: "png" });
    throwIfAborted(signal);
    const drawable = await decodeFrame(frame);
    context.clearRect(0, 0, plan.width, plan.height);
    context.drawImage(drawable, 0, 0, plan.width, plan.height);
    drawable.close?.();
    const pixels = context.getImageData(0, 0, plan.width, plan.height).data;
    const palette = quantize(pixels, 256);
    gif.writeFrame(applyPalette(pixels, palette), plan.width, plan.height, { palette, delay: Math.round(plan.frameDurationMs), repeat: 0 });
    onProgress?.(frameIndex + 1, plan.frameCount);
  }
  gif.finish();
  return { blob: new Blob([gif.bytes()], { type: "image/gif" }), container: "gif", extension: "gif", mimeType: "image/gif", plan };
}

export async function createLivePhotoBundle({ cover, video, videoExtension }) {
  if (!(cover instanceof Blob) || !(video instanceof Blob)) throw new Error("实况素材包缺少封面或视频");
  const extension = videoExtension === "mp4" ? "mp4" : "webm";
  return new Blob([zipSync({
    "cover.jpg": new Uint8Array(await cover.arrayBuffer()),
    [`motion.${extension}`]: new Uint8Array(await video.arrayBuffer()),
    "README.txt": strToU8("这是实况照片转换素材包：导入美图秀秀等应用后，可将 cover.jpg 与短视频转换成 iPhone 实况照片。该 ZIP 不是原生 Live Photo。"),
  })], { type: "application/zip" });
}

export async function renderMotion({ project, sourceBitmap, kind = "video", signal, onProgress, environment = globalThis, canvasFactory = createCanvas, decodeFrame = blobToDrawable, waitForFrame = waitForRealtimeFrame, renderFrame = ({ project: frameProject, sourceBitmap: frameSource, timeMs, plan, format }) => renderProjectFrameToBlob({ project: frameProject, sourceBitmap: frameSource, timeMs, scale: plan.scale, format }) }) {
  const plan = createMotionPlan(project?.canvas, {
    durationMs: project?.motion?.durationMs,
    maxEdge: kind === "gif" ? MOTION_PRESET.gifMaxEdge : MOTION_PRESET.maxEdge,
  });
  throwIfAborted(signal);
  if (kind === "gif") return renderGif({ plan, project, sourceBitmap, signal, onProgress, renderFrame, canvasFactory, decodeFrame });
  const capability = await selectVideoEncoder(environment);
  let result;
  if (capability.strategy === "webcodecs") {
    try {
      result = await renderMp4({ plan, project, sourceBitmap, signal, onProgress, renderFrame, capability, environment, decodeFrame });
    } catch (error) {
      if (error?.name === "AbortError" || signal?.aborted) throw error;
      const fallback = selectWebmEncoder(environment);
      result = await renderWebm({ plan, project, sourceBitmap, signal, onProgress, renderFrame, capability: fallback, environment, canvasFactory, decodeFrame, waitForFrame });
    }
  } else {
    result = await renderWebm({ plan, project, sourceBitmap, signal, onProgress, renderFrame, capability, environment, canvasFactory, decodeFrame, waitForFrame });
  }
  if (kind !== "bundle") return result;
  const cover = await renderProjectFrameToBlob({ project, sourceBitmap, timeMs: 0, scale: plan.scale, format: "jpg", quality: 0.9 });
  throwIfAborted(signal);
  return {
    blob: await createLivePhotoBundle({ cover, video: result.blob, videoExtension: result.extension }),
    container: "bundle",
    extension: "zip",
    mimeType: "application/zip",
    plan,
    videoExtension: result.extension,
  };
}
