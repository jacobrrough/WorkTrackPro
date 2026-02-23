# roughcutmfg.com — Resend & Gmail Verification Fix

Your CSV shows why **Resend** and **Gmail** are both failing verification. Apply the changes below at your DNS host (Netlify DNS, Cloudflare, Namecheap, etc.).

---

## 1. Gmail / Google Workspace

### Problem A: Conflicting MX records

You have **two** MX records for `roughcutmfg.com`:

| Current MX for roughcutmfg.com | Purpose        |
|--------------------------------|----------------|
| `inbound-smtp.us-east-1.amazonaws.com` | Amazon SES (receiving) |
| `SMTP.GOOGLE.COM`              | Google Workspace       |

Google’s docs say: **“Remove any other MX records. Your email might not work correctly if you keep old or incorrect MX records.”**  
So as long as both exist, Gmail verification and delivery can fail.

**Fix:**

- If you want **Gmail to receive** mail for `@roughcutmfg.com`:
  - **Remove** the MX that points to `inbound-smtp.us-east-1.amazonaws.com` for `roughcutmfg.com`.
  - **Keep** only the Google MX:
    - **Name:** `roughcutmfg.com` (or `@` if your host uses that)
    - **Type:** MX  
    - **Priority:** 1  
    - **Value:** `smtp.google.com` (lowercase; some hosts want a trailing dot: `smtp.google.com.`)

- If you use **Amazon SES only for receiving** (no Gmail), then remove the Google MX instead and keep SES. You can’t have both as MX for the same domain and expect Google to verify.

### Problem B: Missing domain verification TXT

Google requires a **domain ownership** TXT record before Gmail will verify.

**Fix:**

1. In **Google Admin**: [Admin](https://admin.google.com) → **Account** → **Domains** → **Manage domains**.
2. Select **Verify** (or add the domain and start verification).
3. Choose **“Verify using a TXT record”** and copy the value (looks like `google-site-verification=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`).
4. In your DNS, add:
   - **Name:** `roughcutmfg.com` (or `@`)
   - **Type:** TXT  
   - **Value:** paste the full string from Google (no extra spaces).

Save, wait for DNS to propagate (up to 24–72 hours), then click **Verify** again in the Admin console.

---

## 2. Resend

### What you have (from CSV)

- **SPF:** TXT on `roughcutmfg.com` includes `include:_spf.resend.com` — good.
- **Return-path MX:** `send.roughcutmfg.com` → `feedback-smtp.us-east-1.amazonses.com` — correct for Resend.
- **DKIM:** TXT at `resend._domainkey.roughcutmfg.com` with a long public key.

### Why Resend might still show “not verified”

1. **Exact DKIM value**  
   Resend expects the **exact** DKIM value they show in the dashboard (Domains → your domain → DNS records). Even a missing character or extra space will fail.

   **Fix:** In [Resend → Domains](https://resend.com/domains), open `roughcutmfg.com`, copy the **DKIM TXT value** again and replace your current `resend._domainkey.roughcutmfg.com` TXT with that value exactly (same selector and key).

2. **CNAME vs TXT**  
   Resend may offer **CNAME** instead of TXT for DKIM (e.g. point `resend._domainkey.roughcutmfg.com` to `resend._domainkey.resend.com`). If the dashboard shows a CNAME, use that instead of the TXT you have now:
   - **Name:** `resend._domainkey.roughcutmfg.com` (or `resend._domainkey` if your host appends the domain)
   - **Type:** CNAME  
   - **Value:** whatever Resend shows (often `resend._domainkey.resend.com`)

3. **Propagation**  
   DNS can take up to 24–48 hours. Use [Resend’s verification](https://resend.com/domains) after waiting.

---

## 3. Summary checklist

| Step | Action |
|------|--------|
| **Gmail** | Remove the extra MX for `roughcutmfg.com` so only **one** MX remains (Google **or** SES, not both). |
| **Gmail** | Set Google MX to `smtp.google.com` (priority 1). |
| **Gmail** | Add Google’s **TXT** verification record from Admin → Domains → Verify. |
| **Resend** | Ensure **DKIM** for `resend._domainkey.roughcutmfg.com` matches Resend dashboard exactly (TXT or CNAME as shown). |
| **Resend** | Keep SPF and `send.roughcutmfg.com` MX as-is. |
| **Both** | Wait 24–72 hours after changes, then run verification again. |

---

## 4. Optional: use a subdomain for Resend

To avoid conflicts between Gmail (root domain) and Resend (sending), you can send via a subdomain, e.g. `mail.roughcutmfg.com` or `send.roughcutmfg.com`. Add that domain in Resend and set only its DKIM/SPF/MX; leave `roughcutmfg.com` MX and verification for Gmail only.

After you apply these changes, run both verifications again (Resend dashboard and Google Admin). If one still fails, say which service and what exact error message you see (and whether you use Netlify DNS, Cloudflare, etc.), and we can narrow it down further.
