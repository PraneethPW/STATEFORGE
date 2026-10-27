FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN apt-get update && apt-get install -y --no-install-recommends spin gcc libc6-dev ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pyproject.toml requirements.lock ./
COPY app ./app
COPY migrations ./migrations
RUN pip install --no-cache-dir -c requirements.lock . && useradd --uid 10001 --create-home stateforge
USER stateforge
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --timeout-graceful-shutdown 10 --proxy-headers --forwarded-allow-ips '*'"]
