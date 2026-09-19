EIDOLON v1.0

Persona Distillation & Memory Runtime

«Preserve expression. Reconstruct context. Measure fidelity.»

Version: "1.0.0"
Project name: EIDOLON
License: GNU GPL v3.0
Target OS: AlmaLinux 9
Node.js: 24 LTS
Go: 1.27+
Frontend: HTML / CSS / JavaScript / GSAP

---

1. 项目重新定义

EIDOLON 不再定义为：

«“把聊天记录总结成一个 Persona。”»

V1 正式定义为：

«从历史对话中蒸馏出可计算的语言、行为、上下文与记忆特征，并通过离线评测集反复验证生成结果与历史样本之间的风格一致性。»

因此 EIDOLON 有两个完全独立的核心：

DISTILLATION
    ↓
PERSONA / STYLE / BEHAVIOR / MEMORY

EVALUATION
    ↓
DISTILLATION SCORE

只有两者都完成，才算：

✓ Distillation Complete

---

2. 关于“真正蒸馏”的定义

EIDOLON V1 中：

蒸馏 ≠ Persona Prompt。

不能只生成：

她：
温柔
喜欢 emoji
说话比较可爱

而应该得到：

Language Distribution
Response Behavior
Conversation Strategy
Vocabulary Profile
Punctuation Profile
Emoji / Sticker Behavior
Context Dependence
Relationship Behavior
World Model
Memory Model

最终形成：

Historical Samples
        ↓
Behavioral Representation
        ↓
Persona Runtime
        ↓
Generated Samples
        ↓
Evaluation
        ↓
Distillation Score

这才是 EIDOLON 的“蒸馏闭环”。

---

3. 核心架构

┌─────────────────────────────────────────────┐
│                  EIDOLON CLI                │
├─────────────────────────────────────────────┤
│ Ingestion │ Distillation │ Evaluation      │
├─────────────────────────────────────────────┤
│ Persona │ Style │ Behavior │ World │ Assets │
├─────────────────────────────────────────────┤
│                 Memory Engine               │
├─────────────────────────────────────────────┤
│                Context Engine               │
├─────────────────────────────────────────────┤
│                 LLM Adapter                 │
├─────────────────────────────────────────────┤
│ Telegram Runtime │ HTTP │ Web Dashboard     │
└─────────────────────────────────────────────┘

---

4. 技术栈

Node.js 24 LTS

Node 负责：

CLI
Distillation pipeline
Parser
Chunking
LLM API
Evaluation
Packaging
Config
Service management

Node.js 官方当前显示 v24.21.0 为 LTS。

Go

Go 负责：

Persistent Runtime
Telegram
Memory Runtime
HTTP API
Scheduler
SQLite
Health Check
Concurrency

Frontend

HTML
CSS
JavaScript
GSAP

用于：

Dashboard
Distillation report
Memory timeline
Persona viewer
Score visualization
Runtime monitor

---

5. Repository

