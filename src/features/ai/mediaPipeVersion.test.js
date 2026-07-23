import fs from "node:fs";
import { expect, test } from "vitest";
import { TASKS_VISION_WASM_BASE_URL } from "./landmarkModel.js";

test("pins the MediaPipe package and WASM runtime to the same exact version", () => {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const packageLock = JSON.parse(
    fs.readFileSync("package-lock.json", "utf8"),
  );

  expect(packageJson.dependencies["@mediapipe/tasks-vision"]).toBe(
    "0.10.22-rc.20250304",
  );
  expect(
    packageLock.packages["node_modules/@mediapipe/tasks-vision"].version,
  ).toBe("0.10.22-rc.20250304");
  expect(TASKS_VISION_WASM_BASE_URL).toContain(
    "@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm",
  );
});
