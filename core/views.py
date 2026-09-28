import csv
import json

from django.conf import settings
from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth import authenticate, login, logout as auth_logout
from django.contrib.auth.decorators import login_required
from django.contrib import messages
from django.db import transaction
from django.db.models import Q, Sum
from django.http import HttpResponse, JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.http import require_http_methods, require_POST
from .models import CustomUser, Book, BorrowRecord, LoginActivity
from .forms import RegisterForm, BookForm
from django.utils import timezone


def _record_login(user):
    """Keep a separate audit trail; Django's last_login only retains one login."""
    LoginActivity.objects.create(user=user)


def _report_data():
    records = BorrowRecord.objects.select_related('user', 'book').all().order_by('-borrow_date')
    return {
        'generated_at': timezone.localtime(),
        'total_books': Book.objects.count(),
        'total_copies': Book.objects.aggregate(total=Sum('quantity'))['total'] or 0,
        'total_borrowed': records.count(),
        'books_currently_borrowed': records.filter(status__in=['borrowed', 'overdue']).count(),
        'records': records,
        'login_activities': LoginActivity.objects.select_related('user').all(),
    }


def _json_body(request):
    try:
        return json.loads(request.body.decode('utf-8') or '{}')
    except json.JSONDecodeError:
        return {}


def _book_json(book):
    quantity = max(book.quantity, book.available_copies)
    return {
        'id': book.id,
        'title': book.title,
        'author': book.author,
        'isbn': book.isbn,
        'category': book.category,
        'quantity': quantity,
        'available_copies': min(book.available_copies, quantity),
    }


def _normalize_book_inventory(book):
    changed = False
    if book.available_copies > book.quantity:
        book.quantity = book.available_copies
        changed = True
    if book.available_copies < 0:
        book.available_copies = 0
        changed = True
    if changed:
        book.save(update_fields=['quantity', 'available_copies'])
    return book


def _user_json(user):
    return {
        'id': user.id,
        'username': user.username,
        'email': user.email,
        'role': user.role,
        'is_authenticated': user.is_authenticated,
    }


def _borrow_record_json(record):
    return {
        'id': record.id,
        'user': _user_json(record.user),
        'book': _book_json(record.book),
        'borrow_date': record.borrow_date.isoformat() if record.borrow_date else None,
        'due_date': record.due_date.isoformat() if record.due_date else None,
        'return_date': record.return_date.isoformat() if record.return_date else None,
        'status': record.status,
    }


def _login_activity_json(activity):
    return {
        'id': activity.id,
        'user': _user_json(activity.user),
        'logged_in_at': activity.logged_in_at.isoformat(),
    }


def _require_authenticated(request):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Authentication required.'}, status=401)
    return None


def _require_role(request, role):
    auth_error = _require_authenticated(request)
    if auth_error:
        return auth_error
    if request.user.role != role:
        label = 'Member' if role == 'user' else role.title()
        return JsonResponse({'error': f'{label} access required.'}, status=403)
    return None


def home(request):
    react_index = settings.BASE_DIR / 'static' / 'react' / 'index.html'
    if react_index.exists():
        return HttpResponse(react_index.read_text(encoding='utf-8'))
    return render(request, 'core/home.html')


def api_session(request):
    data = {
        'csrfToken': get_token(request),
        'user': None,
    }
    if request.user.is_authenticated:
        data['user'] = _user_json(request.user)
    return JsonResponse(data)


@require_POST
def api_login(request):
    data = _json_body(request)
    username = data.get('username', '').strip()
    password = data.get('password', '')
    role = data.get('role', 'user')

    user = authenticate(request, username=username, password=password)
    if user is None:
        return JsonResponse({'error': 'Invalid username or password.'}, status=400)

    if role == 'admin' and user.role != 'admin':
        return JsonResponse({'error': 'You are not an admin.'}, status=403)
    if role == 'user' and user.role != 'user':
        return JsonResponse({'error': 'You are not a library member.'}, status=403)

    login(request, user)
    _record_login(user)
    return JsonResponse({'csrfToken': get_token(request), 'user': _user_json(user)})