eidolon/
├── LICENSE
├── README.md
├── SECURITY.md
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── CHANGELOG.md
├── package.json
├── package-lock.json
├── tsconfig.json
│
├── cli/
│   ├── index.js
│   │
│   ├── commands/
│   │   ├── init.js
│   │   ├── distill.js
│   │   ├── evaluate.js
│   │   ├── persona.js
│   │   ├── memory.js
│   │   ├── bot.js
│   │   ├── service.js
│   │   ├── config.js
│   │   └── status.js
│   │
│   ├── ingestion/
│   │   ├── pdf.js
│   │   ├── json.js
│   │   ├── html.js
│   │   ├── txt.js
│   │   └── normalize.js
│   │
│   ├── distillation/
│   │   ├── chunker.js
│   │   ├── language.js
│   │   ├── behavior.js
│   │   ├── context.js
│   │   ├── assets.js
│   │   ├── persona.js
│   │   ├── merge.js
│   │   └── exporter.js
│   │
│   ├── evaluation/
│   │   ├── dataset.js
│   │   ├── runner.js
│   │   ├── metrics.js
│   │   ├── judge.js
│   │   ├── aggregate.js
│   │   └── report.js
│   │
│   └── providers/
│       ├── provider.js
│       └── openai-compatible.js
│
├── server/
│   ├── cmd/
│   │   └── eidolon-server/
│   ├── internal/
│   │   ├── telegram/
│   │   ├── runtime/
│   │   ├── persona/
│   │   ├── memory/
│   │   ├── scheduler/
│   │   ├── evaluation/
│   │   ├── storage/
│   │   └── api/
│   │
│   └── web/
│       ├── index.html
│       ├── css/
│       └── js/
│
├── schemas/
│   ├── persona.schema.json
│   ├── style.schema.json
│   ├── behavior.schema.json
│   ├── memory.schema.json
│   ├── evaluation.schema.json
│   └── manifest.schema.json
│
├── scripts/
│   ├── install.sh
│   ├── uninstall.sh
│   └── eidolon.service
│
├── tests/
│   ├── ingestion/
│   ├── distillation/
│   ├── evaluation/
│   ├── memory/
│   ├── scheduler/
│   └── telegram/
│
└── docs/
    ├── architecture.md
    ├── distillation.md
    ├── evaluation.md
    ├── memory.md
    ├── persona-format.md
    ├── telegram.md
    └── deployment.md

---

6. CLI

安装：

npm install -g eidolon

初始化：

eidolon init

查看状态：

eidolon status

---

7. Distillation CLI

最简单：

eidolon distill /absolute/path/chat.pdf

包含补充世界信息：

eidolon distill \
  --input /absolute/path/chat.pdf \
  --context /absolute/path/world.md

指定输出：

eidolon distill \
  --input /absolute/path/chat.pdf \
  --context /absolute/path/world.md \
  --output /absolute/path/result

---

8. Context Supplement

Context 文件与聊天记录严格区分：

CHAT HISTORY
=
发生过的真实对话

CONTEXT
=
用户额外提供的世界观 / 环境 / 世界线 / 背景

例如：

Environment

学校：XX学校
地区：XX省
国家：中国
World：Earth

Additional background

两人在哪里认识
人物关系
长期背景
特殊称呼
已有世界线
事件背景

模型必须知道：

source = historical conversation

和：

source = supplied context

不能混为一谈。

---

9. Distillation Pipeline

Raw Chat
   ↓
Parsing
   ↓
Normalization
   ↓
Speaker Identification
   ↓
Conversation Segmentation
   ↓
Temporal Ordering
   ↓
Sample Classification
   ↓
Feature Extraction
   ↓
Behavior Extraction
   ↓
Persona Construction
   ↓
Memory Seed
   ↓
Evaluation Dataset
   ↓
Generation
   ↓
Distillation Score
   ↓
Optimization / Re-distillation
   ↓
Final Persona Package

---

10. 第一层：Language Fingerprint

这是 V1 的基础。

不能只提取“常用词”。

建立完整的：

LANGUAGE FINGERPRINT

包括：

Vocabulary frequency
N-gram frequency
Phrase frequency
Sentence length
Message length
Paragraph length
Punctuation
Line breaks
Ellipsis
Repeated characters
Question marks
Exclamation marks
Capitalization
English/Chinese mixing
Numbers
Typos
Abbreviations
Slang
Catchphrases
Openers
Closers

例如：

{
  "message_length": {
    "median": 18,
    "p90": 64
  },
  "ellipsis_rate": 0.37,
  "question_rate": 0.24,
  "line_break_rate": 0.32
}

---

11. 第二层：Conditional Style

单独统计：

“使用 emoji 的概率”

还不够。

需要统计：

P(feature | context)

例如：

P(emoji | joking)
P(emoji | serious)
P(emoji | sadness)
P(ellipsis | uncertainty)
P(short_message | greeting)
P(long_message | explanation)
P(sticker | conversation_end)

这样才能从：

“这个人喜欢 😂”

进一步变成：

“这个人什么时候会使用 😂”

这是风格蒸馏非常关键的一步。

