# WorkTrack Pro – Online with Cloudflare Tunnel (roughcutmfg.com)

Get the app online at **https://app.roughcutmfg.com** using a Cloudflare Tunnel so you don’t open firewall ports, and keep your data safe with backups.

---

## Overview

- **App URL:** `https://app.roughcutmfg.com` (subdomain of your Squarespace site)
- **Main site:** `roughcutmfg.com` stays on Squarespace; only the subdomain goes through Cloudflare for the app
- **Data:** All data stays on your machine in PocketBase; tunnel only exposes it securely

---

## Part 1: Don’t Lose Data – Backups

### 1.1 Run a backup now (and regularly)

From the project folder:

```bat
scripts\backup-pocketbase.bat
```

This copies `PocketBaseServer\pb_data` to `backups\pb_data_YYYY-MM-DD_HH-MM-SS`.

### 1.2 Keep backups off this PC

- Copy the `backups` folder to **OneDrive**, **Google Drive**, or an external drive.
- Optionally use **Task Scheduler** to run `scripts\backup-pocketbase.bat` daily.

### 1.3 What to back up

- **`PocketBaseServer\pb_data`** – database and uploaded files (the only place your app data lives).

---

## Part 2: Cloudflare + roughcutmfg.com (Squarespace)

To use **app.roughcutmfg.com** with a Cloudflare Tunnel, Cloudflare must manage DNS for your domain. Your main site can still be hosted on Squarespace.

### 2.1 Add roughcutmfg.com to Cloudflare

