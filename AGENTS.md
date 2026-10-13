# KingdomRise 开发约定

## 按需读取

- 修改核心规则、运行时数据流或测试策略前，读取 `docs/architecture.md`。
- 新增模块、跨目录依赖，或扩展 NPC、资源、建筑、战斗、经营系统前，读取 `docs/module-boundaries.md`。
- 记录或调整难以逆转的架构选择前，读取 `docs/decisions/README.md`。

## 稳定约束

- 运行时依赖方向保持为 `main → presentation → core`；`core` 不导入 Phaser、DOM 或表现层模块。
- 游戏规则、状态转换和不变量属于 `core`；`presentation` 负责输入翻译、呈现和运行时装配。
- `GameScene` 是现有集成壳。新业务规则进入核心模块，现有场景职责本次不追溯重构。
- 优先设计小 interface、深 module；只在真实存在多种实现或测试替身时增加 seam 和 adapter。
- 保持固定步长模拟。改变 Tick 顺序、时间语义或确定性属于重大调整。

## 证据优先

- 文档与实现不一致时，先核对代码、测试和设计意图；不得按旧文档直接修改实现。
- 能从代码确认的内容记录为现状；仅见于路线图的内容标为规划；无法确认的内容标为待确认。
- `docs/王国崛起_V0.1当前开发总结.md` 是带日期的历史快照，不作为当前实现的唯一依据。

## 修改权限

- 可直接完成：不改变公共 interface、状态所有权或跨模块依赖的局部实现、修复、测试和文档同步。
- 先提交影响分析并等待确认：公共 interface、ECS 数据模型、状态所有权、坐标/占地/寻路语义、模拟顺序、跨模块依赖、新运行时依赖、存档/网络格式或重大架构调整。
- 影响分析至少说明受影响模块、interface 或数据变化、兼容风险、验证范围和文档更新。
- 保留工作区中不属于当前任务的改动；不覆盖、不暂存、不回退用户内容。

## 注释

- 核心公共 interface 优先使用简体中文 JSDoc，说明用途、关键不变量、参数约束和失败语义；类型已充分表达的信息无需复述。
- 复杂算法注释解释设计原因、边界条件和非显然取舍，放在相关逻辑旁。
- 使用简体中文；保持注释随实现同步，避免逐行翻译代码或描述显而易见的操作。

## 验证与同步

- 先运行受影响测试；核心或跨模块变更再运行 `npm test` 和 `npm run typecheck`。
- 入口、构建配置或生产依赖变化运行 `npm run build`；Phaser/DOM 交互变化记录必要的手工验证。
- 实际架构或数据流变化同步 `docs/architecture.md`；职责、依赖或扩展方式变化同步 `docs/module-boundaries.md`。
- 只有满足 `docs/decisions/README.md` 门槛的选择才新增决策记录。

## 全局 Skill 路由

- 故障或性能退化：`diagnosing-bugs`；测试先行或集成测试：`tdd`；代码审查：`code-review`。
- module/interface/seam 设计：`codebase-design`；领域术语或决策记录：`domain-modeling`。
- 编码、修复和重构：`ponytail`；合并冲突：`resolving-merge-conflicts`；修改本文件：`writing-for-agents`。
- 使用已安装 Skill 的原始说明，不在仓库内复制或重建同类 Skill。
