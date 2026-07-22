from decimal import Decimal
from django.test import TestCase
from django.urls import reverse
from datetime import timedelta
from django.utils import timezone

from .models import Book, BorrowRecord, CustomUser, LoginActivity


class AdminReportTests(TestCase):
    def setUp(self):
        self.admin = CustomUser.objects.create_user('admin', password='admin-pass', role='admin')
        self.member = CustomUser.objects.create_user('member', password='member-pass', role='user')
        self.book = Book.objects.create(title='Report Book', author='Author', isbn='12345', category='Test')

    def test_admin_can_download_report_with_outstanding_fine_and_login_history(self):
        BorrowRecord.objects.create(
            user=self.member, book=self.book, due_date=timezone.now().date() - timedelta(days=1),
            status='overdue', fine_amount=Decimal('20.00')
        )
        LoginActivity.objects.create(user=self.member)
        self.client.force_login(self.admin)

        response = self.client.get(reverse('download_admin_report'))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'text/csv')
        self.assertIn('Books currently owed,1', response.content.decode())
        self.assertIn('member', response.content.decode())
