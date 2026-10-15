# 提交前清单

2026 年 10 月 15 日只读核对[官方完整规则](https://github.com/M-China/mcd-developer-innovation-challenge/blob/main/activityGuidelines.md)。截止时间为北京时间 **2026 年 10 月 25 日 23:59**；仓库创建时间要求为 2025 年 12 月 25 日 00:00 至该截止时间。网页应用属于规则中的软件项目形式，必须真实使用麦当劳 MCP。

## 本地候选材料

- [x] README：项目介绍、安装、使用示例、目标用户与能力边界。
- [x] CONTEST_DECLARATION.md：按官方原文提供，未替报名者签署或提交。
- [x] MCP_INTEGRATION.md：Server、工具、参数、实际调用流程与价值。
- [x] mcp-config.example.json：Bearer 值仅为环境变量占位符。
- [x] 可运行 Web 源码及锁文件，无本机凭证、私人备份或实际菜单缓存。
- [x] MIT 源码许可证、第三方依赖许可文本与素材授权范围。
- [x] 主动导入的独立私密示例；霸保留原笔迹，其他两幅新原创。
- [x] [报名正文草稿](ISSUE_DRAFT.txt)、[演示脚本](DEMO_SCRIPT.md)、[录屏清单](RECORDING_CHECKLIST.md)。
- [ ] 演示视频实际录制完成。当前只有脚本，视频非当前规则列明的必交文件。

实际测试、冷启动、素材与敏感信息检查结果见[候选审查记录](PUBLIC_RELEASE_REVIEW.md)。准备材料不等于全面安全保证、第三方审核或报名成功。

## 发布和报名步骤

实际进展见[参赛进度](SUBMISSION_STATUS.md)。以下保留提交时的检查步骤。

1. 只上传本候选目录中的文件；不从原工作目录执行“添加全部”。复查文件清单及哈希，保留 MIT、NOTICE 和第三方声明。
2. 以你自己的个人 GitHub 账户创建 Public 仓库，并保持公开可访问。项目地址必须是实际仓库 URL，本机端口不是报名地址。
3. 按 README 安装运行，截图和可选演示视频不得出现凭证、私人记录或其他任务窗口。
4. 阅读并确认官方声明内容及活动条款；将 ISSUE_DRAFT.txt 的 `PUBLIC_REPOSITORY_URL` 替换为实际地址，字段和内容在同一行，链接不包 Markdown。
5. 到[官方 Issue 入口](https://github.com/M-China/mcd-developer-innovation-challenge/issues/new)按模板提交，等待系统成功回复；失败时按说明修正后重提。

建议标题：`你画我点：把今天的餐品画成一张餐纸`。使用 Codex，不提交 workbuddy.md、不申报 WorkBuddy 专项奖励。没有小程序上线或公网部署要求；当前不执行这些步骤。排名依官方规则的公开 Star 数据，不保证获奖。
