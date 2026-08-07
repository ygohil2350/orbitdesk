FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
RUN addgroup --system orbit && adduser --system --ingroup orbit orbit
COPY pyproject.toml ./
RUN pip install .
COPY --chown=orbit:orbit . .
RUN mkdir -p /app/uploads && chown orbit:orbit /app/uploads && chmod +x /app/entrypoint.sh
USER orbit
EXPOSE 8000
ENTRYPOINT ["/app/entrypoint.sh"]