1. Sign in at [dash.cloudflare.com](https://dash.cloudflare.com).
2. **Add a site** → enter `roughcutmfg.com` → choose **Free** plan.
3. Cloudflare will show **nameservers** (e.g. `ada.ns.cloudflare.com`, `bob.ns.cloudflare.com`). Leave this tab open.

### 2.2 Point the domain to Cloudflare (at your registrar)

Where you bought **roughcutmfg.com** (Squarespace Domains, GoDaddy, etc.):

1. Open **DNS / Nameservers** for the domain.
2. **Replace** the current nameservers with the **two nameservers** Cloudflare gave you.
3. Save. Propagation can take from a few minutes up to 24–48 hours.

**If the domain is on Squarespace:**  
Squarespace → **Settings** → **Domains** → **roughcutmfg.com** → **DNS Settings** or **Use Custom Nameservers** and enter Cloudflare’s nameservers.

### 2.3 Restore your main site (roughcutmfg.com) in Cloudflare DNS

After the domain is using Cloudflare nameservers, Cloudflare DNS controls where the site goes:

1. In Cloudflare: **Websites** → **roughcutmfg.com** → **DNS** → **Records**.
2. Add records so the **root** and **www** still point to Squarespace:
   - Squarespace usually gives you a **host** to CNAME to (e.g. `ext-sq.squarespace.com` or similar). In the Squarespace domain/DNS instructions, find the exact target.
   - In Cloudflare, add:
     - **Type** A or CNAME, **Name** `@`, **Target** = Squarespace’s value.
     - **Type** CNAME, **Name** `www`, **Target** = Squarespace’s value (or same as above if they say so).
3. Leave **Proxy status** (orange cloud) **On** for these if you want Cloudflare in front of Squarespace; otherwise set to **DNS only** (grey) if Squarespace requires it.

Your main site **roughcutmfg.com** will keep working through Squarespace; only the app subdomain will use the tunnel.

---

## Part 3: Create the Cloudflare Tunnel

### 3.1 Install cloudflared (Windows)

1. Download: [github.com/cloudflare/cloudflared/releases](https://github.com/cloudflare/cloudflared/releases) – get `cloudflared-windows-amd64.exe`.
2. Rename to `cloudflared.exe` and put it in a folder in your PATH (e.g. `C:\cloudflared\`) or the project folder.

### 3.2 Log in and create the tunnel

Open **PowerShell** or **Command Prompt**:

```bash
cloudflared tunnel login
```

A browser window opens; choose your Cloudflare account and approve. This saves a cert to `%USERPROFILE%\.cloudflared\`.

Create a named tunnel:

```bash
cloudflared tunnel create worktrack-pro
```

Note the **tunnel ID** (e.g. `abc123-def456-...`) and that a credentials file was created under `%USERPROFILE%\.cloudflared\` (e.g. `abc123-def456-....json`).

### 3.3 Route the subdomain to the tunnel

Route **app.roughcutmfg.com** to this tunnel (creates the CNAME in Cloudflare DNS):

```bash
cloudflared tunnel route dns worktrack-pro app.roughcutmfg.com
```

### 3.4 Configure the tunnel config file

1. Open `%USERPROFILE%\.cloudflared\` (e.g. `C:\Users\YourName\.cloudflared\`).
2. Create or edit **config.yml** with (replace `YOUR_TUNNEL_ID` with the tunnel ID from step 3.2, and fix the path to the `.json` file):

```yaml
tunnel: YOUR_TUNNEL_ID
credentials-file: C:\Users\YOUR_USERNAME\.cloudflared\YOUR_TUNNEL_ID.json

ingress:
  - hostname: app.roughcutmfg.com
    service: http://localhost:4173
  - service: http_status:404
```

Use your actual Windows username and the real tunnel ID in both `tunnel:` and `credentials-file:`.

---

## Part 4: Run the app and tunnel

Do this on the PC where PocketBase and the app run (same machine as where you run the tunnel).

### 4.1 Start PocketBase (no Caddy needed for tunnel)

From **PocketBaseServer**:

```bat
pocketbase.exe serve --http=127.0.0.1:8091
```

Leave this window open. If you normally use `START-SERVER-AUTO.bat` (Caddy + PocketBase), you can instead run only PocketBase on 8091 for the tunnel; the production server will proxy to it.

### 4.2 Build the frontend with the public URL

In the **project root** (WorkTrackPro):

```bat
set VITE_POCKETBASE_URL=https://app.roughcutmfg.com
npm run build
```

So the built app talks to `https://app.roughcutmfg.com` (same origin; your server will proxy `/api` and `/_` to PocketBase).

### 4.3 Start the production server

```bat
npm run serve
```

This serves the build and proxies `/api` and `/_` to `http://127.0.0.1:8091`. It listens on **port 4173**.

### 4.4 Start the tunnel

In another terminal:

```bash
cloudflared tunnel run worktrack-pro
```

(If you didn’t use a named tunnel, use: `cloudflared tunnel run --config path\to\config.yml`.)

---

## Part 5: Use the app online

- **App:** [https://app.roughcutmfg.com](https://app.roughcutmfg.com)
- **PocketBase admin:** [https://app.roughcutmfg.com/_/](https://app.roughcutmfg.com/_/)

---

## Optional: Run tunnel as a Windows service

So the tunnel starts after reboot without opening a window:

1. Run as admin:  
   `cloudflared service install`
2. Ensure **config.yml** and **credentials-file** are in the right place (see Cloudflare docs for service config path if needed).
3. Start: `sc start cloudflared` or use **Services** (services.msc).

---

## Checklist

- [ ] Backed up `PocketBaseServer\pb_data` and copied backups off this PC
- [ ] Domain roughcutmfg.com added to Cloudflare; nameservers switched at registrar
- [ ] DNS for `@` and `www` pointing to Squarespace so main site still works
- [ ] cloudflared installed; `cloudflared tunnel login` and `tunnel create worktrack-pro` done
- [ ] `cloudflared tunnel route dns worktrack-pro app.roughcutmfg.com` run
- [ ] `%USERPROFILE%\.cloudflared\config.yml` has correct tunnel ID, credentials path, and `service: http://localhost:4173`
- [ ] PocketBase running on 8091; `npm run build` with `VITE_POCKETBASE_URL=https://app.roughcutmfg.com`; `npm run serve` and `cloudflared tunnel run worktrack-pro` running
- [ ] https://app.roughcutmfg.com loads and you can log in

If you want, we can next add a single `.bat` that starts PocketBase + `npm run serve` + `cloudflared tunnel run` together, or automate backups (e.g. Task Scheduler).