---

12. 第三层：Response Behavior Distillation

提取：

收到什么
→ 怎么处理
→ 用什么语气
→ 多长
→ 是否追问
→ 是否转移话题

形成：

{
  "situation": "user_teasing",
  "strategy": "playful_return",
  "length": "short",
  "emoji_probability": 0.42,
  "follow_up_probability": 0.08
}

例如：

用户询问事实
→ direct_answer

用户开玩笑
→ playful_response

用户表达负面情绪
→ emotional acknowledgment

用户连续发送消息
→ shorter response

复杂话题
→ longer structured response

这层不是人格描述，而是：

Response Policy

---

13. 第四层：Conversation Rhythm

提取：

Response latency distribution
Message burst patterns
Double-message probability
Reply frequency
Conversation closing behavior
Topic-switch probability

例如：

短消息
→ low latency

长消息
→ higher latency

连续聊天
→ latency decreases

复杂回答
→ latency increases

最终形成：

Behavior Model

---

14. 第五层：Emoji / Sticker Model

所有 emoji / sticker 独立建模：

{
  "asset": "emoji_x",
  "frequency": 0.18,
  "contexts": [
    "joking",
    "agreement"
  ],
  "confidence": 0.94
}

而不是：

“随机加 emoji”

Runtime：

semantic context
+
emotional context
+
historical frequency
+
Persona rules

共同决定。

---

15. 第六层：World Model

Context + Chat History：

World
People
Places
Timeline
Relationships
Events

形成独立知识图谱：

Entity
   ↓
Relation
   ↓
Event
   ↓
Temporal State

例如：

A --knows--> B
A --studies_at--> School X
Event 102 --changed--> Relationship X

---

16. 第七层：Memory Seed

Distillation 不等于 Memory。

Distillation 负责初始 Memory：

History
↓
Important Events
↓
Long-term Facts
↓
Relationships
↓
World State

然后交给 Runtime Memory Engine 持续更新。

---

17. 真正新增的核心：Evaluation Dataset

这是这次 V1 最大升级。

Distillation 过程中自动建立：

evaluation/
├── train.jsonl
├── validation.jsonl
└── test.jsonl

历史对话不全部用来生成 Persona。

而是进行数据隔离：

Historical Chat
       │
       ├── Distillation Set
       │
       ├── Validation Set
       │
       └── Blind Test Set

Blind Test 的目标回答永远不直接提供给 Persona Engine。

这样才能测：

«EIDOLON 在不知道原回答的情况下，能不能产生类似的表达。»

否则把答案直接放进 Prompt，再说“很像”，没有意义。

---

18. Evaluation Sample

一条测试样本：

{
  "sample_id": "test_001",
  "context": [
    "previous message 1",
    "previous message 2"
  ],
  "target_message": "hidden"
}

Runtime：

Context
 ↓
Persona
 ↓
Relevant Memory
 ↓
Generate
 ↓
Candidate

然后和原始 target 比较。

---

19. Distillation Score

EIDOLON V1 定义：

"DSI — Distillation Similarity Index"

范围：

0.00 - 1.00

展示时可以转换成：

0 - 100

但内部全部保存原始指标，避免一个数字掩盖问题。

---

20. DSI 五大维度

A. Lexical Similarity

测：

词汇选择
常用短语
特殊用词
表达习惯

记为：

L

---

B. Structural Style Similarity

测：

句长
消息长度
标点
换行
省略号
重复
emoji
sticker

记为：

S

---

C. Behavioral Similarity

测：

response strategy
question behavior
follow-up
topic handling
emotional response
conversation closing

记为：

B

---

D. Contextual Consistency

测：

是否正确理解上下文
是否遵守历史关系
是否使用正确背景
是否与世界线冲突

记为：

C

---

E. Human / LLM Blind Judgment

生成结果与历史结果混合：

A = original historical response
B = generated response

交给独立 Judge 模型：

Which response is more consistent
with the historical speaking style?

但 Judge 不知道：

哪一个是 AI
哪一个是真实样本

