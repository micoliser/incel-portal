"""The building blocks every API resource uses.

A resource is a `GenericViewSet` plus only the mixins it needs, so nothing is
exposed by accident (the default `ModelViewSet` offers every action, including
PUT and DELETE). Changes are partial updates (PATCH); no resource accepts PUT.
The only PUTs in the API set a single value you own (your profile photo,
your reaction); see docs/TECHNICAL_DOCUMENTATION.md, section 6.
"""

from rest_framework import mixins
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

ListModelMixin = mixins.ListModelMixin
RetrieveModelMixin = mixins.RetrieveModelMixin
CreateModelMixin = mixins.CreateModelMixin
DestroyModelMixin = mixins.DestroyModelMixin


class PartialUpdateModelMixin:
    """PATCH only. DRF's `UpdateModelMixin` also brings PUT, which the API does not offer."""

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        if getattr(instance, '_prefetched_objects_cache', None):
            # Prefetched relations are stale after the update.
            instance._prefetched_objects_cache = {}
        return Response(serializer.data)

    def perform_update(self, serializer):
        serializer.save()


__all__ = [
    'CreateModelMixin',
    'DestroyModelMixin',
    'GenericViewSet',
    'ListModelMixin',
    'PartialUpdateModelMixin',
    'RetrieveModelMixin',
]
