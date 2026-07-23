function finiteNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function usableDimension(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function normalizePoint(point, size) {
  const width = usableDimension(size?.width);
  const height = usableDimension(size?.height);

  return {
    x: width ? finiteNumber(point?.x) / width : 0,
    y: height ? finiteNumber(point?.y) / height : 0,
  };
}

export function denormalizePoint(point, size) {
  return {
    x: finiteNumber(point?.x) * usableDimension(size?.width),
    y: finiteNumber(point?.y) * usableDimension(size?.height),
  };
}

export function makeCurvePoints(points, tension = 0) {
  if (!Array.isArray(points)) return [];
  if (points.length < 3 || !Number.isFinite(tension) || tension <= 0) {
    return points;
  }

  const output = [points[0]];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const xDistance = end.x - start.x;
    const yDistance = end.y - start.y;

    output.push(
      {
        x: start.x + xDistance * tension,
        y: start.y + yDistance * tension,
      },
      {
        x: end.x - xDistance * tension,
        y: end.y - yDistance * tension,
      },
      end,
    );
  }

  return output;
}
