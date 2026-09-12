# Local/CI PostgreSQL 16 with PostGIS 3 and pgvector — the same extension set AWS RDS provides.
# Built by docker compose (service "postgres") and by CI; never used for production data.
#
# Base: the official `postgres` image on Debian 12 (bookworm), not `postgis/postgis`.
#
# `postgis/postgis:16-3.4` was Debian 11 (bullseye). Bullseye left full support in mid-2024, and
# once its `bullseye-security` Release metadata expired, `apt-get update` inside the build started
# failing signature-validity checks — so the image could no longer be built at all, and CI failed on
# the build rather than on anything in this repository. Upgrading to `postgis/postgis:16-3.5` does
# not fix it: that tag is still `FROM postgres:16-bullseye` upstream, so it inherits the same expired
# archive. (The `16-3.4` variant no longer exists in the upstream repository at all.) The only
# versions of that image on a supported Debian are unreleased PostGIS master builds — not something
# to run migrations against.
#
# The official image is maintained, is on a Debian release with years of support left, and — the
# reason this file is now three lines of apt — already carries the PostgreSQL APT (PGDG) repository
# it installed PostgreSQL from:
#
#   /etc/apt/sources.list.d/pgdg.list
#     deb [ signed-by=/usr/local/share/keyrings/postgres.gpg.asc ] \
#       http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main 16
#
# signed by the PostgreSQL Debian Repository key B97B0AFC AA1A47F0 44F244A0 7FCC7D46 ACCC4CF8. The
# extensions therefore come from the same signed repository as the server itself, verified by the
# same key, with no repository stanza, keyring or trust decision added here. Nothing weakens APT:
# no Check-Valid-Until override, no --allow-unauthenticated, no apt-key, no unsigned source.
FROM postgres:16-bookworm

# `postgresql-16-*` rather than an unversioned name: the extension binaries must match the server's
# major version, and Debian's own archive carries PostgreSQL 15, so an unpinned major would either
# install the wrong build or pull a second server. PostGIS is pinned to its major line (`-postgis-3`)
# because that is what decides `CREATE EXTENSION postgis` compatibility; patch versions float with
# the repository, as they do for the server in the base image.
#
# The two `test -f` assertions are the point of the layer, not decoration: they fail the build if a
# package is ever renamed or silently dropped, so "the image can run CREATE EXTENSION" is proven
# when the image is built rather than discovered when a migration runs.
RUN set -eux; \
  apt-get update; \
  apt-get install -y --no-install-recommends \
  postgresql-16-postgis-3 \
  postgresql-16-postgis-3-scripts \
  postgresql-16-pgvector; \
  rm -rf /var/lib/apt/lists/*; \
  test -f "$(pg_config --sharedir)/extension/postgis.control"; \
  test -f "$(pg_config --sharedir)/extension/vector.control"

# Extensions are created by application migrations (apps/api/drizzle/0000_platform_extensions.sql),
# not by init scripts, so local and cloud databases converge through the same code path. Deliberately
# no /docker-entrypoint-initdb.d script: `postgis/postgis` shipped one that created the extension in
# template1 and in POSTGRES_DB, which meant every database inherited PostGIS before migration 0000
# ran and that migration's own work was never actually exercised. Dropping it removes a second owner
# of the same schema decision — the integration harness creates each per-suite database and then runs
# `migrateUp` against it, so nothing depends on the template carrying extensions.
