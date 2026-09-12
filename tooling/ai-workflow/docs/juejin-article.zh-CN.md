# 让 AI 写代码，也让它按流程把事情做完：Local AI Workflow

很多 AI 编程工具都能生成代码，但真正让人不放心的，往往是代码之外的部分：需求有没有理解错，改了哪些文件，测试是否真的跑过，任务中断后能不能接着做。

Local AI Workflow 是一个本地工作流引擎。它不替你选择模型，也不把开发过程变成一套复杂的评分表。它做的是给 AI Agent 加一层可恢复的流程约束：先登记任务，再规划、实现、验证，最后根据明确授权决定是否创建本地提交。

## 它解决什么问题

安装到项目后，开发者通常不需要手动输入一串 `workflow` 命令。你可以在 Claude Code 或其他会读取 `AGENTS.md` 的 AI 编程工具中直接描述任务，Agent 会按照仓库规则调用工作流。

```bash
./install.sh /path/to/your-repository --apply
cd /path/to/your-repository
# 在 AI 编程工具中描述任务
```

安装器会写入工作流引擎、`.workflow/config.yaml`、`AGENTS.md`，并在需要时合并 Claude Hook。它会根据项目清单识别 Node、Python、Rust、Go、Flutter、Gradle 和 Maven 等技术栈，生成对应的验证命令。

## 工作流怎么运行

一次 Run 默认经过下面这些阶段：

```text
intake → planning → implementation → verification → sediment → complete
```

任务涉及 API、数据、鉴权、安全或公开行为变化时，会增加 OpenSpec 契约阶段。需要多轮自动修正时，只有同时满足迭代信号、自动验证和风险条件，才会进入有限循环。

每个阶段的完成都需要结构化证据。测试结果、源码复核、上下文选择和沉淀记录会写入本地事件；模型说“应该没问题”不能代替这些证据。

## 为什么选择本地事件和 DAG

工作流节点由 DAG 表达依赖，状态机负责推进顺序。JSON Event Store 追加记录状态迁移，Lease 和 Heartbeat 处理进程中断，Commit Journal 用于提交后的对账。这样做的目标很实际：任务停了可以恢复，出了问题可以回看，提交范围可以核对。

本地索引只负责缩小搜索范围，不连接向量数据库，也不替代 `rg`、源码阅读和测试。默认情况下，工作流不会 push、创建 PR、发布版本或写入生产环境。

## 直接使用 CLI

CLI 是给脚本、调试和不会读取仓库规则的 Agent 使用的底层接口：

```bash
workflow start \
  --task-id login-page \
  --request "update the login page" \
  --changed-file src/pages/LoginPage.vue

workflow status
workflow explain
workflow timeline
```

只有用户明确要求本地提交时，才在 `start` 中加入 `--commit`；真正执行提交还需要 `workflow commit --yes`。工作流只操作 Run 拥有的精确路径，不会把其他暂存改动混入提交。

## 安装和开发

项目要求 Node.js 20.19 或更高版本，推荐使用 pnpm：

```bash
git clone https://github.com/Eysion/local-ai-workflow.git
cd local-ai-workflow
pnpm install
pnpm test
```

当前仓库测试套件包含 150 个测试，覆盖状态机、DAG、事件存储、安装器、Git 适配器、Shadow Mode 和提交对账。

## 项目边界

这是一个帮助 AI Agent 更稳定地完成开发任务的本地工具，不是自动发布平台，也不会替你判断业务架构或安全策略。安装器只提供基础探测；项目自己的业务规则、验证命令和敏感操作边界仍由维护者负责。

项目采用 PolyForm Noncommercial 1.0.0，仅允许非商业用途。觉得项目有用，可以在仓库 README 中扫码支持维护。

项目地址：[github.com/Eysion/local-ai-workflow](https://github.com/Eysion/local-ai-workflow)
