"""The ticket form's rules. Every message names the field and what to fix.

Pricing:
- revenue = selling price - cost price; negative is refused, zero must be
  confirmed (`confirm_zero_revenue`);
- with the discount section (optional; required for affiliates) the cost price
  is worked out: published fare - commission given to the customer, and the
  balance commission is net commission - commission given (`ticket_costs`);
- an amount in another currency needs its rate, and amount x rate must cover
  the selling price; a credit client in another currency must give both.
"""

import re
from collections.abc import Mapping
from decimal import Decimal

from django.core.exceptions import ValidationError as DjangoValidationError

from rest_framework import serializers
from rest_framework.fields import SkipField, get_error_detail

from clients.models import CreditClient, Currency

from .models import ServiceRequest

PNR_PATTERN = re.compile(r'^[A-Z0-9]{5,8}$')
ROUTE_PATTERN = re.compile(r'^[A-Z]{3}(-[A-Z]{3})+$')
MAX_PASSENGERS = 50
FOREIGN_CURRENCIES = [code for code in Currency.values if code != Currency.NGN]

EVIDENCE_TYPES = {
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'application/pdf',
}
EVIDENCE_MAX_BYTES = 5 * 1024 * 1024


def ticket_costs(published_fare, net_commission, commission_given):
    """(cost price, balance commission) from the discount section.

    The formula is the one Tourism uses today (confirmed 2026-11-27); change it here only.
    """
    return published_fare - commission_given, net_commission - commission_given


def money(**kwargs):
    kwargs.setdefault('max_digits', 18)
    kwargs.setdefault('decimal_places', 2)
    kwargs.setdefault('min_value', Decimal('0'))
    return serializers.DecimalField(**kwargs)


def naira(amount):
    return f'₦{amount:,.2f}'


class EvidenceSerializer(serializers.Serializer):
    object_key = serializers.CharField(max_length=500)
    file_name = serializers.CharField(max_length=255)
    content_type = serializers.CharField(max_length=100)
    size = serializers.IntegerField(min_value=1, max_value=EVIDENCE_MAX_BYTES)

    def validate_content_type(self, value):
        value = value.split(';')[0].strip().lower()
        if value not in EVIDENCE_TYPES:
            raise serializers.ValidationError('Payment evidence must be an image or a PDF.')
        return value


