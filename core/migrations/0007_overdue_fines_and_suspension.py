from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('core', '0006_remove_borrowrecord_fines')]

    operations = [
        migrations.AddField(
            model_name='borrowrecord', name='fine_amount',
            field=models.DecimalField(decimal_places=2, default=0, max_digits=6),
        ),
        migrations.AddField(
            model_name='borrowrecord', name='fine_paid',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='customuser', name='is_suspended',
            field=models.BooleanField(default=False),
        ),
    ]
