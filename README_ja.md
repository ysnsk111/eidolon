# EIDOLON v1.1.0

<p align="center">
  <strong>ペルソナ蒸留＆メモリーランタイム (Persona Distillation & Memory Runtime)</strong><br>
  <em>«表現を保存し、文脈を再構築し、忠実度を測定する。»</em>
</p>

<p align="center">
  <a href="README.md#-简体中文"><strong>简体中文</strong></a> •
  <a href="README_en.md"><strong>English</strong></a> •
  <a href="README_ja.md"><strong>日本語</strong></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-GPL%20v3.0-blue.svg" alt="License: GPL-3.0">
  <img src="https://img.shields.io/badge/Node.js-24%20LTS-green.svg" alt="Node.js: 24 LTS">
  <img src="https://img.shields.io/badge/Go-1.22+-00ADD8.svg" alt="Go 1.22+">
  <img src="https://img.shields.io/badge/SQLite-Native%20ACID-003B57.svg" alt="SQLite: Native ACID">
  <img src="https://img.shields.io/badge/Tests-34%20Passed-brightgreen.svg" alt="Tests: 34 Passed">
  <img src="https://img.shields.io/badge/DSI-Deterministic%20v1.1-purple.svg" alt="DSI: Deterministic v1.1">
</p>

---

## 1. プロジェクトの再定義

EIDOLON はもはや単なる「チャット履歴を要約してプロンプトにするツール」ではありません。

**V1.1 における正式な定義：**
> **«過去の実際の対話履歴から計算可能な言語・行動・リズム・文脈・記憶の特徴を蒸留し、オフライン評価用データセットを用いて生成結果と過去サンプル間のスタイル一貫性および事実忠実度を厳格に検証する。»**

EIDOLON は2つの完全に独立したクローズドループを備えています：

```text
蒸留ループ (DISTILLATION LOOP):
対話履歴 ──▶ 取り込み ──▶ 多層蒸留パイプライン ──▶ ペルソナ実行可能パッケージ (.eidolon)

評価ループ (EVALUATION LOOP):
ブラインドテストデータ ──▶ 候補生成 ──▶ ペアワイズ・ブラインド評価 ──▶ DSIスコア ──▶ 最適化
```

両方のループが正常に実行され、品質ゲート（Quality Gate）をクリアして初めて、真の **Distillation Complete（蒸留完了）** と判定されます。

---

## 2. コアアーキテクチャと7層蒸留レイヤー

```text
┌────────────────────────────────────────────────────────────────────────┐
│                              EIDOLON CLI                               │
├────────────────────────────────────────────────────────────────────────┤
│    取り込み (Ingestion)    │    蒸留 (Distillation)   │    評価 (Evaluation)   │
├────────────────────────────────────────────────────────────────────────┤
│ 言語指紋 (L1)   │ スタイル (L2) │ 行動モデル (L3)    │ リズム・遅延 (L4)  │
│ アセット (L5)   │ 世界観 (L6)   │ 記憶シード (L7)    │ 再現性メタデータ   │
├────────────────────────────────────────────────────────────────────────┤
│                    記憶エンジン (L0〜L3 時系列永続化)                  │
├────────────────────────────────────────────────────────────────────────┤
│                    ネイティブ SQLite ストレージ＆ACID                  │
├────────────────────────────────────────────────────────────────────────┤
│ Telegram ランタイム (直列キュー) │ HTTP API │ GSAP Web ダッシュボード │
└────────────────────────────────────────────────────────────────────────┘
```

### 7層の特徴蒸留レイヤー：
1. **Layer 1: 言語指紋 (Language Fingerprint)**: メッセージ長および文長の統計分布（中央値、P90、標準偏差）、日本語・中国語の終助詞・語気詞（ね/よ/わ/啊/呀等）、文字の連続繰り返しパターン（www/笑/哈哈哈）、メッセージ構造（単行/複数行/箇条書き）、句読点の省略傾向、Top語彙プロファイル（過学習防止のため強制プロンプト拘束にはしない）。
2. **Layer 2: 条件付きスタイル (Conditional Style)**: ベータ二項ベイズ平滑化（$\alpha=1, \beta=1$）に基づく $P(\text{feature} \mid \text{context})$ の学習。サンプルサイズと信頼度を保持。
3. **Layer 3: 応答行動 (Response Behavior)**: からかいへの返し、共感・慰め、説明要求への対応など、統計特徴量とLLMの純粋な要約によって抽出される行動ポリシー行列（固定AIテンプレートを排除）。
4. **Layer 4: 会話リズム (Conversation Rhythm)**: メッセージ長（短・中・長）ごとの応答遅延分布モデル（`latency_model`）とガウスジッターを算出。架空の固定180 CPMを完全撤廃。
5. **Layer 5: 絵文字・スタンプ (Emoji & Sticker Assets)**: 感情や文脈に紐付いたアセットモデル。
6. **Layer 6: 世界観モデル (World Model & Context)**: 会話内の客観的事実と外部補足背景（`--context`）を厳格に分離・検証。
7. **Layer 7: 記憶シード (Memory Seed)**: L0（作業記憶）、L1（エピソード記憶）、L2（意味事実）、L3（世界設定）の初期化。

---

## 3. 蒸留類似度指数 (DSI)

DSI は 4 つの決定論的統計指標と 1 つの独立ブラインド評価の重み付け統合によって算出されます：

