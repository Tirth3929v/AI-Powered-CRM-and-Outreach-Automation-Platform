"""
Scraper Runner CLI (BE-34).

Usage:
    python -m automation.scrapers.runner --source internshala
    python -m automation.scrapers.runner --source internshala --source naukri

Executes one or more approved scrapers via `registry.run_scraper`, each in
its own OS process. A semaphore caps the number of simultaneously running
processes at MAX_PLAYWRIGHT_CONCURRENCY (default 2) to protect the Oracle
Free VM's limited RAM. Each process is hard-killed if it exceeds
SCRAPER_TIMEOUT_SECONDS (default 60).
"""

import argparse
import logging
import os
import threading
from multiprocessing import Process, Semaphore

from automation.scrapers import registry

logger = logging.getLogger(__name__)

DEFAULT_MAX_CONCURRENCY = 2
DEFAULT_TIMEOUT_SECONDS = 60


def get_max_concurrency() -> int:
    """Reads the concurrency cap from the environment, falling back to the default."""
    return int(os.environ.get("MAX_PLAYWRIGHT_CONCURRENCY", DEFAULT_MAX_CONCURRENCY))


def get_timeout_seconds() -> int:
    """Reads the per-source timeout from the environment, falling back to the default."""
    return int(os.environ.get("SCRAPER_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS))


def _scraper_worker(source_id: str) -> None:
    """Process entry-point: runs a single source's scraper to completion."""
    registry.run_scraper(source_id)


def _run_source(source_id: str, timeout_seconds: int, semaphore: Semaphore, target=None) -> None:
    """
    Launches one source's scraper in its own process, enforcing the
    per-source timeout. Releases the concurrency slot once the process
    finishes (normally or via a forced kill), running on its own thread so
    multiple sources can be in flight at once up to the concurrency cap.

    `target` defaults to `_scraper_worker` (the real registry-backed worker);
    tests may inject a different picklable, module-level callable to exercise
    this function's wait/kill/report logic without a real scraper or database.
    """
    process = Process(target=target or _scraper_worker, args=(source_id,), name=f"scraper-{source_id}")
    process.start()
    logger.info("Started scraper process for source '%s' (pid=%s).", source_id, process.pid)

    process.join(timeout=timeout_seconds)

    if process.is_alive():
        logger.error(
            "Scraper for source '%s' (pid=%s) exceeded the %ds timeout. Killing process.",
            source_id,
            process.pid,
            timeout_seconds,
        )
        process.terminate()
        process.join(timeout=5)
        if process.is_alive():
            process.kill()
            process.join()
        logger.error("Scraper for source '%s' was killed after timing out.", source_id)
    elif process.exitcode != 0:
        logger.error(
            "Scraper for source '%s' exited with non-zero code %s.",
            source_id,
            process.exitcode,
        )
    else:
        logger.info("Scraper for source '%s' completed successfully.", source_id)

    semaphore.release()


def run_sources(source_ids: list, max_concurrency: int = None, timeout_seconds: int = None) -> None:
    """
    Runs each source's scraper in its own process, never exceeding
    `max_concurrency` simultaneously-running processes.
    """
    if max_concurrency is None:
        max_concurrency = get_max_concurrency()
    if timeout_seconds is None:
        timeout_seconds = get_timeout_seconds()

    semaphore = Semaphore(max_concurrency)
    workers = []

    for source_id in source_ids:
        semaphore.acquire()
        worker = threading.Thread(
            target=_run_source,
            args=(source_id, timeout_seconds, semaphore),
            name=f"runner-{source_id}",
        )
        worker.start()
        workers.append(worker)

    for worker in workers:
        worker.join()


def main() -> None:
    logging.basicConfig(level=logging.INFO)

    parser = argparse.ArgumentParser(
        description="Run approved scrapers with a bounded concurrency limit and per-source timeout."
    )
    parser.add_argument(
        "--source",
        action="append",
        required=True,
        dest="sources",
        help="Source id to scrape (repeatable, e.g. --source internshala --source naukri).",
    )
    args = parser.parse_args()

    run_sources(args.sources)


if __name__ == "__main__":
    main()
