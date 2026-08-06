# Reki Visual Annotation Lab

Reki 是面向 coser 的静态图片视觉标注工作台，使用银雾毛玻璃界面、红色信号标记和本地浏览器处理照片。

## 在线使用

- 公开网址：<https://reki-visual-lab.kunxin.chatgpt.site>
- GitHub 备用网址：<https://niuzipai-gif.github.io/reki-visual-lab/>
- GitHub：<https://github.com/niuzipai-gif>

打开网址后可以直接导入 JPG、PNG 或 WebP。图片、滤镜、AI 扫描和项目草稿默认只在当前浏览器本地处理与保存。

## Anitabi 圣地巡礼 Skill / アニメ聖地巡礼スキル / Anime Pilgrimage Skill

- **中文：** 查询动漫圣地、现实取景地、附近巡礼点、地图链接和对应截图；每个点严格按“地点 → Google 地图链接 → 对应图片”逐点发送。
- **日本語：** アニメの聖地・実在のロケ地・周辺スポット・地図リンク・対応する画像を検索します。各スポットは「場所 → Google マップリンク → 対応画像」の順に一件ずつ送信します。
- **English:** Find anime pilgrimage sites, real-world filming spots, nearby landmarks, map links, and matching screenshots. Deliver each point one at a time in the order: place → Google Maps link → matching image.

Skill 文件 / スキルファイル / Skill file：<skills/anitabi-pilgrimage/SKILL.md>

## 主要功能

- 点框、叠框、节点路径、单侧引线、全局节点、随机节点、轨道圆环和标签文字。
- 选中任意未锁定标记后，可直接拖动；选中框周围的八个红色控制点可自由调整大小。
- 图层可见性、锁定、复制、删除、置顶/置底和撤销/重做。
- 红色标注线、锚点和标签文字支持 Inspector 自定义。
- 底图滤镜、AI landmark 扫描、快速预设和完整图/透明效果层导出。
- 每个标记可做淡入、线条生长、呼吸、错位抖动、环绕或扫描动画；可在本机导出短视频、GIF 或“实况素材包”。视频优先使用 H.264 MP4，浏览器不支持时会如实导出 WebM；GIF 长边最多 640px。
- 任何红色标记都可直接“提取框内原图”：得到的矩形片段可以自由拖拽、八点缩放、单独设置透明度、局部效果与动效。原位置可选保留原图、透明挖空、黑底或白底；这不是主体抠图，不会自动给底图或片段套滤镜。
- AI 风格建议会先在浏览器本地提取图片特征，再通过同源 `/api/style-advice` 请求 MiniMax 文本建议；只返回编辑方案，不生成图片。
- “原图对比”会在编辑画布旁并排显示无效果的原始照片；不会清除标记、选择状态或编辑历史，也不会把效果、图层或动效带进原图侧。
- 用户提供的 Reki 角色 PNG 是品牌主资产；透明方形裁切版同时用于工作台左上角、首页、画布环境水印和 favicon。没有使用用户截图作为网站资产。

## 本地开发

```bash
npm install
npm run dev
```

演示工作台：<http://localhost:4173/?demo=1>

## 验证命令

```bash
npm test
npm run build
npm run test:sites
git diff --check
```

## 隐私说明

照片不会上传到 Reki 服务器。关键点扫描运行在浏览器 worker 中；风格建议请求只发送去标识化的尺寸、亮度、对比度、饱和度和主体提示摘要，不发送原图或像素数据。IndexedDB 只保存项目结构和必要的本地缩略图。清理浏览器站点数据会删除本机草稿。

“实况素材包”是 JPEG 封面图、短视频与说明文件组成的 ZIP。可导入美图秀秀等应用转换为 iPhone 实况照片，但它不是浏览器生成的原生 HEIC+MOV Live Photo。

### MiniMax 风格建议代理

Worker 通过官方 OpenAI-compatible 文本接口请求建议。部署时仅在 Worker secret 中配置 `MINIMAX_API_KEY`；可选配置 `MINIMAX_API_URL` 和 `MINIMAX_MODEL`（默认 `https://api.minimaxi.com/v1/chat/completions` 与 `MiniMax-M2.7`）。密钥不会进入浏览器代码、请求正文或日志。

## 备用网址与交接

GitHub Pages 会在每次推送 `main` 后自动更新，作为不依赖 Codex/Sites 账号的静态备用入口。它保留所有浏览器本地编辑与导出能力；AI 建议会自动改用本机离线推荐，密钥不会进入前端。完整迁移方式见 [部署与恢复说明](docs/deployment-recovery.md)。
