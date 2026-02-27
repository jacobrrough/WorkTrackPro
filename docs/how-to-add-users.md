# How to Add Users to WorkTrack Pro

When your domain email (Resend/Gmail) isn’t verifying, confirmation and password-reset emails won’t go out. You can still add users in two ways.

**Note:** New users need `is_approved = true` on their `profiles` row to access the app (see Option 2 or the SQL below). If you use a sign-up flow, approve them in Supabase after sign-up.

---

## Option 1: Let users sign up (no email confirmation)

Turn off **email confirmation** in Supabase so new sign-ups can log in immediately.

1. Open **[Supabase Dashboard](https://supabase.com/dashboard)** → your project.
2. Go to **Authentication** → **Providers** → **Email**.
3. Turn **OFF** “Confirm email”.
4. Save.

After that, anyone who goes to the login page, clicks **Sign up**, and enters email + password can log in right away (no “check your email” step).

**To make someone an admin:** run this in Supabase **SQL Editor** (replace the email):

```sql
update public.profiles
set is_admin = true, is_approved = true
where email = 'admin@roughcutmfg.com';
```

---

## Option 2: Add users yourself in Supabase (recommended if you want control)

You create the account and set a temporary password; the user logs in and can change it later (if you add a “change password” flow).

1. Open **[Supabase Dashboard](https://supabase.com/dashboard)** → your project.
2. Go to **Authentication** → **Users**.
3. Click **Add user** → **Create new user**.
4. Enter:
   - **Email:** e.g. `jane@roughcutmfg.com`
   - **Password:** a temporary password (min 6 characters)
   - Leave **Auto Confirm User** **ON** so they can log in without clicking an email link.
5. Click **Create user**.

A row in `auth.users` is created and the trigger in your DB creates a `profiles` row. The user can log in at your app’s login page with that email and password.

**To make this user an admin (and ensure they can log in):** run in **SQL Editor**:

```sql
update public.profiles
set is_admin = true, is_approved = true
where email = 'jane@roughcutmfg.com';
```

---

## Summary

| Goal | What to do |
|------|------------|
| Anyone can self-sign-up and log in immediately | Option 1: Disable “Confirm email” in Supabase → Auth → Providers → Email. New users still need `is_approved = true` on `profiles` (set via SQL or your process). |
| You create each user and set their password | Option 2: Supabase → Authentication → Users → Add user (with “Auto Confirm User” on). Set `is_approved = true` in `profiles` (trigger may create the row; approve via SQL if needed). |
| Give a user admin rights | Run `update public.profiles set is_admin = true where email = '...'` in Supabase SQL Editor. |
| Let a new user access the app | Ensure `profiles.is_approved` is true for that user (required for WorkTrack Pro to show the dashboard). |

Password reset will still depend on Supabase’s built-in email (or your custom SMTP once Resend/Gmail are fixed). Until then, you can set a new password for a user from Supabase: **Authentication** → **Users** → open the user → **Send password recovery** (uses Supabase’s default sender) or change the password manually in the user’s row if your Supabase plan allows it.