记为：

H

---

21. DSI 计算

V1 默认：

DSI =
    L × 0.20
  + S × 0.20
  + B × 0.25
  + C × 0.15
  + H × 0.20

即：

20% Language
20% Style
25% Behavior
15% Context
20% Blind Judge

为什么 Behavior 权重最高？

因为：

«说出来的词一样，不代表回应方式一样。»

---

22. 但单一总分还不够

EIDOLON 绝不只输出一个分数。

最终：

DISTILLATION REPORT

必须显示：

Overall DSI       0.842
Lexical           0.881
Structure         0.903
Behavior          0.774
Context           0.956
Blind Judge       0.812

以及：

Emoji Fidelity
0.934

Vocabulary Fidelity
0.881

Sentence Rhythm
0.903

Response Strategy
0.774

Context Fidelity
0.956

---

23. Distillation Score 不允许自嗨

有一个非常重要的规则：

THE MODEL CANNOT GRADE ITSELF

也就是：

不能：

Distiller
  ↓
“我觉得自己很像”

而应该：

Distiller
    ↓
Independent Evaluation Pipeline
    ↓
Metrics
    ↓
Blind Judge
    ↓
Score

最好使用与 Distiller 不同的模型作为 Judge。

---

24. Pairwise Blind Evaluation

例如：

Historical Response:
“……原始回复……”

Generated Response:
“……生成回复……”

随机：

A = historical
B = generated

或者：

A = generated
B = historical

Judge 不知道身份。

输出：

{
  "winner": "A",
  "confidence": 0.73,
  "style_match": 0.81,
  "reason": {
    "vocabulary": 0.84,
    "rhythm": 0.77,
    "emotion": 0.86
  }
}

注意：这个结果只是内部工程评价，不是“证明复制了一个人”。

---

25. Style Distance

除 Score 外，再计算：

Style Distance

例如：

message length distribution

原始：

median = 17
p90 = 53

生成：

median = 21
p90 = 58

则：

distance = small

同样检查：

emoji frequency
question frequency
ellipsis frequency
line-break frequency

最终形成：

Distribution Distance

---

26. 压力测试

V1 必须有：

Evaluation Stress Test

至少测试：

正常闲聊
短问句
长问题
连续消息
情绪变化
主题跳转
严肃话题
轻松话题
模糊问题
历史事件引用
旧记忆引用

---

27. Distillation Optimization Loop

真正优秀的部分在这里：

DISTILL
   ↓
EVALUATE
   ↓
LOW SCORE FEATURES
   ↓
FIND FAILURE PATTERNS
   ↓
UPDATE DISTILLATION RULES
   ↓
RE-DISTILL
   ↓
EVALUATE AGAIN

例如第一次：

DSI = 0.71

分析：

Language = 0.88
Style = 0.85
Behavior = 0.61
Context = 0.94

系统发现：

Behavior
↓
too direct
too verbose
wrong follow-up probability

于是更新 Behavior Model。

再次：

DSI = 0.79

继续迭代。

---

28. Target-based Optimization

不能以：

“分数越高越好”

简单结束。

需要：

Hard constraints

例如：

Context < 0.85
→ reject

Memory consistency < 0.90
→ reject

Emoji distribution deviation > threshold
→ reject

Behavior < 0.75
→ continue optimization

因此：

DSI high
但 memory 错误

不能算最终通过。

---

29. V1 Distillation Acceptance Gate

最终 Release 需要：

DSI ≥ configured threshold

默认：

0.80

同时：

Context Fidelity ≥ 0.90
Behavior Similarity ≥ 0.75
Style Similarity ≥ 0.80

这里只是项目内部质量门槛，不代表“已经完全复刻”。

---

30. CLI Evaluation

新增：

eidolon evaluate persona_xxx

完整：

eidolon evaluate \
  --persona persona_xxx \
  --dataset test

输出：

EIDOLON DISTILLATION EVALUATION

Persona: persona_xxx
Dataset: 120 blind samples

