# Resend + Netlify + Supabase Setup

Complete walkthrough for sending email with Resend when hosting WorkTrack Pro on Netlify. Covers:

- **Netlify**: Proposal intake emails (submit-proposal function)
- **Supabase Auth**: Sign-up confirmation and password reset emails (SMTP)

Use **one Resend account and one API key** for both.

---

## 1. Create a Resend account

1. Go to **[resend.com](https://resend.com)** and sign up.
2. Verify your email if prompted.

---

## 2. Verify your sending domain

You must verify the domain you send from (e.g. `roughcutmfg.com`). Until then, Resend only allows sending to your own email (for testing).

1. In Resend: **Domains** → **Add Domain**.
2. Enter your domain (e.g. `roughcutmfg.com`) → **Add**.
3. Resend shows DNS records (SPF, DKIM, etc.). Add them at your DNS provider:
   - **Where**: Your domain registrar or DNS host (Cloudflare, Namecheap, GoDaddy, etc.).
   - **What**: Create the records Resend lists (usually 1–3 records; type can be TXT or CNAME).
4. In Resend, click **Verify**. It may take a few minutes to a few hours for DNS to propagate.
5. When the domain shows **Verified**, you can send from any address on that domain (e.g. `no-reply@roughcutmfg.com`, `quotes@roughcutmfg.com`).

**No custom domain yet?** Resend’s free tier often allows sending from `onboarding@resend.dev` for testing (check Resend’s current docs). You’d use that only for testing; for production, verify your own domain.

---

## 3. Create a Resend API key

1. In Resend: **API Keys** → **Create API Key**.
2. Name it (e.g. `WorkTrack Pro – Netlify & Supabase`).
3. **Copy the key** (starts with `re_`). You won’t see it again; store it somewhere safe.
4. You’ll use this same key in **Netlify** (env var) and in **Supabase** (SMTP password).

---

## 4. Netlify: Environment variables

These are used by your Netlify site and the `submit-proposal` function.

1. In **[Netlify Dashboard](https://app.netlify.com)** → your site → **Site configuration** → **Environment variables** (or **Build & deploy** → **Environment**).
2. Click **Add a variable** (or **Add single variable** / **New variable**).
3. Add these (use **Add single variable** for each, or **Import from .env** if you have a file):

   | Variable | Value | Notes |
   |----------|--------|--------|
   | `RESEND_API_KEY` | `re_xxxxxxxx...` | Your Resend API key from step 3. |
   | `PROPOSAL_FROM_EMAIL` | `Your Name <no-reply@yourdomain.com>` | Must be an address on your **verified** domain. Example: `Rough Cut Manufacturing <no-reply@roughcutmfg.com>`. |

4. Add or confirm the rest of your app’s variables (from `.env.example`), including:
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SECRET_KEY`, `VITE_TURNSTILE_SITE_KEY`
   - `PROPOSAL_ADMIN_EMAIL`, `APP_PUBLIC_URL`
   - Trello vars if you use Trello import

5. **Scopes**: For `RESEND_API_KEY` and `PROPOSAL_FROM_EMAIL`, make sure they’re available to **Functions** (and **Build** if you ever need them at build time). In Netlify you can set “Scopes” to **All** or include **Functions**.
6. **Save** and trigger a new deploy (or wait for the next one) so the function gets the new vars.

After this, the proposal form that uses the `submit-proposal` Netlify function will send email via Resend.

---

## 5. Supabase: SMTP (auth emails)

So that **sign-up confirmation** and **password reset** emails go through Resend (and not Supabase’s limited default mailer):

1. Open **[Supabase Dashboard](https://supabase.com/dashboard)** → your project.
2. Go to **Authentication** → **SMTP Settings** (or **Project Settings** → **Auth** → **SMTP**).
3. Enable **Custom SMTP** (or “Use custom SMTP”).
4. Fill in:

   | Field | Value |
   |--------|--------|
   | **Sender email** | An address on your verified domain, e.g. `no-reply@roughcutmfg.com` (can match `PROPOSAL_FROM_EMAIL` or use a dedicated one like `auth@roughcutmfg.com`). |
   | **Sender name** | e.g. `WorkTrack Pro` or your app name. |
   | **Host** | `smtp.resend.com` |
   | **Port** | `465` |
   | **Username** | `resend` (the word “resend”, no email). |
   | **Password** | Your **same** Resend API key (`re_...`). |

5. Save.

Supabase will now send all auth-related emails (confirm signup, reset password, magic link, etc.) through Resend. No env vars for SMTP are set in Netlify; this is configured only in Supabase.

---

## 6. Optional: local development

- Copy `.env.example` to `.env.local`.
- Set `RESEND_API_KEY` and `PROPOSAL_FROM_EMAIL` in `.env.local` so the proposal flow works locally (e.g. when running Netlify Dev or calling the function locally).
- Supabase SMTP is global per project; once set in the dashboard, it applies to all environments (local and production).

---

## Checklist

- [ ] Resend account created
- [ ] Domain verified in Resend (DNS records added and verified)
- [ ] Resend API key created and copied
- [ ] Netlify: `RESEND_API_KEY` and `PROPOSAL_FROM_EMAIL` set (and other vars from `.env.example`)
- [ ] Netlify: New deploy so functions get the new env
- [ ] Supabase: Custom SMTP enabled with Resend host/port/username/password and sender email/name
- [ ] Test: Submit a proposal on the live site and confirm email is received
- [ ] Test: Sign up or “Forgot password” and confirm auth emails are received

---

## Troubleshooting

- **Proposal emails not sending**: Check Netlify function logs (Netlify → **Functions** → `submit-proposal`). Ensure `RESEND_API_KEY` and `PROPOSAL_FROM_EMAIL` are set and that the from address uses a verified domain.
- **Auth emails not sending**: In Supabase, **Authentication** → **Users** or **Logs** for errors. Confirm SMTP settings, and that the sender email uses a verified domain in Resend.
- **“Domain not verified”**: Wait for DNS propagation (up to 24–48 hours in rare cases) and re-verify in Resend.
