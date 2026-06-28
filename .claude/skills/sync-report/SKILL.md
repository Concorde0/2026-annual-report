---
name: sync-report
description: 从飞书多维表格拉取寄语+图片，注入到 main.html，准备部署。
---

1. 运行 `node fetch-feishu.js` — 从飞书多维表格拉取寄语、下载照片
2. 运行 `node inject-to-html.js` — 将数据注入到 main.html
3. 告知用户：数据已更新，可以 `git add . && git commit && git push` 部署
