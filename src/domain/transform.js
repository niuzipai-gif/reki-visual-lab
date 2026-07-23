const MIN_SIZE = 0.01;

export function pointBounds(points = []) {
  if (!points.length) return { x: 0, y: 0, width: MIN_SIZE, height: MIN_SIZE };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(MIN_SIZE, Math.max(...xs) - x),
    height: Math.max(MIN_SIZE, Math.max(...ys) - y),
  };
}

export function clampBounds(bounds) {
  const width = Math.max(MIN_SIZE, Math.min(1, bounds.width));
  const height = Math.max(MIN_SIZE, Math.min(1, bounds.height));
  return {
    x: Math.max(0, Math.min(1 - width, bounds.x)),
    y: Math.max(0, Math.min(1 - height, bounds.y)),
    width,
    height,
  };
}

export function resizeNormalizedPoints(points, fromBounds, toBounds) {
  const source = clampBounds(fromBounds);
  const target = clampBounds(toBounds);
  const round = (value) => Math.round(value * 1_000_000) / 1_000_000;
  return points.map((point) => ({
    x: round(target.x + ((point.x - source.x) / source.width) * target.width),
    y: round(target.y + ((point.y - source.y) / source.height) * target.height),
  }));
}

export function resizeBoundsFromHandle(bounds, handle, pointer) {
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  const next = { ...bounds };
  if (handle.includes("w")) {
    next.x = Math.min(pointer.x, right - MIN_SIZE);
    next.width = right - next.x;
  }
  if (handle.includes("e")) {
    next.width = Math.max(MIN_SIZE, pointer.x - bounds.x);
  }
  if (handle.includes("n")) {
    next.y = Math.min(pointer.y, bottom - MIN_SIZE);
    next.height = bottom - next.y;
  }
  if (handle.includes("s")) {
    next.height = Math.max(MIN_SIZE, pointer.y - bounds.y);
  }
  return clampBounds(next);
}
