"""CSV downloads that are safe to open in a spreadsheet and do not hold the
whole export in memory."""

import csv

from django.http import StreamingHttpResponse

# A cell starting with one of these is run as a formula by Excel and others,
# so a value typed by one user could execute on the machine of whoever opens
# the export. A leading apostrophe makes the spreadsheet show it as text.
_FORMULA_PREFIXES = ('=', '+', '-', '@', '\t', '\r')


def csv_safe(value):
    if value is None:
        return ''
    if isinstance(value, str) and value.startswith(_FORMULA_PREFIXES):
        return "'" + value
    return value


class _Echo:
    """A file-like object that hands each written row straight back."""

    def write(self, value):
        return value


def csv_response(filename, header, rows):
    """Stream `rows` (an iterable of sequences) as a CSV download."""
    writer = csv.writer(_Echo())

    def lines():
        yield writer.writerow(header)
        for row in rows:
            yield writer.writerow([csv_safe(cell) for cell in row])

    response = StreamingHttpResponse(lines(), content_type='text/csv')
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response
