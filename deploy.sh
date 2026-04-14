#!/bin/bash
set -euo pipefail

# ============================================================
# LLM Gateway Demo - Cloud Run Deployment Script
# Project: data-agent-bq
# ============================================================

PROJECT_ID="data-agent-bq"
REGION="asia-northeast1"
SERVICE_NAME="litellm-proxy"
SA_NAME="litellm-proxy-sa"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
CLOUD_SQL_INSTANCE="litellm-db"
CLOUD_SQL_CONNECTION="${PROJECT_ID}:${REGION}:${CLOUD_SQL_INSTANCE}"
PUBSUB_TOPIC="litellm-spend-logs"
BQ_DATASET="llm_gateway"
BQ_TABLE="spend_logs"
MASTER_KEY="${LITELLM_MASTER_KEY:-$(openssl rand -hex 16)}"
DB_PASSWORD="$(openssl rand -hex 16)"
DB_NAME="litellm"
DB_USER="litellm"

echo "🚀 LLM Gateway Demo Deployment"
echo "================================"
echo "Project:  ${PROJECT_ID}"
echo "Region:   ${REGION}"
echo ""

# --------------------------------------------------
# Step 1: Enable APIs
# --------------------------------------------------
echo "📦 Step 1: Enabling APIs..."
gcloud services enable \
  aiplatform.googleapis.com \
  run.googleapis.com \
  sqladmin.googleapis.com \
  pubsub.googleapis.com \
  bigquery.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  --project="${PROJECT_ID}"
echo "✅ APIs enabled"

# --------------------------------------------------
# Step 2: Create Service Account
# --------------------------------------------------
echo "👤 Step 2: Creating service account..."
gcloud iam service-accounts create "${SA_NAME}" \
  --display-name="LiteLLM Proxy Service Account" \
  --project="${PROJECT_ID}" 2>/dev/null || echo "  (already exists)"

ROLES=(
  "roles/aiplatform.user"
  "roles/cloudsql.client"
  "roles/pubsub.publisher"
  "roles/bigquery.dataEditor"
  "roles/secretmanager.secretAccessor"
)
for ROLE in "${ROLES[@]}"; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="${ROLE}" \
    --condition=None \
    --quiet
done
echo "✅ Service account configured"

# --------------------------------------------------
# Step 3: Create Cloud SQL Instance
# --------------------------------------------------
echo "🗄️ Step 3: Creating Cloud SQL PostgreSQL instance..."
if ! gcloud sql instances describe "${CLOUD_SQL_INSTANCE}" --project="${PROJECT_ID}" &>/dev/null; then
  gcloud sql instances create "${CLOUD_SQL_INSTANCE}" \
    --database-version=POSTGRES_15 \
    --tier=db-f1-micro \
    --region="${REGION}" \
    --project="${PROJECT_ID}" \
    --storage-auto-increase \
    --availability-type=zonal
  echo "  Waiting for instance to be ready..."
  gcloud sql instances patch "${CLOUD_SQL_INSTANCE}" \
    --project="${PROJECT_ID}" \
    --quiet
else
  echo "  (already exists)"
fi

# Create database and user
gcloud sql databases create "${DB_NAME}" \
  --instance="${CLOUD_SQL_INSTANCE}" \
  --project="${PROJECT_ID}" 2>/dev/null || echo "  (database already exists)"

gcloud sql users create "${DB_USER}" \
  --instance="${CLOUD_SQL_INSTANCE}" \
  --password="${DB_PASSWORD}" \
  --project="${PROJECT_ID}" 2>/dev/null || echo "  (user already exists, updating password)"
gcloud sql users set-password "${DB_USER}" \
  --instance="${CLOUD_SQL_INSTANCE}" \
  --password="${DB_PASSWORD}" \
  --project="${PROJECT_ID}"

DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}"
echo "✅ Cloud SQL ready"

# --------------------------------------------------
# Step 4: Create Pub/Sub Topic
# --------------------------------------------------
echo "📨 Step 4: Creating Pub/Sub topic..."
gcloud pubsub topics create "${PUBSUB_TOPIC}" \
  --project="${PROJECT_ID}" 2>/dev/null || echo "  (already exists)"
echo "✅ Pub/Sub topic ready"

# --------------------------------------------------
# Step 5: Create BigQuery Dataset & Pub/Sub Subscription
# --------------------------------------------------
echo "📊 Step 5: Setting up BigQuery..."
bq --project_id="${PROJECT_ID}" mk \
  --dataset \
  --location="${REGION}" \
  "${BQ_DATASET}" 2>/dev/null || echo "  (dataset already exists)"

