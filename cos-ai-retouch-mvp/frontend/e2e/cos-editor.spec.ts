import { expect, test } from "@playwright/test";
import path from "node:path";

test("opens the browser COS workstation and exports an editable project", async ({ page }) => {
  let plannerCalls = 0;
  await page.route("**/api/v1/workflows/plan", async (route) => {
    plannerCalls += 1;
    await route.fulfill({
      json: {
        filename: "cos-smoke.jpg",
        provider: "rules",
        image_generation_calls: 0,
        operations: [{
          id: "workflow-light-1",
          module: "light",
          label: "智能提亮",
          kind: "adjustment",
          scope: "global",
          intensity: 55,
          requires_remote_ai: false,
          preserve: ["face identity"],
        }],
        preserve: ["face identity"],
        validation: ["face identity"],
        notes: ["planner only"],
      },
    });
  });

  await page.goto("/");
  const fixture = path.join(__dirname, "fixtures", "cos-smoke.jpg");
  await page.getByLabel("选择 JPG 或 PNG 原图").setInputFiles(fixture);
  await expect(page.getByAltText("待处理原图预览")).toBeVisible();
  await page.getByRole("button", { name: "进入网页修图工作台" }).click();

  await expect(page.getByRole("heading", { name: "COS 修图工作台" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "照片画布" })).toBeVisible();
  await page.getByRole("button", { name: "自动执行 · COS 人像基础链路" }).click();
  await expect(page.getByText("智能提亮").first()).toBeVisible();
  expect(plannerCalls).toBe(1);

  await page.getByRole("button", { name: "面部精修" }).click();
  await expect(page.getByText("面部精修 · 待云端 AI").first()).toBeVisible();
  const canvas = page.getByLabel("COS 照片编辑画布");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error("editor canvas has no layout box");
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.45);
  await page.mouse.up();

  const projectDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存项目 JSON" }).click();
  await expect((await projectDownload).suggestedFilename()).toContain("aura-project.json");

  const psdDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 PSD" }).click();
  await expect((await psdDownload).suggestedFilename()).toContain("aura.psd");
  await expect(page.getByRole("status")).toContainText("PSD 已导出");
});
