from __future__ import annotations

import logging

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(name='support.auto_close_resolved_requests')
def auto_close_resolved_requests() -> dict[str, int]:
    """Auto-close resolved support requests past the threshold."""
    from .services import auto_close_resolved_requests as _auto_close

    closed_count = _auto_close()
    logger.info('Auto-close support requests: %d closed', closed_count)
    return {'closed': closed_count}
