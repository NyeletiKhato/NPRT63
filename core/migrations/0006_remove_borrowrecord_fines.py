from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0005_member_role_labels'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='borrowrecord',
            name='fine_amount',
        ),
        migrations.RemoveField(
            model_name='borrowrecord',
            name='fine_paid',
        ),
    ]
