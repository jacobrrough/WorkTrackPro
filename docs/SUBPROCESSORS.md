# Subprocessor List

**Organization:** Rough Cut Manufacturing — operator of WorkTrackPro
**Policy Owner:** Jacob Rough, CEO — jacobrrough@gmail.com
**Last updated:** June 17, 2026

Rough Cut Manufacturing uses the third-party service providers ("subprocessors") below to operate
the WorkTrackPro application. Each processes data only as needed to provide its service and under
its own security and compliance commitments. We review this list during our annual risk review and
when adding a provider.

| Subprocessor | Purpose | Data processed | Region | Compliance |
|---|---|---|---|---|
| **Supabase** (incl. AWS) | Primary database, authentication, file storage | All application data: accounts, job/manufacturing, customer/vendor, accounting, and bank-feed data | United States (AWS us-west-2) | SOC 2 Type II |
| **Netlify** | Application hosting and serverless functions (API/integration endpoints) | Application traffic, request data, and operational logs | United States | SOC 2 Type II |
| **Plaid Inc.** | Bank / credit-card account connectivity and transaction sync | Financial-account data: account name/mask, balances, and transactions; provider access tokens | United States | SOC 2 Type II, ISO 27001 |
| **Intuit / QuickBooks Online** | Accounting-platform synchronization | Accounting records synced to/from QuickBooks; provider access tokens | United States | SOC 2 |
| **Cloudflare** (Turnstile) | Bot/abuse protection on public forms | Limited technical data (e.g., IP, challenge token) on public form submissions | Global | SOC 2 Type II |
| **GitHub** | Source-code hosting and dependency vulnerability scanning | Application source code only — no customer or financial data | United States | SOC 2 Type II |

**Notes**
- Access tokens for financial integrations (Plaid, QuickBooks) are stored encrypted and are
  accessible only to server-side functions; they are never exposed to client browsers.
- We do not sell personal information, and we do not share data with subprocessors for their own
  marketing.
- Questions about subprocessors: jacobrrough@gmail.com.
