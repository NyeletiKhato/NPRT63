from django.test import TestCase
from django.urls import reverse

from .models import Book, BorrowRecord, CustomUser, LoginActivity


class AdminReportTests(TestCase):
    def setUp(self):
        self.admin = CustomUser.objects.create_user('admin', password='admin-pass', role='admin')
        self.member = CustomUser.objects.create_user('member', password='member-pass', role='user')
        self.book = Book.objects.create(title='Report Book', author='Author', isbn='12345', category='Test')

    def test_admin_can_download_report_with_borrowing_and_login_history(self):
        BorrowRecord.objects.create(
            user=self.member, book=self.book, status='overdue'
        )
        LoginActivity.objects.create(user=self.member)
        self.client.force_login(self.admin)

        response = self.client.get(reverse('download_admin_report'))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'text/csv')
        self.assertIn('Books currently borrowed,1', response.content.decode())
        self.assertNotIn('Fine', response.content.decode())
        self.assertIn('member', response.content.decode())


class BorrowBookTests(TestCase):
    def setUp(self):
        self.member = CustomUser.objects.create_user('member', password='member-pass', role='user')
        self.book = Book.objects.create(
            title='Available Book', author='Author', isbn='borrow-123', category='Test',
            quantity=1, available_copies=1,
        )
        self.client.force_login(self.member)

    def test_member_can_borrow_an_available_book_with_a_post(self):
        response = self.client.post(reverse('borrow_book', args=[self.book.id]))
        self.assertRedirects(response, reverse('view_books'))
        self.book.refresh_from_db()
        self.assertEqual(self.book.available_copies, 0)
        self.assertTrue(BorrowRecord.objects.filter(user=self.member, book=self.book, status='borrowed').exists())

    def test_borrow_endpoint_rejects_get_requests(self):
        response = self.client.get(reverse('borrow_book', args=[self.book.id]))
        self.assertEqual(response.status_code, 405)

    def test_cannot_borrow_unavailable_book(self):
        self.book.available_copies = 0
        self.book.save()
        self.client.post(reverse('borrow_book', args=[self.book.id]))
        self.book.refresh_from_db()
        self.assertEqual(self.book.available_copies, 0)
        self.assertFalse(BorrowRecord.objects.filter(user=self.member, book=self.book).exists())

    def test_cannot_borrow_same_book_twice(self):
        self.client.post(reverse('borrow_book', args=[self.book.id]))
        self.client.post(reverse('borrow_book', args=[self.book.id]))
        self.assertEqual(BorrowRecord.objects.filter(user=self.member, book=self.book).count(), 1)


class ReturnBookTests(TestCase):
    def setUp(self):
        self.member = CustomUser.objects.create_user('member', password='member-pass', role='user')
        self.book = Book.objects.create(
            title='Return Test Book', author='Author', isbn='return-123', category='Test',
            quantity=1, available_copies=0,
        )
        self.record = BorrowRecord.objects.create(user=self.member, book=self.book, status='borrowed')
        self.client.force_login(self.member)

    def test_member_can_return_a_book(self):
        response = self.client.post(reverse('return_book', args=[self.record.id]))
        self.assertRedirects(response, reverse('my_borrowed_books'))
        self.record.refresh_from_db()
        self.book.refresh_from_db()
        self.assertEqual(self.record.status, 'returned')
        self.assertEqual(self.book.available_copies, 1)


class RegistrationTests(TestCase):
    def test_register_with_duplicate_username_fails(self):
        CustomUser.objects.create_user('member', password='member-pass', role='user')
        response = self.client.post(reverse('register'), {
            'username': 'member',
            'email': 'x@x.com',
            'password1': 'somepass123',
            'password2': 'somepass123',
        })
        # The duplicate username should not create a second account
        self.assertEqual(CustomUser.objects.filter(username='member').count(), 1)
