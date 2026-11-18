"""Audit logging: who did what, recorded in `applications.AuditLog`.

- `audit.log_audit(...)` writes an entry (`audit/log.py`).
- `audit.actions.AuditAction` names every action that is recorded.
- `audit.messages` turns an entry into the plain-language text the Logs page shows.

The model stays in the applications app, so its table and history are unchanged.
"""

from .log import log_audit  # noqa: F401
