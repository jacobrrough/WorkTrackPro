import { createClient } from '@supabase/supabase-js';
// PHASE E (E5) — optional, server-gated rate limiting on this add-on endpoint. INERT by default
// (ACCOUNTING_SECURITY_HARDENING_ENABLED off ⇒ no-op), so existing behavior is unchanged until an
// operator enables hardening. Body SIZE is already guarded by the per-attachment caps below, so we
// add only a per-client-IP request cap here.
import {
  isHardeningEnabled,
  rateLimit,
  clientKeyFromEvent,
  tooManyRequestsResponse,
  LIMITS,
} from './lib/securityHardening.mjs';

// Creates a board card from Gmail email data (subject, body, attachments).
// Authenticated via a static API key (GMAIL_ADDON_API_KEY env var).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Content-Type': 'application/json',
};

const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024; // 5 MB per file (before base64 encoding)
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;

function verifyApiKey(event) {
  const key = process.env.GMAIL_ADDON_API_KEY;
  if (!key) return false;
  const auth = (event.headers.authorization || event.headers.Authorization || '').trim();
  if (!auth.startsWith('Bearer ')) return false;
  return auth.slice(7).trim() === key;
}

function sanitizeText(input) {
  return String(input ?? '').trim();
}

function sanitizeFileName(input) {
  const base = sanitizeText(input);
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned.length > 0 ? cleaned : 'file.bin';
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
  }
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  if (!verifyApiKey(event)) {
    return {
      statusCode: 401,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  // ── E5 rate limit (INERT unless ACCOUNTING_SECURITY_HARDENING_ENABLED). Throttle per client IP. ──
  if (isHardeningEnabled()) {
    const rl = rateLimit(clientKeyFromEvent(event, 'create-card-from-email'), LIMITS.addonPerMinute(), 60 * 1000);
    if (rl.limited) {
      return tooManyRequestsResponse(corsHeaders, rl.retryAfterSec);
    }
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing server configuration' }),
    };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const boardId = sanitizeText(payload.boardId);
    const columnId = sanitizeText(payload.columnId);
    let title = sanitizeText(payload.title);
    let description = sanitizeText(payload.description);
    const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
    const emailMeta = payload.emailMetadata || {};

    // ── Validate required fields ─────────────────────────
    if (!boardId || !columnId || !title) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'boardId, columnId, and title are required.' }),
      };
    }

    // Enforce length limits.
    title = title.slice(0, MAX_TITLE_LENGTH);
    description = description.slice(0, MAX_DESCRIPTION_LENGTH);

    // Append email metadata to description for traceability.
    const metaLines = [];
    if (emailMeta.from) metaLines.push(`From: ${sanitizeText(emailMeta.from)}`);
    if (emailMeta.date) metaLines.push(`Date: ${sanitizeText(emailMeta.date)}`);
    if (metaLines.length > 0) {
      const metaBlock = '\n\n--- Email ---\n' + metaLines.join('\n');
      // Keep total under limit.
      const available = MAX_DESCRIPTION_LENGTH - metaBlock.length;
      if (description.length > available) {
        description = description.slice(0, Math.max(0, available)) + '...';
      }
      description += metaBlock;
    }

    // Limit attachment count.
    const validAttachments = attachments.slice(0, MAX_ATTACHMENTS);

    // ── Supabase client ──────────────────────────────────
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ── Detect job board vs custom board ─────────────────
    const isJobBoard = boardId === 'job-admin' || boardId === 'job-shopFloor';

    if (isJobBoard) {
      // Create a job instead of a board card.
      const boardType = boardId === 'job-admin' ? 'admin' : 'shopFloor';
      const jobStatus = columnId; // columnId is the status string (e.g. 'toBeQuoted')

      // Fold the email subject into the description instead of the job name
      // so the part name stays empty for the user to fill in manually.
      let jobDescription = description || '';
      if (title) {
        jobDescription = title + (jobDescription ? '\n\n' + jobDescription : '');
      }

      // Auto-generate next job code.
      const { data: latestJob } = await supabase
        .from('jobs')
        .select('job_code')
        .order('job_code', { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextJobCode = (latestJob?.job_code ?? 0) + 1;

      const { data: jobRow, error: jobErr } = await supabase
        .from('jobs')
        .insert({
          job_code: nextJobCode,
          name: '',
          description: jobDescription || null,
          status: jobStatus,
          board_type: boardType,
          active: true,
        })
        .select('id, job_code')
        .single();

      if (jobErr || !jobRow) {
        console.error('create-card-from-email: job insert failed:', jobErr?.message);
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Failed to create job.' }),
        };
      }

      const jobId = jobRow.id;

      // Upload attachments to the job.
      const attachmentResults = [];
      const warnings = [];

      for (const [idx, att] of validAttachments.entries()) {
        const filename = sanitizeText(att.filename) || `attachment-${idx + 1}`;
        const mimeType = sanitizeText(att.mimeType) || 'application/octet-stream';
        const base64Data = sanitizeText(att.base64Data);

        if (!base64Data) { warnings.push(`Skipped ${filename}: no data`); continue; }

        let buffer;
        try { buffer = Buffer.from(base64Data, 'base64'); } catch {
          warnings.push(`Skipped ${filename}: invalid base64`); continue;
        }
        if (buffer.length > MAX_ATTACHMENT_SIZE) {
          warnings.push(`Skipped ${filename}: exceeds 5 MB limit`); continue;
        }

        const safeName = sanitizeFileName(filename);
        const ext = safeName.includes('.') ? safeName.split('.').pop() : 'bin';
        const storagePath = `jobs/${jobId}/${crypto.randomUUID()}.${ext}`;

        const { error: uploadErr } = await supabase.storage
          .from('attachments')
          .upload(storagePath, buffer, { upsert: false, contentType: mimeType });

        if (uploadErr) {
          console.error(`Attachment upload failed (${filename}):`, uploadErr.message);
          warnings.push(`Failed to upload ${filename}`); continue;
        }

        const { error: insertErr } = await supabase.from('attachments').insert({
          job_id: jobId,
          filename,
          storage_path: storagePath,
          is_admin_only: true,
        });

        if (insertErr) {
          console.error(`Attachment record insert failed (${filename}):`, insertErr.message);
          warnings.push(`Uploaded ${filename} but failed to save record`); continue;
        }
        attachmentResults.push({ filename, storagePath });
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          ok: true,
          jobId,
          jobCode: jobRow.job_code,
          attachmentCount: attachmentResults.length,
          warnings: warnings.length > 0 ? warnings : undefined,
        }),
      };
    }

    // ── Custom board card flow ───────────────────────────
    // Verify board and column exist.
    const { data: boardRow, error: boardErr } = await supabase
      .from('boards')
      .select('id')
      .eq('id', boardId)
      .single();
    if (boardErr || !boardRow) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Board not found.' }),
      };
    }

    const { data: colRow, error: colErr } = await supabase
      .from('board_columns')
      .select('id')
      .eq('id', columnId)
      .eq('board_id', boardId)
      .single();
    if (colErr || !colRow) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Column not found on this board.' }),
      };
    }

    // Compute next sort_order for this column.
    const { count: existingCards } = await supabase
      .from('board_cards')
      .select('id', { count: 'exact', head: true })
      .eq('column_id', columnId);
    const sortOrder = existingCards ?? 0;

    // ── Create card ──────────────────────────────────────
    const { data: cardRow, error: cardErr } = await supabase
      .from('board_cards')
      .insert({
        board_id: boardId,
        column_id: columnId,
        title,
        description: description || null,
        sort_order: sortOrder,
      })
      .select('id')
      .single();

    if (cardErr || !cardRow) {
      console.error('create-card-from-email: card insert failed:', cardErr?.message);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Failed to create card.' }),
      };
    }

    const cardId = cardRow.id;

    // ── Upload attachments ───────────────────────────────
    const attachmentResults = [];
    const warnings = [];

    for (const [idx, att] of validAttachments.entries()) {
      const filename = sanitizeText(att.filename) || `attachment-${idx + 1}`;
      const mimeType = sanitizeText(att.mimeType) || 'application/octet-stream';
      const base64Data = sanitizeText(att.base64Data);

      if (!base64Data) {
        warnings.push(`Skipped ${filename}: no data`);
        continue;
      }

      // Decode base64 to a buffer.
      let buffer;
      try {
        buffer = Buffer.from(base64Data, 'base64');
      } catch {
        warnings.push(`Skipped ${filename}: invalid base64`);
        continue;
      }

      if (buffer.length > MAX_ATTACHMENT_SIZE) {
        warnings.push(`Skipped ${filename}: exceeds 5 MB limit`);
        continue;
      }

      const safeName = sanitizeFileName(filename);
      const ext = safeName.includes('.') ? safeName.split('.').pop() : 'bin';
      const storagePath = `board-cards/${cardId}/${crypto.randomUUID()}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from('attachments')
        .upload(storagePath, buffer, {
          upsert: false,
          contentType: mimeType,
        });

      if (uploadErr) {
        console.error(`Attachment upload failed (${filename}):`, uploadErr.message);
        warnings.push(`Failed to upload ${filename}`);
        continue;
      }

      const { error: insertErr } = await supabase.from('attachments').insert({
        board_card_id: cardId,
        filename,
        storage_path: storagePath,
        is_admin_only: false,
      });

      if (insertErr) {
        console.error(`Attachment record insert failed (${filename}):`, insertErr.message);
        warnings.push(`Uploaded ${filename} but failed to save record`);
        continue;
      }

      attachmentResults.push({ filename, storagePath });
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        ok: true,
        cardId,
        attachmentCount: attachmentResults.length,
        warnings: warnings.length > 0 ? warnings : undefined,
      }),
    };
  } catch (error) {
    console.error('create-card-from-email: unexpected error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Unexpected error creating card.',
      }),
    };
  }
}