class TicketRequestSerializer(serializers.Serializer):
    payment_type = serializers.ChoiceField(choices=ServiceRequest.PaymentType.choices)
    party_type = serializers.ChoiceField(choices=ServiceRequest.PartyType.choices)
    client_id = serializers.UUIDField(required=False, allow_null=True)
    client_name = serializers.CharField(max_length=200, required=False, allow_blank=True, trim_whitespace=True)

    passengers = serializers.ListField(
        child=serializers.CharField(max_length=150, trim_whitespace=True, allow_blank=True),
        allow_empty=True,
        max_length=MAX_PASSENGERS,
    )
    airline = serializers.CharField(max_length=100, trim_whitespace=True)
    pnr = serializers.CharField(max_length=20, trim_whitespace=True)
    departure_date = serializers.DateField()
    return_date = serializers.DateField(required=False, allow_null=True)
    route = serializers.CharField(max_length=100, trim_whitespace=True)
    vendor = serializers.CharField(max_length=150, trim_whitespace=True)

    published_fare = money(required=False, allow_null=True)
    net_commission = money(required=False, allow_null=True)
    commission_given = money(required=False, allow_null=True)

    selling_price = money()
    cost_price = money(required=False, allow_null=True)
    confirm_zero_revenue = serializers.BooleanField(required=False, default=False)

    foreign_currency = serializers.CharField(max_length=3, required=False, allow_blank=True)
    foreign_amount = money(required=False, allow_null=True)
    exchange_rate = serializers.DecimalField(
        max_digits=18, decimal_places=6, min_value=Decimal('0'), required=False, allow_null=True,
    )

    amount_paid = money(required=False, allow_null=True)
    evidence = EvidenceSerializer(required=False, allow_null=True)
    # "New request from this one": the cancelled request this copies.
    created_from = serializers.UUIDField(required=False, allow_null=True)

    def validate_pnr(self, value):
        value = value.replace(' ', '').upper()
        if not PNR_PATTERN.match(value):
            raise serializers.ValidationError('PNR must be 5 to 8 letters and numbers, e.g. AB3ZKB.')
        return value

    def validate_route(self, value):
        value = value.replace(' ', '').upper()
        if not ROUTE_PATTERN.match(value):
            raise serializers.ValidationError('Route must be airport codes separated by hyphens, e.g. LOS-ABV or LOS-SEZ-LOS.')
        return value

    def validate_passengers(self, value):
        names = [' '.join(name.split()) for name in value if name and name.strip()]
        if not names:
            raise serializers.ValidationError('Add at least one passenger.')
        return names

    def to_internal_value(self, data):
        """Like DRF's, but the form checks (which compare fields) still run when
        some fields are invalid, so every problem is reported at once."""
        if not isinstance(data, Mapping):
            raise serializers.ValidationError({'non_field_errors': ['Send the form as an object.']})
        values, errors = {}, {}
        for field in self._writable_fields:
            validate_method = getattr(self, f'validate_{field.field_name}', None)
            primitive = field.get_value(data)
            try:
                value = field.run_validation(primitive)
                if validate_method is not None:
                    value = validate_method(value)
            except serializers.ValidationError as exc:
                errors[field.field_name] = exc.detail
            except DjangoValidationError as exc:
                errors[field.field_name] = get_error_detail(exc)
            except SkipField:
                pass
            else:
                values[field.field_name] = value
        self.cross_check(values, errors)
        if errors:
            raise serializers.ValidationError(errors)
        return values

    def cross_check(self, data, field_errors):
        errors = {}

        # Who the ticket is for.
        client = None
        payment_type = data.get('payment_type')
        party_type = data.get('party_type')
        if payment_type == ServiceRequest.PaymentType.CREDIT:
            client_id = data.get('client_id')
            client = CreditClient.objects.filter(pk=client_id).first() if client_id else None
            if client is None:
                errors['client_id'] = 'Choose the credit client.'
            elif client.status != CreditClient.Status.ACTIVE:
                errors['client_id'] = f'{client.name} is inactive and cannot take requests on credit.'
            else:
                data['client_name'] = client.name
        elif payment_type and not data.get('client_name') and 'client_name' not in field_errors:
            errors['client_name'] = 'Affiliate name is required.' if party_type == 'affiliate' else 'Client name is required.'
        data['client'] = client

        if data.get('return_date') and data.get('departure_date') and data['return_date'] < data['departure_date']:
            errors['return_date'] = 'Return date cannot be before the departure date.'

        # Discount section: all or nothing, and required for affiliates.
        discount = [data.get('published_fare'), data.get('net_commission'), data.get('commission_given')]
        labels = {'published_fare': 'Published fare', 'net_commission': 'Net commission', 'commission_given': 'Commission given to the customer'}
        has_discount = any(value is not None for value in discount)
        if party_type == ServiceRequest.PartyType.AFFILIATE or has_discount:
            for field, label in labels.items():
                if data.get(field) is None and field not in field_errors:
                    errors[field] = (
                        f'{label} is required for affiliates.'
                        if party_type == ServiceRequest.PartyType.AFFILIATE
                        else f'{label} is required when the discount section is used.'
                    )
        data['balance_commission'] = None
        discount_ok = not any(field in errors or field in field_errors for field in labels)
        if discount_ok and (has_discount or party_type == 'affiliate'):
            fare, net, given = discount
            if net > fare:
                errors['net_commission'] = 'Net commission cannot be more than the published fare.'
            if given > net:
                errors['commission_given'] = 'Commission given to the customer cannot be more than the net commission.'
            if not ({'net_commission', 'commission_given'} & set(errors)):
                data['cost_price'], data['balance_commission'] = ticket_costs(fare, net, given)
        elif discount_ok and data.get('cost_price') is None and 'cost_price' not in field_errors:
            errors['cost_price'] = 'Cost price is required.'

        # Revenue.
        if data.get('selling_price') is None:
            pass
        elif data['selling_price'] <= 0:
            errors['selling_price'] = 'Selling price must be more than 0.'
        elif data.get('cost_price') is not None and 'cost_price' not in errors:
            revenue = data['selling_price'] - data['cost_price']
            data['revenue'] = revenue
            if revenue < 0:
                errors['selling_price'] = (
                    f'Selling price is below the cost price: revenue would be {naira(revenue)}.'
                )
            elif revenue == 0 and not data.get('confirm_zero_revenue'):
                errors['confirm_zero_revenue'] = 'There is no profit on this transaction. Confirm to submit anyway.'

        # Amount in another currency.
        amount, rate = data.get('foreign_amount'), data.get('exchange_rate')
        currency = (data.get('foreign_currency') or '').upper()
        if client is not None and client.currency != Currency.NGN:
            currency = client.currency
            if amount is None:
                errors['foreign_amount'] = f'{client.name} is billed in {currency}: enter the amount in {currency}.'
            if rate is None:
                errors['exchange_rate'] = f'Enter the {currency} to Naira exchange rate used.'
        elif amount is not None or rate is not None or currency:
            if amount is None:
                errors['foreign_amount'] = 'Enter the amount in the other currency, or clear the exchange rate.'
            if rate is None:
                errors['exchange_rate'] = 'Enter the exchange rate used, or clear the amount in the other currency.'
            if currency not in FOREIGN_CURRENCIES:
                errors['foreign_currency'] = f'Choose the other currency: {", ".join(FOREIGN_CURRENCIES)}.'
        if amount is not None and amount <= 0 and 'foreign_amount' not in errors:
            errors['foreign_amount'] = 'Amount in the other currency must be more than 0.'
        if rate is not None and rate <= 0 and 'exchange_rate' not in errors:
            errors['exchange_rate'] = 'Exchange rate must be more than 0.'
        if amount and rate and amount > 0 and rate > 0 and data.get('selling_price') and 'selling_price' not in errors:
            converted = (amount * rate).quantize(Decimal('0.01'))
            if converted < data['selling_price']:
                errors['foreign_amount'] = (
                    f'{currency} {amount:,.2f} × {rate:,} = {naira(converted)}, which is less than the '
                    f'selling price of {naira(data["selling_price"])}.'
                )
        uses_foreign = amount is not None or (client is not None and client.currency != Currency.NGN)
        data['foreign_currency'] = currency if uses_foreign else ''

        # Payment.
        if payment_type == ServiceRequest.PaymentType.CASH:
            paid = data.get('amount_paid')
            if paid is None:
                if 'amount_paid' not in field_errors:
                    errors['amount_paid'] = 'Amount paid is required.'
            elif data.get('selling_price') is not None and paid < data['selling_price']:
                errors['amount_paid'] = (
                    f'Amount paid ({naira(paid)}) is less than the selling price ({naira(data["selling_price"])}). '
                    'Cash requests must be paid in full.'
                )
            if not data.get('evidence') and 'evidence' not in field_errors:
                errors['evidence'] = 'Attach the payment evidence (an image or a PDF).'
        else:
            data['amount_paid'] = None
            data['evidence'] = None

        for field, message in errors.items():
            field_errors.setdefault(field, [message])
