# WorkTrack Pro - PocketBase Server Setup

## Architecture

```
[Mobile/Desktop] --> HTTPS:8090 --> [Caddy Reverse Proxy] --> HTTP:8091 --> [PocketBase]
                     (External)                                 (Internal)
```

**Benefits:**
- ✅ Caddy handles HTTPS automatically
- ✅ PocketBase runs on HTTP internally (simpler)
- ✅ Automatic SSL certificate management
- ✅ CORS headers handled by Caddy
- ✅ Clean separation of concerns

---

## Files Included

### Essential Files:
- **START-SERVER.bat** - Start both Caddy and PocketBase
- **STOP-SERVER.bat** - Stop all servers
- **Caddyfile** - Caddy configuration (reverse proxy)
- **pocketbase.exe** - (You need to add this - not included to save space)
- **caddy.exe** - HTTPS reverse proxy

### Data Directories (Keep These!):
- **pb_data/** - Database and storage (30MB+)
  - `data.db` - Main database
  - `storage/` - Uploaded files
  - `backups/` - Database backups
- **pb_hooks/** - Server-side automation scripts
- **pb_migrations/** - Database schema migrations

### Old/Unused Files (Can Delete):
- `server.crt` / `server.key` - Old certificates (Caddy generates its own)
- `start-pocketbase-https.bat` - Old script (replaced by START-SERVER.bat)

---

## Setup Instructions

### 1. Add PocketBase Executable
Download latest PocketBase from: https://pocketbase.io/docs/

Place `pocketbase.exe` in this folder.

### 2. Verify Caddy
`caddy.exe` is already included. If missing, download from: https://caddyserver.com/download

### 3. Start Servers
Double-click: **START-SERVER.bat**

You should see:
```
[OK] PocketBase running on localhost:8091
[OK] Caddy running with HTTPS
```

### 4. Test Access

**Admin Dashboard:**
```
https://192.168.1.100:8090/_/
```
(Replace IP with yours)

**API Endpoint:**
```
https://192.168.1.100:8090/api/
```

---

## How It Works

### PocketBase (Port 8091 - Internal HTTP)
- Runs on `localhost:8091`
- HTTP only (not exposed to network)
- Only Caddy can reach it

### Caddy (Port 8090 - External HTTPS)
- Listens on `0.0.0.0:8090` (all interfaces)
- Automatically generates HTTPS certificates
- Proxies requests to PocketBase
- Adds CORS headers

### Your Vite App
Should connect to: `https://YOUR-IP:8090`

---

## Configuration

### Change Port
Edit `Caddyfile`:
```
:8090 {  ← Change this port
    reverse_proxy localhost:8091
    tls internal
}
```

### Bind to Specific IP
Edit `Caddyfile`:
```
192.168.1.100:8090 {
    reverse_proxy localhost:8091
    tls internal
}
```

### Change Internal Port
Edit both files:
1. `Caddyfile`: `reverse_proxy localhost:8091` ← Change this
2. `START-SERVER.bat`: `--http=127.0.0.1:8091` ← Change this

---

## Troubleshooting

### Caddy won't start
**Error:** "address already in use"
**Solution:** Port 8090 is taken. Either:
- Stop other program using 8090
- Change port in Caddyfile

### PocketBase won't start
**Error:** "address already in use"
**Solution:** Port 8091 is taken. Change it in both files.

### Can't access from phone
**Check:**
1. Both computer and phone on same WiFi
2. Firewall allows port 8090
3. Using correct IP address (run `ipconfig`)

### Certificate warnings
This is NORMAL for self-signed certificates.
- Desktop: Click "Advanced" → "Proceed"
- Mobile: Tap "Show Details" → "Visit Website"

---

## What to Keep vs Delete

### ✅ KEEP:
- `pocketbase.exe` - The server
- `caddy.exe` - HTTPS proxy
- `Caddyfile` - Configuration
- `START-SERVER.bat` - Launcher
- `STOP-SERVER.bat` - Stopper
- `pb_data/` - Your database!
- `pb_hooks/` - Automation scripts
- `pb_migrations/` - Schema history

### ❌ CAN DELETE:
- `server.crt` - Old certificate (Caddy generates new ones)
- `server.key` - Old key
- `start-pocketbase-https.bat` - Old launcher
- `Caddyfile.old` - Backup
- Any `.bak` or `.backup` files

### ⚠️ CAUTION:
- **pb_data/backups/** - Old database backups (can delete to save space, but keep recent ones!)
- **pb_data/storage/** - Uploaded files (images, etc.) - only delete if you're sure

---

## Backup Important Data

Before major changes, backup:
```
pb_data/data.db
pb_data/storage/
```

PocketBase auto-backups to `pb_data/backups/` but manual backup is safer.

---

## Production Deployment

For internet-facing deployment:
1. Get a domain name
2. Update Caddyfile to use domain instead of IP
3. Caddy will automatically get real SSL certificate from Let's Encrypt
4. Set up proper firewall rules
5. Consider using systemd/Windows Service for auto-start

---

## Daily Use

**Start servers:**
```
START-SERVER.bat
```

**Stop servers:**
```
STOP-SERVER.bat
```

**Check if running:**
Open: https://YOUR-IP:8090/_/

---

## File Structure

```
PocketBaseServer/
├── pocketbase.exe          ← PocketBase server (add this!)
├── caddy.exe               ← HTTPS proxy (included)
├── Caddyfile               ← Caddy config
├── START-SERVER.bat        ← Start everything
├── STOP-SERVER.bat         ← Stop everything
├── README.md               ← This file
│
├── pb_data/                ← Database and files (IMPORTANT!)
│   ├── data.db            ← Main database
│   ├── auxiliary.db       ← Metadata
│   ├── storage/           ← Uploaded files
│   ├── backups/           ← Auto backups
│   └── types.d.ts         ← TypeScript definitions
│
├── pb_hooks/               ← Server-side automation
│   ├── jobs_automation_pb.js
│   ├── shifts_pb.js
│   └── ... (custom logic)
│
└── pb_migrations/          ← Database schema changes
    ├── 1768934816_created_jobs.js
    └── ... (migration history)
```

---

## Success Checklist

After running START-SERVER.bat:

- [ ] PocketBase window opened (minimized)
- [ ] Caddy window opened (minimized)
- [ ] Can access: https://YOUR-IP:8090/_/
- [ ] Can login to admin dashboard
- [ ] Your Vite app can connect
- [ ] No connection errors in console

---

## Support

If you have issues:
1. Check both server windows for errors
2. Verify firewall settings
3. Try accessing from computer first: https://localhost:8090/_/
4. Check Caddy logs in the Caddy window

Caddy reverse proxy is the PROFESSIONAL way to handle HTTPS!
It's what production servers use. 🚀
