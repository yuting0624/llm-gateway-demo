# LLM Gateway デモスクリプト

## 前提
- `deploy.sh` でデプロイ済み
- `PROXY_URL` と `MASTER_KEY` を控えておく

```bash
export PROXY_URL="https://litellm-proxy-xxxxx.run.app"
export MASTER_KEY="sk-your-master-key"
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
    "models": ["claude-opus-4-6", "claude-sonnet-4-6", "gemini-3.1-pro", "gemini-3.1-flash"],
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
    "models": ["claude-opus-4-6", "claude-sonnet-4-6", "gemini-3.1-pro", "gemini-3.1-flash"],
    "max_budget": 50.0,
    "budget_duration": "monthly"
  }'

# インターン向け（Flash のみ）
curl -X POST "${PROXY_URL}/key/generate" \
  -H "Authorization: Bearer ${MASTER_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "intern@example.com",
    "team_id": "<TEAM_ID>",
    "models": ["gemini-3.1-flash", "claude-sonnet-4-6"],
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

### Gemini でリクエスト
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
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

---

## デモ3: Claude Code 接続

### 開発者の ~/.claude/settings.json
```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://litellm-proxy-xxxxx.run.app",
    "ANTHROPIC_AUTH_TOKEN": "sk-user-key-here",
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

### BigQuery でクエリ（Looker Studioにも接続可能）
```sql
-- モデル別コスト集計
SELECT
  model,
  COUNT(*) AS request_count,
  SUM(spend) AS total_cost,
  SUM(total_tokens) AS total_tokens,
  AVG(TIMESTAMP_DIFF(endTime, startTime, MILLISECOND)) AS avg_latency_ms
FROM `data-agent-bq.llm_gateway.spend_logs`
WHERE startTime >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
GROUP BY model
ORDER BY total_cost DESC;

-- ユーザー別コスト（日別推移）
SELECT
  user,
  DATE(startTime) AS date,
  SUM(spend) AS daily_cost,
  COUNT(*) AS requests
FROM `data-agent-bq.llm_gateway.spend_logs`
GROUP BY user, date
ORDER BY date DESC, daily_cost DESC;

-- 利用パターン（時間帯別）
SELECT
  EXTRACT(HOUR FROM startTime) AS hour_of_day,
  model,
  COUNT(*) AS requests
FROM `data-agent-bq.llm_gateway.spend_logs`
GROUP BY hour_of_day, model
ORDER BY hour_of_day;
```

---

## デモのポイント（話すべきこと）

1. **ガバナンス**: 誰がどのモデルを使えるか、予算上限を管理者が制御
2. **可視化**: BigQuery + Looker Studio でリアルタイムにコスト把握
3. **マルチモデル**: Claude も Gemini も同一プロキシで管理
4. **課金一本化**: すべて GCP 課金に集約（Anthropic 直接契約不要）
5. **セキュリティ**: IAM / Secret Manager / VPC Service Controls
6. **開発者体験**: Claude Code / Gemini CLI の設定は数行だけ
