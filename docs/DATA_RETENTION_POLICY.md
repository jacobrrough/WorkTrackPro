# Data Retention & Deletion Policy

**Organization:** Rough Cut Manufacturing ("the Company"), operator of the WorkTrackPro application
**Policy Owner:** Jacob Rough, Chief Executive Officer — jacobrrough@gmail.com
**Version:** 1.0  **Effective Date:** June 17, 2026  **Next Review:** June 17, 2027

## 1. Purpose
This policy defines how long Rough Cut Manufacturing retains the data it processes, and how that
data is securely deleted, so that information is kept only as long as necessary for business and
legal obligations and in compliance with applicable data-privacy laws.

## 2. Scope
Applies to all data processed by the WorkTrackPro application and its supporting systems (Supabase,
Netlify, Plaid, QuickBooks Online), across all environments.

## 3. Principles
- **Retain only what we need, for only as long as we need it.** Data is retained for the period
  required to deliver the Service and to meet legal, tax, and accounting obligations, then deleted
  or anonymized.
- **Strongest controls for the most sensitive data.** Financial-account credentials receive the
  shortest practical retention and are removed as soon as a connection is no longer needed.

## 4. Retention schedule
| Data category | Retention period | Notes |
|---|---|---|
| Accounting & financial records (invoices, estimates, bills, journal entries, bank transactions) | **7 years** | Aligns with U.S. tax/financial recordkeeping practice; then deleted or archived. |
| Bank-feed connection credentials (Plaid/QuickBooks access tokens) | **Life of the connection** | Deleted/revoked immediately upon disconnection or account closure. |
| Customer & vendor records, job/manufacturing data | **Duration of the business relationship + 7 years** | Supports warranty, accounting, and legal needs. |
| User account data (name, email, role) | **While the account is active** | Deleted or anonymized within 90 days of account closure, subject to legal holds. |
| Authentication & security logs | **12 months** | Retained for security monitoring and incident investigation. |
| Backups (point-in-time recovery) | **Per hosting provider's backup window** | Deleted data ages out of backups on the provider's schedule. |

Where a legal hold, dispute, or regulatory obligation requires longer retention, the affected data
is retained until the obligation ends.

## 5. Deletion procedures
- **On disconnection of a financial account:** the stored access token is removed/revoked and the
  account is unlinked, stopping further syncing. Previously imported transactions are retained as
  part of the accounting record (per §4) unless deletion is requested and permissible.
- **On account closure:** user account data is deleted or anonymized within 90 days, subject to
  legal holds.
- **On a verified deletion request:** we delete the requester's personal information that we are not
  legally required to retain, and confirm completion (see §6).
- **Method:** deletion is performed in the production database (Supabase); the data then ages out of
  encrypted backups on the provider's schedule.

## 6. Honoring data-subject requests
Individuals may request access to, correction of, or deletion of their personal information by
contacting jacobrrough@gmail.com. We verify the requester's identity and respond within the
timeframe required by applicable law (e.g., CCPA/CPRA for California residents). Requests that
conflict with a legal retention obligation are fulfilled to the extent permitted, and the reason for
any retained data is communicated to the requester.

## 7. Responsibilities & enforcement
The Policy Owner (Jacob Rough, CEO) is responsible for enforcing this policy, fulfilling deletion
requests, and ensuring retention periods are applied. Failure to follow this policy may result in
revoked access and corrective action.

## 8. Review
This policy is reviewed at least annually, and after any material change to our systems, data types,
or applicable law, and updated as needed by the Policy Owner.

---
*Document control: maintained by the Policy Owner (Jacob Rough, CEO). Supersedes all prior versions.*
