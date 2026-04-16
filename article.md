---
title: "Claude × Gemini マルチモデルゲートウェイを Cloud Run で構築する"
emoji: "🚀"
type: "tech"
topics: ["googlecloud", "vertexai", "claude", "gemini", "litellm"]
published: false
---

## はじめに

[前回の記事](https://zenn.dev/google_cloud_jp/articles/b65dc4d6df7f34)では、Claude Code を Vertex AI 経由でセキュアに使う方法を紹介しました。

しかし実際のチーム開発では、こんな課題が出てきます：

- **誰がどのモデルをいくら使ったか**わからない
- Claude Code と Gemini CLI で**別々に管理**するのが面倒
- エンジニアごとに**予算制限**をかけたい
- 利用状況を**ダッシュボードで可視化**したい

本記事では、**LiteLLM Proxy** を Cloud Run にデプロイし、Claude と Gemini を一元管理する **LLM Gateway** を構築します。さらに **BigQuery Federation** でリアルタイムにコストを可視化するところまでカバーします。

## アーキテクチャ

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ Claude Code  │  │ Gemini CLI  │  │ 任意の       │
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
   │ Vertex AI  │ │Cloud SQL│ │ BigQuery  │
   │            │ │(状態管理)│ │(Federation)│
   │ • Claude   │ └─────────┘ └──────┬───┘
   │ • Gemini   │                    │
   └────────────┘                    ▼
                             ┌──────────────┐
                             │Looker Studio │
                             │(ダッシュボード)│
                             └──────────────┘
```

### 使用する GCP プロダクト

| プロダクト | 用途 |
|-----------|------|
| **Cloud Run** | LiteLLM Proxy のホスティング |
| **Vertex AI** | Claude / Gemini モデルへのアクセス |
| **Cloud SQL (PostgreSQL)** | LiteLLM 内部状態（キー、チーム、予算） |
| **BigQuery** | Cloud SQL Federation でリアルタイム分析 |
| **Looker Studio** | ダッシュボード・可視化 |
| **Secret Manager** | マスターキー・DB 接続情報 |

## 1. 環境準備

### API の有効化

```bash
PROJECT_ID="your-project-id"
REGION="asia-northeast1"

gcloud services enable \
  aiplatform.googleapis.com \
  run.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com \
  bigquery.googleapis.com \
  bigqueryconnection.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  --project=$PROJECT_ID
```

### サービスアカウントの作成

```bash
SA_NAME="litellm-proxy-sa"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud iam service-accounts create $SA_NAME \
  --display-name="LiteLLM Proxy Service Account" \
  --project=$PROJECT_ID

# 必要なロールを付与
for ROLE in \
  roles/aiplatform.user \
  roles/cloudsql.client \
  roles/secretmanager.secretAccessor \
  roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="$ROLE" --quiet
done
```

## 2. Cloud SQL の準備

```bash
# インスタンス作成
gcloud sql instances create litellm-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=$REGION \
  --project=$PROJECT_ID

# データベースとユーザー作成
gcloud sql databases create litellm \
  --instance=litellm-db --project=$PROJECT_ID

gcloud sql users create litellm \
  --instance=litellm-db \
  --password="$(openssl rand -hex 16)" \
  --project=$PROJECT_ID
```

## 3. LiteLLM の設定

### config.yaml

ここが本記事のポイントです。**Claude と Gemini の両方を 1 つの Gateway で管理**します。

```yaml
model_list:
  # Claude Models (via Vertex AI - global)
  - model_name: claude-opus-4-6
    litellm_params:
      model: vertex_ai/claude-opus-4-6
      vertex_project: "your-project-id"
      vertex_location: "global"

  - model_name: claude-sonnet-4-6
    litellm_params:
      model: vertex_ai/claude-sonnet-4-6
      vertex_project: "your-project-id"
      vertex_location: "global"

  # Gemini 3.1 Models (global endpoint)
  - model_name: gemini-3.1-pro
    litellm_params:
      model: vertex_ai/gemini-3.1-pro-preview
      vertex_project: "your-project-id"
      vertex_location: "global"
      api_base: "https://aiplatform.googleapis.com/v1/projects/your-project-id/locations/global/publishers/google/models/gemini-3.1-pro-preview"

  - model_name: gemini-3.1-flash-lite
    litellm_params:
      model: vertex_ai/gemini-3.1-flash-lite-preview
      vertex_project: "your-project-id"
      vertex_location: "global"
      api_base: "https://aiplatform.googleapis.com/v1/projects/your-project-id/locations/global/publishers/google/models/gemini-3.1-flash-lite-preview"

litellm_settings:
  drop_params: true

general_settings:
  master_key: "os.environ/LITELLM_MASTER_KEY"
  database_url: "os.environ/DATABASE_URL"
```

:::message alert
**Gemini 3.1 の落とし穴：global エンドポイント**

Gemini 3.1 系モデルは Vertex AI の **global リージョン**でのみ利用可能です。ただし、通常の `{region}-aiplatform.googleapis.com` 形式ではなく、**リージョンプレフィックスなし**の `aiplatform.googleapis.com` を使う必要があります。

LiteLLM で `vertex_location: "global"` を指定しただけでは `global-aiplatform.googleapis.com` にアクセスしてしまい、404 エラーになります。`api_base` で直接エンドポイントを指定することで解決します。
:::

### Dockerfile

LiteLLM 公式イメージでは Prisma DB エンジンが正常に動作しなかったため、カスタム Dockerfile を使用します。

```dockerfile
FROM python:3.12-slim

RUN pip install --no-cache-dir 'litellm[proxy]' prisma

COPY config.yaml .

RUN prisma generate --schema \
  /usr/local/lib/python3.12/site-packages/litellm/proxy/schema.prisma

ENV DATABASE_URL=""
ENV LITELLM_MASTER_KEY=""

EXPOSE 4000

CMD ["litellm", "--config", "config.yaml", "--host", "0.0.0.0", "--port", "4000"]
```

## 4. Cloud Run へのデプロイ

```bash
# シークレットの保存
MASTER_KEY=$(openssl rand -hex 16)
DB_PASSWORD="your-db-password"
CONNECTION_NAME=$(gcloud sql instances describe litellm-db \
  --format="value(connectionName)" --project=$PROJECT_ID)
DATABASE_URL="postgresql://litellm:${DB_PASSWORD}@localhost/litellm?host=/cloudsql/${CONNECTION_NAME}&schema=public"

echo -n "$MASTER_KEY" | gcloud secrets create litellm-master-key \
  --data-file=- --project=$PROJECT_ID
echo -n "$DATABASE_URL" | gcloud secrets create litellm-database-url \
  --data-file=- --project=$PROJECT_ID

# コンテナビルド & デプロイ
gcloud builds submit --tag "gcr.io/${PROJECT_ID}/litellm-proxy" \
  --project=$PROJECT_ID

gcloud run deploy litellm-proxy \
  --image="gcr.io/${PROJECT_ID}/litellm-proxy" \
  --platform=managed \
  --region=$REGION \
  --service-account=$SA_EMAIL \
  --add-cloudsql-instances=$CONNECTION_NAME \
  --set-secrets="LITELLM_MASTER_KEY=litellm-master-key:latest,DATABASE_URL=litellm-database-url:latest" \
  --port=4000 \
  --memory=1Gi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=5 \
  --project=$PROJECT_ID
```

デプロイが完了したら、動作確認します：

```bash
PROXY_URL=$(gcloud run services describe litellm-proxy \
  --region=$REGION --format="value(status.url)" --project=$PROJECT_ID)

# Claude でテスト
curl -s "${PROXY_URL}/v1/chat/completions" \
  -H "Authorization: Bearer ${MASTER_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-6",
    "messages": [{"role": "user", "content": "こんにちは！"}],
    "max_tokens": 50
  }' | jq .choices[0].message.content

