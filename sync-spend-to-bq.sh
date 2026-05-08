#!/bin/bash
# Sync LiteLLM spend data to BigQuery (batch load approach)
#
# NOTE: This script is an ALTERNATIVE to BigQuery Federation.
# If you set up BigQuery Federation (EXTERNAL_QUERY to Cloud SQL),
# you do NOT need this script — data is queried in real-time.
# Use this script only if you want periodic BQ snapshots instead.
#
# Usage:
#   PROJECT_ID=my-project \
#   PROXY_URL=https://my-proxy.run.app \
#   LITELLM_MASTER_KEY=xxx \
#   ./sync-spend-to-bq.sh

PROJECT_ID="${PROJECT_ID:?Error: PROJECT_ID environment variable must be set}"
PROXY_URL="${PROXY_URL:?Error: PROXY_URL environment variable must be set (e.g. https://litellm-proxy-xxxxx.run.app)}"
MASTER_KEY="${LITELLM_MASTER_KEY:?Error: LITELLM_MASTER_KEY environment variable must be set}"
BQ_DATASET="${BQ_DATASET:-llm_gateway}"
BQ_TABLE="${PROJECT_ID}:${BQ_DATASET}.spend_logs"
TODAY=$(date -u +%Y-%m-%d)
if [[ "$(uname)" == "Darwin" ]]; then
  TOMORROW=$(date -u -v+1d +%Y-%m-%d)
else
  TOMORROW=$(date -u -d "+1 day" +%Y-%m-%d)
fi
TMPFILE=$(mktemp /tmp/spend-XXXXXX.json)

echo "Syncing spend data for ${TODAY}..."

# Get spend per model
curl -s "${PROXY_URL}/spend/logs?start_date=${TODAY}&end_date=${TOMORROW}" \
  -H "Authorization: Bearer ${MASTER_KEY}" | python3 -c "
import sys, json, datetime

data = json.load(sys.stdin)
if not isinstance(data, list):
    print('No data', file=sys.stderr)
    sys.exit(0)

rows = []
for entry in data:
    date = entry.get('startTime', '$TODAY')
    models = entry.get('models', {})
    users = entry.get('users', {})
    
    for model, spend in models.items():
        if spend > 0:
            rows.append({
                'date': date,
                'model': model,
                'spend': spend,
                'sync_time': datetime.datetime.now(datetime.timezone.utc).isoformat()
            })
    
    for user, spend in users.items():
        if spend > 0:
            rows.append({
                'date': date,
                'user_id': user,
                'user_spend': spend,
                'sync_time': datetime.datetime.now(datetime.timezone.utc).isoformat()
            })

for row in rows:
    print(json.dumps(row))
" > "${TMPFILE}"

if [ -s "${TMPFILE}" ]; then
    echo "Loading $(wc -l < ${TMPFILE}) rows into BigQuery..."
    bq load --source_format=NEWLINE_DELIMITED_JSON \
      --autodetect \
      "${BQ_TABLE}" "${TMPFILE}"
    echo "Done!"
else
    echo "No data to sync"
fi

rm -f "${TMPFILE}"
