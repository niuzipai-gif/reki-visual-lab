# COS AI Retouch「奶油写真馆」视觉改版实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 COS AI 修图 MVP 从深色科技控制台改造成温柔、可爱、精致的奶油写真馆，同时保持现有上传、分析、蒙版、任务、候选图和原图保护能力不变。

**Architecture:** 保持现有 React 组件边界和后端 API 不变，把视觉令牌集中在 `frontend/src/styles.css`，把用户可见文案放在现有组件中，继续使用现有的语义角色和状态机。Figma 文件 `J6OGou9VsFow3tzFfTaV1j` 的主工作台画板 `1:3` 作为外部视觉验收稿，与本地前端采用同一组颜色、圆角、阴影和文案。

**Tech Stack:** React 19, TypeScript, Vite, CSS, Vitest, Testing Library, Playwright, Figma MCP。

---

## 文件地图

- `frontend/src/styles.css`：全局颜色、字体、卡片、按钮、上传区、分析区、结果区和响应式样式。
- `frontend/src/app/App.tsx`：工作台品牌、顶部隐私提示、三步侧栏和状态文案。
- `frontend/src/components/InviteGate.tsx`：邀请入口的品牌文案和 CTA。
- `frontend/src/components/UploadPanel.tsx`：上传空状态、上传提示、上传按钮。
- `frontend/src/components/TaskProgress.tsx`：上传、分析、生成各状态的温和进度文案。
- `frontend/src/components/AnalysisPanel.tsx`：分析标题、目标选项、强度、保护清单、备注和生成 CTA。
- `frontend/src/components/MaskCanvas.tsx`：局部选区工具栏的中文操作文案。
- `frontend/src/components/ResultPanel.tsx`：结果标题、前后对比提示、候选版本和结果 CTA。
- `frontend/src/test/App.test.tsx`、`frontend/src/test/UploadPanel.test.tsx`、`frontend/src/test/ResultPanel.test.tsx`、`frontend/src/test/MaskCanvas.test.tsx`：同步用户可见名称，并增加品牌语气回归断言。
- `docs/superpowers/specs/2026-09-02-cos-retouch-cute-premium-design.md`：已确认的设计规格，不再扩大本次范围。

## Task 1: 更新品牌入口与工作台导航

**Files:**
- Modify: `frontend/src/app/App.tsx:137-200`
- Modify: `frontend/src/components/InviteGate.tsx:25-40`
- Test: `frontend/src/test/App.test.tsx`

- [ ] **Step 1: 写品牌语气回归测试**

在 `frontend/src/test/App.test.tsx` 的邀请入口测试中补充以下断言；如果测试已有同一入口断言，直接扩展该测试，不新建重复渲染：

```tsx
expect(screen.getByRole("heading", { name: "进入我的写真工作室" })).toBeVisible();
expect(screen.getByText("把喜欢的角色，好好留在照片里")).toBeVisible();
expect(screen.getByText("你的照片只用于本次修图")).toBeVisible();
expect(screen.getByRole("button", { name: "开始我的修图" })).toBeVisible();
```

- [ ] **Step 2: 运行入口测试，确认新断言先失败**

Run: `npm test -- --run frontend/src/test/App.test.tsx`  
Expected: FAIL，原因是当前入口仍显示“进入修图工作台”、旧英文眉标题或旧按钮名称。

- [ ] **Step 3: 修改入口和工作台导航文案**

在 `InviteGate.tsx` 使用以下固定文案：

```tsx
<p className="eyebrow">COS AI 角色写真</p>
<h1 id="invite-title">进入我的写真工作室</h1>
<p className="muted">输入邀请 token，开启一张照片的温柔修图。</p>
<button type="submit">开始我的修图</button>
```

在 `App.tsx` 使用以下固定文案：

```tsx
<p className="eyebrow">COS AI 角色写真</p>
<h1>把喜欢的角色，好好留在照片里</h1>
<span className="privacy-note">你的照片只用于本次修图</span>
<p className="eyebrow">修图小助手</p>
<li>上传照片</li>
<li>选择想变好的地方</li>
<li>生成预览</li>
<p className="aside-copy">每一步都由你确认，原图和角色感都会好好保留。</p>
```

