# Local/CI PostgreSQL 16 with PostGIS 3 and pgvector — the same extension set AWS RDS provides.
# Built by docker compose (service "postgres") and by CI; never used for production data.
FROM postgis/postgis:16-3.4

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-16-pgvector \
  && rm -rf /var/lib/apt/lists/*

# Extensions are created by application migrations (apps/api/drizzle), not by init scripts,
# so local and cloud databases converge through the same code path.