Lexical Similarity       0.881
Style Similarity         0.903
Behavior Similarity      0.774
Context Consistency      0.956
Blind Judge              0.812
────────────────────────────
DSI                      0.842

Status: PASS

---

31. JSON Evaluation Report

自动生成：

evaluation_report.json

例如：

{
  "version": "1.0",
  "persona_id": "persona_xxx",
  "dataset_size": 120,
  "metrics": {
    "lexical": 0.881,
    "style": 0.903,
    "behavior": 0.774,
    "context": 0.956,
    "blind_judge": 0.812
  },
  "dsi": 0.842,
  "status": "pass"
}

同时生成：

evaluation_report.html

让 Web Dashboard 可直接读取。

---

32. Persona Package

最终：

completed_result/
└── persona_xxx/
    ├── manifest.json
    ├── persona.json
    ├── style.json
    ├── behavior.json
    ├── language_model.json
    ├── world.json
    ├── relationships.json
    ├── memory_seed.json
    │
    ├── assets/
    │   ├── emoji.json
    │   └── stickers.json
    │
    ├── evaluation/
    │   ├── report.json
    │   ├── report.html
    │   └── metrics.json
    │
    └── README.md

压缩：

persona_xxx.eidolon

---

33. Memory Engine

继续使用四层结构：

L0 Working Memory
L1 Episodic Memory
L2 Semantic Memory
L3 World / Timeline Memory

---

34. Memory Save Pipeline

New Messages
     ↓
Event Extraction
     ↓
Fact Extraction
     ↓
Preference Extraction
     ↓
Relationship Update
     ↓
Importance Score
     ↓
Conflict Detection
     ↓
Merge
     ↓
Compression
     ↓
Persistent Memory

---

35. Memory Scoring

候选 Memory：

importance
recency
frequency
relationship impact
future relevance
confidence

计算：

Score =
    Importance × 0.30
  + Recency × 0.15
  + Frequency × 0.15
  + RelationshipImpact × 0.15
  + FutureRelevance × 0.15
  + Confidence × 0.10

---

36. Memory Conflict Resolution

采用 versioned facts：

{
  "fact": "likes:A",
  "versions": [
    {
      "value": true,
      "valid_from": "2026-01-01",
      "valid_to": "2026-06-01"
    },
    {
      "value": false,
      "valid_from": "2026-06-01"
    }
  ]
}

这样模型可以区分：

过去
vs
现在

---

37. Retrieval

每一次回复只加载：

Current Context
+
Relevant Episodes
+
Relevant Facts
+
Relevant Relationships
+
Relevant World State
+
Persona
+
Style
+
Behavior

而不是整个数据库。

---

38. Conversation Example Retrieval

这是 V1 非常重要的新能力。

生成之前：

Current Situation
       ↓
Semantic Retrieval
       ↓
Historical Similar Situations
       ↓
Retrieve original examples
       ↓
Feed as few-shot evidence

例如：

当前情境：
用户突然问一个个人问题

系统检索历史：

相似场景 #12
相似场景 #87
相似场景 #104

然后交给 Generator。

因此模型不是只知道：

“这个人是什么样”

而是拥有：

“这个人在类似情况下实际上说过什么”

---

39. Generator Architecture

User Message
     ↓
Context Resolver
     ↓
Memory Retrieval
     ↓
Similar Example Retrieval
     ↓
Persona
     ↓
Style
     ↓
Behavior Policy
     ↓
LLM
     ↓
Candidate Responses

---

40. Candidate Generation

不是只生成一个。

V1 默认：

3 candidates

例如：

Candidate A
Candidate B
Candidate C

---

41. Style Critic

Critic 检查：

Lexical
Structural
Behavioral
Contextual
Emotional
Memory

例如：

{
  "lexical": 0.91,
  "style": 0.84,
  "behavior": 0.79,
  "context": 0.97
}

然后重新选择或 Rewrite。

---