# Gemini 3.1 Pro でテスト
curl -s "${PROXY_URL}/v1/chat/completions" \
  -H "Authorization: Bearer ${MASTER_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3.1-pro",
    "messages": [{"role": "user", "content": "Hello!"}],
    "max_tokens": 50
  }' | jq .choices[0].message.content
```

## 5. ユーザー・チーム管理

LiteLLM Gateway の真価は、**ユーザーごとの権限管理と予算制限**にあります。

### チームの作成

```bash
# エンジニアリングチーム（全モデル、月 $500 まで）
curl -X POST "${PROXY_URL}/team/new" \
  -H "Authorization: Bearer ${MASTER_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "team_alias": "engineering",
    "models": ["claude-opus-4-6", "claude-sonnet-4-6", "gemini-3.1-pro", "gemini-3.1-flash-lite"],
    "max_budget": 500.0
  }'
```

### ユーザーの作成と API キー発行

```bash
# フルアクセスのエンジニア（月 $100 まで）
curl -X POST "${PROXY_URL}/key/generate" \
  -H "Authorization: Bearer ${MASTER_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "tanaka@example.com",
    "team_id": "<team_id>",
    "max_budget": 100.0,
    "models": ["claude-opus-4-6", "claude-sonnet-4-6", "gemini-3.1-pro", "gemini-3.1-flash-lite"]
  }'

