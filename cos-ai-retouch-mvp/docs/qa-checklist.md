# COS AI Retouch MVP：20 图人工 QA 表

本表用于最终产品人工验收。表格中的结果栏故意留空；在实际执行前不得
预填、猜填或把自动化测试结果当作图像质量结果。

## 测试前置

1. 准备 20 张不同的、已获使用授权的 COS 原图；每张原图只创建一个任务，
   不用同一照片的裁切、变体或重复上传来凑数。样本固定覆盖半身、全身、
   假发、铠甲/复杂服装、室内、室外和夜景，并尽量让脸、姿势、手部、服装、
   背景线条、光线和噪点都可观察。若某一字段确实不可观察，记录为
   `review`，并在 `review notes` 说明原因。
2. 执行前记录：测试日期、评审人、代码提交、浏览器、前后端运行方式、
   `IMAGE_PROVIDER_MODE`、外部模型/端点（如使用）以及图片集版本。每行
   还要记录对应 `task_id/version_id`。
3. 每张图均走完整 MVP 流程：邀请验证 → 上传单张 JPG/PNG → 查看分析卡 →
   确认目标、强度和局部区域 → 提交生成 → 查看候选结果与验证状态 →
   对比原图并确认原图仍可恢复。结构修复只能使用确认过的局部区域和蒙版。
4. 图像质量评审必须使用实际配置的外部模型/端点。`IMAGE_PROVIDER_MODE=mock`
   只能验证流程和契约；使用 mock 时不得将以下五项填写为图像质量
   `pass`。
5. 每张结果至少在适配视图和 100% 放大下比较；脸、手、服装连接处和细小
   背景线条需要额外放大检查。候选失败、无法加载、验证状态缺失或无法与
   原图比较时，整体直接记为 `review`。

## 通过门槛

- **单图通过：** `face identity`、`pose/composition`、`hands/costume`、
  `background geometry`、`lighting/noise` 五项均为 `pass`；原图可恢复；
  候选带有可见的验证状态；没有未解决的质量风险。
- **单图 review：** 任一项为 `review`、结果不可评估、使用 mock 评估质量、
  或评审人无法确定是否保持原貌。必须在 `review notes` 写明问题和决定，
  不可用空白、`N/A` 或“看起来可以”替代。
- **20 图套件通过：** 20 行全部实际执行并完成记录，且 20/20 行达到单图
  通过；任一未执行或未解决的 `review` 都阻断本次视觉验收，直到重新生成、
  复核并留下新的候选版本记录。

## 记录规则

- 五个质量字段只写 `pass` 或 `review`，`pass/review` 是待选择提示，不是
  已通过的结果。`pass/review` 列填写该行最终结论。
- `review notes` 需要包含可复核的现象（位置、对象、变化和严重程度），
  以及 `keep / regenerate / reject` 决定。重生成不能覆盖旧结论；在备注中
  追加新的 `version_id` 和复核结果。
- 评审以原图为基准，不因修图“更好看”而放宽身份、构图、局部区域或背景
  几何约束。任何超出确认区域的变化，都至少将对应项记为 `review`。
- 本表只记录人工观察结果，不替代自动化测试、部署 smoke 或模型服务的
  可用性证明；没有实际执行的内容保持空白并在提交前标为 `review`。

## 20 图执行表