$$\text{DSI} = L \times 0.20 + S \times 0.20 + B \times 0.25 + C \times 0.15 + H \times 0.20$$

| 次元 | 重み | 計算基準と定義 |
| :--- | :---: | :--- |
| **L (語彙類似度)** | 20% | 0.30 文字 1/2-gram コサイン ＋ 0.20 句読点分布距離 ＋ 0.20 語彙適合度 ＋ 0.15 メッセージ長比 ＋ 0.15 文長比 |
| **S (構造スタイル類似度)** | 20% | 特徴量分布類似度（絵文字差分、三点リーダー、疑問符、感嘆符、文末句点省略、長さバケット、繰り返し率） |
| **B (行動類似度)** | 25% | からかい対応、共感対応、逆質問等の特徴量アライメント。AI特有の定型謝罪・自己開示検知時は最低点へ減点 |
| **C (文脈一貫性)** | 15% | 世界観エンティティ矛盾検知、事実否定違反検知、事実グラウンディング加点（検証事実不在時は null 正規化） |
| **H (独立ブラインド評価)** | 20% | 候補A/Bの完全ブラインドシャッフル評価、構造化 `reason_codes`、観点別類似度判定 |

### 品質合格基準 (Quality Gate):
- $\text{DSI} \ge 0.80$
- $\text{Context Fidelity} \ge 0.90$
- $\text{Behavior Similarity} \ge 0.75$
- $\text{Style Similarity} \ge 0.80$
- $\text{Lexical Similarity} \ge 0.80$

---

## 4. エンジニアリングとセキュリティ強化

- **ネイティブ SQLite ACID ストレージ**: 冗長なディスク JSON シリアライズを完全排除し、全クエリを直接 SQLite へパラメータ化実行。`CommitInteraction` によるメッセージ・時系列記憶・スケジューライベントのアトミックな一括トランザクションを実現。
- **時系列記憶バージョン管理 (Temporal Versioning)**: 事実更新時に `valid_to` タイムスタンプを付与し、歴史的事実の変遷を完全保持。多要素加重スコアリングによる Top-K 抽出でプロンプト肥大化を防止：
  $$\text{Score} = \text{Relevance} \times 0.40 + \text{Importance} \times 0.25 + \text{Recency} \times 0.15 + \text{Confidence} \times 0.20$$
- **セッション単位分割と漏洩防御**: データセットを会話セッション単位で分割（Train 70% / Val 15% / Blind 15%）。3-gram Jaccard 類似度 0.90 以上の近傍重複を自動検知・排除。
- **Runtime 候補評価パイプライン**: 候補A/B/C 生成 $\to$ Style Critic 採点選別 $\to$ `sanitizeOutput` 安全ガードレール。
- **Telegram 並行処理とプライバシー保護**: `chat_id` ごとの専用直列チャンネルにより発言順序を完全保証。監査ログのユーザーIDは HMAC-SHA256 ソルトハッシュでマスキング。
- **Zip Slip パストラバーサル対策**: `.eidolon` パッケージの展開時にパスの正規化と境界検査を実施し、ディレクトリ横断攻撃を防御。
- **プロンプトと成果物のバージョン管理**: プロンプトを外部テンプレート化（`cli/distillation/prompts/`）。パッケージには commit・モデル・seed・データハッシュを記録した `reproducibility.json` を同梱。

---

## 5. クイックスタート

```bash
# 1. インストールと初期化
git clone https://github.com/ysnsk111/eidolon.git
cd eidolon && npm install && npm link
eidolon init

# 2. 設定と接続テスト
eidolon config test
eidolon bot token set <YOUR_BOT_TOKEN>

# 3. 対話の蒸留を実行
eidolon distill /path/to/chat.jsonl --target Alice --output ./completed_result

# 4. パッケージのスキーマ検証 (Schema Validation)
eidolon validate ./completed_result/persona_xxx.eidolon

# 5. サーバーのビルドと起動
npm run build:server && eidolon service start
```

---

## 6. CLI コマンドリファレンス

| コマンド | 説明 |
| :--- | :--- |
| `eidolon init` | 実行環境とローカル SQLite データベースの初期化 |
| `eidolon config [show\|set\|test]` | 設定の確認・変更、LLM 接続テスト |
| `eidolon distill <file> [options]` | 対話取り込み、7層特徴蒸留、オフライン評価の実行 |
| `eidolon evaluate <persona>` | 指定ペルソナのオフライン評価と DSI スコア算出 |
| `eidolon validate <path>` | `.eidolon` アーカイブまたはディレクトリの JSON スキーマ検証 |
| `eidolon persona [list\|activate\|install\|verify]` | ペルソナ一覧表示、アクティブ化、安全なインストール、整合性検証 |
| `eidolon memory [status\|compact\|export]` | 記憶統計の確認、期限切れ記憶の圧縮、全量エクスポート |
| `eidolon bot [token\|user\|status]` | Telegram Bot トークンおよび許可ユーザーの管理 |
| `eidolon service [start\|stop\|restart\|status]` | Go 言語常駐デーモンサービスの管理 |
| `eidolon logs [-n lines]` | デーモンのリアルタイムログの閲覧 |
| `eidolon status` | システム全体のステータス確認 |

---

## 7. License

GNU General Public License v3.0 (GPL-3.0). 詳細については [LICENSE](LICENSE) を参照してください。
