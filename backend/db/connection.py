import logging
import asyncpg
from pathlib import Path

logger = logging.getLogger(__name__)

_pool: asyncpg.Pool | None = None


async def init_db_pool(database_url: str) -> None:
    global _pool
    _pool = await asyncpg.create_pool(database_url, min_size=2, max_size=10)


async def get_db_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("DB pool not initialized. Call init_db_pool() first.")
    return _pool


def get_pool() -> asyncpg.Pool:
    """Synchronous access to the already-initialised pool.

    Use this inside ``async def`` handlers that don't need to ``await``
    the pool creation — the pool must already be initialised via
    ``init_db_pool()`` during app startup.
    """
    if _pool is None:
        raise RuntimeError("DB pool not initialized. Call init_db_pool() first.")
    return _pool


async def close_db_pool() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


async def _refresh_collation() -> None:
    """Silence collation-version-mismatch warnings.

    When the glibc version inside the container differs from the one used
    when the database/cluster was *initdb*'d PostgreSQL emits a WARNING on
    every connection.  ``REFRESH COLLATION VERSION`` acknowledges the new
    version and suppresses the warning.
    """
    pool = await get_db_pool()
    databases = ["ai_workforce", "postgres", "template1"]
    for db_name in databases:
        try:
            async with pool.acquire() as conn:
                await conn.execute(
                    f"ALTER DATABASE {db_name} REFRESH COLLATION VERSION"
                )
                print(f"[collation] refreshed collation version for {db_name}")
        except Exception as e:
            # Non-fatal: the warning is cosmetic
            print(f"[collation] refresh skipped for {db_name}: {e}")


async def run_migrations() -> None:
    """Apply pending SQL migrations in filename order, tracking applied files in
    the schema_migrations table to ensure each file runs exactly once."""
    migrations_dir = Path(__file__).parent / "migrations"
    sql_files = sorted(migrations_dir.glob("*.sql"))
    if not sql_files:
        return

    pool = await get_db_pool()

    # Bootstrap: create the tracking table if it doesn't exist yet.
    # This table is intentionally managed in code, not via a migration file,
    # to avoid a chicken-and-egg dependency.
    async with pool.acquire() as conn:
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                filename   TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ DEFAULT NOW()
            )
            """
        )
        applied: set[str] = {
            row["filename"]
            for row in await conn.fetch("SELECT filename FROM schema_migrations")
        }

    for migration_file in sql_files:
        name = migration_file.name
        if name in applied:
            logger.debug("[migrations] skipping already-applied: %s", name)
            continue

        logger.info("[migrations] applying: %s", name)
        sql = migration_file.read_text()
        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(sql)
                await conn.execute(
                    "INSERT INTO schema_migrations (filename) VALUES ($1)", name
                )
        logger.info("[migrations] applied: %s", name)
