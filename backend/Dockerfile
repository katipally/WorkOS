FROM python:3.12-slim

WORKDIR /app

# Install system deps + Node.js (needed for npm-based MCP stdio servers)
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy project files
COPY pyproject.toml uv.lock* ./

# Install dependencies
RUN uv sync --no-dev --frozen 2>/dev/null || uv sync --no-dev

# Copy source code
COPY src/ src/

# Create data directory
RUN mkdir -p /app/data

ENV PYTHONPATH=/app/src
ENV WORKOS_DATABASE_PATH=/app/data/workos.db

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "workos.main:app", "--host", "0.0.0.0", "--port", "8000"]
