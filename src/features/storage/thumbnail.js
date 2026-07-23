const MAX_EDGE = 256;
const MAX_BYTES = 256 * 1024;

function drawable(image) {
  return image?.source ?? image?.element ?? image?.bitmap ?? image?.image ?? null;
}

export async function createProjectThumbnail(
  image,
  createCanvas = () => document.createElement("canvas"),
) {
  const source = drawable(image);
  const width = Number(image?.width ?? image?.originalWidth);
  const height = Number(image?.height ?? image?.originalHeight);
  if (!source || width <= 0 || height <= 0) return null;
  if (
    createCanvas === undefined ||
    (typeof navigator !== "undefined" &&
      /\bjsdom\b/i.test(navigator.userAgent) &&
      arguments.length < 2)
  ) {
    return null;
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  try {
    const canvas = createCanvas();
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d");
    if (!context || typeof canvas.toBlob !== "function") return null;
    context.drawImage(source, 0, 0, targetWidth, targetHeight);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.72),
    );
    return blob && blob.size <= MAX_BYTES ? blob : null;
  } catch {
    return null;
  }
}
