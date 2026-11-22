"""
Tests for automation/scrapers/runner.py (BE-34: Scraper Runner with Concurrency Limits).

These tests call `_run_source` directly, injecting a lightweight module-level
target in place of the real `_scraper_worker`. On Windows, `multiprocessing`
uses the 'spawn' start method, which re-imports this module fresh inside each
child process, so a `monkeypatch` of `runner._scraper_worker` in the parent
process would be invisible to the child. Passing a real, picklable,
module-level function via `_run_source`'s `target` parameter avoids that
problem while still exercising the real wait/kill/report logic.
"""

import functools
import multiprocessing
import sys
import threading
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from automation.scrapers.runner import _run_source  # noqa: E402


# ---------------------------------------------------------------------------
# Fake process targets (top-level so they're picklable under 'spawn')
# ---------------------------------------------------------------------------

def _hang_forever(source_id):
    """Simulates a scraper stuck in a frozen browser call that never returns."""
    while True:
        time.sleep(1)


def _finish_quickly(source_id):
    """Simulates a scraper that completes well within the timeout."""
    time.sleep(0.1)


def _track_concurrency(source_id, active_count, max_seen, lock):
    """Records the peak number of concurrently running processes."""
    with lock:
        active_count.value += 1
        if active_count.value > max_seen.value:
            max_seen.value = active_count.value
    time.sleep(0.3)
    with lock:
        active_count.value -= 1


# ---------------------------------------------------------------------------
# Timeout + kill tests
# ---------------------------------------------------------------------------

def test_hung_process_is_killed_at_timeout(caplog):
    """A process that never finishes must be forcibly terminated after the timeout."""
    semaphore = multiprocessing.Semaphore(1)
    semaphore.acquire()

    start = time.time()
    with caplog.at_level("ERROR"):
        _run_source("hang-test", timeout_seconds=1, semaphore=semaphore, target=_hang_forever)
    elapsed = time.time() - start

    assert elapsed < 10  # killed promptly, not left hanging for the real 60s
    assert any("timeout" in r.message.lower() for r in caplog.records)
    assert any("killed" in r.message.lower() for r in caplog.records)


def test_quick_process_completes_without_being_killed(caplog):
    """A process that finishes well within the timeout should complete normally, not be killed."""
    semaphore = multiprocessing.Semaphore(1)
    semaphore.acquire()

    with caplog.at_level("INFO"):
        _run_source("quick-test", timeout_seconds=5, semaphore=semaphore, target=_finish_quickly)

    assert any("completed successfully" in r.message.lower() for r in caplog.records)
    assert not any("killed" in r.message.lower() for r in caplog.records)


def test_semaphore_is_released_after_kill():
    """The concurrency slot must be freed even when a hung process had to be killed."""
    semaphore = multiprocessing.Semaphore(1)
    semaphore.acquire()

    _run_source("hang-test", timeout_seconds=1, semaphore=semaphore, target=_hang_forever)

    # If the slot wasn't released, this acquire would block forever; use a
    # timeout so the test fails fast instead of hanging if that regresses.
    released = semaphore.acquire(timeout=5)
    assert released is True


# ---------------------------------------------------------------------------
# Concurrency cap test
# ---------------------------------------------------------------------------

def test_never_exceeds_configured_concurrency_limit():
    """Launching more sources than the cap must never run more than the cap at once."""
    manager = multiprocessing.Manager()
    active_count = manager.Value("i", 0)
    max_seen = manager.Value("i", 0)
    lock = manager.Lock()

    max_concurrency = 2
    source_count = 6
    semaphore = multiprocessing.Semaphore(max_concurrency)

    tracking_target = functools.partial(
        _track_concurrency, active_count=active_count, max_seen=max_seen, lock=lock
    )

    def launch(source_id):
        semaphore.acquire()
        _run_source(
            source_id,
            timeout_seconds=10,
            semaphore=semaphore,
            target=tracking_target,
        )

    # _run_source releases the semaphore itself; drive several in parallel
    # threads so the cap is actually exercised rather than serialized.
    threads = [
        threading.Thread(target=launch, args=(f"source-{i}",)) for i in range(source_count)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert max_seen.value <= max_concurrency
    assert max_seen.value > 0  # sanity: workers actually ran
