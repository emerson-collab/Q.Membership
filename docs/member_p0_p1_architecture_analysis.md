# member 业务与 P0/P1 骨架的关系分析

> 分析对象：`d:\chen\Q\Q.Membership`
> 骨架版本：P0 运行时核心 V0134 / P1 业务运行时 V0186 / member 能力契约 V0104

## 一、总览：分层与依赖方向

```
┌────────────────────────────────────────────────────────────────┐
│ web/server.ts · 组合根                                           │
│   启动时装配依赖；运行期只做路由与信封转换                          │
│   registerMemberBusinessOperations(deps)   dispatchViaRegistry  │
└──────────────────────────────┬─────────────────────────────────┘
                               │ 启动期：注册 9 个 op
                               ▼
┌────────────────────────────────────────────────────────────────┐
│ src/p1 · member 业务能力                                        │
│   契约面 export/member：types.ts / contracts.ts / metadata.ts   │
│                        / client.ts                              │
│   业务实现 member/：9 × handler.ts                              │
│   ★ business_registration.ts · 桥（唯一交汇点）                  │
└──────────────────────────────┬─────────────────────────────────┘
                               │ 运行期：invoke_* 调用
                               ▼
┌────────────────────────────────────────────────────────────────┐
│ business_runtime · P1 骨架 V0186                                │
│   13 GENERAL 槽投影 + 静态槽 → operations Map                    │
│   invoke 时查表、授权、归一化                                     │
│   stage_extension_contract.ts   business_operation_registry.ts  │
└──────────────────────────────┬─────────────────────────────────┘
                               │ 逐 op 经 P0 管线执行
                               ▼
┌────────────────────────────────────────────────────────────────┐
│ src/p0 · 运行时核心 V0134                                       │
│   上下文校验 · 钩子 before/after/on_error · 错误归一化            │
│   runtime_contract.ts   runtime_pipeline.ts   hook_anchor.ts    │
└────────────────────────────────────────────────────────────────┘
```

依赖方向严格自上而下：`web → member 桥 → P1 → P0`，下层永不 import 上层。

## 二、各层提供什么

### P0 运行时核心（src/p0，V0134）——不感知任何业务

| 文件 | 职责 |
|---|---|
| `runtime_contract.ts` | 契约类型基座：`RuntimeContext` 六必填字段（stage_contract_ref / operation_ref / trace_id / request_id / invocation_id / binding_set_ref）、`StableRuntimeError`、`RuntimeOperation<TInput,TOutput>` 签名、`deep_freeze` / `exact_ref` 等工具 |
| `runtime_pipeline.ts` | 统一执行管线：上下文校验、attempt 计数、`before_process` / `after_process` / `on_error` 钩子、错误归一化 |
| `hook_anchor.ts` | 横切逻辑（审计、指标、告警等）的挂载点 |

### P1 业务运行时（src/p1/business_runtime，V0186）——感知"业务能力"概念，但不感知 member

| 文件 | 职责 |
|---|---|
| `stage_extension_contract.ts` | 定义 13 个 GENERAL 槽 + 6 个静态槽的投影规则，把"一个 Operation 是谁"形式化 |
| `business_operation_registry.ts` | `operations` Map 单例；`register_*` 族（对外 op / 内部 op / 事件面 / 业务对象 / 钩子）与 `invoke_*` 族（`invoke_business_operation` / `invoke_internal_call`）；invoke 时查表、跑授权闸门、把执行委托给 P0 管线 |

### member 业务（src/p1/member + src/p1/export/member）——只依赖契约，不依赖骨架执行细节

- 9 个 handler（create_member / resolve_member / update_member_profile / update_member_status / create_membership / update_membership_plan / lookup_membership / evaluate_membership_eligibility / resolve_membership）只 import `export/member` 的 `contracts.ts` 与 `types.ts`，说的是自己的语言：`CallContext` / `CallOutcome` / `MEMBER_*` 错误码，**完全不知道 `RuntimeContext` 的存在**。
- `business_registration.ts` 是**唯一的交汇点**：同时 import P0（`P0_CONTRACT_REF`、`StableRuntimeError`）、P1（槽位投影、注册函数）和 member 工厂，承担双向翻译。

## 三、联系的实质：两次"语言转换"

骨架与业务说两种不同的语言，联系全部通过桥接层完成：

