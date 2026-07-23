<p align="center">
  <img src="assets/brand/potato-box-mark.svg" width="112" height="112" alt="potato box 标志">
</p>

<h1 align="center">potato box</h1>

<p align="center"><strong>将资料转化为可检查知识库的本地优先 AI 工作空间。</strong></p>

<p align="center">
  <a href="https://github.com/potatohoney-p/potato_wiki_box/actions/workflows/ci.yml"><img alt="CI 状态" src="https://github.com/potatohoney-p/potato_wiki_box/actions/workflows/ci.yml/badge.svg?branch=main"></a>
</p>

<p align="center"><a href="README.md">English</a> | <a href="README_KO.md">한국어</a> | 中文 | <a href="README_JA.md">日本語</a></p>

<p align="center">
  <img src="assets/readme/potato-box-cover.jpg" alt="连接文档与知识节点的模块化 potato box">
</p>

potato box 导入文档，生成结构化 Markdown 页面，维护链接与来源，并提供搜索、审核、健康检查、备份和恢复。项目本身是普通文件夹，可直接用于 Git、Obsidian 和其他 Markdown 工具。

![potato box 知识图谱](assets/readme/workspace-graph.png)

## 主要能力

- 持久化导入队列、崩溃恢复、增量缓存和源文件夹监视
- PDF/Office 文本与图片提取，可选视觉模型图片说明
- Markdown、YAML frontmatter、wikilink 和来源追踪
- 关键词、知识图谱和可选 LanceDB 向量检索
- Deep Research、人工 Review、Lint 和 Knowledge Health
- 项目 ZIP 备份、安全恢复到新目录、脱敏诊断导出
- 强制令牌认证的 localhost API、MCP Server 和浏览器剪藏器

![potato box 知识工作流](assets/readme/knowledge-loop.svg)

## 开始开发

需要 Node.js 22+、Rust stable、`protoc`，以及对应平台的 [Tauri 2 前置依赖](https://v2.tauri.app/start/prerequisites/)。

```bash
npm ci
npm run tauri dev
```

生产构建：

```bash
npm run build
npm run tauri build
```

## 安全模型

本地 API 仅监听 `127.0.0.1`，但仍强制要求 `X-Potato-Box-Token` 或 Bearer token。公开项目 ID 是 UUID，唯一别名是 `current`；文件系统路径不能作为 API 项目 ID。Tauri asset protocol 仅在项目打开后允许访问该项目目录。

## 文档

- [Architecture](docs/ARCHITECTURE.md)
- [Local API reference](docs/API.md)
- [Threat model](docs/THREAT_MODEL.md)
- [Privacy](docs/PRIVACY.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)

## 许可证与来源

potato box 采用 GNU GPL v3.0。完整条款见 [LICENSE](LICENSE)，必须保留的来源与第三方说明见 [NOTICE](NOTICE)。
