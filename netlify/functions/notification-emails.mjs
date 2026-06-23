// WorkTrackPro — notification-emails — V2 SCHEDULED function
// ============================================================================
// Emails each user a DIGEST of their recent system notifications, respecting that user's
// per-type EMAIL preference (user_notification_preferences.email[type]). In-app delivery
// is unaffected; this is the optional email channel on top of it.
//
// Runs every 10 minutes (config.schedule below) AND is reachable on-demand for an admin
// "run now" at POST /api/notification-emails (Bearer admin) via the netlify.toml /api/*
// redirect.
//
// HARD ENV GATE (safe to ship to production OFF)
//   • Gated on NOTIFICATION_EMAILS_ENABLED. When unset / not truthy, the function EXITS
//     IMMEDIATELY with NO query, NO email, NO DB write. A frontend flag cannot gate a
//     scheduled function, so THIS server gate is the isolation guarantee. Email is ALSO
//     opt-in per user per type (the seed defaults every email pref to false), so nothing
//     is emailed until a user enables it AND this gate is on.
//
// INVARIANTS
//   • Reads system_notifications + user_notification_preferences + profiles; writes only
//     system_notifications.emailed_at (no money, no journal entries).
//   • Backlog cap: only notifications created in the last hour are considered, so first
//     enable cannot blast an old backlog. A notification is emailed at most once
//     (emailed_at is the marker).
//   • Recipient filter: approved users with an email on file whose email[type] pref is true.
//   • Fail-safe per user: one bad send is logged and never aborts the run.
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import {
  sendResendEmail,
  sanitizeText,
  escapeHtml,
  normalizeResendError,
  sleep,
} from './lib/resendMailer.mjs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Content-Type': 'application/json',
};

// Only notifications newer than this are considered (first-enable backlog guard).
const BACKLOG_WINDOW_MS = 60 * 60 * 1000;
// Defensive cap on notifications pulled per run.
const HARD_MAX_NOTIFICATIONS = 2000;
// Polite gap between sends to stay under Resend's ~2 req/sec limit.
const INTER_SEND_DELAY_MS = 600;