# Create BigQuery table with LiteLLM spend log schema
bq --project_id="${PROJECT_ID}" mk \
  --table \
  "${BQ_DATASET}.${BQ_TABLE}" \
  'request_id:STRING,call_type:STRING,api_key:STRING,spend:FLOAT,total_tokens:INTEGER,prompt_tokens:INTEGER,completion_tokens:INTEGER,startTime:TIMESTAMP,endTime:TIMESTAMP,completionStartTime:TIMESTAMP,model:STRING,model_id:STRING,model_group:STRING,api_base:STRING,user:STRING,metadata:STRING,cache_hit:STRING,cache_key:STRING,request_tags:STRING,team_id:STRING,end_user:STRING,requester_ip_address:STRING,messages:STRING,response:STRING,status:STRING,error_str:STRING' \
  2>/dev/null || echo "  (table already exists)"

# Create Pub/Sub → BigQuery subscription
gcloud pubsub subscriptions create "${PUBSUB_TOPIC}-bq-sub" \
  --topic="${PUBSUB_TOPIC}" \
  --bigquery-table="${PROJECT_ID}:${BQ_DATASET}.${BQ_TABLE}" \
  --write-metadata \
  --project="${PROJECT_ID}" 2>/dev/null || echo "  (subscription already exists)"
echo "✅ BigQuery pipeline ready"

# --------------------------------------------------
# Step 6: Store Secrets
# --------------------------------------------------
echo "🔐 Step 6: Storing secrets..."
echo -n "${MASTER_KEY}" | gcloud secrets create litellm-master-key \
  --data-file=- \
  --project="${PROJECT_ID}" 2>/dev/null || \
  (echo -n "${MASTER_KEY}" | gcloud secrets versions add litellm-master-key \
    --data-file=- \
    --project="${PROJECT_ID}")

echo -n "${DATABASE_URL}" | gcloud secrets create litellm-database-url \
  --data-file=- \
  --project="${PROJECT_ID}" 2>/dev/null || \
  (echo -n "${DATABASE_URL}" | gcloud secrets versions add litellm-database-url \
    --data-file=- \
    --project="${PROJECT_ID}")
echo "✅ Secrets stored"

# --------------------------------------------------
# Step 7: Build & Deploy to Cloud Run
# --------------------------------------------------
echo "🏗️ Step 7: Building and deploying to Cloud Run..."

# Build container
gcloud builds submit \
  --tag "gcr.io/${PROJECT_ID}/${SERVICE_NAME}" \
  --project="${PROJECT_ID}"

# Deploy to Cloud Run
gcloud run deploy "${SERVICE_NAME}" \
  --image="gcr.io/${PROJECT_ID}/${SERVICE_NAME}" \
  --platform=managed \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --service-account="${SA_EMAIL}" \
  --port=4000 \
  --memory=1Gi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=3 \
  --allow-unauthenticated \
  --add-cloudsql-instances="${CLOUD_SQL_CONNECTION}" \
  --set-env-vars="LITELLM_MASTER_KEY=sm://${PROJECT_ID}/litellm-master-key" \
  --set-env-vars="DATABASE_URL=sm://${PROJECT_ID}/litellm-database-url" \
  --set-env-vars="GCS_PUBSUB_TOPIC_ID=${PUBSUB_TOPIC}" \
  --set-env-vars="GCS_PUBSUB_PROJECT_ID=${PROJECT_ID}" \
  --set-env-vars="GOOGLE_CLOUD_PROJECT=${PROJECT_ID}"

# Get the URL
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --format="value(status.url)")

echo ""
echo "============================================================"
echo "🎉 Deployment Complete!"
echo "============================================================"
echo ""
echo "📍 LiteLLM Proxy URL: ${SERVICE_URL}"
echo "🔑 Master Key:        ${MASTER_KEY}"
echo "🖥️ Dashboard:         ${SERVICE_URL}/ui"
echo ""
echo "📊 BigQuery Table:    ${PROJECT_ID}:${BQ_DATASET}.${BQ_TABLE}"
echo "📨 Pub/Sub Topic:     ${PUBSUB_TOPIC}"
echo "🗄️ Cloud SQL:         ${CLOUD_SQL_INSTANCE}"
echo ""
echo "Next steps:"
echo "  1. Open ${SERVICE_URL}/ui and log in with master key"
echo "  2. Create users and API keys (see demo-script.md)"
echo "  3. Configure Claude Code / Gemini CLI to use this proxy"
echo "  4. Connect BigQuery to Looker Studio for dashboards"
echo "============================================================"