@require_POST
def api_register(request):
    data = _json_body(request)
    username = data.get('username', '').strip()
    email = data.get('email', '').strip()
    password = data.get('password', '')

    if not username or not password:
        return JsonResponse({'error': 'Username and password are required.'}, status=400)
    if CustomUser.objects.filter(username=username).exists():
        return JsonResponse({'error': 'That username is already taken.'}, status=400)

    user = CustomUser.objects.create_user(
        username=username,
        email=email,
        password=password,
        role='user',
    )
    login(request, user)
    return JsonResponse({'csrfToken': get_token(request), 'user': _user_json(user)}, status=201)


@require_POST
def api_logout(request):
    auth_logout(request)
    return JsonResponse({'ok': True})


def api_books(request):
    auth_error = _require_authenticated(request)
    if auth_error:
        return auth_error

    if request.method == 'POST':
        role_error = _require_role(request, 'admin')
        if role_error:
            return role_error
        data = _json_body(request)
        quantity = int(data.get('quantity') or 1)
        available_copies = int(data.get('available_copies') or quantity)
        book = Book.objects.create(
            title=data.get('title', '').strip(),
            author=data.get('author', '').strip(),
            isbn=data.get('isbn', '').strip(),
            category=data.get('category', '').strip(),
            quantity=max(quantity, available_copies),
            available_copies=available_copies,
        )
        return JsonResponse({'book': _book_json(book)}, status=201)

    query = request.GET.get('q', '').strip()
    books = Book.objects.all().order_by('title')
    if query:
        books = books.filter(
            Q(title__icontains=query) |
            Q(author__icontains=query) |
            Q(category__icontains=query) |
            Q(isbn__icontains=query)
        )
    normalized_books = [_normalize_book_inventory(book) for book in books]
    return JsonResponse({'books': [_book_json(book) for book in normalized_books]})


@require_http_methods(['PUT', 'DELETE'])
def api_book_detail(request, book_id):
    role_error = _require_role(request, 'admin')
    if role_error:
        return role_error

    book = get_object_or_404(Book, id=book_id)
    if request.method == 'DELETE':
        book.delete()
        return JsonResponse({'ok': True})

    data = _json_body(request)
    for field in ['title', 'author', 'isbn', 'category']:
        if field in data:
            setattr(book, field, data.get(field, '').strip())
    for field in ['quantity', 'available_copies']:
        if field in data:
            setattr(book, field, int(data.get(field) or 0))
    if book.available_copies > book.quantity:
        book.quantity = book.available_copies
    book.save()
    return JsonResponse({'book': _book_json(book)})


@require_POST
def api_borrow_book(request, book_id):
    role_error = _require_role(request, 'user')
    if role_error:
        return role_error

    book = _normalize_book_inventory(get_object_or_404(Book, id=book_id))
    already_borrowed = BorrowRecord.objects.filter(
        user=request.user,
        book=book,
        status='borrowed',
    ).exists()

    if already_borrowed:
        return JsonResponse({'error': 'You already borrowed this book.'}, status=400)
    if book.available_copies <= 0:
        return JsonResponse({'error': 'This book is not available right now.'}, status=400)

    record = BorrowRecord.objects.create(user=request.user, book=book)
    book.available_copies -= 1
    book.save()
    return JsonResponse({'record': _borrow_record_json(record)})


def api_my_books(request):
    role_error = _require_role(request, 'user')
    if role_error:
        return role_error

    borrowed_books = BorrowRecord.objects.filter(
        user=request.user
    ).select_related('book', 'user').order_by('-borrow_date')

    return JsonResponse({'records': [_borrow_record_json(record) for record in borrowed_books]})


@require_POST
def api_return_book(request, record_id):
    role_error = _require_role(request, 'user')
    if role_error:
        return role_error

    record = get_object_or_404(BorrowRecord, id=record_id, user=request.user)
    if record.status == 'returned':
        return JsonResponse({'error': 'This book has already been returned.'}, status=400)

    today = timezone.now().date()
    record.return_date = today
    record.status = 'returned'
    record.save()

    book = _normalize_book_inventory(record.book)
    book.available_copies = min(book.available_copies + 1, book.quantity)
    book.save()
    return JsonResponse({'record': _borrow_record_json(record)})


