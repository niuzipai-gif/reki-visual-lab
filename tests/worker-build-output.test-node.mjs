import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const assetsUrl = new URL("../dist/client/assets/", import.meta.url);

test("production build emits a standalone landmark module worker", async () => {
  const files = await readdir(assetsUrl);
  const workerAssets = files.filter((file) =>
    /^landmarkWorker-[\w-]+\.js$/.test(file),
  );

  assert.equal(
    workerAssets.length,
    1,
    `expected one landmark worker asset, found: ${workerAssets.join(", ") || "none"}`,
  );

  const applicationSources = await Promise.all(
    files
      .filter((file) => file.endsWith(".js") && !workerAssets.includes(file))
      .map((file) => readFile(new URL(file, assetsUrl), "utf8")),
  );
  const compiledApplication = applicationSources.join("\n");

  assert.doesNotMatch(compiledApplication, /data:text\/javascript/i);
  assert.doesNotMatch(compiledApplication, /\.\/landmarkRuntime\.js/);
});
