import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import worker from "../worker/index.js";

test("serves existing static assets without a fallback", async () => {
  const calls = [];
  const response = await worker.fetch(new Request("https://example.test/assets/app.js"), {
    ASSETS: {
      fetch: async (request) => {
        calls.push(new URL(request.url).pathname);
        return new Response("asset", { status: 200 });
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/assets/app.js"]);
});

test("falls back to index.html for an unknown app route", async () => {
  const calls = [];
  const response = await worker.fetch(
    new Request("https://example.test/flow/step-two?source=share", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async (request) => {
          const url = new URL(request.url);
          calls.push(url.pathname + url.search);
          return new Response(url.pathname === "/index.html" ? "app" : "missing", {
            status: url.pathname === "/index.html" ? 200 : 404,
          });
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/flow/step-two?source=share", "/index.html"]);
});

test("does not turn missing API or write requests into the app shell", async () => {
  for (const request of [
    new Request("https://example.test/api/missing", { headers: { accept: "application/json" } }),
    new Request("https://example.test/flow", { method: "POST", headers: { accept: "text/html" } }),
  ]) {
    let calls = 0;
    const response = await worker.fetch(request, {
      ASSETS: {
        fetch: async () => {
          calls += 1;
          return new Response("missing", { status: 404 });
        },
      },
    });

    assert.equal(response.status, 404);
    assert.equal(calls, 1);
  }
});

test("returns JSON status when style advice is not configured", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/api/style-advice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ features: { width: 100 } }),
    }),
    { ASSETS: { fetch: async () => new Response("asset", { status: 200 }) } },
  );

  assert.equal(response.status, 503);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.equal((await response.json()).error.code, "AI_NOT_CONFIGURED");
});

test("proxies a sanitized summary to MiniMax without exposing the key", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    calls.push({ input, init });
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ recommendations: [] }) } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const response = await worker.fetch(
      new Request("https://example.test/api/style-advice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ features: { width: 100, image: "raw-image", data: [1, 2] } }),
      }),
      { ASSETS: { fetch: async () => new Response("asset", { status: 200 }) }, MINIMAX_API_KEY: "test-token" },
    );

    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.match(calls[0].init.headers.authorization, /^Bearer /);
    assert.doesNotMatch(JSON.stringify(calls[0].init.body), /raw-image/);
    assert.doesNotMatch(JSON.stringify(await response.json()), /test-token/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("emits the files required by Sites packaging", async () => {
  await access(new URL("../dist/client/index.html", import.meta.url));
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../dist/.openai/hosting.json", import.meta.url));
});
