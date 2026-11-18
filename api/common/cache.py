"""A Redis cache that degrades instead of failing.

The cache only holds short-lived counters and locks: sign-in attempts and
lockouts, rate-limit windows, password-reset limits, the end-of-day email lock.
None of them is worth an outage. With Django's own Redis backend, an
unreachable or misconfigured Redis turned every API request into a 500,
because the rate limiter reads the cache on every request.

This backend behaves exactly like Django's while Redis answers. When Redis
does not, each operation logs the problem (at most once a minute per process)
and returns what an empty cache would: reads miss, writes are dropped. The
effect while Redis is down: requests work, rate limits and sign-in lockouts
are not enforced, and the end-of-day email lock lets the job run.
"""

import logging
import time

from django.core.cache.backends.base import DEFAULT_TIMEOUT
from django.core.cache.backends.redis import RedisCache

logger = logging.getLogger(__name__)

_LOG_INTERVAL_SECONDS = 60


class ResilientRedisCache(RedisCache):
    _last_logged = 0.0

    def _failed(self, operation, exc):
        now = time.monotonic()
        if now - ResilientRedisCache._last_logged >= _LOG_INTERVAL_SECONDS:
            ResilientRedisCache._last_logged = now
            logger.error(
                'Cache unavailable (%s failed: %s). Requests continue without rate limits '
                'or sign-in lockouts until it is back. Check CACHE_URL.',
                operation, exc,
            )

    def _attempt(self, operation, call, fallback):
        try:
            return call()
        except Exception as exc:  # redis.exceptions.*, socket and DNS errors
            self._failed(operation, exc)
            return fallback

    def add(self, key, value, timeout=DEFAULT_TIMEOUT, version=None):
        return self._attempt('add', lambda: super(ResilientRedisCache, self).add(key, value, timeout, version), True)

    def get(self, key, default=None, version=None):
        return self._attempt('get', lambda: super(ResilientRedisCache, self).get(key, default, version), default)

    def set(self, key, value, timeout=DEFAULT_TIMEOUT, version=None):
        return self._attempt('set', lambda: super(ResilientRedisCache, self).set(key, value, timeout, version), None)

    def touch(self, key, timeout=DEFAULT_TIMEOUT, version=None):
        return self._attempt('touch', lambda: super(ResilientRedisCache, self).touch(key, timeout, version), False)

    def delete(self, key, version=None):
        return self._attempt('delete', lambda: super(ResilientRedisCache, self).delete(key, version), False)

    def get_many(self, keys, version=None):
        return self._attempt('get_many', lambda: super(ResilientRedisCache, self).get_many(keys, version), {})

    def has_key(self, key, version=None):
        return self._attempt('has_key', lambda: super(ResilientRedisCache, self).has_key(key, version), False)

    def incr(self, key, delta=1, version=None):
        # Callers of incr expect an error for a missing key; with no cache,
        # every key is missing.
        try:
            return super().incr(key, delta, version)
        except ValueError:
            raise
        except Exception as exc:
            self._failed('incr', exc)
            raise ValueError(f"Key '{key}' not found (cache unavailable).") from exc

    def set_many(self, data, timeout=DEFAULT_TIMEOUT, version=None):
        return self._attempt('set_many', lambda: super(ResilientRedisCache, self).set_many(data, timeout, version), list(data))

    def delete_many(self, keys, version=None):
        return self._attempt('delete_many', lambda: super(ResilientRedisCache, self).delete_many(keys, version), None)

    def clear(self):
        return self._attempt('clear', lambda: super(ResilientRedisCache, self).clear(), False)

    def is_available(self):
        """True if Redis answers right now (used by the health check)."""
        try:
            return bool(self._cache.get_client(write=False).ping())
        except Exception:
            return False
