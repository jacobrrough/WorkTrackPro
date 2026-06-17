# Business Continuity & Disaster Recovery Plan

**Organization:** Rough Cut Manufacturing — operator of WorkTrackPro
**Plan Owner:** Jacob Rough, Chief Executive Officer — jacobrrough@gmail.com
**Version:** 1.0  **Effective Date:** June 17, 2026  **Next Review:** June 17, 2027

## 1. Purpose
This plan describes how Rough Cut Manufacturing maintains and restores the availability of the
WorkTrackPro application and its data during and after a disruption (e.g., data loss, provider
outage, or corruption).

## 2. Critical systems & dependencies
- **Supabase** — production database, authentication, and file storage (system of record).
- **Netlify** — application hosting and serverless/integration functions.
- **GitHub** — source-code repository and deployment source.
- **Integrations** — Plaid and QuickBooks Online (non-critical to core operation; degrade
  gracefully if unavailable).

## 3. Recovery objectives
- **Recovery Point Objective (RPO): ≤ 24 hours** — supported by Supabase automated backups and
  point-in-time recovery (data loss is bounded to the most recent recoverable point).
- **Recovery Time Objective (RTO): ≤ 1 business day** for core application availability.

## 4. Backup strategy
- Production data is backed up automatically by Supabase, with point-in-time recovery available.
- Application code is version-controlled in GitHub; the production build can be redeployed to
  Netlify from source at any time.
- Configuration and secrets are stored in the Netlify environment and are re-creatable by the Plan
  Owner.

## 5. Recovery procedures
- **Data loss/corruption:** restore the Supabase database to a healthy point using point-in-time
  recovery; verify data integrity before resuming normal use.
- **Hosting/app failure:** redeploy the application from GitHub to Netlify; if Netlify is
  unavailable, redeploy to an alternative static/functions host using the same build.
- **Provider outage (Plaid/QuickBooks):** core job and accounting features continue; bank-feed and
  accounting sync resume automatically when the provider recovers (cursor-based sync resumes where
  it left off).
- **Credential compromise:** rotate keys and provider tokens (see the Incident Response Plan).

## 6. Communication
During a significant disruption, the Plan Owner communicates status and expected restoration to
affected users and, where relevant, customers and providers.

## 7. Review & testing
This plan is reviewed at least annually and after any material change. The Plan Owner periodically
verifies that backups are present and that the redeploy-from-source path is functional.