| 方向 | 转换内容 | 位置 |
|---|---|---|
| 装配期 | member handler 工厂 + metadata 身份 → 13 槽投影 + `BusinessOperationHandler`；8 个对外 op 走 `register_business_operation`，op09 resolve_membership 走 `register_internal_business_operation` | `registerMemberBusinessOperations` |
| 运行期入口 | `RuntimeContext` → `CallContext`：request_id / trace_id 直取，`commit_time` / `authorization` / `internal_invocation` 经 `attributes` 命名空间键还原 | `adaptMemberHandler` |
| 运行期出口 | `CallOutcome` → 返回值 / `throw StableRuntimeError`：SUCCESS 返回 runtime_result，STABLE_ERROR 抛 StableRuntimeError，业务错误码（如 `MEMBER_NOT_FOUND`）经 P0 管线原样透传 | `adaptMemberHandler` |
| 响应边界 | `BusinessOperationOutcome`（response / stable_error）→ 前端既有信封（SUCCESS / STABLE_ERROR） | `web/server.ts` 的 `toWebCallOutcome` / `toWebInternalCallOutcome` |

## 四、运行期一次调用的完整链路（以 create_member 为例）

```
网页/app.ts          web/server.ts        P1 注册表          P0 管线         member handler
    │                    │                  │                 │                  │
    │ 1 POST /api/<op>   │                  │                 │                  │
    │───────────────────▶│                  │                 │                  │
    │                    │ 2 invoke_business_operation        │                  │
    │                    │─────────────────▶│                 │                  │
    │                    │                  │ 3 查表+授权闸门  │                  │
    │                    │                  │────────────────▶│                  │
    │                    │                  │                 │ 4 校验ctx/钩子   │
    │                    │                  │                 │─────────────────▶│
    │                    │                  │                 │ 5 CallOutcome/throw
    │                    │                  │                 │◀─────────────────│
    │                    │                  │ 6 RuntimeInvokeResult              │
    │                    │                  │◀────────────────│                  │
    │                    │ 7 BusinessOperationOutcome          │                  │
    │                    │◀─────────────────│                 │                  │
    │ 8 信封 JSON        │                  │                 │                  │
    │◀───────────────────│                  │                 │                  │
```

关键点：P1 注册表在执行前完成路由解析（capability_id + operation_id 唯一匹配）与授权闸门；P0 管线负责上下文校验、钩子执行与错误归一化；member handler 只在最后一步被调用，且仍以它原有的 `CallContext` 契约被调用。

## 五、依赖纪律（架构成立的前提）

1. **单向依赖**：web → member 桥 → P1 → P0。P0 里没有 "member" 字样；member handler 里没有 "RuntimeContext" 字样。
2. **骨架管"怎么执行"，业务管"执行什么"**：P1 授权闸门只确认"授权在 Operation 尝试前已完成"这一框架事实；`OPERATION_NOT_AUTHORIZED`、`MEMBER_*` 等业务判定仍由 handler 内注入的 `deps.authorizer` 决定；op09 的内部用途守卫（hasInternalPurpose）也仍在会员 handler 内生效。
3. **组合根唯一**：只有 `web/server.ts` 的启动段知道全部三层并做装配；业务代码保持可独立测试（tests/p1/member 下 84 个单元测试不碰注册表即是证明）。
4. **member 是可替换的**：新增能力（如 order）只需照 `business_registration.ts` 的模式写自己的桥，P0/P1 骨架一行不动。
5. **注册幂等**：所有 `register_*` 相同物料重复注册返回既有条目，不同物料抛 `P1_OPERATION_DUPLICATE`；运行期请求路径上绝不调用任何 register——调用只走 `invoke_*`。

## 六、关键文件索引

| 角色 | 路径 |
|---|---|
| 组合根 | `web/server.ts` |
| 桥接层（适配+注册） | `src/p1/member/business_registration.ts` |
| 9 个业务 handler | `src/p1/member/<operation>/handler.ts` |
| member 契约面 | `src/p1/export/member/{types,contracts,metadata,client}.ts` |
| P1 骨架 | `src/p1/business_runtime/{stage_extension_contract,business_operation_registry}.ts` |
| P0 骨架 | `src/p0/{runtime_contract,runtime_pipeline,stage_handler,hook_anchor}.ts` |
