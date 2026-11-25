
from unittest.mock import MagicMock, patch

import pytest

from backend.app.repositories import leads_repo


@pytest.mark.parametrize(
    ("sort_by", "sort_order", "expected"),
    [
        ("discovered_at", "desc", "o.discovered_at DESC"),
        ("score", "asc", "COALESCE(dqs.score, 0) ASC"),
        ("experience_min", "asc", "o.experience_min ASC"),
        ("experience_max", "desc", "o.experience_max DESC"),
        ("organization_name", "asc", "org.name ASC"),
        ("title", "desc", "o.title DESC"),
    ],
)
def test_list_leads_uses_allowlisted_sorting(
    sort_by, sort_order, expected
):
    mock_cursor = MagicMock()
    mock_cursor.fetchone.return_value = (0,)
    mock_cursor.fetchall.return_value = []
    mock_cursor.description = []

    mock_conn = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cursor

    with patch.object(leads_repo, "get_conn") as mock_get_conn:
        mock_get_conn.return_value.__enter__.return_value = mock_conn

        leads_repo.list_leads(
            filters={
                "sort_by": sort_by,
                "sort_order": sort_order,
            }
        )

    executed_query = mock_cursor.execute.call_args_list[1].args[0]
    assert expected in executed_query
    assert "o.id ASC" in executed_query


def test_list_leads_rejects_unsafe_sort_input():
    mock_cursor = MagicMock()
    mock_cursor.fetchone.return_value = (0,)
    mock_cursor.fetchall.return_value = []
    mock_cursor.description = []

    mock_conn = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cursor

    with patch.object(leads_repo, "get_conn") as mock_get_conn:
        mock_get_conn.return_value.__enter__.return_value = mock_conn

        leads_repo.list_leads(
            filters={
                "sort_by": "title; DROP TABLE users;--",
                "sort_order": "DESC; DROP TABLE users;--",
            }
        )

    executed_query = mock_cursor.execute.call_args_list[1].args[0]

    assert "DROP TABLE" not in executed_query
    assert "ORDER BY o.discovered_at DESC" in executed_query
