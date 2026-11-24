"""PostgreSQL persistence for campaign records."""

from uuid import UUID

from psycopg.rows import dict_row

from backend.app.core.db import get_conn


def list_campaigns() -> list[dict]:
    with get_conn() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute("""
            SELECT id, name, purpose, status, daily_limit
            FROM campaigns ORDER BY created_at DESC, id
        """)
        return cur.fetchall()


def get_campaign_by_id(campaign_id: UUID) -> dict | None:
    with get_conn() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute("""
            SELECT id, name, purpose, status, daily_limit
            FROM campaigns WHERE id = %s
        """, (campaign_id,))
        return cur.fetchone()


def create_campaign(*, name: str, purpose: str, status: str, daily_limit: int, created_by: str) -> dict:
    with get_conn() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute("""
            INSERT INTO campaigns (name, purpose, status, daily_limit, created_by)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id, name, purpose, status, daily_limit
        """, (name, purpose, status, daily_limit, created_by))
        return cur.fetchone()


def update_campaign(campaign_id: UUID, *, name: str | None = None, purpose: str | None = None,
                    status: str | None = None, daily_limit: int | None = None) -> dict | None:
    with get_conn() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute("""
            UPDATE campaigns
            SET name = COALESCE(%s, name), purpose = COALESCE(%s, purpose),
                status = COALESCE(%s, status), daily_limit = COALESCE(%s, daily_limit),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = %s
            RETURNING id, name, purpose, status, daily_limit
        """, (name, purpose, status, daily_limit, campaign_id))
        return cur.fetchone()


def delete_campaign(campaign_id: UUID) -> bool:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM campaigns WHERE id = %s", (campaign_id,))
        return cur.rowcount == 1
