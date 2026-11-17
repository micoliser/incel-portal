from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response


class StandardPagination(PageNumberPagination):
    """The one pagination shape used by every list endpoint:

        {"count": 57, "page": 2, "page_size": 20, "total_pages": 3, "results": [...]}

    Clients choose the page with `page` and may choose the size with
    `page_size` (up to `max_page_size`). A view that shows a different number
    of rows by default subclasses this and sets only `page_size`.
    """

    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 100

    def get_paginated_response(self, data):
        return Response(
            {
                'count': self.page.paginator.count,
                'page': self.page.number,
                'page_size': self.get_page_size(self.request),
                'total_pages': self.page.paginator.num_pages,
                'results': data,
            }
        )


def page_size(size, maximum=100):
    """A StandardPagination with a different default page size."""
    return type(
        f'StandardPagination{size}',
        (StandardPagination,),
        {'page_size': size, 'max_page_size': max(maximum, size)},
    )


def paginate(queryset, request, serializer_class, *, pagination_class=StandardPagination, view=None, context=None):
    """Paginate and serialize a queryset in a plain APIView."""
    paginator = pagination_class()
    page = paginator.paginate_queryset(queryset, request, view=view)
    serializer = serializer_class(page, many=True, context=context or {'request': request})
    return paginator.get_paginated_response(serializer.data)
