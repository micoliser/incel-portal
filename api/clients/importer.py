"""Credit client import from a spreadsheet (.xlsx or .csv).

`analyse()` checks a file without saving anything, in the order the uploader
sees it:

1. Columns: every required column must be there (headers match ignoring case,
   extra spaces, underscores and hyphens). Missing or repeated columns reject
   the file.
2. Rows: every field of every row is validated; any error rejects the file.
3. Review (only when 1 and 2 pass): notices to confirm (unrecognised columns,
   defaults for missing Status/Currency/Credit Utilization, an Available
   Balance column that is ignored, clients over their limit) and duplicate
   groups, each needing a decision.

`apply()` re-runs the analysis on the same file and saves it all at once with
the uploader's decisions, or nothing.
"""

import csv
import io
import re
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.db.models.functions import Lower

from .models import CreditClient, CreditClientChange, CreditClientImport, Currency
from .validation import CLEANERS, FieldError

MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_ROWS = 5000
MAX_COLUMNS = 100

# (field, header in the template, required)
COLUMNS = [
    ('name', 'Name', True),
    ('tin', 'TIN', True),
    ('contact_person', 'Contact Person', True),
    ('phone', 'Phone', True),
    ('email', 'Email', True),
    ('address', 'Address', False),
    ('credit_limit', 'Credit Limit', True),
    ('credit_days', 'Credit Days', True),
    ('credit_utilization', 'Credit Utilization', False),
    ('currency', 'Currency', False),
    ('status', 'Status', False),
    ('notes', 'Notes', False),
]
HEADER_LABELS = {field: header for field, header, _required in COLUMNS}
REQUIRED = [field for field, _header, required in COLUMNS if required]
# Missing columns that get a value for new clients (and are flagged for confirmation).
DEFAULTS = {
    'status': (CreditClient.Status.ACTIVE, 'Active'),
    'currency': (Currency.NGN, 'NGN'),
    'credit_utilization': (Decimal('0.00'), '0'),
}
AVAILABLE_BALANCE = 'available balance'


class ImportFileError(Exception):
    """The file cannot be read at all (wrong type, too big, not a spreadsheet)."""


class ImportNotReady(Exception):
    """Confirming is refused: errors remain, or a decision is missing or invalid."""


def normalise_header(value):
    text = '' if value is None else str(value)
    return re.sub(r'\s+', ' ', re.sub(r'[_\-]', ' ', text)).strip().lower()


_FIELD_BY_HEADER = {normalise_header(header): field for field, header, _required in COLUMNS}


# Reading -------------------------------------------------------------------

def _read_xlsx(data):
    from openpyxl import load_workbook

    try:
        workbook = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception:
        raise ImportFileError('This file could not be read as an Excel workbook (.xlsx).')
    try:
        sheet = workbook.worksheets[0]
        rows = []
        for row in sheet.iter_rows(values_only=True):
            if len(rows) > MAX_ROWS + 1:
                raise ImportFileError(f'The file has more than {MAX_ROWS} rows. Split it into smaller files.')
            rows.append(list(row[:MAX_COLUMNS + 1]))
        return rows
    finally:
        workbook.close()


def _read_csv(data):
    try:
        text = data.decode('utf-8-sig')
    except UnicodeDecodeError:
        raise ImportFileError('This CSV file is not UTF-8 text. Save it as "CSV UTF-8" and upload it again.')
    rows = []
    for row in csv.reader(io.StringIO(text)):
        if len(rows) > MAX_ROWS + 1:
            raise ImportFileError(f'The file has more than {MAX_ROWS} rows. Split it into smaller files.')
        rows.append(row[:MAX_COLUMNS + 1])
    return rows


def read_file(upload):
    name = (getattr(upload, 'name', '') or '').strip()
    lowered = name.lower()
    if upload.size > MAX_FILE_BYTES:
        raise ImportFileError('The file is larger than 5 MB.')
    data = upload.read()
    if lowered.endswith('.xlsx'):
        return _read_xlsx(data)
    if lowered.endswith('.csv'):
        return _read_csv(data)
    if lowered.endswith('.xls'):
        raise ImportFileError('Old Excel files (.xls) are not supported. Save it as .xlsx and upload it again.')
    raise ImportFileError('Upload an Excel (.xlsx) or CSV (.csv) file.')


def _blank(cell):
    return cell is None or (isinstance(cell, str) and not cell.strip())


# Analysis ------------------------------------------------------------------

def _money_text(value):
    return f'{value:.2f}' if isinstance(value, Decimal) else value


