"""Every API route, with its name and allowed methods, matches a checked-in table.

This keeps view refactors honest: converting a view from one style to another
must not add, remove or rename an endpoint, or change which HTTP methods it
accepts. A deliberate API change updates the table:

    UPDATE_ROUTE_TABLE=1 python manage.py test common.tests.test_route_methods

and the diff of `route_methods.json` shows exactly what changed.
"""

import json
import os
import re
from pathlib import Path

from django.test import SimpleTestCase
from django.urls import URLPattern, URLResolver, get_resolver

TABLE = Path(__file__).with_name('route_methods.json')
HTTP_METHODS = ('get', 'post', 'put', 'patch', 'delete')

_PATH_PARAM = re.compile(r'<(?:[^:<>]+:)?[^<>]+>')
_REGEX_PARAM = re.compile(r'\(\?P<[^>]+>[^)]*\)')


def _normalise(pattern: str) -> str:
    """Write a route the same way whether it came from path() or a router regex."""
    text = _REGEX_PARAM.sub('{}', pattern)
    text = _PATH_PARAM.sub('{}', text)
    text = text.replace('^', '').replace('$', '').replace('\\Z', '')
    return text.replace('\\.', '.')


def _allowed_methods(callback) -> list[str]:
    cls = getattr(callback, 'cls', None) or getattr(callback, 'view_class', None)
    allowed = {m.lower() for m in getattr(cls, 'http_method_names', HTTP_METHODS)}
    actions = getattr(callback, 'actions', None)
    if actions:  # a viewset route: the router's method -> action map, minus what the view refuses
        return sorted(m for m in actions if m in HTTP_METHODS and m in allowed)
    if cls is None:
        return []
    return sorted(m for m in HTTP_METHODS if m in allowed and hasattr(cls, m))


def _walk(patterns, prefix=''):
    for entry in patterns:
        route = prefix + str(entry.pattern)
        if isinstance(entry, URLResolver):
            yield from _walk(entry.url_patterns, route)
        elif isinstance(entry, URLPattern):
            yield route, entry


def current_routes() -> dict[str, dict]:
    table = {}
    for route, entry in _walk(get_resolver().url_patterns):
        if not route.startswith('api/v1/') or 'format' in route:
            continue
        key = _normalise(route)
        methods = _allowed_methods(entry.callback)
        existing = table.get(key)
        if existing:  # the same path split across two views (list and detail never collide)
            existing['methods'] = sorted(set(existing['methods']) | set(methods))
            continue
        table[key] = {'name': entry.name, 'methods': methods}
    return dict(sorted(table.items()))


class RouteTableTests(SimpleTestCase):
    def test_routes_and_methods_match_the_checked_in_table(self):
        routes = current_routes()
        if os.environ.get('UPDATE_ROUTE_TABLE'):
            TABLE.write_text(json.dumps(routes, indent=2) + '\n')
        expected = json.loads(TABLE.read_text())

        self.assertEqual(sorted(routes), sorted(expected), 'Routes were added or removed.')
        for route, info in expected.items():
            with self.subTest(route=route):
                self.assertEqual(routes[route]['methods'], info['methods'])
                self.assertEqual(routes[route]['name'], info['name'])
