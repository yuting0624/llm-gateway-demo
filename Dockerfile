FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev curl && \
    rm -rf /var/lib/apt/lists/*

# Install LiteLLM with proxy support
RUN pip install --no-cache-dir \
    'litellm[proxy]' \
    prisma \
    google-cloud-aiplatform \
    google-cloud-pubsub

# Generate Prisma client with a dummy DB URL (needed for client generation only)
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN prisma generate --schema /usr/local/lib/python3.12/site-packages/litellm/proxy/schema.prisma || \
    python -c "from litellm.proxy.utils import PrismaClient; print('prisma ok')" || \
    find / -name "schema.prisma" -path "*/litellm/*" 2>/dev/null
ENV DATABASE_URL=""

COPY config.yaml /app/config.yaml

EXPOSE 4000

CMD ["litellm", "--config", "/app/config.yaml", "--port", "4000"]
