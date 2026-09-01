import { expect, test } from "@playwright/test";
import path from "node:path";

const taskId = "smoke-task-001";
const expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const originalAsset = {
  kind: "original",
  url: "https://mock-storage.test/smoke/original.jpg?signature=original",
  expires_at: expiry,
};
const versionAsset = {
  kind: "version",
  url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  expires_at: expiry,
};

function taskPayload(status: string, extra: Record<string, unknown> = {}) {
  return {
    task_id: taskId,
    status,
    created_at: "2026-08-31T00:00:00Z",
    updated_at: "2026-08-31T00:01:00Z",
    original_asset_url: originalAsset,
    mask_asset_url: null,
    analysis: [
      {
        id: "face-card",
        category: "face",
        title: "面部细节",
        summary: "保留角色辨识度，轻微清理肤质。",
        confidence: 0.92,
        risk: "不要改变面部身份。",
        enabled: false,
        regions: [{ id: "face-1", label: "面部局部", x: 0.25, y: 0.2, width: 0.3, height: 0.3, source: "analysis" }],
      },
      {
        id: "body-card",
        category: "body_pose",
        title: "姿态连接",
        summary: "只检查局部姿态连接，不改变主体比例。",
        confidence: 0.87,
        risk: "保持主姿势和服装结构。",
        enabled: false,
        regions: [{ id: "body-1", label: "姿态连接", x: 0.55, y: 0.35, width: 0.2, height: 0.25, source: "analysis" }],
      },
    ],
    plan: null,
    versions: [],
    error: null,
    ...extra,
  };
}

test("completes the invite-only single-photo workflow with the mock provider", async ({ page }) => {
  let planBody: Record<string, unknown> | null = null;
  let analysisStarted = false;
  let generationStarted = false;
  let taskGetRequests = 0;
  let uploadBody: Buffer | null = null;

  await page.route("**/api/v1/tasks", async (route) => {
    expect(route.request().method()).toBe("POST");
    const body = route.request().postDataJSON();
    expect(body.invite_token).toBe("invite-demo");
    expect(body.content_type).toBe("image/jpeg");
    await route.fulfill({ json: { task_id: taskId, upload_url: "https://mock-storage.test/upload", expires_at: expiry, status: "uploading" } });
  });
  await page.route("https://mock-storage.test/upload", async (route) => {
    expect(route.request().method()).toBe("PUT");
    expect(route.request().headers()["x-invite-token"]).toBeUndefined();
    uploadBody = route.request().postDataBuffer();
    await route.fulfill({ status: 200, body: "" });
  });
  await page.route(/\/api\/v1\/tasks\/[^/]+(?:\/(?:analyze|plan|generate|download))?$/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathSegments = url.pathname.split("/").filter(Boolean);
    const action = pathSegments.length === 5 ? pathSegments.at(-1) : undefined;
    if (request.method() === "POST" && action === "analyze") {
      analysisStarted = true;
      expect(request.headers()["x-invite-token"]).toBe("invite-demo");
      expect(request.headers()["idempotency-key"]).toBeTruthy();
      await route.fulfill({ json: {} });
      return;
    }
    if (request.method() === "POST" && action === "plan") {
      planBody = request.postDataJSON();
      expect(request.headers()["x-invite-token"]).toBe("invite-demo");
      await route.fulfill({ json: {} });
      return;
    }
    if (request.method() === "POST" && action === "generate") {
      generationStarted = true;
      expect(request.headers()["x-invite-token"]).toBe("invite-demo");
      expect(request.headers()["idempotency-key"]).toBeTruthy();
      await route.fulfill({ json: {} });
      return;
    }
    if (request.method() === "GET" && action === "download") {
      expect(request.headers()["x-invite-token"]).toBe("invite-demo");
      await route.fulfill({ json: { url: `https://mock-storage.test/download.png?expires=${encodeURIComponent(expiry)}`, expires_at: expiry } });
      return;
    }
    if (request.method() === "GET" && action === undefined) {
      taskGetRequests += 1;
      if (generationStarted) {
        await route.fulfill({ json: taskPayload("succeeded", { plan: planBody, versions: [{ id: "version-1", asset_url: versionAsset, created_at: "2026-08-31T00:02:00Z", validation: { face_identity: "pass", hands_and_costume: "review" }, selected: true }] }) });
      } else if (analysisStarted) {
        await route.fulfill({ json: taskPayload("awaiting_confirmation") });
      }
      return;
    }
    await route.abort();
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "进入我的写真工作室" })).toBeVisible();
  await page.getByLabel("邀请 token").fill("invite-demo");
  await page.getByRole("button", { name: "开始我的修图" }).click();
  await expect(page.getByRole("heading", { name: "先放一张你喜欢的照片" })).toBeVisible();

  const fixture = path.join(__dirname, "fixtures", "cos-smoke.jpg");
  await page.getByLabel("选择 JPG 或 PNG 原图").setInputFiles(fixture);
  await expect(page.getByAltText("待处理原图预览")).toBeVisible();
  await page.getByRole("button", { name: "开始看看哪里可以更好" }).click();
  await expect(page.getByRole("heading", { name: "看看哪里可以更好" })).toBeVisible();
  await expect(page.getByText("面部细节")).toBeVisible();
  await expect(page.getByText("姿态连接")).toBeVisible();

  await page.getByLabel("整理细节").check();
  await page.getByRole("switch", { name: "面部处理开关" }).check();
  await page.getByRole("switch", { name: "身体 / 姿态处理开关" }).check();

  const canvas = page.getByLabel("局部蒙版画布");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error("mask canvas has no layout box");
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.55);
  await page.mouse.up();

  await page.getByRole("button", { name: "生成我的预览" }).click();
  await expect(page.getByRole("heading", { name: "生成结果" })).toBeVisible();
  expect(uploadBody?.length).toBeGreaterThan(0);
  expect(planBody?.goals).toEqual(["natural_retouch", "structure_repair"]);
  expect(planBody?.mask_strokes).toHaveLength(1);
  await expect(page.getByTestId("before-after-comparison")).toBeVisible();
  await page.getByLabel("对比位置").fill("72");
  await expect(page.getByLabel("对比位置")).toHaveValue("72");

  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "下载当前结果" }).click();
  const popup = await popupPromise;
  await expect.poll(() => popup.url()).toContain("expires=");
  expect(taskGetRequests).toBeGreaterThan(0);
});