# Gemini のみのインターン（月 $20 まで）
curl -X POST "${PROXY_URL}/key/generate" \
  -H "Authorization: Bearer ${MASTER_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "intern@example.com",
    "max_budget": 20.0,
    "models": ["gemini-3.1-flash-lite"]
  }'
```

予算を超えると API リクエストが自動的に拒否されるため、想定外のコスト増を防げます。

## 6. Claude Code / Gemini CLI の接続

### Claude Code

`~/.claude/settings.json` に以下を追加するだけで、Claude Code の全リクエストが Gateway 経由になります：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://litellm-proxy-xxxxx.run.app",
    "ANTHROPIC_AUTH_TOKEN": "<your-api-key>"
  }
}
```

:::details Vertex AI パススルーエンドポイントを使う場合
```json
{
  "env": {
    "ANTHROPIC_VERTEX_BASE_URL": "https://litellm-proxy-xxxxx.run.app/vertex_ai/v1",
    "ANTHROPIC_VERTEX_PROJECT_ID": "your-project-id",
    "CLOUD_ML_REGION": "us-east5",
    "CLAUDE_CODE_USE_VERTEX": "1",
    "CLAUDE_CODE_SKIP_VERTEX_AUTH": "1",
    "ANTHROPIC_AUTH_TOKEN": "<your-api-key>"
  }
}
```
:::

### Gemini CLI

`~/.bashrc` または `~/.zshrc` に追加：

```bash
export GOOGLE_GEMINI_BASE_URL="https://litellm-proxy-xxxxx.run.app"
export GEMINI_API_KEY="<your-api-key>"
```

これで `gemini "Hello!"` が Gateway 経由で動きます。

### 🎉 応用: Gemini CLI で Claude を使う

LiteLLM の `model_group_alias` を使うと、**Gemini CLI からのリクエストを Claude にルーティング**できます。

```yaml
# config.yaml に追加
router_settings:
  model_group_alias:
    "gemini-2.5-pro": "claude-sonnet-4-6"
```

この設定により、Gemini CLI が送る `gemini-2.5-pro` リクエストが内部的に `claude-sonnet-4-6` にルーティングされます。バックエンドは同じ Vertex AI 経由なので、**Anthropic の API キーは不要**です。

```
Gemini CLI → "gemini-2.5-pro" → LiteLLM Proxy
  → model_group_alias で "claude-sonnet-4-6" にマップ
  → Vertex AI 経由で Claude を呼び出し
```

## 7. BigQuery Federation でリアルタイムコスト可視化

LiteLLM は利用ログを Cloud SQL（PostgreSQL）に自動保存します。**BigQuery Federation** を使えば、ETL パイプラインなしでリアルタイムにクエリできます。

:::message alert
**ハマりポイント：`gcs_pubsub` は有料機能**

LiteLLM の `gcs_pubsub` コールバック（Pub/Sub → BigQuery にストリーミング）は **LiteLLM Enterprise（有料）限定**です。OSS 版では 403 エラーになります。

代わりに BigQuery Federation を使えば、Cloud SQL のデータをリアルタイムで直接クエリできます。
:::

### BigQuery 外部接続の作成

