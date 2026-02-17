# Deploy to Netlify via GitHub

Netlify auto-deploys when you push to GitHub. No workflow file needed.

## Setup

1. **Push this repo to GitHub**
   - Create a new repo on GitHub, then:
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/WorkTrackPro.git
   git add -A && git commit -m "Supabase + Netlify" && git push -u origin main
   ```

2. **Connect to Netlify**
   - Go to [netlify.com](https://netlify.com) → Add new site → Import from Git
   - Choose GitHub and select the WorkTrackPro repo
   - Build command: `npm run build` (default from netlify.toml)
   - Publish directory: `dist`
   - Add environment variables in Netlify: Site settings → Environment variables:
     - `VITE_SUPABASE_URL` = your Supabase project URL
     - `VITE_SUPABASE_ANON_KEY` = your Supabase anon key

3. **Supabase**
   - Create a project at [supabase.com](https://supabase.com)
   - Run the SQL in `supabase/migrations/20250216000001_initial_schema.sql` in the SQL Editor
   - Create Storage buckets: `attachments` (public) and `inventory-images` (public) if you use images
   - In Authentication → Providers enable Email; create a user and set `is_admin` in `profiles` for admin access

Every push to `main` will trigger a new deploy on Netlify.