步骤数字、动态状态 class、`aria` 结构和 token 提交逻辑保持不变。

- [ ] **Step 4: 运行入口测试确认通过**

Run: `npm test -- --run frontend/src/test/App.test.tsx`  
Expected: PASS，所有原有状态流测试和新增品牌文案断言通过。

- [ ] **Step 5: 提交入口文案改动**

```bash
git add frontend/src/app/App.tsx frontend/src/components/InviteGate.tsx frontend/src/test/App.test.tsx
git commit -m "feat: soften COS retouch workspace entry copy"
```

## Task 2: 更新上传区与任务进度语气

**Files:**
- Modify: `frontend/src/components/UploadPanel.tsx:214-246`
- Modify: `frontend/src/components/TaskProgress.tsx:14-55`
- Test: `frontend/src/test/UploadPanel.test.tsx`

- [ ] **Step 1: 为上传空状态增加可访问名称回归断言**

在 `frontend/src/test/UploadPanel.test.tsx` 新增一个独立测试，使用现有的最小 `apiClient` stub：

```tsx
it("uses the photo-studio upload language", () => {
  render(
    <UploadPanel
      inviteToken="invite-in-memory"
      apiClient={{
        createTask: vi.fn(), uploadOriginal: vi.fn(), startAnalysis: vi.fn(),
        getTask: vi.fn(), savePlan: vi.fn(), startGeneration: vi.fn(), getDownloadUrl: vi.fn(),
      }}
      onTaskUpdate={vi.fn()}
    />,
  );
  expect(screen.getByRole("heading", { name: "先放一张你喜欢的照片" })).toBeVisible();
  expect(screen.getByText("把 COS 照片放在这里")).toBeVisible();
  expect(screen.getByRole("button", { name: "开始看看哪里可以更好" })).toBeDisabled();
});
```

- [ ] **Step 2: 运行上传测试确认新断言先失败**

Run: `npm test -- --run frontend/src/test/UploadPanel.test.tsx`  
Expected: FAIL，原因是当前组件仍使用“上传原图”“选择一张 COS 原图”和“上传并开始分析”。

- [ ] **Step 3: 替换上传区文案但保留文件校验和状态逻辑**

把展示区改为：

```tsx
<p className="eyebrow">第一步 · 上传照片</p>
<h2 id="upload-title">先放一张你喜欢的照片</h2>
<span className="badge">JPG / PNG · ≤ 20MB</span>
<p className="muted">我们会保留你的脸、姿势和服装设计，只帮你把细节变得更好。</p>
<strong>把 COS 照片放在这里</strong>
<span className="muted">支持 JPG、PNG，最大 20MB</span>
```

按钮文案固定为：默认 `开始看看哪里可以更好`，忙碌时 `正在准备预览…`，可重试时 `再试一次`。保留原有 `disabled={!file || busy}`、上传函数、错误信息和 input 的 `aria-label`。

- [ ] **Step 4: 更新进度状态文案并保留失败语义**

在 `TaskProgress.tsx` 只替换正常状态的 `label`：

```tsx
created: { label: "准备你的修图", percent: 10 },
uploading: { label: "正在收好原图", percent: 30 },
analyzing: { label: "正在看看细节", percent: 58 },
awaiting_confirmation: { label: "可以开始挑选了", percent: 70 },
generating: { label: "正在生成预览", percent: 82 },
```

`failed`、`expired` 的错误标题、重试按钮和 `role="alert"` 继续保留，避免把错误状态包装成装饰文案。

- [ ] **Step 5: 运行上传测试并提交**

Run: `npm test -- --run frontend/src/test/UploadPanel.test.tsx`  
Expected: PASS。

```bash
git add frontend/src/components/UploadPanel.tsx frontend/src/components/TaskProgress.tsx frontend/src/test/UploadPanel.test.tsx
git commit -m "feat: make COS upload flow feel more welcoming"
```

## Task 3: 更新分析、目标选择与局部蒙版文案

