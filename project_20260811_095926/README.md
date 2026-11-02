# 政企销售 AI 竞标实训游戏

## 2026-10-30 工作交接

完整说明和日常操作请读 [交接与操作手册](docs/handover/README.md)，数据迁移请读 [恢复手册](docs/handover/DATA_RESTORE.md)，本次数据/验证范围请读 [交接核验记录](docs/handover/DELIVERY_REPORT.md)。页面/API清单、架构、配置、已知问题和故障排查均在同目录。

## Windows 一键启动

双击项目根目录的 `start-project.bat`。脚本会检查环境与构建产物、启动 `http://127.0.0.1:5000/` 并自动打开浏览器。运行期间不要关闭命令行窗口；按 `Ctrl+C` 或关闭窗口即可停止服务。

首次使用仍需先完成 `projects/.env.local` 配置并安装依赖。正常重启电脑后无需再次安装或配置，直接双击脚本即可。

本目录是项目治理与版本管理根目录。现有 Next.js 工程保留在 `projects/`，外层 `harness/` 用于管理目标、项目上下文、长期记忆、迭代计划和开发循环。

## 入口

接手项目或开始一次新工作前，按顺序阅读：

1. `PROJECT.md`
2. `harness/STATE.md`
3. `harness/plans/CURRENT_ITERATION.md`
4. `harness/memory/DECISIONS.md`
5. `harness/context/PROJECT_CONTEXT.md`

## 目录

```text
project_20260811_095926/
├── AGENTS.md                    # Agent/开发协作规则
├── PROJECT.md                   # 项目章程与目标边界
├── harness/
│   ├── STATE.md                 # 当前状态和下一道门
│   ├── context/                 # 稳定项目上下文
│   ├── memory/                  # 决策、发现与交接记忆
│   ├── plans/                   # 当前迭代与候选 backlog
│   └── loops/                   # 开发和验证循环
├── scripts/harness-check.ps1    # 治理结构检查
└── projects/                    # 现有 Next.js 工程
```

业务素材原件位于外部目录 `D:\WeiXun\竞标游戏项目相关\整理`，不复制进当前 Git 仓库。采用哪个版本由 `harness/context/SOURCE_OF_TRUTH.md` 记录。
