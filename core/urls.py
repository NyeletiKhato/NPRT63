from django.urls import path
from django.contrib.auth import views as auth_views
from . import views

urlpatterns = [
    path('api/session/', views.api_session, name='api_session'),
    path('api/login/', views.api_login, name='api_login'),
    path('api/register/', views.api_register, name='api_register'),
    path('api/logout/', views.api_logout, name='api_logout'),
    path('api/books/', views.api_books, name='api_books'),
    path('api/books/<int:book_id>/', views.api_book_detail, name='api_book_detail'),
    path('api/books/<int:book_id>/borrow/', views.api_borrow_book, name='api_borrow_book'),
    path('api/my-books/', views.api_my_books, name='api_my_books'),
    path('api/my-books/<int:record_id>/return/', views.api_return_book, name='api_return_book'),
    path('api/my-books/<int:record_id>/pay-fine/', views.api_pay_fine, name='api_pay_fine'),
    path('api/admin/summary/', views.api_admin_summary, name='api_admin_summary'),

    path('', views.home, name='home'),
    path('user-entry/', views.user_entry, name='user_entry'),
    path('register/', views.register_view, name='register'),
    path('login/', views.custom_login_view, name='login'),
    path('logout/', auth_views.LogoutView.as_view(next_page='home'), name='logout'),

    path('redirect-dashboard/', views.redirect_dashboard, name='redirect_dashboard'),
    path('user-dashboard/', views.user_dashboard, name='user_dashboard'),

    path('admin-dashboard/', views.admin_dashboard, name='admin_dashboard'),
    path('manage-books/', views.manage_books, name='manage_books'),
    path('add-book/', views.add_book, name='add_book'),
    path('edit-book/<int:book_id>/', views.edit_book, name='edit_book'),
    path('delete-book/<int:book_id>/', views.delete_book, name='delete_book'),
    path('admin-borrowed-books/', views.admin_borrowed_books, name='admin_borrowed_books'),
    path('admin-reports/', views.admin_reports, name='admin_reports'),
    path('manage-users/', views.manage_users, name='manage_users'),
    

    path('books/', views.view_books, name='view_books'),
    path('borrow/<int:book_id>/', views.borrow_book, name='borrow_book'),
    path('my-books/', views.my_borrowed_books, name='my_borrowed_books'),
    path('return-book/<int:record_id>/', views.return_book, name='return_book'),
    path('manage-books/', views.manage_books, name='manage_books'),

    path('fine-payment/', views.fine_payment_page, name='fine_payment'),
path('pay-fine/<int:record_id>/', views.pay_fine, name='pay_fine'),
]
