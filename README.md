# LLM Gateway Demo

Google Cloud 上で Claude & Gemini を一元管理する LLM Gateway デモ。
LiteLLM Proxy を使い、従業員ごとの利用権限管理・使用量追跡・コスト可視化を実現します。

## アーキテクチャ

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ Claude Code  │  │ Gemini CLI  │  │   任意の     │
│             │  │             │  │ OpenAI SDK   │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                │                │
       └────────────────┼────────────────┘
                        │ OpenAI-compatible API
                        ▼
              ┌─────────────────┐
              │  LiteLLM Proxy  │ ← Cloud Run
              │                 │
              │ • 認証 (APIキー) │
              │ • 権限管理      │
              │ • レート制限     │
              │ • コスト追跡     │
              └───┬────┬────┬───┘
                  │    │    │
          ┌───────┘    │    └───────┐
          ▼            ▼            ▼
   ┌────────────┐ ┌─────────┐ ┌──────────┐
   │ Vertex AI  │ │Cloud SQL│ │ Pub/Sub  │
   │            │ │(状態管理)│ │          │
   │ • Claude   │ └─────────┘ └────┬─────┘
   │ • Gemini   │                  │
   └────────────┘                  ▼
                           ┌────────────┐
                           │  BigQuery   │
                           │ (利用ログ)  │
                           └──────┬─────┘
                                  │
                                  ▼
                          ┌──────────────┐
                          │Looker Studio │
                          │ (ダッシュボード)│
                          └──────────────┘
```

## 使用 GCP プロダクト

| プロダクト | 用途 |
|-----------|------|
| **Cloud Run** | LiteLLM Proxy のホスティング |
| **Vertex AI** | Claude / Gemini モデルへのアクセス |
| **Cloud SQL** | LiteLLM 内部状態（キー、チーム、予算） |
| **Pub/Sub** | 利用ログのストリーミング |
| **BigQuery** | ログの蓄積・分析 |
| **Looker Studio** | ダッシュボード・可視化 |
| **Secret Manager** | マスターキー・DB接続情報の管理 |
| **IAM** | サービスアカウントによるアクセス制御 |

## クイックスタート

### 1. デプロイ
```bash
# 環境変数（オプション：指定しなければ自動生成）
export LITELLM_MASTER_KEY="your-secure-master-key"

# デプロイ実行
./deploy.sh
```

### 2. ダッシュボードにアクセス
デプロイ完了後に表示される URL の `/ui` にアクセスし、マスターキーでログイン。

### 3. ユーザー・キーの作成
```bash
# チーム作成
curl -X POST "${PROXY_URL}/team/new" \
  -H "Authorization: Bearer ${MASTER_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"team_alias": "dev-team", "models": ["claude-opus-4-6", "gemini-3.1-pro"]}'

# APIキー発行
curl -X POST "${PROXY_URL}/key/generate" \
  -H "Authorization: Bearer ${MASTER_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"user_id": "user@example.com", "models": ["claude-opus-4-6", "gemini-3.1-pro"], "max_budget": 50.0}'
```

### 4. Claude Code の接続

Claude Code 公式ドキュメント: https://code.claude.com/docs/en/llm-gateway

#### 方法A: Unified Endpoint（推奨）

LiteLLM の Anthropic 形式エンドポイントを使用。ロードバランシング・フォールバック対応。

`~/.claude/settings.json`:
```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://<your-proxy>.run.app",
    "ANTHROPIC_AUTH_TOKEN": "<your-api-key>"
  }
}
```

> **Note:** デフォルトでは Claude Code の標準モデルが使用されます。モデルを変更したい場合は `"ANTHROPIC_MODEL": "claude-opus-4-6"` を追加してください。

#### 方法B: Vertex AI Pass-through Endpoint

LiteLLM の Vertex AI パススルーを使用。Vertex AI ネイティブの API 形式を維持。

`~/.claude/settings.json`:
```json
{
  "env": {
    "ANTHROPIC_VERTEX_BASE_URL": "https://<your-proxy>.run.app/vertex_ai/v1",
    "ANTHROPIC_VERTEX_PROJECT_ID": "<your-gcp-project-id>",
    "CLOUD_ML_REGION": "us-east5",
    "CLAUDE_CODE_USE_VERTEX": "1",
    "CLAUDE_CODE_SKIP_VERTEX_AUTH": "1",
    "ANTHROPIC_AUTH_TOKEN": "<your-api-key>"
  }
}
```

### 5. Gemini CLI の接続
```bash
export GOOGLE_GEMINI_BASE_URL="https://<your-proxy>.run.app"
export GEMINI_API_KEY="<your-api-key>"
gemini "Hello!"
```

## 対応モデル

| モデル名 | プロバイダ | 用途 |
|---------|-----------|------|
| `claude-opus-4-6` | Anthropic (via Vertex AI) | 高度な推論・コーディング |
| `claude-sonnet-4-6` | Anthropic (via Vertex AI) | バランス型タスク |
| `gemini-3.1-pro` | Google (via Vertex AI) | 最新フラッグシップ推論 |
| `gemini-3.1-flash-lite` | Google (via Vertex AI) | 高速・低コスト |
| `gemini-2.5-pro` | Google (via Vertex AI) | 安定版高性能推論 |
| `gemini-2.0-flash` | Google (via Vertex AI) | 安定版高速推論 |

## ファイル構成

```
llm-gateway-demo/
├── README.md           # このファイル
├── Dockerfile          # LiteLLM コンテナ定義
├── config.yaml         # LiteLLM モデル・ログ設定
├── deploy.sh           # GCP デプロイスクリプト
├── demo-script.md      # デモ手順書
└── DASHBOARD.md        # Looker Studio 設定ガイド
```

## 詳細

- [デモスクリプト](./demo-script.md) — 顧客デモの手順書
- [ダッシュボード設定](./DASHBOARD.md) — Looker Studio 連携ガイド
