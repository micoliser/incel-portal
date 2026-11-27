"""Field rules for credit clients, shared by the form (serializers) and the import.

Each `clean_*` takes a raw value (text from a form or a spreadsheet cell, which
may be a number) and returns the stored value, or raises FieldError with a
message written for the person who typed it.
"""

import re
from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError
from django.core.validators import validate_email

from .models import CreditClient, Currency


class FieldError(ValueError):
    pass


MAX_MONEY = Decimal('9999999999999999.99')  # 18 digits, 2 after the point
MAX_CREDIT_DAYS = 3650
# Nigerian TINs: 8 to 15 digits, optionally with a hyphen and a 4-digit suffix (12345678-0001).
TIN_PATTERN = re.compile(r'^\d{8,15}(-\d{4})?$')
PHONE_PATTERN = re.compile(r'^\+?[\d\s\-().]+$')


def _text(value):
    """A cell or form value as trimmed text; whole numbers lose Excel's '.0'."""
    if value is None:
        return ''
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _limited(value, field_label, max_length, required=False):
    text = re.sub(r'\s+', ' ', _text(value))
    if required and not text:
        raise FieldError(f'{field_label} is required.')
    if len(text) > max_length:
        raise FieldError(f'{field_label} must be at most {max_length} characters.')
    return text


def clean_name(value):
    return _limited(value, 'Name', 200, required=True)


def clean_tin(value):
    text = re.sub(r'\s+', '', _text(value))
    if not text:
        raise FieldError('TIN is required.')
    if not TIN_PATTERN.match(text):
        raise FieldError('TIN must be 8 to 15 digits, optionally followed by a hyphen and 4 digits (e.g. 12345678-0001).')
    return text


def clean_contact_person(value):
    return _limited(value, 'Contact person', 150, required=True)


def clean_phone(value):
    text = _text(value)
    if not text:
        raise FieldError('Phone is required.')
    digits = re.sub(r'\D', '', text)
    if not PHONE_PATTERN.match(text) or not 7 <= len(digits) <= 15:
        raise FieldError('Phone must be a phone number of 7 to 15 digits, e.g. +234 803 123 4567.')
    if len(text) > 30:
        raise FieldError('Phone must be at most 30 characters.')
    return text


def clean_email(value):
    text = _text(value).lower()
    if not text:
        raise FieldError('Email is required.')
    try:
        validate_email(text)
    except ValidationError:
        raise FieldError('Email must be a valid email address.')
    if len(text) > 254:
        raise FieldError('Email must be at most 254 characters.')
    return text


def clean_address(value):
    text = _text(value)
    if len(text) > 500:
        raise FieldError('Address must be at most 500 characters.')
    return text


def clean_notes(value):
    text = _text(value)
    if len(text) > 2000:
        raise FieldError('Notes must be at most 2000 characters.')
    return text


def _money(value, field_label):
    if isinstance(value, bool):
        raise FieldError(f'{field_label} must be an amount, e.g. 1500000.00.')
    text = _text(value).replace(',', '')
    if not text:
        raise FieldError(f'{field_label} is required.')
    try:
        amount = Decimal(text)
    except InvalidOperation:
        raise FieldError(f'{field_label} must be an amount, e.g. 1500000.00 (no currency symbols).')
    if not amount.is_finite():
        raise FieldError(f'{field_label} must be an amount, e.g. 1500000.00.')
    if amount.as_tuple().exponent < -2 and amount != amount.quantize(Decimal('0.01')):
        raise FieldError(f'{field_label} can have at most 2 decimal places.')
    amount = amount.quantize(Decimal('0.01'))
    if abs(amount) > MAX_MONEY:
        raise FieldError(f'{field_label} is too large.')
    return amount


def clean_credit_limit(value):
    amount = _money(value, 'Credit limit')
    if amount <= 0:
        raise FieldError('Credit limit must be more than 0.')
    return amount


def clean_credit_utilization(value):
    amount = _money(value, 'Credit utilization')
    if amount < 0:
        raise FieldError('Credit utilization cannot be negative.')
    return amount


def clean_credit_days(value):
    if isinstance(value, bool):
        raise FieldError('Credit days must be a whole number of days.')
    text = _text(value).replace(',', '')
    if not text:
        raise FieldError('Credit days is required.')
    try:
        number = Decimal(text)
    except InvalidOperation:
        raise FieldError('Credit days must be a whole number of days, e.g. 30.')
    if not number.is_finite() or number != number.to_integral_value():
        raise FieldError('Credit days must be a whole number of days, e.g. 30.')
    if number < 0:
        raise FieldError('Credit days cannot be negative.')
    if number > MAX_CREDIT_DAYS:
        raise FieldError(f'Credit days must be at most {MAX_CREDIT_DAYS}.')
    return int(number)


def clean_currency(value):
    text = _text(value).upper()
    if text not in Currency.values:
        raise FieldError(f'Currency must be one of: {", ".join(Currency.values)}.')
    return text


def clean_status(value):
    text = _text(value).lower()
    if text not in CreditClient.Status.values:
        raise FieldError('Status must be Active or Inactive.')
    return text


CLEANERS = {
    'name': clean_name,
    'tin': clean_tin,
    'contact_person': clean_contact_person,
    'phone': clean_phone,
    'email': clean_email,
    'address': clean_address,
    'credit_limit': clean_credit_limit,
    'credit_days': clean_credit_days,
    'credit_utilization': clean_credit_utilization,
    'currency': clean_currency,
    'status': clean_status,
    'notes': clean_notes,
}
