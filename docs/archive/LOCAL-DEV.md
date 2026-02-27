# Local Development Guide

Preview your app locally before pushing to avoid wasting Netlify credits!

## Quick Start

1. **Add your Supabase credentials** to `.env.local`:
   - Open `.env.local` in this folder
   - Replace `your-anon-key-here` with your actual **Anon key (Legacy)** from Supabase
   - Get it from: Supabase Dashboard → Project Settings → API → API Keys tab

2. **Start the dev server**:
   ```bash
   npm run dev
   ```

3. **Open your browser**:
   - The terminal will show: `Local: http://localhost:3000`
   - Open that URL in your browser
   - You should see the Rough Cut Manufacturing landing page!

## What You'll See

- **Landing page** (`/`) - Company website with Employee Login button
- **Login** (`/login`) - Sign in with your Supabase user credentials
- **App** - Full WorkTrack Pro app after login

## Testing Changes

- Make changes to any file in `src/`
- Save the file
- Browser automatically refreshes (hot reload)
- No need to rebuild or redeploy!

## Environment Files

- **`.env.local`** - Your local dev credentials (gitignored, safe to commit)
- **`.env.example`** - Template showing what variables are needed
- **`.env`** - Old PocketBase config (can be deleted)

## Troubleshooting

**"Invalid Supabase URL" error:**
- Check `.env.local` has the correct URL (no quotes, no trailing slash)
- Make sure you copied the **Anon key (Legacy)**, not the Publishable key
- Restart the dev server after changing `.env.local`

**Port already in use:**
- Change port in `vite.config.ts` or kill the process using port 3000

**Can't connect to Supabase:**
- Verify your Supabase project is active
- Check your internet connection
- Make sure you're using the correct project URL

## Stopping the Dev Server

Press `Ctrl+C` in the terminal where `npm run dev` is running.
