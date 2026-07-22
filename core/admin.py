from django.contrib import admin
from .models import CustomUser, Book, BorrowRecord

admin.site.register(CustomUser)
admin.site.register(Book)
admin.site.register(BorrowRecord)

# Register your models here.
