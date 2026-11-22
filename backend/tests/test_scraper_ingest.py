"""BE-24 tests. DB tests need DATABASE_URL set before pytest starts."""

import os

import pytest

URL = "/api/v1/webhooks/scraper-ingest"
HEADERS = {"X-Scraper-Secret": "test-scraper-secret"}
SRC = "it_ingest"


def item(n, **kw):
    d = {"source_identifier": f"it-{n}", "source_url": f"https://example.com/it-{n}",
         "company_name": f"ItIngest Co {n} Pvt Ltd", "title": f"Intern {n}",
         "opportunity_type": "internship"}
    d.update(kw)
    return d


def post(client, items):
    return client.post(URL, json={"source_id": SRC, "items": items}, headers=HEADERS)


def test_bad_secret_is_401(client):
    r = client.post(URL, json={"source_id": SRC, "items": []}, headers={"X-Scraper-Secret": "x"})
    assert r.status_code == 401


def test_over_200_is_400(client):
    r = post(client, [item(i) for i in range(201)])
    assert r.status_code == 400


def _db_ok():
    url = os.environ.get("DATABASE_URL")
    if not url:
        return False
    try:
        import psycopg
        psycopg.connect(url, connect_timeout=3).close()
        return True
    except Exception:
        return False


db_only = pytest.mark.skipif(not _db_ok(), reason="no database")


@pytest.fixture()
def db():
    import psycopg
    with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True) as conn:
        def clean():
            conn.execute("DELETE FROM opportunities WHERE source_id = %s", (SRC,))
            conn.execute("DELETE FROM organizations WHERE normalized_name LIKE %s", ("itingest%",))
            conn.execute("DELETE FROM sources WHERE id = %s", (SRC,))
        clean()
        conn.execute("INSERT INTO sources (id,name,base_url,is_enabled,status) "
                     "VALUES (%s,'IT','https://example.com',true,'healthy')", (SRC,))
        yield conn
        clean()


def count(db, table):
    where = "source_id = %s" if table == "opportunities" else "normalized_name LIKE %s"
    arg = SRC if table == "opportunities" else "itingest%"
    return db.execute(f"SELECT count(*) FROM {table} WHERE {where}", (arg,)).fetchone()[0]


@pytest.mark.integration_db
@db_only
def test_same_batch_twice_creates_no_duplicates(client, db):
    batch = [item(i) for i in range(5)]
    first = post(client, batch).json()
    assert (first["inserted"], first["skipped"]) == (5, 0)
    second = post(client, batch).json()
    assert (second["inserted"], second["updated"], second["skipped"]) == (0, 0, 5)
    assert count(db, "opportunities") == 5
    assert count(db, "organizations") == 5


@pytest.mark.integration_db
@db_only
def test_invalid_records_rejected_with_reasons_batch_continues(client, db):
    r = post(client, [item(1), item(2, title=""), item(3), item(4, source_url="nope")])
    body = r.json()
    assert r.status_code == 200
    assert (body["inserted"], body["rejected"]) == (2, 2)
    assert body["errors"][0]["reasons"][0].startswith("title")
    assert body["errors"][1]["reasons"][0].startswith("source_url")
    assert count(db, "opportunities") == 2


@pytest.mark.integration_db
@db_only
def test_changed_title_is_updated(client, db):
    post(client, [item(1)])
    r = post(client, [item(1, title="Senior Intern")]).json()
    assert (r["inserted"], r["updated"]) == (0, 1)