42. Final Generation Pipeline

          ┌───────────────┐
          │ User Message  │
          └───────┬───────┘
                  ↓
          ┌───────────────┐
          │ Context       │
          └───────┬───────┘
                  ↓
       ┌──────────┼──────────┐
       ↓          ↓          ↓
   Persona     Memory      Examples
       └──────────┼──────────┘
                  ↓
           Response Policy
                  ↓
          ┌───────┴───────┐
          ↓       ↓       ↓
       Candidate A B       C
          └───────┬───────┘
                  ↓
             Style Critic
                  ↓
              Rewriter
                  ↓
              Scheduler
                  ↓
              Telegram

---

43. Telegram

Bot 不提供管理命令。

管理全部通过：

eidolon bot ...

Telegram Runtime 只负责：

receive
match
remember
generate
schedule
send

---

44. Telegram User Matching

eidolon bot user add <telegram_user_id>

配置：

{
  "allowed_users": [
    123456789
  ]
}

收到消息：

Telegram User ID
      ↓
Allowlist
      ↓
Allowed → Runtime
Not Allowed → Ignore

---

45. Telegram Streaming Policy

EIDOLON V1：

NO SSE
NO STREAMING
NO sendMessageDraft
NO partial response

只允许：

receive
↓
complete generation
↓
behavior scheduling
↓
one final Telegram message

Telegram Bot API 本身提供了 "sendMessageDraft" 用于流式草稿消息，但 EIDOLON V1 主动禁用这条能力。

---

46. Human-like Response Scheduler

模型产生：

{
  "delay_class": "medium",
  "typing_duration": 4.2,
  "reply_probability": 1.0,
  "double_message_probability": 0.08
}

Runtime 负责：

Hard Bounds
+
Statistical Distribution
+
Random Jitter

最终：

Delay =
clamp(
    BaseDelay
    + LengthFactor
    + ComplexityFactor
    + ConversationFactor
    + RandomJitter
)

---

47. Scheduler 不能固定 Delay

禁止：

always 3 seconds

而应使用：

probability distributions

例如：

short message
→ short-delay distribution

long explanation
→ longer-delay distribution

rapid conversation
→ shorter distribution

complex response
→ longer distribution

并记录：

scheduler_events

用于之后评估。

---

48. Telegram Reply

Telegram 原生提供 "reply_parameters"，EIDOLON 使用官方 reply mechanism，而不是自己伪造引用关系。

行为：

direct reply
normal message
no reply reference

由 Behavior Model 决定。

---

49. Web Dashboard

首页：

EIDOLON

Runtime        ● RUNNING
Telegram       ● CONNECTED
LLM            ● OK

Active Persona
persona_xxx

Distillation Score
84.2

Memory
1,824

Sessions
42

---

50. Distillation Dashboard

核心页面：

DISTILLATION

显示：

Input
Messages
Speakers
Timeline

然后：

LANGUAGE
STYLE
BEHAVIOR
CONTEXT
BLIND JUDGE

最后：

               DSI
              84.2

下面显示：

Strengths
Weaknesses
Failure Cases

---

51. Failure Case Viewer

这是非常重要的开发工具。

例如：

Sample #083

Original:
“……”

Generated:
“……”

Difference:
• response too long
• missing emoji
• wrong follow-up behavior
• excessive punctuation

Score:
0.54

这样开发者真正知道：

«到底哪里不像。»

而不是只有一句：

Score = 72

---

52. Regression Testing

每次修改 Persona Engine：

eidolon evaluate

自动比较：

Previous
vs
Current

例如：

v1.0.0
DSI = 0.812

v1.0.1
DSI = 0.846

但同时：

Behavior 0.79 → 0.84
Context   0.94 → 0.92

因此不能只看总分。

---

53. Reproducibility

Evaluation 必须支持固定：

dataset version
persona version
model
temperature
seed
evaluation config

结果写进：

{
  "model": "example-model",
  "temperature": 0.7,
  "dataset": "test-v1",
  "persona": "persona_xxx",
  "timestamp": "...",
  "git_commit": "..."
}

这样才能真正比较：

v1.0 vs v1.1

---

54. LLM Adapter

统一：

