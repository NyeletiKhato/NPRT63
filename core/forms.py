from django import forms
from django.contrib.auth.forms import UserCreationForm
from .models import CustomUser, Book


class RegisterForm(UserCreationForm):
    email = forms.EmailField(required=True)

    class Meta:
        model = CustomUser
        fields = ['first_name', 'username', 'email', 'role', 'password1', 'password2']


class BookForm(forms.ModelForm):
    class Meta:
        model = Book
        fields = ['title', 'author', 'isbn', 'category', 'quantity', 'available_copies']