# Reki Visual Annotation Lab

Reki 是面向 coser 的静态图片视觉标注工作台，使用银雾毛玻璃界面、红色信号标记和本地浏览器处理照片。

## 在线使用

- 公开网址：<https://reki-visual-lab.kunxin.chatgpt.site>
- GitHub：<https://github.com/niuzipai-gif>

打开网址后可以直接导入 JPG、PNG 或 WebP。图片、滤镜、AI 扫描和项目草稿默认只在当前浏览器本地处理与保存。

## 主要功能

- 点框、叠框、节点路径、单侧引线、全局节点、随机节点、轨道圆环和标签文字。
- 选中任意未锁定标记后，可直接拖动；选中框周围的八个红色控制点可自由调整大小。
- 图层可见性、锁定、复制、删除、置顶/置底和撤销/重做。
- 红色标注线、锚点和标签文字支持 Inspector 自定义。
- 底图滤镜、AI landmark 扫描、快速预设和完整图/透明效果层导出。
- “原图对比”只切换底图源，不会清除标记、选择状态或编辑历史。
- 重新绘制的 Reki 手绘种子标记同时用于工作台左上角、首页和 favicon；没有使用用户截图作为网站资产。

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

照片不会上传到 Reki 服务器。AI 扫描运行在浏览器 worker 中；IndexedDB 只保存项目结构和必要的本地缩略图。清理浏览器站点数据会删除本机草稿。
