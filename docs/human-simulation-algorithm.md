# EIDOLON L4 动态关系状态与仿生真人模拟算法规范
# (L4 Dynamic Relationship State & Human-like Behavioral Simulation Engine)

> **核心哲学**：不要让 LLM 决定一切。
> 
> 让 **LLM** 负责“说什么”，  
> 让 **State Engine** 决定“现在是什么心情”，  
> 让 **Policy Engine** 决定“为什么这么说”，  
> 让 **Behavior Engine** 决定“怎么发”，  
> 让 **Scheduler** 决定“什么时候发”，  
> 让 **Memory Engine** 决定“为什么记得以前发生过什么”。

---

## 目录
1. [核心架构与演进背景](#1-核心架构与演进背景)
2. [L4 关系状态向量 (Relationship State)](#2-l4-关系状态向量-relationship-state)
3. [实时感知层 (Perception Layer)](#3-实时感知层-perception-layer)
4. [连续多维情绪动力学模型 (Emotion Dynamics)](#4-连续多维情绪动力学模型-emotion-dynamics)
5. [状态转移方程与刺激矩阵 (State Transition Equation)](#5-状态转移方程与刺激矩阵-state-transition-equation)
6. [时间衰减与恢复函数 (Temporal Decay & Recovery)](#6-时间衰减与恢复函数-temporal-decay--recovery)
7. [连续冷感指标与冷战模型 (Continuous Coldness Index)](#7-连续冷感指标与冷战模型-continuous-coldness-index)
8. [对数正态与多因子交互延时模型 (Interactive Latency Model)](#8-对数正态与多因子交互延时模型-interactive-latency-model)
9. [消息分裂与颗粒度调度 (Message Splitting & Granularity)](#9-消息分裂与颗粒度调度-message-splitting--granularity)
10. [表情包画像与向量打分算法 (Sticker Memory Model)](#10-表情包画像与向量打分算法-sticker-memory-model)
11. [场景条件 Emoji 概率分布 (Probabilistic Emoji Model)](#11-场景条件-emoji-概率分布-probabilistic-emoji-model)
12. [Sigmoid 撤回与“先发后悔”行为链 (Post-Send Regret & Retraction)](#12-sigmoid-撤回与先发后悔行为链-post-send-regret--retraction)
13. [回复策略规划矩阵 (Response Strategy Planning)](#13-回复策略规划矩阵-response-strategy-planning)
14. [冲突激化与降温动力学 (Conflict Dynamics)](#14-冲突激化与降温动力学-conflict-dynamics)
15. [道歉与和解数学模型 (Reconciliation & Apology Formula)](#15-道歉与和解数学模型-reconciliation--apology-formula)
16. [行为状态机 (Behavioral State Machine, BSM)](#16-行为状态机-behavioral-state-machine-bsm)
17. [EIDOLON L0~L4 分层记忆架构](#17-eidolon-l0l4-分层记忆架构)
18. [端到端全链路运行流程 (Runtime Flow)](#18-端到端全链路运行流程-runtime-flow)
19. [Telegram 机器人启动配对与消息处理协议](#19-telegram-机器人启动配对与消息处理协议)

---

## 1. 核心架构与演进背景

在传统的 AI 聊天机器人中，系统通常呈现线性单层结构：
$$\text{User Message} \longrightarrow \text{Prompt Template} \longrightarrow \text{LLM} \longrightarrow \text{Reply}$$

这种方式存在致命缺陷：
1. **无行为连续性**：单条 Prompt 无法让模型保留“昨天的余气”或“逐渐递进的冷淡”；
2. **机械感强**：回复延时固定，缺乏真人思考、打字、消息断句与犹豫的节奏；
3. **情绪割裂**：用户道歉后立刻从暴怒跳跃到极度开心，违反人类情感恢复规律。

EIDOLON 将回复层升级为**状态驱动的行为模拟器 (State-Driven Behavioral Simulator)**：
```text
Telegram Update
       ↓
Message Normalizer
       ↓
Intent / Emotion / Context Extraction (Perception)
       ↓
L0-L3 Memory Retrieval
       ↓
L4 Relationship & Emotion State
       ↓
State Transition (Decay & Stimulus & Reconciliation)
       ↓
Relationship Phase (BSM)
       ↓
Response Strategy Planner
       ↓
Candidate Generator
       ↓
Style Critic & Independent Judge
       ↓
Response Planner (text, sticker, multi-message, delete-after-send, delay)
       ↓
Latency Scheduler (Log-Normal + Factors)
       ↓
Telegram Renderer (typing, delays, multi-dispatch, post-send retraction)
       ↓
CommitInteraction()
       ↓
Update L0-L4 State
```

---

## 2. L4 关系状态向量 (Relationship State)

EIDOLON 为每个会话维护独立的连续状态向量 $R \in [0.0, 1.0]^8$：

| 状态变量 | 语义定义 | 默认基线 | 影响维度 |
|---|---|---|---|
| `affinity` | 亲近程度 / 好感度 | 0.65 | 称呼亲昵度、愿意分享日常的概率 |
| `trust` | 信任程度 | 0.65 | 倾诉深度、对解释的接纳阈值 |
| `warmth` | 当前温柔/亲密倾向 | 0.60 | 语气质感、暖色词汇与语气词频率 |
| `irritation` | 当前不爽/烦躁程度 | 0.05 | 回复字数限制、标点精简、反问倾向 |
| `hurt` | 被伤害程度 | 0.02 | 关系冷漠化、开启防御姿态 |
| `engagement` | 当前聊天意愿 | 0.75 | 回复积极性、主动展开话题的频率 |
| `tension` | 关系紧张度 | 0.08 | 敏感词触发率、撤回犹豫概率 |
| `initiative` | 主动发起交互倾向 | 0.60 | 连续发多条消息、发表情包倾向 |

---

## 3. 实时感知层 (Perception Layer)

每条进入系统的用户输入经过 Perception 提取为结构化刺激向量：

```json
{
  "intent": "complaint",
  "sentiment": -0.42,
  "pressure": 0.31,
  "affection": 0.18,
  "humor": 0.02,
  "importance": 0.54,
  "apology_strength": 0.0,
  "requires_reply": true
}
```

- **Intent 分类**：`chat`, `question`, `complaint`, `apology`, `provocation`, `tease`, `affection`, `short_ack`
- **复合意图识别**：结合前序上下文，例如用户在“我去忙了”之后发“你怎么又不理我”，判定为 `complaint + attachment_seeking`，避免粗暴判定为负面攻击。

---

## 4. 连续多维情绪动力学模型 (Emotion Dynamics)

情绪不是离散的枚举值，而是八维连续分布 $E \in [0.0, 1.0]^8$：
- $E = [\text{anger}, \text{annoyance}, \text{affection}, \text{sadness}, \text{happiness}, \text{embarrassment}, \text{loneliness}, \text{excitement}]$

这使得系统能自然展现复杂微妙的情感状态：
- 例如：$\text{affection}=0.75, \text{annoyance}=0.60$ $\implies$ “其实心里很喜欢你，但现在被你气到了”。

---

## 5. 状态转移方程与刺激矩阵 (State Transition Equation)

系统采用惯性阻尼微分更新方程：

$$S(t+1) = \text{clamp}\Big(\lambda \cdot S(t) + W \cdot X(t) + \epsilon, \; 0.0, \; 1.0\Big)$$

- $\lambda \approx 0.88$ 为**状态惯性系数**（防止因单句话产生剧烈的情绪突变）；
- $W$ 为人格特定的响应敏感度矩阵（Response Matrix）；
- $X(t)$ 为感知刺激向量（包含 $\Delta affection, \Delta irritation, \Delta trust, \Delta hurt$）；
- $\epsilon \sim \mathcal{N}(0, \sigma_\epsilon^2)$ 为人类心理真实存在的微幅随机扰动。

---

## 6. 时间衰减与恢复函数 (Temporal Decay & Recovery)

情绪会随时间指数衰减并向基线回归：

$$irritation(t + \Delta t) = irritation(t) \cdot e^{-\frac{\Delta t}{\tau_{irritation}}}$$
$$hurt(t + \Delta t) = hurt(t) \cdot e^{-\frac{\Delta t}{\tau_{hurt}}}$$
$$tension(t + \Delta t) = tension(t) \cdot e^{-\frac{\Delta t}{\tau_{tension}}}$$

半衰期 $\tau$ 针对不同负面事件区分设定：
- **小烦躁/日常吐槽**：$\tau_{irritation} = 6\text{ 小时}$（几个小时后自然消气）；
- **情感伤害/委屈**：$\tau_{hurt} = 24\text{ 小时}$（需要更长时间平复）；
- **瞬间紧绷/尴尬**：$\tau_{tension} = 4\text{ 小时}$。

---

## 7. 连续冷感指标与冷战模型 (Continuous Coldness Index)

“冷战”并非简单的布尔变量，而是连续的冷感评分 $C \in [0.0, 1.0]$：

$$C = \text{clamp}\Big(0.50 \cdot irritation + 0.35 \cdot hurt + 0.20 \cdot tension - 0.35 \cdot warmth, \; 0.0, \; 1.0\Big)$$

### 行为阶梯表现：
- $C < 0.20$：正常亲和聊天，表情包与多条消息正常触发；
- $0.20 \le C < 0.35$：语调微冷，略微缩短字数；
- $0.35 \le C < 0.50$：主动性显著下降，不再追问，延迟增加；
- $0.50 \le C < 0.65$：进入 `ANNOYED` 或 `DISTANT` 状态，短句为主；
- $C \ge 0.65$：进入 `COLD` 或 `CONFLICT` 阶段，延迟翻倍，仅必要时回复。

---

## 8. 对数正态与多因子交互延时模型 (Interactive Latency Model)

人类回复消息的耗时服从**对数正态分布 (Log-Normal Distribution)**，且受关系、情绪、意图交互调节：

$$T \sim \text{LogNormal}(\mu, \sigma)$$

其中参数 $\mu$ 计算如下：
$$\mu = \text{baseMedian} \times \text{RelFactor} \times \text{EmoFactor} \times \text{IntentFactor} \times \text{EngageFactor}$$

- **关系因子**：$\text{RelFactor} = \max(0.65, \; 1.0 - 0.25 \times warmth)$
- **情绪因子**：$\text{EmoFactor} = 1.0 + 0.80 \times irritation$
- **意图因子**：面对疑问句 ($\text{Intent} = \text{question}$)，$\text{IntentFactor} = 0.75$（秒回概率提高）；
- **投入因子**：$\text{EngageFactor} = \max(0.75, \; 1.15 - 0.35 \times engagement)$。

打字指示器时长占据总延迟的 $50\% \sim 80\%$，并在超过 4 秒时自动循环维持 typing 状态。

---

## 9. 消息分裂与颗粒度调度 (Message Splitting & Granularity)

真人交流往往不会发一大段整话，而是拆分成多条连续发送：

```text
哈哈哈哈
↓ (等待 1.2s)
[Sticker]
```
或者：
```text
不是
↓ (等待 0.8s)
你听我说
```

调度器依据语法标点（句号、感叹号、问号、逗号、换行）计算分割距离，输出结构化消息列表 `Parts` 与子间隔 `InterMessageGapsMs`。

---

## 10. 表情包画像与向量打分算法 (Sticker Memory Model)

拒绝随机抽取，建立专属 Sticker 记忆画像：
$$\text{Score}(\text{sticker}) = 0.30 \cdot \text{ContextSim} + 0.25 \cdot \text{EmotionSim} + 0.20 \cdot \text{Freq} + 0.15 \cdot \text{Pref} - 0.10 \cdot \text{RecencyPenalty}$$

当上下文或情绪高度匹配时采样对应标签的贴纸（如 `annoyed`, `cute_love`, `laugh_tease` 等）。

---

## 11. 场景条件 Emoji 概率分布 (Probabilistic Emoji Model)

基于马尔可夫链和情感条件分布：
$$P(\text{emoji} \mid \text{context}, \text{emotion}, \text{style})$$

- 开心/兴奋时：`😄`, `✨`, `🥰`
- 尴尬/害羞时：`😳`, `🫣`, `🙈`
- 委屈/难过时：`🥺`, `😢`, `💔`
- 烦躁/冷淡时：`🙄`, `😑`, `💢`

---

## 12. Sigmoid 撤回与“先发后悔”行为链 (Post-Send Regret & Retraction)

人类会因冲动、害羞或说错话而撤回消息。系统建立撤回评估概率模型：

$$z = b + w_1 \cdot \text{embarrassment} + w_2 \cdot \text{tension} + w_3 \cdot \text{annoyance} + w_4 \cdot \text{irritation} - w_5 \cdot \text{trust}$$
$$P(\text{delete}) = \sigma(z) = \frac{1}{1 + e^{-z}}$$

- 当 $P(\text{delete})$ 超过阈值触发撤回时：
  1. 正常发出消息；
  2. 延迟等待 $1.4\text{s} \sim 2.6\text{s}$；
  3. 调用 Telegram Bot API `deleteMessage` 物理删除；
  4. 延迟 $600\text{ms}$ 发送追加跟帖（如 `……` 或 `算了没事`）。

---

## 13. 回复策略规划矩阵 (Response Strategy Planning)

在 LLM 生成内容前，Response Planner 强制确定策略模式：

| 策略枚举 | 触发场景 | 行为特征 |
|---|---|---|
| `DIRECT_REPLY` | 正常沟通 | 完整回答，语调自然 |
| `SHORT_REPLY` | 略微烦躁 / 极简回复 | 极简短句，低字数约束 |
| `DISTANCE` | 冷战 / 疏离期 | 礼貌但保持距离，无追问 |
| `CONFLICT` | 冲突爆发 | 负面防御，零热情度 |
| `COMFORT` | 对方示弱 / 依赖诉求 | 暖色倾听，提供安抚 |
| `TEASE` | 亲密调侃 | 幽默玩笑，带轻度反问 |
| `MULTI_MESSAGE` | 兴奋 / 解释急切 | 消息分裂为 2~3 条发送 |

---

## 14. 冲突激化与降温动力学 (Conflict Dynamics)

冲突演化轨迹：
```text
NORMAL (affinity=0.82, irritation=0.05)
   ↓ 遭遇侮辱/挑衅
ANNOYED (irritation=0.42, tension=0.35)
   ↓ 连续语言刺激
COLD (coldness=0.72, irritation=0.67, hurt=0.58)
   ↓ 升级
CONFLICT (hurt=0.85, trust=0.35)
```

处于此状态下，回复延迟成倍提升，禁用贴纸与热情表达，形成真实的冷战对抗。

---

## 15. 道歉与和解数学模型 (Reconciliation & Apology Formula)

当用户真诚道歉（检测到 `apology` 意图）时，系统计算和解强度 $A \in [0.0, 1.0]$：

$$hurt(t+1) = hurt(t) \cdot (1.0 - 0.45 \cdot A)$$
$$trust(t+1) = \min\big(1.0, \; trust(t) + 0.12 \cdot A\big)$$
$$irritation(t+1) = irritation(t) \cdot (1.0 - 0.50 \cdot A)$$

**平滑过渡保护**：
状态机不直接从 `CONFLICT` 瞬间跳回 `NORMAL`，而是经历：
$$\text{CONFLICT} \longrightarrow \text{RECOVERING} \longrightarrow \text{DISTANT} \longrightarrow \text{WARM} \longrightarrow \text{NORMAL}$$
呈现出“虽然道歉了余气未消，但态度逐渐软化”的真人质感。

---

## 16. 行为状态机 (Behavioral State Machine, BSM)

```text
                    ┌────────────┐
                    │    WARM    │
                    └─────┬──────┘
                          ↓
                    ┌────────────┐
              ┌────→│   NORMAL   │←────┐
              │     └─────┬──────┘     │
              │           ↓            │
         recovery     irritation       │
              │           ↓            │
              │     ┌────────────┐     │
              │     │   ANNOYED  │     │
              │     └─────┬──────┘     │
              │           ↓            │
              │     ┌────────────┐     │
              └─────│ RECOVERING │←────┤
                    └─────┬──────┘      │
                          ↓             │
                    ┌────────────┐      │
                    │   COLD     │──────┘
                    └─────┬──────┘
                          ↓
                    ┌────────────┐
                    │  CONFLICT  │
                    └────────────┘
```

---

## 17. EIDOLON L0~L4 分层记忆架构

```text
storage/
├── l0/ (Working Context, 短期滑窗)
├── l1/ (Episodic Memory, 具身情境插曲)
├── l2/ (Semantic Facts, 长期结构化事实)
├── l3/ (World Context, 世界观与核心原则)
└── l4/ (Dynamic Relationship Layer, 动态关系与行为运行时)
    ├── relationship_state
    ├── emotional_state
    ├── interaction_patterns
    ├── response_policy
    ├── sticker_profile
    ├── emoji_profile
    └── temporal_dynamics
```

所有 L0~L4 的记忆与状态更新包裹在单一 SQLite 事务 `CommitInteraction()` 中原子提交，保证状态绝对一致性。

---

## 18. 端到端全链路运行流程 (Runtime Flow)

1. **Telegram Update 接入**：长轮询捕获用户消息；
2. **鉴权与配对检查**：识别 `/start` 命令，自动配对并删除该消息；
3. **感知与状态更新**：计算刺激分量，执行时间衰减与和解公式；
4. **决策规划**：BSM 判定宏观阶段，生成策略指南（Strategy & Guidance）；
5. **候选生成与审查**：LLM 生成 A/B/C 候选回复，Style Critic 进行独立打分；
6. **延时与分句调度**：依据 Log-Normal 分布与多因子交互计算延时并进行消息断句；
7. **Telegram 渲染器分发**：呈现打字态、逐条发送并执行可能的撤回与跟帖；
8. **事务提交**：固化交互记录与 L4 最新状态。

---

## 19. Telegram 机器人启动配对与消息处理协议

### 19.1 `/start` 启动配对命令规范
- **触发指令**：用户发送以 `/start` 开头的消息；
- **配对动作**：
  1. 机器人提取 `msg.From.ID` 并加入本地内存白名单 `allowedUsers`；
  2. 自动更新并持久化写入 `~/.config/eidolon/config.json`；
  3. 机器人调用 Telegram Bot API `deleteMessage(chat_id, message_id)` 立即删除用户发送的那条 `/start` 指令消息；
  4. **无其他多余**：机器人不发送任何冗余文本（如大段欢迎词或配置提示），静默完成配对；
  5. 后续消息（如 `123`）鉴权直接通过，进入全功能拟真回复管线。

### 19.2 默认伴侣人格回退保障
- 若当前未激活任何专属蒸馏包 (`activePersona == null`)，系统自动加载内置 `Ms.Yawen` 伴侣人格；
- 杜绝控制台抛出 `no active persona` 错误或回复报错卡死，保证首次配对后任意输入均能获得即时、智能、拟真的回复。
