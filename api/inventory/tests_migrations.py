from importlib import import_module

from django.test import TestCase

from inventory.models import InventoryCategory, InventoryItem
from organization.models import Department

set_managing_dept_it = import_module(
    'inventory.migrations.0006_set_managing_dept_it'
).set_managing_dept_it


class _AppsStub:
    @staticmethod
    def get_model(app_label, model_name):
        models_map = {
            ('inventory', 'InventoryItem'): InventoryItem,
            ('organization', 'Department'): Department,
        }
        return models_map[(app_label, model_name)]


class InventoryMigrationTests(TestCase):
    def test_set_managing_dept_it_creates_and_assigns_department(self):
        category = InventoryCategory.objects.create(name='Laptops', description='Computing devices')
        other_department = Department.objects.create(name='Finance', code='FIN')

        item_without_department = InventoryItem.objects.create(name='Laptop A', category=category)
        item_with_department = InventoryItem.objects.create(
            name='Laptop B', category=category, managing_department=other_department
        )

        set_managing_dept_it(_AppsStub(), None)

        it_department = Department.objects.get(name='IT')
        self.assertEqual(it_department.code, 'IT')

        item_without_department.refresh_from_db()
        item_with_department.refresh_from_db()
        self.assertEqual(item_without_department.managing_department, it_department)
        self.assertEqual(item_with_department.managing_department, it_department)
