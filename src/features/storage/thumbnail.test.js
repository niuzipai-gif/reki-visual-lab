import { describe, expect, test, vi } from "vitest";
import { createProjectThumbnail } from "./thumbnail.js";

describe("createProjectThumbnail", () => {
  test("draws a bounded 256px WebP preview Blob", async () => {
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toBlob(callback, type) {
        callback(new Blob(["preview"], { type }));
      },
    };
    const source = { width: 1600, height: 800 };

    const thumbnail = await createProjectThumbnail(
      { source, width: 1600, height: 800 },
      () => canvas,
    );

    expect(canvas).toMatchObject({ width: 256, height: 128 });
    expect(drawImage).toHaveBeenCalledWith(source, 0, 0, 256, 128);
    expect(thumbnail).toEqual(
      expect.objectContaining({ type: "image/webp", size: 7 }),
    );
  });

  test("returns null when the generated preview is missing or over 256 KB", async () => {
    const oversized = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob(callback) {
        callback(new Blob(["x".repeat(256 * 1024 + 1)]));
      },
    };
    expect(
      await createProjectThumbnail(
        { source: {}, width: 100, height: 100 },
        () => oversized,
      ),
    ).toBeNull();
    expect(await createProjectThumbnail(null)).toBeNull();
  });
});