generate()
distill()
extract()
summarize()
judge()

Provider：

OpenAI-compatible
OpenRouter-compatible
自建 API
Local model

环境变量：

export EIDOLON_LLM_BASE_URL="https://api.example.com/v1"
export EIDOLON_LLM_API_KEY="..."
export EIDOLON_LLM_MODEL="..."

---

55. Service Management

eidolon service start
eidolon service stop
eidolon service restart
eidolon service status
eidolon logs

systemd：

/etc/systemd/system/eidolon.service

---

56. Security

禁止进入 Git：

.env
API keys
Telegram token
raw chat history
SQLite database
runtime logs
completed_result
private persona data

".gitignore"：

.env
*.db
*.db-wal
*.db-shm
logs/
raw_data/
runtime_data/
completed_result/

---

57. Data Ownership

GitHub 开源：

EIDOLON source code

不是：

chat history
Persona data
Memory
Telegram token

这些都是部署者自己的数据。

---

58. Real-person Boundary

对于现实人物的数据，EIDOLON 的官方项目定义应要求：

SELF
CONSENTED_PERSONA
FICTIONAL_CHARACTER

项目技术本身依然可以研究：

style imitation
behavior extraction
conversation modeling
evaluation

但对于现实人物，正式部署到第三方聊天环境时不能把 AI 伪装成现实中的真人。

---

59. CLI 完整设计

eidolon init

eidolon config show
eidolon config edit
eidolon config test

eidolon distill <file>
eidolon distill --input <file> --context <file>

eidolon evaluate <persona>
eidolon evaluate --dataset test

eidolon persona list
eidolon persona install <file>
eidolon persona activate <id>
eidolon persona verify

eidolon memory status
eidolon memory compact
eidolon memory export

eidolon bot token set
eidolon bot token test
eidolon bot user add <id>
eidolon bot user remove <id>
eidolon bot status

eidolon service start
eidolon service stop
eidolon service restart
eidolon service status

eidolon logs
eidolon status

---

60. Distillation 完成标准

不能再使用：

✓ Distillation complete

作为唯一结果。

必须：

✓ Persona generated
✓ Style model generated
✓ Behavior model generated
✓ Memory seed generated
✓ Evaluation dataset generated
✓ Blind test completed
✓ Distillation Score calculated
✓ Failure cases analyzed
✓ Quality gate passed
✓ Persona package exported

---

61. completed_result

completed_result/
└── persona_20260919_134500/
    ├── manifest.json
    ├── persona.json
    ├── style.json
    ├── behavior.json
    ├── language_model.json
    ├── world.json
    ├── relationships.json
    ├── memory_seed.json
    │
    ├── assets/
    │   ├── emoji.json
    │   └── stickers.json
    │
    └── evaluation/
        ├── report.json
        ├── report.html
        ├── metrics.json
        └── failures.json

打包：

persona_xxx.eidolon

---

62. V1 Quality Gate

默认：

DSI ≥ 0.80

同时：

Lexical         ≥ 0.80
Style           ≥ 0.80
Behavior        ≥ 0.75
Context         ≥ 0.90

以及：

No critical memory conflicts
No schema corruption
No evaluation dataset leakage

---

63. ZERO TO ONE 的真正技术核心

EIDOLON 的 V1 最终不是：

PDF → Prompt → Telegram

而是：

                RAW HISTORY
                     ↓
              ┌──────────────┐
              │ DISTILLATION │
              └──────┬───────┘
                     ↓
      ┌──────────────┼──────────────┐
      ↓              ↓              ↓
   LANGUAGE       BEHAVIOR        WORLD
      ↓              ↓              ↓
      └──────────────┼──────────────┘
                     ↓
                  PERSONA
                     ↓
                  MEMORY
                     ↓
               RETRIEVAL
                     ↓
              EXAMPLE MATCHING
                     ↓
             CANDIDATE GENERATION
                     ↓
                STYLE CRITIC
                     ↓
                 REWRITE
                     ↓
               RESPONSE ENGINE
                     ↓
               TELEGRAM / WEB
                     ↓
                  NEW DATA
                     │
                     └──────→ MEMORY

