#!/bin/bash
# Sync LiteLLM spend data to BigQuery
# Usage: ./sync-spend-to-bq.sh

PROXY_URL="https://litellm-proxy-258509337164.asia-northeast1.run.app"
MASTER_KEY="${LITELLM_MASTER_KEY:-84c24081344dd9ff627ead51880d243b}"
BQ_TABLE="data-agent-bq:llm_gateway.spend_logs"
TODAY=$(date -u +%Y-%m-%d)
TOMORROW=$(date -u -d "+1 day" +%Y-%m-%d)
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
                'sync_time': datetime.datetime.utcnow().isoformat()
            })
    
    for user, spend in users.items():
        if spend > 0:
            rows.append({
                'date': date,
                'user_id': user,
                'user_spend': spend,
                'sync_time': datetime.datetime.utcnow().isoformat()
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