@require_POST
def api_admin_summary(request):
    role_error = _require_role(request, 'admin')
    if role_error:
        return role_error

    report = _report_data()
    records = report['records']
    return JsonResponse({
        'stats': {
            'total_books': Book.objects.count(),
            'total_copies': Book.objects.aggregate(total=Sum('quantity'))['total'] or 0,
            'total_borrowed': BorrowRecord.objects.filter(status='borrowed').count(),
            'total_returned': BorrowRecord.objects.filter(status='returned').count(),
            'total_users': CustomUser.objects.filter(role='user').count(),
        },
        'report_stats': {'total_borrowed': report['total_borrowed']},
        'users': [_user_json(user) for user in CustomUser.objects.all().order_by('username')],
        'records': [_borrow_record_json(record) for record in records],
        'login_activities': [_login_activity_json(activity) for activity in report['login_activities']],
    })

def user_entry(request):
    return render(request, 'core/user_entry.html')
def register_view(request):
    if request.method == 'POST':
        form = RegisterForm(request.POST)
        if form.is_valid():
            form.save()
            messages.success(request, "Account created successfully. Please login.")
            return redirect('/login/?role=user')
    else:
        form = RegisterForm()

    return render(request, 'core/register.html', {'form': form})


def custom_login_view(request):
    if request.method == 'POST':
        username = request.POST.get('username')
        password = request.POST.get('password')
        role = request.POST.get('role', 'user')

        user = authenticate(request, username=username, password=password)

        if user is not None:
            if role == 'admin' and user.role != 'admin':
                messages.error(request, "You are not an admin.")
                return redirect('/login/?role=admin')

            if role == 'user' and user.role != 'user':
                messages.error(request, "You are not a library member.")
                return redirect('/login/?role=user')

            login(request, user)
            _record_login(user)

            if user.role == 'admin':
                return redirect('admin_dashboard')
            return redirect('user_dashboard')

        messages.error(request, "Invalid username or password.")
        if role == 'admin':
            return redirect('/login/?role=admin')
        return redirect('/login/?role=user')

    return render(request, 'core/login.html')


@login_required
def redirect_dashboard(request):
    if request.user.role == 'admin':
        return redirect('admin_dashboard')
    return redirect('user_dashboard')


@login_required
def user_dashboard(request):
    if request.user.role != 'user':
        return redirect('admin_dashboard')
    return render(request, 'core/user_dashboard.html')


@login_required
def admin_dashboard(request):
    if request.user.role != 'admin':
        return redirect('user_dashboard')
    return render(request, 'core/admin_dashboard.html')


@login_required
def view_books(request):
    query = request.GET.get('q')

    if query:
        books = Book.objects.filter(
            Q(title__icontains=query) |
            Q(author__icontains=query) |
            Q(category__icontains=query) |
            Q(isbn__icontains=query)
        )
    else:
        books = Book.objects.all()

    return render(request, 'core/view_books.html', {
        'books': books,
        'query': query
    })


@login_required
@require_POST
def borrow_book(request, book_id):
    if request.user.role != 'user':
        messages.error(request, "Only library members can borrow books.")
        return redirect('redirect_dashboard')

    with transaction.atomic():
        book = Book.objects.select_for_update().filter(id=book_id).first()
        if not book:
            messages.error(request, 'Book not found.')
            return redirect('view_books')

        book = _normalize_book_inventory(book)
        already_borrowed = BorrowRecord.objects.filter(
            user=request.user,
            book=book,
            status__in=['borrowed', 'overdue'],
        ).exists()

        if already_borrowed:
            messages.warning(request, 'You already borrowed this book.')
        elif book.available_copies > 0:
            BorrowRecord.objects.create(user=request.user, book=book)
            book.available_copies -= 1
            book.save(update_fields=['available_copies'])
            messages.success(request, f'You borrowed "{book.title}" successfully.')
        else:
            messages.error(request, 'This book is not available right now.')

    return redirect('view_books')


@login_required
def my_borrowed_books(request):
    if request.user.role != 'user':
        return redirect('redirect_dashboard')

    borrowed_books = BorrowRecord.objects.filter(user=request.user).order_by('-borrow_date')

    return render(request, 'core/my_borrowed_books.html', {'borrowed_books': borrowed_books})
@login_required
def manage_books(request):
    if request.user.role != 'admin':
        return redirect('user_dashboard')

    books = Book.objects.all().order_by('title')
    return render(request, 'core/manage_books.html', {'books': books})


