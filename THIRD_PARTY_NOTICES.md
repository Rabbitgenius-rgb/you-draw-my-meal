# 第三方依赖许可

本项目原创源码采用 MIT，第三方依赖继续使用各自的许可证。

锁定清单：[third-party/dependencies.json](third-party/dependencies.json)。其中包含每个包的名称、版本、许可证、生产/开发属性、来源地址、完整性摘要以及随包许可文本路径。依据 `package-lock.json` 和当前安装包的实际许可文件逐项整理，共 **96 个依赖包**：MIT 85、Apache-2.0 1、BSD-3-Clause 2、ISC 7、BSD-2-Clause 1。

| 直接依赖 | 许可证 | 用途 |
| --- | --- | --- |
| @modelcontextprotocol/sdk 1.32.1 | MIT | MCP 客户端与协议测试 |
| zod 4.6.5 | MIT | MCP SDK schema 依赖及项目声明 |
| fake-indexeddb 6.2.5 | Apache-2.0 | 仅用于本机数据仓库测试 |

完整许可文本在 `third-party/licenses/`。本项目未把 `node_modules/` 打入公开包；安装时 npm 同时提供各依赖的原始许可文件。升级依赖后应重新核对版本、许可文本及完整性，不能把本次清单当作未来版本的许可证明。

界面使用系统字体，没有打包字体文件；图标为项目代码内联路径，没有使用额外图标字体或外部图片库。本说明是实际分发文件的来源与许可记录，不代表对任何未知第三方权利作出保证。
