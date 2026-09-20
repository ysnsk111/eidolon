# EIDOLON v1.2.1

<p align="center">
  <strong>ペルソナ蒸留・L4動的関係状態＆生体記憶ランタイム</strong><br>
  <em>«表現を保存し、文脈を再構築し、忠実度を測定し、真の存在感をシミュレートする。»</em>
</p>

<p align="center">
  <a href="README.md#-简体中文"><strong>🇨🇳 简体中文</strong></a> •
  <a href="README_en.md"><strong>🇺🇸 English</strong></a> •
  <a href="README_ja.md"><strong>🇯🇵 日本語</strong></a> •
  <a href="docs/human-simulation-algorithm.md"><strong>📐 アルゴリズム仕様書 (Algorithm Spec)</strong></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Release-v1.2.1%20(Formal)-blue.svg" alt="Release: v1.2.1 (Formal)">
  <img src="https://img.shields.io/badge/License-GPL%20v3.0-blue.svg" alt="License: GPL-3.0">
  <img src="https://img.shields.io/badge/Node.js-24%20LTS-green.svg" alt="Node.js: 24 LTS">
  <img src="https://img.shields.io/badge/Go-1.22+-00ADD8.svg" alt="Go 1.22+">
  <img src="https://img.shields.io/badge/SQLite-Native%20ACID-003B57.svg" alt="SQLite: Native ACID">
  <img src="https://img.shields.io/badge/L4%20State-BSM%20Engine-ff69b4.svg" alt="L4 State: BSM Engine">
  <img src="https://img.shields.io/badge/Tests-38%20Passed-brightgreen.svg" alt="Tests: 38 Passed">
</p>

---

## 目次 (Table of Contents)