def client_values(client):
    return {
        'name': client.name,
        'tin': client.tin,
        'contact_person': client.contact_person,
        'phone': client.phone,
        'email': client.email,
        'address': client.address,
        'credit_limit': _money_text(client.credit_limit),
        'credit_days': client.credit_days,
        'credit_utilization': _money_text(client.credit_utilization),
        'currency': client.currency,
        'status': client.status,
        'notes': client.notes,
    }


def _row_values(values):
    return {field: _money_text(value) for field, value in values.items()}


def _name_key(name):
    # The same folding as the database's Lower(), which the unique constraint uses.
    return name.lower()


class Analysis:
    def __init__(self, file_name):
        self.file_name = file_name
        self.column_errors = []
        self.row_errors = []
        self.unrecognised = []
        self.present = set()
        self.rows = []  # [(row number, {field: cleaned value})]
        self.groups = []
        self.grouped_rows = {}  # row number -> group id
        self.existing = {}  # client id -> CreditClient
        self.notices = []

    @property
    def has_errors(self):
        return bool(self.column_errors or self.row_errors)

    def as_dict(self):
        result = {
            'file_name': self.file_name,
            'column_errors': self.column_errors,
            'row_errors': self.row_errors,
            'can_import': not self.has_errors,
            'notices': [],
            'duplicates': [],
            'rows': [],
            'summary': {'rows': len(self.rows), 'new': 0, 'duplicate_groups': 0},
        }
        if self.has_errors:
            return result
        result['notices'] = self.notices
        result['duplicates'] = [
            {
                'id': group['id'],
                'reason': group['reason'],
                'rows': [{'row': number, 'values': _row_values(values)} for number, values in group['rows']],
                'existing': (
                    {'id': str(group['existing'].id), 'values': client_values(group['existing'])}
                    if group['existing'] else None
                ),
            }
            for group in self.groups
        ]
        result['rows'] = [
            {'row': number, 'values': _row_values(values), 'duplicate_group': self.grouped_rows.get(number)}
            for number, values in self.rows
        ]
        result['summary'] = {
            'rows': len(self.rows),
            'new': sum(1 for number, _values in self.rows if number not in self.grouped_rows),
            'duplicate_groups': len(self.groups),
        }
        return result


def analyse(upload):
    analysis = Analysis(getattr(upload, 'name', '') or 'upload')
    table = read_file(upload)
    if not table or all(_blank(cell) for cell in table[0]):
        analysis.column_errors.append('The first row must hold the column names. It is empty.')
        return analysis

    header = table[0]
    if len(header) > MAX_COLUMNS:
        raise ImportFileError(f'The file has more than {MAX_COLUMNS} columns.')
    data_rows = [(index + 2, row) for index, row in enumerate(table[1:]) if not all(_blank(cell) for cell in row)]

    # 1. Columns.
    columns = {}  # field -> column index
    seen = {}
    for index, raw in enumerate(header):
        name = normalise_header(raw)
        if not name:
            if any(index < len(row) and not _blank(row[index]) for _number, row in data_rows):
                analysis.unrecognised.append(f'Column {index + 1} (no name)')
            continue
        if name in seen:
            analysis.column_errors.append(f'The column "{str(raw).strip()}" appears more than once.')
            continue
        seen[name] = index
        field = _FIELD_BY_HEADER.get(name)
        if field:
            columns[field] = index
        elif name == AVAILABLE_BALANCE:
            analysis.present.add('available_balance')
        else:
            analysis.unrecognised.append(str(raw).strip())
    missing = [HEADER_LABELS[field] for field in REQUIRED if field not in columns]
    if missing:
        analysis.column_errors.append('Required columns are missing: ' + ', '.join(missing) + '.')
    if not data_rows and not analysis.column_errors:
        analysis.column_errors.append('The file has column names but no clients.')
    analysis.present.update(columns)
    if analysis.column_errors:
        return analysis

    # 2. Rows.
    for number, row in data_rows:
        values = {}
        for field, index in columns.items():
            cell = row[index] if index < len(row) else None
            try:
                values[field] = CLEANERS[field](cell)
            except FieldError as error:
                analysis.row_errors.append({
                    'row': number, 'field': field, 'column': HEADER_LABELS[field], 'message': str(error),
                })
        analysis.rows.append((number, values))
    if analysis.row_errors:
        return analysis

    _find_duplicates(analysis)
    if analysis.row_errors:
        return analysis
    _build_notices(analysis)
    return analysis


