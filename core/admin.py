from django.contrib import admin
from .models import CustomUser, Book, BorrowRecord, LoginActivity

admin.site.register(CustomUser)
admin.site.register(Book)
admin.site.register(BorrowRecord)
admin.site.register(LoginActivity)

# Register your models here.