- [1. プロジェクトの再定義](#1-プロジェクトの再定義)
- [2. コアアーキテクチャと7層蒸留レイヤー](#2-コアアーキテクチャと7層蒸留レイヤー)
- [3. 蒸留類似度指数 (DSI)](#3-蒸留類似度指数-dsi)
- [4. L4動的関係状態と人間行動シミュレーション](#4-l4動的関係状態と人間行動シミュレーション)
- [5. エンジニアリングとセキュリティ強化](#5-エンジニアリングとセキュリティ強化)
- [6. クイックスタートと初期導入ウィザード](#6-クイックスタートと初期導入ウィザード)
- [7. CLI コマンドリファレンス](#7-cli-コマンドリファレンス)
- [8. ライセンス](#8-ライセンス)

---

## 1. プロジェクトの再定義

EIDOLON はもはや単なる「チャット履歴を要約してプロンプトにするツール」ではありません。

**V1.2 における正式な定義：**
> **«過去の実際の対話履歴から計算可能な言語・行動・リズム・文脈・記憶の特徴を蒸留し、L4 動的関係状態と感情力学エンジンを通じて、オフライン評価用データセットを用いて生成結果と過去サンプル間のスタイル一貫性および事実忠実度を厳格に検証し、極めて自然な生体感覚のコンパニオン体験を提供する。»**

EIDOLON は2つの完全に独立したクローズドループを備えています：

```text
蒸留ループ (DISTILLATION LOOP):
対話履歴 ──▶ 取り込み ──▶ 多層蒸留パイプライン ──▶ ペルソナ実行可能パッケージ (.eidolon)

評価ループ (EVALUATION LOOP):
独立ブラインドデータ ──▶ 候補生成 (A/B/C) ──▶ ペアワイズ・ブラインド評価 ──▶ DSIスコア ──▶ 最適化
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
│               L4 動的関係状態＆感情力学エンジン (Emotion Engine)       │
├────────────────────────────────────────────────────────────────────────┤
│                    記憶エンジン (L0〜L3 時系列永続化)                  │
├────────────────────────────────────────────────────────────────────────┤
│                    ネイティブ SQLite ストレージ＆ACID                  │
├────────────────────────────────────────────────────────────────────────┤
│ Telegram ランタイム (直列キュー) │ HTTP API │ GSAP Web ダッシュボード │
└────────────────────────────────────────────────────────────────────────┘
```

### 7層の特徴蒸留レイヤー：
1. **Layer 1: 言語指紋 (Language Fingerprint)**: メッセージ長および文長の統計分布（中央値、P90、標準偏差）、終助詞・語気詞（ね/よ/わ/啊/呀等）、文字の連続繰り返しパターン（www/笑/哈哈哈）、メッセージ構造、句読点の省略傾向、Top語彙プロファイル。
2. **Layer 2: 条件付きスタイル (Conditional Style)**: ベータ二項ベイズ平滑化（$\alpha=1, \beta=1$）に基づく $P(\text{feature} \mid \text{context})$ の学習。サンプルサイズと信頼度を保持。
3. **Layer 3: 応答行動 (Response Behavior)**: からかいへの返し、共感・慰め、説明要求への対応など、統計特徴量とLLMの純粋な要約によって抽出される行動ポリシー行列。
4. **Layer 4: 会話リズム (Conversation Rhythm)**: メッセージ長（短・中・長）ごとの応答遅延分布モデル（`latency_model`）とガウスジッターを算出。固定180 CPMを完全撤廃。
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

## 4. L4動的関係状態と人間行動シミュレーション

> 詳細な数学的仕様書：[docs/human-simulation-algorithm.md](docs/human-simulation-algorithm.md)

1. **L4 連続 8 次元関係状態ベクトル**:
   - `intimacy` (親密さ), `affection` (好意), `trust` (信頼), `attachment` (愛着), `discord` (不和), `boundary` (心理的境界), `openness` (開放度), `dominance` (主導性)。
   - 8次元連続感情力学（怒り、苛立ち、愛着、悲しみ、喜び、照れ、孤独、興奮）と連携。
2. **減衰状態遷移方程式と時間的減衰**:
   - 状態遷移：$\mathbf{S}_{t+1} = \lambda \mathbf{S}_t + (1 - \lambda) \Delta \mathbf{S}_{\text{stimulus}} + \mathbf{R}_{\text{apology}}$、慣性係数 $\lambda = 0.88$ により感情の自然な連続的変化を保証。
   - 時間減衰半減期：苛立ちの解消 $\tau=6h$、傷心からの回復 $\tau=24h$、緊張緩和 $\tau=4h$。
3. **謝罪と和解の数理モデル**:
   - 誠実な謝罪強度 $A$ に基づく対数飽和回復；
   - 行動状態機が `CONFLICT -> RECOVERING -> DISTANT -> WARM -> NORMAL` とスムーズに軟化移行。
4. **多要素対数正規インタラクティブ遅延とメッセージ分割**:
   - 遅延算出：$\tau = \text{Lognormal}(\mu, \sigma) \times M_{\text{length}} \times M_{\text{rapid}} \times M_{\text{cold}}$；
   - 読解・思考期（入力中アニメーション非表示）を経て、長文時は4秒周期でタイピング状態を維持；
   - 文末記号（改行、句点、感嘆符、疑問符、チルダ等）で自然に分割し、文間に1.2秒の自然な入力間隔を挿入。
5. **送信後後悔・取り消しシグモイドモデル**:
   - 衝動性と信頼度から $P(\text{delete}) = \sigma(z)$ を算出し、トリガー時は1.5〜2.5秒待機後に Telegram `deleteMessage` で自動送信取り消しを実行。
6. **Telegram `/start` 起動ペアリングコマンド**:
   - ユーザーが `/start` を送信すると、ロボットは即座にユーザーIDをホワイトリストへ登録し `config.json` へ永続化；
   - 送信された `/start` コマンドメッセージを Telegram 上から自動削除；
   - **完全な静黙ペアリング**：余計な定型文を送らず、その後の通常メッセージ（例：`123`）に対して直接自然な会話を開始。

---

## 5. エンジニアリングとセキュリティ強化

- **ネイティブ SQLite ACID ストレージ**: 冗長なディスク JSON シリアライズを完全排除し、全クエリを直接 SQLite へパラメータ化実行。`CommitInteraction` によるメッセージ・時系列記憶・スケジューライベントのアトミックな一括トランザクションを実現。
- **時系列記憶バージョン管理 (Temporal Versioning)**: 事実更新時に `valid_to` タイムスタンプを付与し、歴史的事実の変遷を完全保持。多要素加重スコアリングによる Top-K 抽出でプロンプト肥大化を防止。
- **セッション単位分割と漏洩防御**: データセットを会話セッション単位で分割（Train 70% / Val 15% / Blind 15%）。3-gram Jaccard 類似度 0.90 以上の近傍重複を自動検知・排除。
- **Runtime 候補評価パイプライン**: 候補A/B/C 生成 $\to$ Style Critic 採点選別 $\to$ `sanitizeOutput` 安全ガードレール（AI定型文を除去し、`[sanitized]` を漏洩させない）。
- **Telegram 並行処理とプライバシー保護**: `chat_id` ごとの専用直列チャンネルにより発言順序を完全保証。監査ログのユーザーIDは HMAC-SHA256 ソルトハッシュでマスキング。
- **Zip Slip パストラバーサル対策**: `.eidolon` パッケージの展開時にパスの正規化と境界検査を実施し、ディレクトリ横断攻撃を防御。
- **プロンプトと成果物のバージョン管理**: プロンプトを外部テンプレート化（`cli/distillation/prompts/`）。パッケージには commit・モデル・seed・データハッシュを記録した `reproducibility.json` を同梱。

---

## 6. クイックスタートと初期導入ウィザード

```bash
# 1. インストール
git clone https://github.com/ysnsk111/eidolon.git
cd eidolon && npm install && npm link

# 2. インタラクティブ初期導入ウィザードの実行（ボットは最初起動しません）
eidolon init
# ウィザードの案内内容：
# - モデル API の接続設定と simple-test による応答検証
# - 対話履歴ファイルパスの入力と大環境・世界観の追加入力
# - Telegram Bot Token の接続とユーザー ID の登録
# - ボットを起動し /start を送信して静黙ペアリング完了

# 3. 対話の蒸留を実行（Telegram リアルタイム進捗通知＆完了時一括消去）
eidolon distill /path/to/chat.jsonl --target Alice --output ./completed_result

# 4. パッケージのスキーマ検証 (Schema Validation)
eidolon validate ./completed_result/persona_xxx.eidolon

# 5. 常駐デーモンサービスの起動
npm run build:server && eidolon service start
```

---

## 7. CLI コマンドリファレンス

| コマンド | 説明 |
| :--- | :--- |
| `eidolon init` | 対話的初期導入ウィザードの起動、環境・設定・SQLite の初期化 |
| `eidolon config [show\|set\|test]` | 設定の確認・変更、LLM 接続 simple-test の実行 |
| `eidolon distill <file> [options]` | 対話取り込み、7層特徴蒸留、Telegram 進捗通知、評価の実行 |
| `eidolon evaluate <persona>` | 指定ペルソナのオフライン評価と DSI スコア算出 |
| `eidolon validate <path>` | `.eidolon` アーカイブまたはディレクトリの JSON スキーマ検証 |
| `eidolon persona [list\|activate\|install\|verify]` | ペルソナ一覧表示、アクティブ化、安全なインストール、整合性検証 |
| `eidolon memory [status\|compact\|export]` | 記憶統計の確認、期限切れ記憶の圧縮、全量エクスポート |
| `eidolon bot [token\|user\|status]` | Telegram Bot トークンおよび許可ユーザーの管理 |
| `eidolon service [start\|stop\|restart\|status]` | Go 言語常駐デーモンサービスの管理 |
| `eidolon logs [-n lines]` | デーモンのリアルタイムログの閲覧 |
| `eidolon status` | システム全体のステータス確認 |

[↑ トップに戻る / Back to Top](#eidolon-v121)

---

## 8. ライセンス

GNU General Public License v3.0 (GPL-3.0). 詳細については [LICENSE](LICENSE) を参照してください。
