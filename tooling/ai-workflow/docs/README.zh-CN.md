# Local AI Workflow（中文说明）

这是一个运行在本地的 AI 编码工作流引擎。它把一次开发任务拆成可恢复、可审计的步骤，并要求用测试、源码复核和结构化事件证明每次关键迁移。

## 使用

正常用法是让 AI Agent 驱动工作流：先把工作流安装到目标仓库，再用 Claude Code 或其他会读取 `AGENTS.md` 的 AI 编程工具打开该仓库，直接用自然语言描述任务。安装器生成的 `AGENTS.md` 和可选 Claude Hook 会提示 Agent 何时检查状态、创建 Run、收集证据和验证改动。

```bash
./install.sh /absolute/path/to/your-repository --apply
cd /absolute/path/to/your-repository
# 在这里启动 AI 编程工具，然后描述任务
```

对于脚本、调试或不会读取仓库规则的 Agent，也可以直接调用底层 CLI：

```bash
workflow start \
  --task-id example-task \
  --request "update the login page" \
  --changed-file src/pages/LoginPage.vue

workflow status
workflow explain
workflow timeline
```

`start` 会创建一个本地 Run，之后按规划、实现、验证推进；只有明确请求时才会进入本地提交流程。开发者通常只需给 AI Agent 提示词，直接 CLI 属于高级用法。运行 `workflow --help` 可查看上下文索引、沉淀、Shadow Mode 和恢复命令。

## 设计原理

### 有限状态机管理生命周期

Run 默认沿着 `intake → context-review → planning → implementation → verification → sediment → complete` 推进。`context-review` 要求记录已阅读的仓库指导、带行号及用途的源码引用和可执行验证命令；它确保计划前已有可复核上下文。契约检查、有限循环和本地提交分支只在对应信号出现时加入。节点必须满足前置依赖和证据门槛才能继续。

### DAG 表达依赖

工作流节点用有向无环图描述。DAG 把执行顺序与模型解耦，允许按任务需要插入 `openspec-contract`、`loop-execution` 和质量评估，同时保持确定性。

### 证据优先

模型自述不能代替证据。事件、测试结果、源码复核、沉淀记录和质量评估共同决定状态迁移。默认状态输出只显示摘要，完整 evidence 保存在本地 Run Event。

### 可恢复和最小副作用

JSON Event Store 追加事件；Lease/Heartbeat 处理进程中断；Commit Journal 用于提交后对账。提交需要 Start 时的 `--commit` 和执行时的 `commit --yes` 两次明确授权。工作流不执行 push、PR、发布或生产写入。

### 清晰的仓库边界

安装器支持单仓和父级 Workspace。它只写目标父级，不修改子仓库，不隐式删除旧入口；`tooling/ai-workflow/` 是唯一分发源。

## 实现原理

- **CLI**：`cli/workflow.mjs` 解析命令，调用 `src/` 用例；npm/pnpm 安装后通过 `workflow` 二进制运行。
- **策略**：`planning-policy`、`quality-policy` 和 `evidence-routing-policy` 将任务信号转换为可测试决策，不依赖旧评分、权重或 ceremony tier。
- **执行**：`node-state-machine`、`workflow-graph` 和 runner 计算节点状态并写入事件。
- **证据**：`json-event-store` 保存不可变事件；`context-index` 提供本地文本索引，但最终仍需 `rg`、源码阅读和验证。
- **仓库适配**：Git/Sediment adapter、单 Writer 锁、精确暂存和 Commit Journal 限制写入范围并支持恢复。
- **安装探测**：`scripts/install.mjs` 读取项目清单，识别 Node、Python、Rust、Go、Flutter、Gradle、Maven 等技术栈，生成 `.workflow/config.yaml` 和验证命令；未知项目退回 `git diff --check`。

## 状态流程

```text
intake → context-review
  → [openspec-contract]
  → planning → implementation
  → [loop-execution]
  → verification → sediment
  → [atomic-commit-plan → shadow-decision → commit]
  → complete
```

## 常用命令

```bash
workflow start --task-id task-id --request "request summary" --changed-file src/example.ts
workflow status [--verbose]
workflow explain
workflow timeline
workflow resume
workflow index
workflow search --query "payment token" --limit 10
```

## 目录约定

`.workflow/config.yaml` 保存项目配置；`.workflow/state/` 保存 Run、Lease、Shadow 报告和 Commit Journal，默认被 Git 忽略。

## 许可证

项目采用 PolyForm Noncommercial 1.0.0，仅允许非商业用途。销售、付费服务、广告投放以及用于商业产品或商业工作流均不允许。完整条款见仓库根目录的 [LICENSE](../LICENSE)。