```bash
# Cloud SQL への接続を作成
bq mk --connection \
  --connection_type=CLOUD_SQL \
  --properties='{"instanceId":"'$PROJECT_ID':'$REGION':litellm-db","database":"litellm","type":"POSTGRES"}' \
  --connection_credential='{"username":"litellm","password":"'$DB_PASSWORD'"}' \
  --project_id=$PROJECT_ID \
  --location=$REGION \
  litellm-sql-connection

# 接続サービスアカウントに Cloud SQL Client ロールを付与
BQ_SA=$(bq show --connection --format=json \
  $PROJECT_ID.$REGION.litellm-sql-connection | jq -r '.cloudSql.serviceAccountId')

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${BQ_SA}" \
  --role="roles/cloudsql.client" --quiet
```

### BigQuery ビューの作成

```sql
-- モデル別日次コスト
CREATE OR REPLACE VIEW `your-project.llm_gateway.daily_model_spend` AS
SELECT * FROM EXTERNAL_QUERY(
  'your-project.asia-northeast1.litellm-sql-connection',
  "SELECT DATE(\"startTime\") as date, model,
          SUM(spend) as total_spend,
          COUNT(*) as request_count,
          SUM(total_tokens) as total_tokens
   FROM \"LiteLLM_SpendLogs\"
   GROUP BY DATE(\"startTime\"), model"
);

-- ユーザー別日次コスト
CREATE OR REPLACE VIEW `your-project.llm_gateway.daily_user_spend` AS
SELECT * FROM EXTERNAL_QUERY(
  'your-project.asia-northeast1.litellm-sql-connection',
  "SELECT date, user_id, model,
          SUM(spend) as total_spend,
          SUM(prompt_tokens) as prompt_tokens,
          SUM(completion_tokens) as completion_tokens,
          SUM(api_requests) as api_requests
   FROM \"LiteLLM_DailyUserSpend\"
   GROUP BY date, user_id, model"
);
```

### Looker Studio でダッシュボード作成

BigQuery のビューをデータソースとして接続すれば、リアルタイムダッシュボードが完成です。

![Looker Studio ダッシュボード例](/images/llm-gateway-looker-dashboard.png)
*モデル別コスト、ユーザー別コスト、日次推移を一目で把握*

おすすめのチャート構成：

| チャート | データソース | ディメンション | メトリクス |
|---------|-------------|--------------|-----------|
| 日別コスト推移 | `daily_model_spend` | `date` | `SUM(total_spend)` |
| モデル別コスト | `daily_model_spend` | `model` | `SUM(total_spend)` |
| ユーザー別コスト | `daily_user_spend` | `user_id` | `SUM(total_spend)` |
| モデル×日次積み上げ | `daily_model_spend` | `date`, `model` | `SUM(total_spend)` |

## まとめ

本記事で構築した LLM Gateway により、以下が実現できます：

| 課題 | 解決策 |
|------|--------|
| モデル管理の分散 | LiteLLM Proxy で Claude + Gemini を一元管理 |
| コスト把握の困難 | BigQuery Federation でリアルタイム可視化 |
| 予算超過リスク | ユーザー/チーム単位の予算制限 |
| 権限管理の欠如 | API キーによるモデルアクセス制御 |
| ツールの互換性 | Claude Code / Gemini CLI 両方対応 |

**すべて GCP のマネージドサービス上で完結**するため、インフラ管理の負担は最小限です。Cloud Run のスケーリング、Cloud SQL の自動バックアップ、BigQuery のサーバーレス分析基盤をそのまま活用できます。

### コスト目安

| コンポーネント | 月額概算 |
|--------------|---------|
| Cloud Run（min-instances=0） | $0〜10（利用量次第） |
| Cloud SQL（db-f1-micro） | ~$10 |
| BigQuery Federation | クエリ量に応じた従量課金 |
| **合計（インフラ）** | **~$10〜20/月** |

モデル利用料（Vertex AI）は別途かかりますが、Gateway 自体のインフラコストは月額 $20 以下に収まります。

### リポジトリ

本記事のコードは GitHub で公開しています：

https://github.com/yuting0624/llm-gateway-demo

---

**前回の記事もあわせてどうぞ 👇**

https://zenn.dev/google_cloud_jp/articles/b65dc4d6df7f34
