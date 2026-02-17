# Fix blank screen + empty Supabase

If your site is **blank/black** or Supabase shows **no tables**, do these in order.

---

## 1. Create the database schema in Supabase

1. Open **[Supabase Dashboard](https://supabase.com/dashboard)** → your project.
2. Go to **SQL Editor** (left sidebar).
3. Click **New query**.
4. Open the file **`supabase/migrations/20250216000001_initial_schema.sql`** from this repo (in your project folder or on GitHub). Copy **all** of its contents.
5. Paste into the Supabase SQL Editor.
6. Click **Run** (or press Ctrl+Enter).
7. You should see “Success. No rows returned.” Tables (e.g. `profiles`, `jobs`, `inventory`, `shifts`, …) will appear under **Table Editor**.

---

## 2. Create storage buckets (for file uploads)

1. In Supabase, go to **Storage** (left sidebar).
2. Click **New bucket**.
3. Name: **`attachments`** → Create (public if you want direct links).
4. Create another bucket: **`inventory-images`** (optional; for inventory item images).

---

## 3. Create your first user and make them admin

1. In Supabase, go to **Authentication** → **Users**.
2. Click **Add user** → **Create new user**.
3. Enter the **email** and **password** you want to use to log in to the app.
4. Click **Create user**.
5. Go to **Table Editor** → **`profiles`**.
6. Find the row with the new user’s `id` (same as in Authentication → Users).
7. Set **`is_admin`** to **`true`** for that row and save.

You can now log in to the app with that email/password and have admin access.

---

## 4. Set env vars in Netlify and redeploy

If the **site is still blank** or shows **“Invalid supabase URL”**, the build probably ran without the env vars or with old values. Vite bakes `VITE_*` at **build time**, so you must redeploy after setting or changing them.

1. In Supabase: **Project Settings** (gear) → **API**, or use **Connect** → **API Keys** tab.
2. Copy:
   - **Project URL** (e.g. `https://xxxx.supabase.co` — no path after `.co`)
   - **Anon key (Legacy)** — use this one for `VITE_SUPABASE_ANON_KEY`, not the “Publishable key”.
3. In **Netlify**: your site → **Site configuration** → **Environment variables**.
4. Add or edit:
   - **Key:** `VITE_SUPABASE_URL`  
     **Value:** (paste Project URL only; no trailing slash)
   - **Key:** `VITE_SUPABASE_ANON_KEY`  
     **Value:** (paste the **Anon key (Legacy)** from Supabase)
5. Save.
6. **Trigger a fresh deploy:** **Deploys** → **Trigger deploy** → **Clear cache and deploy site**. This forces a new build so the live bundle gets the current env values.

After the deploy finishes, reload your site. You should see the **Rough Cut** landing page or the app.

---

## Checklist

- [ ] Ran the full SQL from `supabase/migrations/20250216000001_initial_schema.sql` in Supabase SQL Editor.
- [ ] Created Storage buckets: `attachments` (and optionally `inventory-images`).
- [ ] Created a user in Authentication and set their `profiles.is_admin` to `true`.
- [ ] Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Netlify.
- [ ] Triggered a new deploy on Netlify and waited for it to finish.
