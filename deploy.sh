#!/bin/bash
set -euo pipefail

# ============================================================
# LLM Gateway Demo - Cloud Run Deployment Script
#
# Required env vars (override defaults via shell or .env):
#   PROJECT_ID       — GCP project to deploy into (REQUIRED)
#   REGION           — Cloud Run / Cloud SQL region (default: asia-northeast1)
#   SERVICE_NAME     — Cloud Run service name (default: litellm-proxy)
#
# Example:
#   PROJECT_ID=my-project ./deploy.sh
# ============================================================

PROJECT_ID="${PROJECT_ID:?Error: PROJECT_ID environment variable must be set (e.g. PROJECT_ID=my-gcp-project ./deploy.sh)}"
REGION="${REGION:-asia-northeast1}"
SERVICE_NAME="${SERVICE_NAME:-litellm-proxy}"
SA_NAME="litellm-proxy-sa"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
CLOUD_SQL_INSTANCE="litellm-db"
CLOUD_SQL_CONNECTION="${PROJECT_ID}:${REGION}:${CLOUD_SQL_INSTANCE}"
BQ_DATASET="llm_gateway"
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
  bigquery.googleapis.com \
  bigqueryconnection.googleapis.com \
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
  "roles/secretmanager.secretAccessor"
  "roles/logging.logWriter"
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

DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost/${DB_NAME}?host=/cloudsql/${CLOUD_SQL_CONNECTION}"
echo "✅ Cloud SQL ready"

# --------------------------------------------------
# Step 4: Create BigQuery Dataset (for Federation views)
# --------------------------------------------------
echo "📊 Step 4: Setting up BigQuery dataset..."
bq --project_id="${PROJECT_ID}" mk \
  --dataset \
  --location="${REGION}" \
  "${BQ_DATASET}" 2>/dev/null || echo "  (dataset already exists)"
echo "✅ BigQuery dataset ready (use BigQuery Federation to query Cloud SQL directly)"

# --------------------------------------------------
# Step 5: Store Secrets
# --------------------------------------------------
echo "🔐 Step 5: Storing secrets..."
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
# Step 6: Build & Deploy to Cloud Run
# --------------------------------------------------
echo "🏗️ Step 6: Building and deploying to Cloud Run..."

# Substitute the placeholder vertex_project in config.yaml into a temp build
# context so the working tree stays clean and end-users don't have to hand-edit
# config.yaml before running this script.
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "${BUILD_DIR}"' EXIT
cp Dockerfile "${BUILD_DIR}/Dockerfile"
sed "s|your-gcp-project-id|${PROJECT_ID}|g" config.yaml > "${BUILD_DIR}/config.yaml"

# Build container from the substituted context
gcloud builds submit "${BUILD_DIR}" \
  --tag "gcr.io/${PROJECT_ID}/${SERVICE_NAME}" \
  --project="${PROJECT_ID}"

# Deploy to Cloud Run
# NOTE: --allow-unauthenticated makes the proxy publicly accessible.
# LiteLLM enforces API key authentication, but for stricter access control
# consider using --no-allow-unauthenticated with IAM-based auth or IAP.
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
  --max-instances=5 \
  --allow-unauthenticated \
  --add-cloudsql-instances="${CLOUD_SQL_CONNECTION}" \
  --set-secrets="LITELLM_MASTER_KEY=litellm-master-key:latest,DATABASE_URL=litellm-database-url:latest" \
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
echo "📊 BigQuery Dataset:  ${PROJECT_ID}:${BQ_DATASET}"
echo "🗄️ Cloud SQL:         ${CLOUD_SQL_INSTANCE}"
echo ""
echo "Next steps:"
echo "  1. Open ${SERVICE_URL}/ui and log in with master key"
echo "  2. Create users and API keys (see demo-script.md)"
echo "  3. Configure Claude Code / Gemini CLI to use this proxy"
echo "  4. Set up BigQuery Federation (EXTERNAL_QUERY) to Cloud SQL"
echo "  5. Connect BigQuery views to Looker Studio for dashboards"
echo "============================================================"