**Files:**
- Modify: `frontend/src/components/AnalysisPanel.tsx:390-541`
- Modify: `frontend/src/components/MaskCanvas.tsx:283-312`
- Test: `frontend/src/test/App.test.tsx`
- Test: `frontend/src/test/MaskCanvas.test.tsx`

- [ ] **Step 1: 更新分析流程相关测试名称**

在 `App.test.tsx` 中把进入分析状态的查询从旧标题改为：

```tsx
await screen.findByRole("heading", { name: "看看哪里可以更好" });
```

把生成按钮查询改为：

```tsx
screen.getByRole("button", { name: "生成我的预览" });
```

保留开关的稳定语义 `面部处理开关`、开关状态断言、保存计划调用和生成调用断言，不用视觉文案替代表单语义。

- [ ] **Step 2: 运行分析相关测试确认旧名称失败**

Run: `npm test -- --run frontend/src/test/App.test.tsx frontend/src/test/MaskCanvas.test.tsx`  
Expected: FAIL，仅因新标题和按钮尚未进入组件。

- [ ] **Step 3: 替换分析面板的用户文案**

在 `AnalysisPanel.tsx` 使用：

```tsx
<p className="eyebrow">第二步 · 选择细节</p>
<h2 id="analysis-title">看看哪里可以更好</h2>
<span className="badge">由你确认 · 更安心</span>
<p className="muted">我们先给你几个温柔的建议，你可以自己决定要不要处理。</p>
<span className="control-label">想怎么变好看</span>
```

目标选项文字替换为 `自然变好看`、`修复小瑕疵`、`整理细节`；`处理强度` 改为 `修图力度`；`始终保护` 改为 `这些请一定保留`；补充说明 label 改为 `想补充什么吗？`；主按钮改为 `生成我的预览`，保存按钮改为 `保存这份选择`。目标的 value、plan 序列化、强度数字和保护字段保持不变。

- [ ] **Step 4: 替换蒙版工具栏文案并保持 aria 语义**

在 `MaskCanvas.tsx` 使用以下按钮文字：

```tsx
add: "画出要处理的地方"
erase: "擦掉多余区域"
undo: "撤回上一笔"
rangeLabel: "画笔大小"
```

继续使用 `aria-pressed`、`disabled` 和 `aria-label="局部蒙版画布"`，只修改显示文字；如果测试通过角色名称查找按钮，同步改为上述名称。

- [ ] **Step 5: 运行分析和蒙版测试并提交**

Run: `npm test -- --run frontend/src/test/App.test.tsx frontend/src/test/MaskCanvas.test.tsx`  
Expected: PASS。

```bash
git add frontend/src/components/AnalysisPanel.tsx frontend/src/components/MaskCanvas.tsx frontend/src/test/App.test.tsx frontend/src/test/MaskCanvas.test.tsx
git commit -m "feat: add friendly COS analysis language"
```

## Task 4: 更新结果区和候选图表达

**Files:**
- Modify: `frontend/src/components/ResultPanel.tsx:235-357`
- Test: `frontend/src/test/ResultPanel.test.tsx`

- [ ] **Step 1: 增加结果标题和前后对比文案断言**

在 `ResultPanel.test.tsx` 的首个渲染测试中增加：

```tsx
expect(screen.getByRole("heading", { name: "选一张最像你的" })).toBeVisible();
expect(screen.getByText("左右拖动，看看哪一张更接近你心里的角色。")).toBeVisible();
```

- [ ] **Step 2: 运行结果测试确认新断言先失败**

Run: `npm test -- --run frontend/src/test/ResultPanel.test.tsx`  
Expected: FAIL，原因是当前结果标题仍为“生成结果”。

- [ ] **Step 3: 替换结果区展示文案，不改变结果操作**

使用以下文案：

```tsx
<p className="eyebrow">第三步 · 挑选预览</p>
<h2 id="result-title">选一张最像你的</h2>
<span className="badge">原图永远保留</span>
<p className="muted">左右拖动，看看哪一张更接近你心里的角色。</p>
```

候选卡片标题由 `候选 1/2` 改为 `预览 1/2`，选择状态由 `待选择` 改为 `先看看`，已选状态仍为 `已保留`。保留 `保留此版本`、`恢复原图`、`重新生成`、`下载当前结果` 的按钮语义与 API 行为，避免破坏结果流程和现有测试。