| # | case（构图 / 服装 / 场景） | 建议验证动作 | source image / task_id / version_id | face identity | pose/composition | hands/costume | background geometry | lighting/noise | review notes | pass/review |
|---:|---|---|---|---|---|---|---|---|---|---|
| 01 | 半身 / 普通服装 / 室内窗光 | 自然轻修：脸部与皮肤；检查窗框线条 |  | pass / review | pass / review | pass / review | pass / review | pass / review |  | pass / review |
| 02 | 半身 / 复杂分层服装 / 室内混合光 | 自然轻修 + 局部服装连接修复 |  | pass / review | pass / review | pass / review | pass / review | pass / review |  | pass / review |
| 03 | 半身 / 假发 / 室外日光 | 头发边缘与脸部自然轻修；检查发丝遮挡 |  | pass / review | pass / review | pass / review | pass / review | pass / review |  | pass / review |
| 04 | 半身 / 假发与手部配件 / 室外逆光 | 局部手部结构修复 + 假发边缘检查 |  | pass / review | pass / review | pass / review | pass / review | pass / review |  | pass / review |
| 05 | 半身 / 假发 / 夜景霓虹 | 自然轻修；检查霓虹色污染、脸部身份和噪声 |  | pass / review | pass / review | pass / review | pass / review | pass / review |  | pass / review |
| 06 | 半身 / 铠甲或头盔 / 室内硬光 | 铠甲连接处局部结构修复；检查金属高光 |  | pass / review | pass / review | pass / review | pass / review | pass / review |  | pass / review |
| 07 | 半身 / 复杂分层服装 / 室外阴天 | 服装细节自然轻修 + 局部姿势连接检查 |  | pass / review | pass / review | pass / review | pass / review | pass / review |  | pass / review |
| 08 | 半身 / 复杂服装 / 室内图案背景 | 自然轻修；检查重复图案、墙线和服装边界 |  | pass / review | pass / review | pass / review | pass / review | pass / review |  | pass / review |
| 09 | 半身 / 铠甲或金属配件 / 夜景低照度 | 局部结构修复；检查暗部细节、噪声和金属纹理 |  | pass / review | pass / review | pass / review | pass / review | pass / review |  | pass / review |
| 10 | 半身 / 假发与复杂服装 / 室外高反差或雨后 | 自然轻修 + 手部/衣摆局部检查 |  | pass / review | pass / review | pass / review | pass / review | pass / review |  | pass / review |
| 11 | 全身 / 长裙或复杂服装 / 室内坐姿 | 局部姿势或服装连接修复；检查坐姿比例 |  | pass / review | pass / review | pass / review | pass / review | pass / review |  | pass / review |
| 12 | 全身 / 铠甲 / 室内舞台聚光 | 局部结构修复；检查铠甲分片、手脚和聚光方向 |  | pass / review | pass / review | pass / review | pass / review | pass / review |  | pass / review |
| 13 | 全身 / 飘逸或长款复杂服装 / 室外日光 | 自然轻修；检查衣摆、身体比例和地面关系 |  | pass / review | pass / review | pass / review | pass / review | pass / review |  | pass / review |
| 14 | 全身 / 假发与手持道具 / 室外逆光 | 局部手部/道具连接修复；检查逆光轮廓 |  | pass / review | pass / review | pass / review | pass / review | pass / review |  | pass / review |
| 15 | 全身 / 复杂服装 / 室外建筑或人群背景 | 自然轻修 + 局部姿势修复；检查背景透视和人群边缘 |  | pass / review | pass / review | pass / review | pass / review | pass / review |  | pass / review |
| 16 | 全身 / 假发 / 夜景街灯 | 自然轻修；检查发丝、肤色、灯光方向和暗部噪声 |  | pass / review | pass / review | pass / review | pass / review | pass / review |  | pass / review |
| 17 | 全身 / 铠甲或复杂服装 / 夜景彩灯 | 局部结构修复；检查彩灯反射、铠甲边缘和手脚 |  | pass / review | pass / review | pass / review | pass / review | pass / review |  | pass / review |
| 18 | 全身 / 复杂服装 / 室内镜面或重复线条 | 自然轻修；检查镜面、门框/地砖线条和构图比例 |  | pass / review | pass / review | pass / review | pass / review | pass / review |  | pass / review |
| 19 | 全身 / 铠甲与手持道具 / 室外阴天 | 局部手部、道具或姿势连接修复 |  | pass / review | pass / review | pass / review | pass / review | pass / review |  | pass / review |
| 20 | 全身 / 假发与长款服装 / 夜景逆光或雾气 | 自然轻修 + 局部结构修复；检查轮廓、衣摆和噪声一致性 |  | pass / review | pass / review | pass / review | pass / review | pass / review |  | pass / review |

## 执行汇总

- 测试日期：
- 评审人：
- 代码提交：
- 前端 / 后端版本：
- 浏览器：
- Provider mode：
- 外部模型 / 端点（如适用）：
- 图片集版本或来源记录：
- 20 图最终通过数：`____ / 20`
- 未解决 review 数：`____`
- 最终结论：`pass / review`
- 评审签名或确认：
