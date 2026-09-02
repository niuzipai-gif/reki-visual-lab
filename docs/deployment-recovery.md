# Reki 部署与恢复说明

## 两个独立入口

- 主站：`https://reki-visual-lab.kunxin.chatgpt.site`
- GitHub 备用站：`https://niuzipai-gif.github.io/reki-visual-lab/`

GitHub 仓库 `niuzipai-gif/reki-visual-lab` 是源代码的长期备份。每次推送到 `main`，GitHub Actions 会自动重建并更新备用站；它不依赖 Codex/Sites 账号。

## 备用站可用范围

图片导入、所有标记、拖拽缩放、图层、底图效果、切片提取、动画预览、图片/GIF/视频导出和本地草稿都在浏览器本地运行，备用站可以完整使用。

备用站的 AI 风格建议会直接启用本机离线推荐，不会尝试访问或暴露任何 MiniMax 密钥。若要在备用站恢复云端 AI 建议，需要另外在你自己拥有的 Worker、Vercel 或 Cloudflare 账号中部署 `worker/index.js`，并只在该服务的 Secret 设置中填写 `MINIMAX_API_KEY`；绝不能把密钥写进 GitHub、网页或前端环境变量。

## 交接和恢复

1. 至少让两个可信任的 GitHub 管理员拥有这个仓库的 Admin 权限，并在他们的账号上启用双重验证。
2. 保留仓库地址、主站和备用站地址；即使主站被删除，直接打开 GitHub 备用站即可继续编辑。
3. 若需要迁移完整主站，在任意自己控制的静态托管 + Worker 平台部署此仓库，设置服务端 Secret 后将自己的域名指向新站。
4. 需要彻底摆脱任何单一平台时，购买并由公司控制一个域名；以后把该域名指向新的托管商即可，不必更改用户分享出去的网址。
