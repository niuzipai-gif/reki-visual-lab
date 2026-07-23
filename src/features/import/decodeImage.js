export const SUPPORTED_IMAGE_TYPES = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
export const MAX_DECODED_PIXELS = 40_000_000;

export function validateImageFile(file) {
  if (!file || !SUPPORTED_IMAGE_TYPES.includes(file.type)) {
    return { ok: false, message: "请选择 JPG、PNG 或 WebP 图片" };
  }
  if (!Number.isFinite(file.size) || file.size > MAX_IMAGE_BYTES) {
    return { ok: false, message: "图片不能超过 40 MB" };
  }
  return { ok: true };
}

export function previewSize(width, height, maxEdge = 1600) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(maxEdge) ||
    width <= 0 ||
    height <= 0 ||
    maxEdge <= 0
  ) {
    return { width: 0, height: 0 };
  }

  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function disposableResource(resource, release) {
  let disposed = false;
  return {
    ...resource,
    dispose() {
      if (disposed) return;
      disposed = true;
      release();
    },
  };
}

function validDecodedSize(width, height) {
  return (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
  );
}

function decodedSize(width, height) {
  if (!validDecodedSize(width, height)) {
    throw new Error("无法读取这张图片");
  }
  if (width * height > MAX_DECODED_PIXELS) {
    const error = new Error("图片像素不能超过 4000 万");
    error.code = "IMAGE_PIXEL_LIMIT";
    throw error;
  }
  return { width, height };
}

function createWorkingCanvas(source, width, height) {
  const working = previewSize(width, height);
  if (
    working.width === width &&
    working.height === height
  ) {
    return null;
  }
  if (typeof globalThis.document?.createElement !== "function") return null;

  try {
    const canvas = document.createElement("canvas");
    canvas.width = working.width;
    canvas.height = working.height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(source, 0, 0, working.width, working.height);
    return { canvas, ...working };
  } catch {
    return null;
  }
}

function canvasResource(canvas, metadata) {
  return disposableResource(
    { source: canvas, kind: "canvas", ...metadata },
    () => {
      canvas.width = 0;
      canvas.height = 0;
    },
  );
}

async function decodeWithObjectUrl(file) {
  if (
    typeof URL?.createObjectURL !== "function" ||
    typeof globalThis.Image !== "function"
  ) {
    throw new Error("当前浏览器无法读取本地图片");
  }

  const url = URL.createObjectURL(file);
  let revoked = false;
  const revoke = () => {
    if (revoked) return;
    revoked = true;
    URL.revokeObjectURL(url);
  };

  try {
    const image = await new Promise((resolve, reject) => {
      const candidate = new Image();
      candidate.onload = () => resolve(candidate);
      candidate.onerror = () => reject(new Error("无法读取这张图片"));
      candidate.src = url;
    });
    const { width, height } = decodedSize(
      image.naturalWidth || image.width,
      image.naturalHeight || image.height,
    );
    const working = createWorkingCanvas(image, width, height);
    if (working) {
      revoke();
      return canvasResource(working.canvas, {
        width,
        height,
        originalWidth: width,
        originalHeight: height,
        workingWidth: working.width,
        workingHeight: working.height,
        originalFile: file,
      });
    }

    return disposableResource(
      {
        source: image,
        width,
        height,
        originalWidth: width,
        originalHeight: height,
        workingWidth: width,
        workingHeight: height,
        originalFile: file,
        kind: "image",
        url,
      },
      revoke,
    );
  } catch (error) {
    revoke();
    throw error instanceof Error ? error : new Error("无法读取这张图片");
  }
}

export async function decodeImage(file) {
  if (typeof globalThis.createImageBitmap === "function") {
    try {
      const bitmap = await globalThis.createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      let dimensions;
      try {
        dimensions = decodedSize(bitmap.width, bitmap.height);
      } catch (error) {
        bitmap.close?.();
        throw error;
      }
      const working = createWorkingCanvas(
        bitmap,
        dimensions.width,
        dimensions.height,
      );
      if (working) {
        bitmap.close?.();
        return canvasResource(working.canvas, {
          width: dimensions.width,
          height: dimensions.height,
          originalWidth: dimensions.width,
          originalHeight: dimensions.height,
          workingWidth: working.width,
          workingHeight: working.height,
          originalFile: file,
        });
      }
      return disposableResource(
        {
          source: bitmap,
          width: dimensions.width,
          height: dimensions.height,
          originalWidth: dimensions.width,
          originalHeight: dimensions.height,
          workingWidth: dimensions.width,
          workingHeight: dimensions.height,
          originalFile: file,
          kind: "bitmap",
        },
        () => bitmap.close?.(),
      );
    } catch (error) {
      if (error?.code === "IMAGE_PIXEL_LIMIT") throw error;
      // Some browsers expose createImageBitmap but reject particular formats.
    }
  }

  return decodeWithObjectUrl(file);
}
