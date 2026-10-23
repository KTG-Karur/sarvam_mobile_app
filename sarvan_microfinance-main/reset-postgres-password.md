# How to Reset PostgreSQL Password for 'admin' User

## Method 1: Using psql Command Line

1. Open PowerShell or Command Prompt
2. Connect as the default postgres superuser:
   ```bash
   psql -U postgres
   ```
   (You may need to enter the postgres user's password)

3. Once connected, reset the admin user's password:
   ```sql
   ALTER USER admin WITH PASSWORD 'your_new_password';
   ```

4. Exit psql:
   ```sql
   \q
   ```

## Method 2: Using pgAdmin (GUI)

1. Open pgAdmin
2. Connect to your PostgreSQL server
3. Navigate to: Login/Group Roles → admin → Right-click → Properties
4. Go to the "Definition" tab
5. Enter a new password
6. Click "Save"

## Method 3: Test Connection First

Try connecting directly to see what password works:

```bash
psql -U admin -d k3_micro_finance -h localhost
```

This will prompt you for the password. Try common passwords or the one you remember setting.

## Method 4: Check Your PostgreSQL Installation Notes

- Check any installation documentation you saved
- Check password managers (LastPass, 1Password, etc.)
- Check if you wrote it down somewhere










