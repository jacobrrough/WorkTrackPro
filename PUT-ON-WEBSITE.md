# Put WorkTrack Pro on Your Website

Your app is on GitHub. To put it live on the web (and optionally on **roughcutmfg.com**), use Netlify and point a subdomain to it.

---

## 1. Deploy on Netlify (free)

1. Go to **[app.netlify.com](https://app.netlify.com)** and sign in (or create an account; you can use “Sign in with GitHub”).
2. Click **“Add new site”** → **“Import an existing project”**.
3. Click **“Deploy with GitHub”** and authorize Netlify to see your repos.
4. Choose the **jacobrrough/WorkTrackPro** repository.
5. Netlify will show:
   - **Branch to deploy:** `main` (leave as is)
   - **Build command:** `npm run build` (should be filled from `netlify.toml`)
   - **Publish directory:** `dist` (should be filled from `netlify.toml`)
6. Click **“Add environment variables”** and add:
   - **Key:** `VITE_SUPABASE_URL`  
     **Value:** your Supabase project URL (from [Supabase Dashboard](https://supabase.com/dashboard) → your project → Settings → API → Project URL).
   - **Key:** `VITE_SUPABASE_ANON_KEY`  
     **Value:** your Supabase anon/public key (same page → Project API keys → `anon` `public`).
7. Click **“Deploy site”**.

After a few minutes your app will be live at a URL like **`https://something-random-123.netlify.app`**. You can use that link right away.

---

## 2. Use your own domain (e.g. app.roughcutmfg.com)

To have the app at **app.roughcutmfg.com** (so it’s “on your website”):

### In Netlify

1. In Netlify, open your site → **Site configuration** → **Domain management**.
2. Click **“Add domain”** or **“Add custom domain”**.
3. Enter **`app.roughcutmfg.com`** and follow the steps.
4. Netlify will show you what DNS record to add (usually a **CNAME** for `app` pointing to your Netlify URL, e.g. `something-random-123.netlify.app`).

### Where your domain is managed (Squarespace / registrar)

- If **roughcutmfg.com** is on **Squarespace**:  
  - Go to **Settings** → **Domains** → **roughcutmfg.com** → **DNS settings** (or “Advanced settings”).  
  - Add a **CNAME** record:  
    - **Host/Name:** `app`  
    - **Points to / Target:** the value Netlify gave you (e.g. `your-site-name.netlify.app`).
- If the domain is at another registrar (GoDaddy, Namecheap, etc.), open the DNS section there and add the same CNAME: **app** → Netlify’s URL.

After DNS updates (often 5–30 minutes), **https://app.roughcutmfg.com** will show your WorkTrack Pro app. Netlify will provide HTTPS automatically.

---

## 3. After this

- **roughcutmfg.com** and **www.roughcutmfg.com** can keep pointing to Squarespace (no change needed).
- **app.roughcutmfg.com** will be your WorkTrack Pro app on Netlify.
- Every time you **push to `main`** on GitHub, Netlify will rebuild and update the live site.

If you tell me where roughcutmfg.com is managed (Squarespace, Cloudflare, etc.), I can give you the exact clicks and values for that screen.