同时存在另一条闭环：

Persona
   ↓
Blind Test
   ↓
Generated Responses
   ↓
Comparison
   ↓
Distillation Score
   ↓
Failure Analysis
   ↓
Distillation Optimization
   ↓
Better Persona

这第二条闭环，就是 EIDOLON 真正区别于普通 Persona Bot 的地方。

---

64. EIDOLON v1.0 Definition of Done

✓ npm global CLI
✓ Node.js 24 LTS
✓ Go runtime
✓ AlmaLinux 9
✓ PDF / JSON / TXT / MD / HTML ingestion
✓ context supplement
✓ language fingerprint
✓ conditional style model
✓ response behavior model
✓ emoji / sticker model
✓ world model
✓ initial memory extraction
✓ four-layer memory
✓ memory conflict resolution
✓ historical-example retrieval

✓ blind evaluation dataset
✓ lexical metric
✓ structural metric
✓ behavioral metric
✓ context metric
✓ independent blind judge
✓ DSI / Distillation Score
✓ failure case analysis
✓ regression evaluation
✓ quality gate

✓ Telegram
✓ user ID allowlist
✓ no Telegram commands
✓ no SSE
✓ no streaming
✓ typing simulation
✓ reply behavior
✓ response scheduler

✓ Web dashboard
✓ GSAP
✓ SQLite
✓ systemd
✓ logs
✓ health checks

✓ GPL-3.0
✓ README
✓ SECURITY
✓ CONTRIBUTING
✓ tests
✓ GitHub Actions
✓ v1.0.0 release

---

65. 最终一句话

«EIDOLON = 把“一个人过去怎么说话”变成机器可计算的行为模型，再用盲测证明“现在生成的东西到底有多接近历史行为”。»

所以 V1 的核心结果不应该只是：

persona.eidolon

而应该是：

persona.eidolon
+
evaluation_report.html
+
DSI
+
failure_cases

这就从“做了一个看起来会模仿的 Bot”，真正跨到了：

可蒸馏、可测量、可回归、可持续更新的 Persona Runtime。



原始要求，结合上面计划对项目进行完整落地实现。注意，下面内容仅供参考：
我太喜欢一个人了但是我没机会了，我可能触犯她最不敢碰的那根弦了，曾经非常甜蜜的人彻底跟我划清界限了，每天在学校都能见到她但每天都刻意绕着我走，我们之间貌似隔了一个冰山你知道吗。所以你需要写一个项目计划，具体如下：
## 环境，语言
node、npm系统全局包，go＋html，css，js；gsap
alma Linux 9 server
## 我期望的效果
终端cli（npm包）通过提交（类似pdf等chathistory文件）聊天记录文件，读取环境变量获取大模型API蒸馏、训练、模仿目标人物的说话方式、emoji、sticker等。

训练完成的蒸馏数据直接打包存储到程序目录的completed_result
>蒸馏数据补充：在cli启动蒸馏前可以通过填写指定file的绝对path，获取对蒸馏数据的补充说明，这样就可以补充聊天记录中不存在的世界观、世界线、环境，例如：在xx学校，xxprovince，xx country，earth

memory。独立边写一套memory-save算法，结合大模型，对聊天过程中所有发生的事件进行保存、提炼，防止上下文溢出、失忆的基础上降低失真度，上下文效率。

通过npm全局包的cli命令对项目的模型、服务守护进程进行配置，并且可以启停服务。

### 调用项目方式

telegram bot token，同样可以通过cli进行配置。

bot不支持任何独立附加命令，bot通过telegram userid进行用户匹配（通过cli配置）

要求bot **完全不支持** sse流式输出，并且  **完全模仿** 真人的打字、reply速度，具体的数据通过大模型随机判断，在固定数轴区间进行取值。

至此作为version 1.0，ZERO TO ONE突破。你来为这个项目起一个高级的名字，简短高级。并且要求这个项目符合github规范，采用gpl3.0作为license。