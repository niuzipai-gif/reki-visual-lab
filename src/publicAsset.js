/** Resolve a file from Vite's public directory for root and subpath deployments. */
export function publicAsset(path, base = import.meta.env.BASE_URL) {
  const file = String(path ?? "").replace(/^\/+/, "");
  const prefix = String(base || "/").replace(/\/+$/, "");
  return `${prefix || "/"}/${file}`.replace(/^\/\//, "/");
}