- [ ] **Step 4: 运行结果测试并提交**

Run: `npm test -- --run frontend/src/test/ResultPanel.test.tsx`  
Expected: PASS。

```bash
git add frontend/src/components/ResultPanel.tsx frontend/src/test/ResultPanel.test.tsx
git commit -m "feat: make result review feel like choosing a favorite"
```

## Task 5: 将全局视觉换成奶油写真馆

**Files:**
- Modify: `frontend/src/styles.css:1-420`

- [ ] **Step 1: 替换全局视觉令牌**

将 `:root` 的主题令牌替换为以下值，并保持现有变量名，减少组件级改动：

```css
:root {
  color: #493d4a;
  background: #f8f2ee;
  color-scheme: light;
  font-family: "Noto Sans SC", "Microsoft YaHei", "Segoe UI", sans-serif;
  --canvas: #f8f2ee;
  --surface: rgba(255, 253, 250, .92);
  --surface-strong: #fffaf7;
  --surface-input: #fffdfb;
  --ink: #493d4a;
  --muted: #887787;
  --faint: #a797a4;
  --line: rgba(128, 91, 113, .16);
  --line-strong: rgba(128, 91, 113, .28);
  --accent: #b56b8e;
  --cyan: #c48aa5;
  --cyan-soft: rgba(196, 138, 165, .14);
  --violet-soft: rgba(181, 107, 142, .12);
  --success: #729f88;
  --warning: #b78358;
  --danger: #c66c78;
  --shadow: 0 22px 60px rgba(126, 83, 103, .14);
}
```

- [ ] **Step 2: 替换页面背景和基础层级**

将 `body` 改为暖色柔光背景，不再绘制科技网格：

```css
body {
  min-width: 320px;
  min-height: 100vh;
  margin: 0;
  background:
    radial-gradient(circle at 8% 0%, rgba(235, 192, 207, .46), transparent 28rem),
    radial-gradient(circle at 94% 16%, rgba(239, 211, 174, .32), transparent 25rem),
    linear-gradient(145deg, #fbf7f3 0%, #f8f0ef 52%, #f6f1eb 100%);
}
body::before { display: none; }
```

保留 `focus-visible`、`::selection`、响应式断点和减少动态效果规则；将选区颜色调整为莓果色，确保浅色背景上的焦点仍清晰。

- [ ] **Step 3: 重做容器、按钮和上传区域材质**

把 `.panel, .gate-card, .aside-card, .progress-card` 的共同样式调整为白色暖表面、`border-radius: 22px`、`box-shadow: var(--shadow)`；把 `.primary-button` 改为莓果紫到裸粉的柔和渐变，文字使用白色；`.secondary-button` 改为暖白底和莓果边框；`.file-drop` 改为暖白底、粉紫虚线边框和轻微内层光晕。

同时将 `.panel::before` 的科技蓝横线移除，改成小范围的 `linear-gradient(90deg, #d697ae, #e4bd9a, transparent)`，并把 `.eyebrow` 主色改为 `var(--accent)`；等宽字体只保留给文件名、版本号和任务技术信息。

- [ ] **Step 4: 重做画布、分析卡片和结果对比的强调色**

将 `.analysis-preview`、`.before-after-comparison` 和 `.mask-canvas` 从深色画布改为 `#eee7e4` 或 `#f4eeeb` 的暖灰画布；将 `.region-highlight`、`.comparison-divider` 和滑块的强调色替换为 `var(--accent)`，保持 1.5px 识别边框和拖动功能；卡片 hover 使用 `rgba(181, 107, 142, .08)`，避免荧光发光效果。

- [ ] **Step 5: 检查浅色对比度和移动端布局**

确保 `.muted`、`.faint`、`.badge`、`.error-text` 在浅色背景上仍有清晰对比度；移动端 390px 保持现有单列布局、按钮最小高度 43px、上传区和结果区不横向溢出。

- [ ] **Step 6: 运行前端完整单元测试和构建**

