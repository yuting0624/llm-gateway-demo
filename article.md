

## はじめに

**Vertex AI を使えば、Gemini だけでなく Claude も同じ GCP 環境で使える** — これはまだ意外と知られていない事実です。課金は GCP に一本化され、IAM で権限管理でき、Anthropic との直接契約も API キー管理も不要になります。

本シリーズでは、この Vertex AI のマルチモデル環境を段階的に構築してきました：

| | 記事 | テーマ |
|---|------|--------|
| 第1弾 | [Claude Code を Vertex AI でセキュアに使い倒す](https://zenn.dev/google_cloud_jp/articles/b65dc4d6df7f34) | 個人開発者向け：Claude Code × Vertex AI の基本セットアップ |
| 第2弾 | [Gemini 3.1 × Claude 4.6 で企画→マージを自動化](https://zenn.dev/google_cloud_jp/articles/412b26038374a9) | エージェント活用：ADK + Agent Engine でマルチモデル連携 |
| **第3弾** | **本記事** | **チーム運用：LLM Gateway で利用管理・コスト可視化** |

第1弾・第2弾で「個人で Claude を使う方法」「エージェントで活用する方法」をカバーしました。しかし、**チームで本格運用**するとなると新たな課題が出てきます：

- **誰がどのモデルをいくら使ったか**わからない
- Claude Code と Gemini CLI で**別々に管理**するのが面倒
- 個人・チームごとに**予算制限**をかけたい
- 利用状況を**ダッシュボードで可視化**したい

本記事では、**LiteLLM Proxy** を Cloud Run にデプロイし、Claude と Gemini を一元管理する **LLM Gateway** を構築します。さらに **BigQuery Federation** でリアルタイムにコストを可視化するところまでカバーします。すべて GCP マネージドサービス上で完結します。

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

### なぜ LiteLLM Proxy か

LLM のプロキシ/ゲートウェイは複数の選択肢がありますが、本記事では **LiteLLM Proxy** を採用しました。

| ソリューション | 特徴 | 予算管理 | セルフホスト |
|--------------|------|---------|------------|
| **LiteLLM Proxy** | 100+ モデル対応、OpenAI 互換 API、管理 UI 付き | ○（組み込み） | ○ |
| Portkey AI Gateway | エッジ配信、SOC2/HIPAA 認証 | ○ | △（有料） |
| Helicone | オブザーバビリティ特化 | △ | ○ |
| Cloudflare AI Gateway | CDN 統合、ワンライン導入 | ×（レート制限のみ） | × |
| Kong AI Gateway | API 管理全体の AI 拡張 | △ | ○ |

**LiteLLM を選んだ理由：**

1. **Claude Code 公式ドキュメントで唯一、具体的な設定手順が記載されている**ゲートウェイです（[LLM Gateway ドキュメント](https://docs.claude.com/en/docs/claude-code/llm-gateway)）。Vertex AI パススルーエンドポイントにも対応しており、Claude Code との連携がスムーズです
2. **Vertex AI との親和性が高い**。`vertex_ai/` プレフィックスで Gemini・Claude の両方をルーティングでき、Application Default Credentials や Workload Identity Federation での認証にも対応しています
3. **OSS でセルフホスト可能**。Cloud Run にデプロイすれば、利用ログやキー情報が外部 SaaS に送信されず、自社 GCP 環境内で完結します
4. **予算・チーム管理が組み込み済み**。Virtual Keys 機能でユーザー/チーム単位の予算設定、モデルアクセス制御が追加開発なしで使えます
5. **GitHub Stars 43,000 超の活発なコミュニティ**。100 以上の LLM プロバイダーに対応し、ドキュメントも充実しています

:::message
**注意事項：** LiteLLM は Anthropic や Google Cloud 公式が推奨・保守・監査するものではなく、あくまで情報提供としてドキュメントに記載されています。また、**2026 年 3 月に PyPI パッケージ（v1.82.7 / v1.82.8）がサプライチェーン攻撃を受けた事例**があります（該当バージョンは PyPI により約3時間で隔離・削除済み）。本番導入時は**バージョン固定・SBOM 管理・依存パッケージの継続的な脆弱性スキャン**を強く推奨します。
:::

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

:::message
**スモールスタート向けの構成です。** `db-f1-micro` は共有 vCPU・メモリ 614MB の最小ティアで、数十人規模のチームには十分ですが、利用者やリクエスト数が増えた場合は `db-g1-small` 以上へのスケールアップを検討してください。
:::

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

なお、本記事執筆時点のモデル名は `gemini-3.1-pro-preview` / `gemini-3.1-flash-lite-preview`（preview 版）です。GA 版がリリースされた場合はモデル名が変わる可能性があります。
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

:::message alert
**セキュリティ補足：本番運用時のアクセス制御**

デフォルトでは Cloud Run は公開アクセス可能な状態でデプロイされます。LiteLLM の API キー認証は有効ですが、URL が漏れれば認証試行は可能になります。本番環境では以下の多層防御を推奨します：

- **Identity-Aware Proxy (IAP)** で Google アカウントベースの認証層を追加
- **VPC Service Controls** で Vertex AI / Cloud SQL への通信を内部経路に限定
- **`--no-allow-unauthenticated`** + IAM ベース認証で特定サービスアカウントのみアクセス許可
- ログ監視（Cloud Logging / Cloud Monitoring アラート）で異常なリクエストを検知

本記事では検証用途のため `--allow-unauthenticated` を使用しています。
:::

<!-- TODO: スクリーンショット① LiteLLM UI ダッシュボード（${PROXY_URL}/ui にログインした画面） -->

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
デプロイ完了後、`${PROXY_URL}/ui` にアクセスすれば UI 構成画面が開きます。
![](https://storage.googleapis.com/zenn-user-upload/e0bfe33beab4-20260416.png)


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
もしくは UI 上で行います。
![](https://storage.googleapis.com/zenn-user-upload/030ab514bcb4-20260416.png)

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
UI 上でも作成可能です。
![](https://storage.googleapis.com/zenn-user-upload/815326448571-20260416.png)

予算を超えると API リクエストが自動的に拒否されるため、想定外のコスト増を防げます。

<!-- TODO: スクリーンショット② 予算超過時のエラーレスポンス例（curl 実行結果 or UI 上での表示） -->
<!-- TODO: スクリーンショット③ LiteLLM UI の Keys / Teams 管理画面 -->


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

<!-- TODO: スクリーンショット④ Claude Code と Gemini CLI が Gateway 経由で動作している様子（ターミナルの実行ログ） -->


### 🎉 応用: Gemini CLI で Claude を使う

LiteLLM の `model_group_alias` を使うと、**Gemini CLI からのリクエストを Claude にルーティング**できます。

```yaml
# config.yaml に追加
router_settings:
  model_group_alias:
    "gemini-2.5-pro": "claude-opus-4-6"
```

この設定により、Gemini CLI が送る `gemini-2.5-pro` リクエストが内部的に `claude-opus-4-6` にルーティングされます。バックエンドは同じ Vertex AI 経由なので、**Anthropic の API キーは不要**です。

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

代わりに BigQuery Federation を使えば、Cloud SQL のデータをリアルタイムで直接クエリできます。なお、`EXTERNAL_QUERY` は 1 回のクエリで返せる行数に制限があるため（デフォルト 10,000 行）、大量ログの集計には日次集計ビューの活用を推奨します。
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

![Looker Studio ダッシュボード例](https://storage.googleapis.com/zenn-user-upload/95a89d0904b7-20260416.png)
*モデル別コスト、ユーザー別コスト、日次推移を一目で把握*

おすすめのチャート構成：

| チャート | データソース | ディメンション | メトリクス |
|---------|-------------|--------------|-----------|
| 日別コスト推移 | `daily_model_spend` | `date` | `SUM(total_spend)` |
| モデル別コスト | `daily_model_spend` | `model` | `SUM(total_spend)` |
| ユーザー別コスト | `daily_user_spend` | `user_id` | `SUM(total_spend)` |
| モデル×日次積み上げ | `daily_model_spend` | `date`, `model` | `SUM(total_spend)` |

## まとめ

### Gateway なし vs あり

| | Gateway なし 😰 | Gateway あり 🎉 |
|---|---|---|
| **モデル管理** | Claude と Gemini を別々に契約・設定 | LiteLLM Proxy で一元管理、OpenAI 互換 API で統一 |
| **コスト把握** | 月末に請求書を見て驚く | BigQuery Federation でリアルタイムにダッシュボード確認 |
| **予算管理** | 制限なし、使い放題 | ユーザー/チーム単位で月額上限を設定、超過時は自動拒否 |
| **権限管理** | 全員が全モデルにアクセス可能 | API キーでモデルアクセスを制御（インターンは軽量モデルのみ等） |
| **開発者体験** | ツールごとに認証情報を管理 | Claude Code も Gemini CLI も設定数行で Gateway 経由に |
| **セキュリティ** | API キーが各開発者に分散 | Gateway が一括管理、個別キーは Gateway 発行の Virtual Key |

### 本シリーズの全体像

本シリーズ3記事を通じて、**Vertex AI を軸にしたマルチモデル AI 環境**を段階的に構築しました：

1. **[第1弾](https://zenn.dev/google_cloud_jp/articles/b65dc4d6df7f34)：個人で使う** — Claude Code × Vertex AI のセットアップと認証
2. **[第2弾](https://zenn.dev/google_cloud_jp/articles/412b26038374a9)：エージェントで活用する** — Gemini 3.1 × Claude をADK + Agent Engineで連携
3. **本記事：チームで運用する** — LLM Gateway で利用管理・コスト可視化

**すべて GCP のマネージドサービス上で完結**するため、インフラ管理の負担は最小限です。Cloud Run のスケーリング、Cloud SQL の自動バックアップ、BigQuery のサーバーレス分析基盤をそのまま活用できます。

### コスト目安

| コンポーネント | 月額概算 |
|--------------|---------|
| Cloud Run（min-instances=0） | $0〜10（利用量次第） |
| Cloud SQL（db-f1-micro） | ~$10 |
| BigQuery Federation | クエリ量に応じた従量課金 |
| **合計（インフラ）** | **~$10〜20/月** |

モデル利用料（Vertex AI）は別途かかりますが、Gateway 自体のインフラコストは月額 $20 以下に収まります。
