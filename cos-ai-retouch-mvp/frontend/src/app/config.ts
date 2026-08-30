export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").trim().replace(/\/$/, "");

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png"] as const;

export type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];

export function isSupportedImageType(value: string): value is SupportedImageType {
  return (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(value.toLowerCase());
}