/** The hard server gate. TRUE only for an explicit truthy value. */
function isEnabled() {
  const v = (process.env.NOTIFICATION_EMAILS_ENABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on' || v === 'enabled';
}

function getServiceClient() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function resolveFromEmail() {
  return (
    sanitizeText(process.env.NOTIFICATION_FROM_EMAIL) ||
    sanitizeText(process.env.ACCOUNTING_FROM_EMAIL) ||
    sanitizeText(process.env.PROPOSAL_FROM_EMAIL) ||
    sanitizeText(process.env.RESEND_FROM_EMAIL)
  );
}

/** Verify a manual "run now" caller is an approved admin. */
async function verifyAdmin(client, authHeader) {
  const token = sanitizeText(authHeader).replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;
  try {
    const {
      data: { user },
      error,
    } = await client.auth.getUser(token);
    if (error || !user) return false;
    const { data: profile } = await client
      .from('profiles')
      .select('is_admin, is_approved')
      .eq('id', user.id)
      .maybeSingle();
    return Boolean(profile && profile.is_admin === true && profile.is_approved === true);
  } catch {
    return false;
  }
}

function buildDigest(items, appUrl) {
  const n = items.length;
  const subject = n === 1 ? `New notification: ${items[0].title}` : `You have ${n} new notifications`;

  const rows = items
    .map((it) => {
      const title = escapeHtml(it.title || 'Notification');
      const message = escapeHtml(it.message || '');
      return (
        `<tr><td style="padding:10px 0;border-bottom:1px solid #eee;">` +
        `<div style="font-weight:600;color:#111;">${title}</div>` +
        `<div style="color:#444;font-size:14px;margin-top:2px;">${message}</div>` +
        `</td></tr>`
      );
    })
    .join('');

  const cta = appUrl
    ? `<p style="margin:20px 0 0;"><a href="${escapeHtml(appUrl)}/app" ` +
      `style="background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px;">Open WorkTrack Pro</a></p>`
    : '';

  const html =
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;">` +
    `<h2 style="color:#111;font-size:18px;">${escapeHtml(subject)}</h2>` +
    `<table style="width:100%;border-collapse:collapse;">${rows}</table>` +
    `${cta}` +
    `<p style="color:#999;font-size:12px;margin-top:24px;">You're receiving this because you enabled email for these notification types. ` +
    `Manage your preferences in WorkTrack Pro → Settings → Notifications.</p>` +
    `</div>`;

  const text =
    `${subject}\n\n` +
    items.map((it) => `• ${sanitizeText(it.title)}${it.message ? ` — ${sanitizeText(it.message)}` : ''}`).join('\n') +
    (appUrl ? `\n\nOpen WorkTrack Pro: ${appUrl}/app` : '') +
    `\n\nManage preferences in Settings → Notifications.`;

  return { subject, html, text };
}

async function run(client, trigger) {
  const fromEmail = resolveFromEmail();
  if (!fromEmail) {
    return { ok: false, error: 'No From address configured (set NOTIFICATION_FROM_EMAIL).' };
  }

  const sinceIso = new Date(Date.now() - BACKLOG_WINDOW_MS).toISOString();

  const { data: notifs, error } = await client
    .from('system_notifications')
    .select('id, user_id, type, title, message, link, created_at')
    .is('emailed_at', null)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true })
    .limit(HARD_MAX_NOTIFICATIONS);
  if (error) {
    return { ok: false, error: `could not load notifications: ${error.message}` };
  }
  if (!notifs || notifs.length === 0) {
    return { ok: true, emails: 0, notifications: 0, message: `No pending notifications (${trigger}).` };
  }

  const userIds = [...new Set(notifs.map((n) => n.user_id))];
  const [{ data: profiles }, { data: prefRows }] = await Promise.all([
    client.from('profiles').select('id, email, name, is_approved').in('id', userIds),
    client.from('user_notification_preferences').select('user_id, preferences').in('user_id', userIds),
  ]);
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const prefsByUser = new Map((prefRows ?? []).map((r) => [r.user_id, r.preferences]));

  // Group eligible notifications by user: approved, has an email, and email[type] = true.
  const byUser = new Map();
  for (const n of notifs) {
    const profile = profileById.get(n.user_id);
    if (!profile || profile.is_approved !== true) continue;
    const email = sanitizeText(profile.email);
    if (!email) continue;
    const prefs = prefsByUser.get(n.user_id);
    const emailOn = Boolean(prefs && prefs.email && prefs.email[n.type] === true);
    if (!emailOn) continue;
    if (!byUser.has(n.user_id)) byUser.set(n.user_id, { email, items: [] });
    byUser.get(n.user_id).items.push(n);
  }

  const appUrl = sanitizeText(process.env.APP_PUBLIC_URL);
  const results = { ok: true, users: byUser.size, emails: 0, notifications: 0, failed: 0 };
  const sentIds = [];

  for (const [, group] of byUser) {
    const digest = buildDigest(group.items, appUrl);
    const sent = await sendResendEmail({
      from: fromEmail,
      to: group.email,
      subject: digest.subject,
      html: digest.html,
      text: digest.text,
    });
    if (sent.ok) {
      results.emails += 1;
      results.notifications += group.items.length;
      for (const it of group.items) sentIds.push(it.id);
    } else {
      results.failed += 1;
      console.error(`notification-emails: send failed for ${group.email}: ${normalizeResendError(sent.error)}`);
    }
    await sleep(INTER_SEND_DELAY_MS);
  }

  // Mark only the notifications we actually emailed (chunked to keep .in() lists sane).
  if (sentIds.length > 0) {
    const nowIso = new Date().toISOString();
    for (let i = 0; i < sentIds.length; i += 200) {
      const chunk = sentIds.slice(i, i + 200);
      const { error: updErr } = await client
        .from('system_notifications')
        .update({ emailed_at: nowIso })
        .in('id', chunk);
      if (updErr) console.error('notification-emails: mark emailed failed:', updErr.message);
    }
  }

  results.message =
    `Notification emails (${trigger}): ${results.emails} email(s) to ${results.users} user(s) ` +
    `covering ${results.notifications} notification(s), ${results.failed} failed.`;
  return results;
}

export default async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  // ── HARD ENV GATE — before ANY query, email, or DB write. ──
  if (!isEnabled()) {
    return new Response(
      JSON.stringify({
        ok: true,
        disabled: true,
        message:
          'Notification emails are disabled on the server (NOTIFICATION_EMAILS_ENABLED is off). ' +
          'No email or database write was performed.',
      }),
      { status: 200, headers: corsHeaders }
    );
  }

  if (!process.env.RESEND_API_KEY) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Email is not configured (missing RESEND_API_KEY).' }),
      { status: 500, headers: corsHeaders }
    );
  }

  const client = getServiceClient();
  if (!client) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Server is not configured (missing service-role credentials).' }),
      { status: 500, headers: corsHeaders }
    );
  }

  // A manual "run now" carries a Bearer admin token; the Netlify scheduler invokes with no
  // Bearer (trusted internal invocation), mirroring the dunning function's model.
  const authHeader = request.headers.get('authorization') || '';
  const isManual = authHeader.startsWith('Bearer ');
  if (isManual) {
    const ok = await verifyAdmin(client, authHeader);
    if (!ok) {
      return new Response(JSON.stringify({ ok: false, error: 'Admin access required.' }), {
        status: 403,
        headers: corsHeaders,
      });
    }
  }

  try {
    const result = await run(client, isManual ? 'manual' : 'scheduled');
    return new Response(JSON.stringify(result), {
      status: result.ok ? 200 : 500,
      headers: corsHeaders,
    });
  } catch (err) {
    console.error('notification-emails unhandled error:', err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Notification email run failed.',
        detail: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: corsHeaders }
    );
  }
};

// Netlify Functions V2 config: every 10 minutes. A scheduled function MUST NOT also
// declare a custom `path` (Netlify rejects that at deploy time). The admin "run now"
// still reaches it at /api/notification-emails via the netlify.toml /api/* redirect.
export const config = {
  schedule: '*/10 * * * *',
};