def _find_duplicates(analysis):
    """Group rows that share a name or TIN with each other or with an existing client."""
    names = {_name_key(values['name']) for _number, values in analysis.rows}
    tins = {values['tin'] for _number, values in analysis.rows}
    matches = list(
        CreditClient.objects.annotate(name_key=Lower('name')).filter(Q(tin__in=tins) | Q(name_key__in=names))
    )
    analysis.existing = {client.id: client for client in matches}

    # Union-find over rows ('r', number) and existing clients ('c', id).
    parent = {}

    def find(node):
        parent.setdefault(node, node)
        while parent[node] != node:
            parent[node] = parent[parent[node]]
            node = parent[node]
        return node

    def union(a, b):
        parent[find(a)] = find(b)

    owners = {}
    for client in matches:
        node = ('c', client.id)
        find(node)
        for key in (('name', _name_key(client.name)), ('tin', client.tin)):
            if key in owners:
                union(node, owners[key])
            else:
                owners[key] = node
    for number, values in analysis.rows:
        node = ('r', number)
        find(node)
        for key in (('name', _name_key(values['name'])), ('tin', values['tin'])):
            if key in owners:
                union(node, owners[key])
            else:
                owners[key] = node

    components = {}
    for node in list(parent):
        components.setdefault(find(node), []).append(node)

    row_values = dict(analysis.rows)
    for nodes in components.values():
        row_numbers = sorted(n for kind, n in nodes if kind == 'r')
        clients = [analysis.existing[n] for kind, n in nodes if kind == 'c']
        if not row_numbers or (len(row_numbers) == 1 and not clients):
            continue
        if len(clients) > 1:
            listed = ' and '.join(f'"{client.name}" (TIN {client.tin})' for client in clients)
            for number in row_numbers:
                analysis.row_errors.append({
                    'row': number, 'field': 'name', 'column': 'Name',
                    'message': f'This row matches more than one existing client by name or TIN: {listed}. '
                               'Correct the name or TIN so it matches only one.',
                })
            continue
        existing = clients[0] if clients else None
        reasons = []
        if existing:
            reasons.append('already exists')
        if len(row_numbers) > 1:
            reasons.append('appears more than once in the file')
        group_id = f'g{row_numbers[0]}'
        analysis.groups.append({
            'id': group_id,
            'reason': 'Same name or TIN: ' + ' and '.join(reasons) + '.',
            'rows': [(number, row_values[number]) for number in row_numbers],
            'existing': existing,
        })
        for number in row_numbers:
            analysis.grouped_rows[number] = group_id
    analysis.groups.sort(key=lambda group: group['rows'][0][0])


def _existing_for_row(analysis, number):
    group_id = analysis.grouped_rows.get(number)
    for group in analysis.groups:
        if group['id'] == group_id:
            return group['existing']
    return None


def _build_notices(analysis):
    notices = analysis.notices
    if analysis.unrecognised:
        notices.append({
            'code': 'unrecognised_columns',
            'message': 'These columns are not recognised and will not be imported: ' + ', '.join(analysis.unrecognised) + '.',
            'columns': analysis.unrecognised,
        })
    for field, (_value, label) in DEFAULTS.items():
        if field not in analysis.present:
            notices.append({
                'code': f'default_{field}',
                'message': f'There is no {HEADER_LABELS[field]} column. New clients will get {label}; '
                           f'clients being updated keep their current {HEADER_LABELS[field].lower()}.',
            })
    if 'available_balance' in analysis.present:
        notices.append({
            'code': 'available_balance_ignored',
            'message': 'The Available Balance column will be ignored. The system calculates it as '
                       'credit limit minus credit utilization.',
        })
    over = []
    for number, values in analysis.rows:
        existing = _existing_for_row(analysis, number)
        limit = values['credit_limit']
        if 'credit_utilization' in values:
            used = values['credit_utilization']
        else:
            used = existing.credit_utilization if existing else Decimal('0')
        if used > limit:
            currency = values.get('currency') or (existing.currency if existing else DEFAULTS['currency'][0])
            over.append({
                'row': number, 'name': values['name'], 'available_balance': _money_text(limit - used),
                'currency': str(currency),
            })
    if over:
        notices.append({
            'code': 'over_limit',
            'message': f'{len(over)} client{"s" if len(over) != 1 else ""} will start with a negative available '
                       'balance (credit utilization is above the credit limit). Their requests will need approval.',
            'rows': over,
        })


# Saving --------------------------------------------------------------------

def changes_between(before, after):
    """{field: [old, new]} for the fields that differ, as text."""
    return {
        field: [str(before[field]), str(after[field])]
        for field in after
        if str(before.get(field)) != str(after[field])
    }