@login_required
def admin_borrowed_books(request):
    if request.user.role != 'admin':
        return redirect('user_dashboard')

    borrowed_books = BorrowRecord.objects.select_related('user', 'book').all().order_by('-borrow_date')
    return render(request, 'core/admin_borrowed_books.html', {'borrowed_books': borrowed_books})


@login_required
def admin_reports(request):
    if request.user.role != 'admin':
        return redirect('user_dashboard')

    return render(request, 'core/admin_reports.html', _report_data())


@login_required
def download_admin_report(request):
    if request.user.role != 'admin':
        return redirect('user_dashboard')

    report = _report_data()
    response = HttpResponse(content_type='text/csv')
    response['Content-Disposition'] = 'attachment; filename="library-admin-report.csv"'
    writer = csv.writer(response)
    writer.writerow(['Library administration report'])
    writer.writerow(['Generated', report['generated_at'].strftime('%d %B %Y %H:%M')])
    writer.writerow([])
    writer.writerow(['Summary'])
    writer.writerow(['Books in catalogue', report['total_books']])
    writer.writerow(['Total copies in catalogue', report['total_copies']])
    writer.writerow(['Books borrowed (all time)', report['total_borrowed']])
    writer.writerow(['Books currently borrowed', report['books_currently_borrowed']])
    writer.writerow([])
    writer.writerow(['Borrowing records'])
    writer.writerow(['Borrower', 'Book', 'Borrowed on', 'Due on', 'Status'])
    for record in report['records']:
        writer.writerow([record.user.username, record.book.title, record.borrow_date, record.due_date,
                         record.get_status_display()])
    writer.writerow([])
    writer.writerow(['Successful login history'])
    writer.writerow(['Username', 'Email', 'Role', 'Logged in at'])
    for activity in report['login_activities']:
        writer.writerow([activity.user.username, activity.user.email, activity.user.get_role_display(),
                         timezone.localtime(activity.logged_in_at).strftime('%d %B %Y %H:%M')])
    return response


@login_required
def manage_users(request):
    if request.user.role != 'admin':
        return redirect('user_dashboard')

    users = CustomUser.objects.all().order_by('username')
    return render(request, 'core/manage_users.html', {'users': users})


@login_required
def manage_books(request):
    if request.user.role != 'admin':
        return redirect('user_dashboard')

    books = Book.objects.all().order_by('title')
    return render(request, 'core/manage_books.html', {'books': books})


@login_required
def add_book(request):
    if request.user.role != 'admin':
        return redirect('user_dashboard')

    if request.method == 'POST':
        form = BookForm(request.POST)
        if form.is_valid():
            form.save()
            messages.success(request, "Book added successfully.")
            return redirect('manage_books')
    else:
        form = BookForm()

    return render(request, 'core/book_form.html', {
        'form': form,
        'title': 'Add Book'
    })


@login_required
def edit_book(request, book_id):
    if request.user.role != 'admin':
        return redirect('user_dashboard')

    book = get_object_or_404(Book, id=book_id)

    if request.method == 'POST':
        form = BookForm(request.POST, instance=book)
        if form.is_valid():
            form.save()
            messages.success(request, "Book updated successfully.")
            return redirect('manage_books')
    else:
        form = BookForm(instance=book)

    return render(request, 'core/book_form.html', {
        'form': form,
        'title': 'Edit Book'
    })


@login_required
def delete_book(request, book_id):
    if request.user.role != 'admin':
        return redirect('user_dashboard')

    book = get_object_or_404(Book, id=book_id)

    if request.method == 'POST':
        book.delete()
        messages.success(request, "Book deleted successfully.")
        return redirect('manage_books')

    return render(request, 'core/delete_book.html', {'book': book})

@login_required
def return_book(request, record_id):
    if request.user.role != 'user':
        return redirect('redirect_dashboard')

    record = get_object_or_404(BorrowRecord, id=record_id, user=request.user)
    if record.status == 'returned':
        messages.warning(request, "This book has already been returned.")
        return redirect('my_borrowed_books')

    record.return_date = timezone.now().date()
    record.status = 'returned'
    record.save(update_fields=['return_date', 'status'])

    book = _normalize_book_inventory(record.book)
    book.available_copies = min(book.available_copies + 1, book.quantity)
    book.save()
    messages.success(request, "Book returned successfully.")
    return redirect('my_borrowed_books')