Run: `npm test -- --run`  
Expected: 所有 Vitest 测试 PASS。

Run: `npm run build`  
Expected: `tsc -b` 和 Vite production build PASS。

```bash
git add frontend/src/styles.css
git commit -m "feat: apply cream photo studio visual system"
```

## Task 6: 同步 Figma 主工作台并做视觉验收

**Files / external design:**
- Figma file: `https://www.figma.com/design/J6OGou9VsFow3tzFfTaV1j`
- Modify node: `1:3` (`COS AI Retouch / Workspace`)
- Main canvas node: `5:17` (`Canvas Panel / Original`)
- Controls rail node: `5:18` (`Controls Rail`)

- [ ] **Step 1: 将 Figma 主画板换成同一组设计令牌**

通过 `mcp__codex_apps__figma_use_figma` 更新现有节点，不另建重复画板：页面背景使用 `#F8F2EE`，卡片使用 `#FFFDFA`，主文字 `#493D4A`，辅助文字 `#887787`，主色 `#B56B8E`，辅助高光 `#E4BD9A`；圆角统一为 18–24px，阴影改为低饱和暖色柔影。

- [ ] **Step 2: 同步 Figma 文案和结构**

将顶部和侧栏改为：`COS AI 角色写真`、`把喜欢的角色，好好留在照片里`、`你的照片只用于本次修图`、`修图小助手`、`上传照片`、`选择想变好的地方`、`生成预览`；将目标、保护项和生成按钮同步为规格中的中文。

- [ ] **Step 3: 删除科技装饰并补充轻量写真装饰**

移除深色网格、HUD 横线和荧光青紫边框；保留照片主体、脸部识别框和安全提示；在画布和卡片空白区增加不超过 3 处柔光光晕或细丝带线，不能覆盖主体、选区或 CTA。

- [ ] **Step 4: 回读 Figma 结构和截图**

读取 `1:3` 的元数据，确认主画板尺寸和主要子节点仍存在；获取主画板截图，人工检查：浅色背景一致、正文可读、第三步完整显示、主按钮突出、无白色默认填充或内容裁切。

- [ ] **Step 5: 记录 Figma 与本地验收结果**

确认本地 `npm test -- --run` 和 `npm run build` 已通过；确认 Figma 截图和本地页面均满足桌面端与 390px 移动端的视觉方向。若 Figma MCP 仍返回 Starter 计划的调用限额错误，只报告“Figma 待额度恢复”，不得声称已同步完成。

## Task 7: 最终回归与交付

**Files:**
- Verify: `frontend/src/app/App.tsx`
- Verify: `frontend/src/components/InviteGate.tsx`
- Verify: `frontend/src/components/UploadPanel.tsx`
- Verify: `frontend/src/components/TaskProgress.tsx`
- Verify: `frontend/src/components/AnalysisPanel.tsx`
- Verify: `frontend/src/components/MaskCanvas.tsx`
- Verify: `frontend/src/components/ResultPanel.tsx`
- Verify: `frontend/src/styles.css`
- Verify: `docs/superpowers/specs/2026-09-02-cos-retouch-cute-premium-design.md`

- [ ] **Step 1: 运行完整前端回归**

Run: `npm test -- --run`  
Expected: 所有测试通过，且没有未处理的 React、TypeScript 或无障碍查询错误。

- [ ] **Step 2: 运行生产构建**

Run: `npm run build`  
Expected: TypeScript 编译和 Vite 构建均成功，`frontend/dist` 生成且不纳入 Git。

- [ ] **Step 3: 检查敏感信息和工作区**

Run: `rg -n --hidden -g '!frontend/node_modules/**' -g '!frontend/dist/**' 'sk-[A-Za-z0-9_-]{20,}' .`  
Expected: 无 API Key 命中。

Run: `git status --short`  
Expected: 只包含本次改版预期文件，或为空；不修改后端和部署密钥配置。

- [ ] **Step 4: 提交最终回归结果**

```bash
git log --oneline -8
git status --short
```

交付说明必须分别列出：本地前端测试结果、生产构建结果、Figma 是否完成同步、以及任何未完成的外部连接或视觉检查。