def apply(upload, *, decisions, user):
    """Save the file with the uploader's decisions ({group id: 'reject' or a row number}).

    Returns the CreditClientImport. Raises ImportNotReady when the file has errors
    or a decision is missing, and ImportFileError when it cannot be read.
    """
    with transaction.atomic():
        analysis = analyse(upload)
        if analysis.has_errors:
            raise ImportNotReady('The file has errors. Check it again and correct them first.')

        chosen = {}  # row number -> existing client or None, for rows to save
        rejected = 0
        for group in analysis.groups:
            decision = decisions.get(group['id'])
            row_numbers = [number for number, _values in group['rows']]
            if decision is None:
                raise ImportNotReady(
                    'Every duplicate needs a decision. The data may have changed since the check; check the file again.'
                )
            if decision == 'reject':
                rejected += len(row_numbers)
                continue
            try:
                keep = int(decision)
            except (TypeError, ValueError):
                keep = None
            if keep not in row_numbers:
                raise ImportNotReady(f'The decision for the duplicate at row {row_numbers[0]} is not one of its rows.')
            chosen[keep] = group['existing']
            rejected += len(row_numbers) - 1

        record = CreditClientImport.objects.create(
            uploaded_by=user, file_name=analysis.file_name[:255], rows=len(analysis.rows),
        )
        created = updated = 0
        try:
            for number, values in analysis.rows:
                if number in analysis.grouped_rows and number not in chosen:
                    continue
                existing = chosen.get(number)
                if existing is None:
                    data = {field: default for field, (default, _label) in DEFAULTS.items()}
                    data.update(values)
                    client = CreditClient.objects.create(**data, created_by=user, updated_by=user)
                    CreditClientChange.objects.create(
                        client=client, changed_by=user, source=CreditClientChange.Source.IMPORTED,
                        client_import=record, changes={},
                    )
                    created += 1
                    continue
                client = CreditClient.objects.select_for_update().get(pk=existing.pk)
                before = client_values(client)
                for field, value in values.items():
                    setattr(client, field, value)
                client.updated_by = user
                client.save()
                changes = changes_between(before, client_values(client))
                if changes:
                    CreditClientChange.objects.create(
                        client=client, changed_by=user, source=CreditClientChange.Source.IMPORTED,
                        client_import=record, changes=changes,
                    )
                updated += 1
        except IntegrityError:
            raise ImportNotReady('Clients changed while this file was being imported. Check the file again.')

        record.created_count, record.updated_count, record.rejected_count = created, updated, rejected
        record.save(update_fields=['created_count', 'updated_count', 'rejected_count'])
        return record


def template_workbook():
    """An .xlsx with the expected headers, TIN and Phone formatted as text."""
    from openpyxl import Workbook
    from openpyxl.styles import Font

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = 'Credit clients'
    sheet.append([header for _field, header, _required in COLUMNS])
    for index, (field, header, required) in enumerate(COLUMNS, start=1):
        cell = sheet.cell(row=1, column=index)
        cell.font = Font(bold=True)
        letter = cell.column_letter
        sheet.column_dimensions[letter].width = max(14, len(header) + 4)
        if field in ('tin', 'phone'):
            for row in range(2, 1002):
                sheet.cell(row=row, column=index).number_format = '@'
    notes = workbook.create_sheet('How to fill')
    notes.append(['Column', 'Required', 'Rules'])
    rules = {
        'name': 'Unique. At most 200 characters.',
        'tin': '8 to 15 digits, optionally a hyphen and 4 digits (12345678-0001). Unique.',
        'contact_person': 'At most 150 characters.',
        'phone': '7 to 15 digits; +, spaces, hyphens and brackets allowed.',
        'email': 'A valid email address.',
        'address': 'At most 500 characters.',
        'credit_limit': 'An amount above 0, at most 2 decimal places. No currency symbol.',
        'credit_days': 'A whole number of days, 0 or more.',
        'credit_utilization': 'Amount already used, 0 or more. Left out: 0 for new clients.',
        'currency': ', '.join(Currency.values) + '. Left out: NGN for new clients.',
        'status': 'Active or Inactive. Left out: Active for new clients.',
        'notes': 'At most 2000 characters.',
    }
    for field, header, required in COLUMNS:
        notes.append([header, 'Yes' if required else 'No', rules[field]])
    notes.append([])
    notes.append(['Available balance is not imported: it is always credit limit minus credit utilization.'])
    for letter, width in (('A', 22), ('B', 10), ('C', 80)):
        notes.column_dimensions[letter].width = width
    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()
