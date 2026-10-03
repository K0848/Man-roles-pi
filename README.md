# 向古人问惑 · Pi Agent

这是「向古人问惑」迁移到 Pi Agent 运行架构后的可复现代码基线。当前仓库提供 Agent 执行、工具调用、结构化回合、Session 持久化和最小 Remote/UI 接口，仍处于 P7 真实入口与质量验收阶段。

## 当前范围

- 单人物和多人物 Session 隔离
- 共享状态投影
- 取消、有限重试、请求预算和无进展控制
- SQLite Session backend 与删除 checkpoint
- 最小 Remote/UI HTTP 页面和 conversation API
- Provider catalog、Codex OAuth 发现和代理感知 SSE 传输

当前页面是最小入口，不是完整三栏产品 UI；五个真实 H3 困惑、完整浏览器刷新读回和 P8 交付回退仍未完成。

## 环境

- Node.js `>=22.19.0`
- pnpm

```powershell
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test -- --reporter=dot
```

## 目录

- `src/`：运行时代码
- `tests/`：P1–P7 的限定验证和真实 Provider/Remote smoke 入口
- `package.json`、`pnpm-lock.yaml`：依赖和脚本
- `tsconfig.json`：TypeScript 配置

真实 Provider 命令需要显式设置 `PI_RUN_REAL=1`，并使用本机已有的 Provider 凭据；凭据、用户数据和运行日志不应写入仓库。

## 当前限制

本仓库的测试可以验证流程、状态和接线，但不能替代真实人物质量、跨进程恢复、浏览器交互、延迟、Token 和成本验收。正式人物资料、产品台账和内部质量证据保留在本地研发工作树中，不随公共代码发布。
