FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev curl && \
    rm -rf /var/lib/apt/lists/*

# LiteLLM version is pinned for reproducibility / supply-chain safety.
# See https://github.com/BerriAI/litellm/releases for newer stable releases.
# Bump intentionally and re-test (the proxy occasionally regresses on
# the /v1/messages translation path used by Claude Code).
ARG LITELLM_VERSION=1.83.14
RUN pip install --no-cache-dir \
    "litellm[proxy]==${LITELLM_VERSION}" \
    prisma \
    google-cloud-aiplatform

# Generate Prisma client with a dummy DB URL (needed for client generation only)
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN prisma generate --schema /usr/local/lib/python3.12/site-packages/litellm/proxy/schema.prisma || \
    python -c "from litellm.proxy.utils import PrismaClient; print('prisma ok')" || \
    find / -name "schema.prisma" -path "*/litellm/*" 2>/dev/null
ENV DATABASE_URL=""

COPY config.yaml /app/config.yaml

EXPOSE 4000

CMD ["litellm", "--config", "/app/config.yaml", "--host", "0.0.0.0", "--port", "4000"]
