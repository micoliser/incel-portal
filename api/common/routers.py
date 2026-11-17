from rest_framework.routers import DefaultRouter


class ApiRouter(DefaultRouter):
    """The router every app uses: no trailing slash on any route, matching the
    hand-written paths, and no browsable root view."""

    include_root_view = False

    def __init__(self, *args, **kwargs):
        kwargs.setdefault('trailing_slash', False)
        super().__init__(*args, **kwargs)
