from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0004_loginactivity'),
    ]

    operations = [
        migrations.AlterField(
            model_name='customuser',
            name='role',
            field=models.CharField(
                choices=[('admin', 'Admin'), ('user', 'Member')],
                default='user',
                max_length=10,
            ),
        ),
        migrations.AlterModelOptions(
            name='customuser',
            options={'verbose_name': 'Member', 'verbose_name_plural': 'Members'},
        ),
    ]
