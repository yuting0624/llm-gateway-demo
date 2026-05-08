# LLM Gateway デモスクリプト

## 前提
- `deploy.sh` でデプロイ済み
- `PROXY_URL` と `MASTER_KEY` を控えておく

```bash
export PROXY_URL="https://<your-proxy>.run.app"
export MASTER_KEY="<your-master-key>"
```

---

## デモ1: 管理者 — ユーザー・チーム管理

### チームを作成
```bash
curl -X POST "${PROXY_URL}/team/new" \
  -H "Authorization: Bearer ${MASTER_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "team_alias": "engineering",
    "models": ["claude-opus-4-6", "claude-sonnet-4-6", "gemini-3.1-pro", "gemini-3.1-flash-lite", "gemini-2.5-pro", "gemini-2.0-flash"],
    "max_budget": 100.0
  }'
```

### ユーザーを作成してAPIキーを発行
```bash
# エンジニア向け（全モデルアクセス可）
curl -X POST "${PROXY_URL}/key/generate" \
  -H "Authorization: Bearer ${MASTER_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "tanaka@example.com",
    "team_id": "<TEAM_ID>",
    "models": ["claude-opus-4-6", "claude-sonnet-4-6", "gemini-3.1-pro", "gemini-3.1-flash-lite", "gemini-2.5-pro", "gemini-2.0-flash"],
    "max_budget": 50.0,
    "budget_duration": "monthly"
  }'

# インターン向け（軽量モデルのみ）
curl -X POST "${PROXY_URL}/key/generate" \
  -H "Authorization: Bearer ${MASTER_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "intern@example.com",
    "team_id": "<TEAM_ID>",
    "models": ["gemini-3.1-flash-lite", "gemini-2.0-flash", "claude-sonnet-4-6"],
    "max_budget": 10.0,
    "budget_duration": "monthly"
  }'
```

---

## デモ2: 開発者 — モデル利用

### Claude でリクエスト
```bash
export USER_KEY="sk-user-key-here"

curl -X POST "${PROXY_URL}/v1/chat/completions" \
  -H "Authorization: Bearer ${USER_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-opus-4-6",
    "messages": [{"role": "user", "content": "Pythonで簡単なWebサーバーを書いて"}],
    "max_tokens": 1024
  }'
```

### Gemini 3.1 Pro でリクエスト
```bash
curl -X POST "${PROXY_URL}/v1/chat/completions" \
  -H "Authorization: Bearer ${USER_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3.1-pro",
    "messages": [{"role": "user", "content": "KubernetesのPodセキュリティについて説明して"}],
    "max_tokens": 1024
  }'
```

### 予算超過テスト（インターンのキーでOpusを試す）
```bash
export INTERN_KEY="sk-intern-key-here"

# これは 403 エラーになるはず（Opusは許可されていない）
curl -X POST "${PROXY_URL}/v1/chat/completions" \
  -H "Authorization: Bearer ${INTERN_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-opus-4-6",
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 50
  }'
```

---

## デモ3: Claude Code 接続

### 開発者の ~/.claude/settings.json
```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://<your-proxy>.run.app",
    "ANTHROPIC_AUTH_TOKEN": "<your-api-key>",
    "ANTHROPIC_MODEL": "claude-opus-4-6"
  }
}
```

これだけで Claude Code の全通信がプロキシ経由に！

---

## デモ4: Gemini CLI 接続

```bash
export GOOGLE_GEMINI_BASE_URL="${PROXY_URL}"
export GEMINI_API_KEY="${USER_KEY}"

gemini "Hello from Gemini CLI via LLM Gateway!"
# Note: Gemini CLI経由だとgemini-3.1-proが自動的に使われる
```

---

## デモ5: 使用量の確認

### LiteLLM API で確認
```bash
# ユーザーの使用量
curl "${PROXY_URL}/user/info?user_id=tanaka@example.com" \
  -H "Authorization: Bearer ${MASTER_KEY}"

# チーム全体の使用量
curl "${PROXY_URL}/team/info?team_id=<TEAM_ID>" \
  -H "Authorization: Bearer ${MASTER_KEY}"

# キーの使用量
curl "${PROXY_URL}/key/info?key=sk-user-key-here" \
  -H "Authorization: Bearer ${MASTER_KEY}"
```

### BigQuery Federation でクエリ（Looker Studioにも接続可能）

BigQuery Federation を使い、Cloud SQL のデータを直接クエリします（セットアップは article.md 参照）。

```sql
-- モデル別日次コスト（Federation ビュー経由）
SELECT date, model, total_spend, request_count, total_tokens
FROM `<your-project-id>.llm_gateway.daily_model_spend`
ORDER BY date DESC, total_spend DESC;

-- ユーザー別日次コスト（Federation ビュー経由）
SELECT date, user_id, model, total_spend, api_requests
FROM `<your-project-id>.llm_gateway.daily_user_spend`
ORDER BY date DESC, total_spend DESC;
```

---

## 対応モデル一覧

| モデル名 | プロバイダ | 用途 |
|---------|-----------|------|
| `claude-opus-4-6` | Anthropic (Vertex AI) | 高度な推論・コーディング |
| `claude-sonnet-4-6` | Anthropic (Vertex AI) | バランス型タスク |
| `gemini-3.1-pro` | Google (Vertex AI) | 最新フラッグシップ推論 |
| `gemini-3.1-flash-lite` | Google (Vertex AI) | 高速・低コスト |
| `gemini-2.5-pro` | Google (Vertex AI) | 安定版高性能推論 |
| `gemini-2.0-flash` | Google (Vertex AI) | 安定版高速推論 |

---

## デモのポイント（話すべきこと）

1. **ガバナンス**: 誰がどのモデルを使えるか、予算上限を管理者が制御
2. **可視化**: BigQuery + Looker Studio でリアルタイムにコスト把握
3. **マルチモデル**: Claude も Gemini も同一プロキシで管理
4. **課金一本化**: すべて GCP 課金に集約（Anthropic 直接契約不要）
5. **セキュリティ**: IAM / Secret Manager / VPC Service Controls
6. **開発者体験**: Claude Code / Gemini CLI の設定は数行だけ
