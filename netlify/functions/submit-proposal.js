import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Content-Type': 'application/json',
};

const requiredBaseEnv = [
  'VITE_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'TURNSTILE_SECRET_KEY',
  'RESEND_API_KEY',
];

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return '';
}

function resolveProposalEmailConfig() {
  const adminEmail = firstNonEmpty(process.env.PROPOSAL_ADMIN_EMAIL);
  // Backward compatible: old deployments may only have PROPOSAL_FROM_EMAIL set.
  const fromAdmin = firstNonEmpty(
    process.env.PROPOSAL_FROM_EMAIL_ADMIN,
    process.env.PROPOSAL_FROM_EMAIL,
    process.env.RESEND_FROM_EMAIL,
    process.env.RESEND_FROM
  );
  const fromCustomer = firstNonEmpty(
    process.env.PROPOSAL_FROM_EMAIL_CUSTOMER,
    process.env.PROPOSAL_FROM_EMAIL,
    fromAdmin
  );
  return { adminEmail, fromAdmin, fromCustomer };
}

function validateEnv() {
  for (const key of requiredBaseEnv) {
    if (!process.env[key] || process.env[key].trim().length === 0) {
      return key;
    }
  }
  const { adminEmail, fromAdmin, fromCustomer } = resolveProposalEmailConfig();
  if (!adminEmail) return 'PROPOSAL_ADMIN_EMAIL';
  if (!fromAdmin) return 'PROPOSAL_FROM_EMAIL_ADMIN (or PROPOSAL_FROM_EMAIL)';
  if (!fromCustomer) return 'PROPOSAL_FROM_EMAIL_CUSTOMER (or PROPOSAL_FROM_EMAIL)';
  return null;
}

async function verifyTurnstile(token, remoteIp) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', token);
  if (remoteIp) body.set('remoteip', remoteIp);

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!response.ok) return false;
  const payload = await response.json();
  return payload.success === true;
}

function sanitizeText(input) {
  return String(input ?? '').trim();
}

function sanitizeFileName(input) {
  const base = sanitizeText(input);
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned.length > 0 ? cleaned : 'file.bin';
}

function normalizeResendError(rawError) {
  const text = sanitizeText(rawError);
  if (!text) return 'Email delivery failed.';
  return text.replace(/^Resend error:\s*/i, '').trim();
}

async function attachProposalFilesToAdminJob({ supabase, jobId, files }) {
  const warnings = [];
  if (!jobId || !Array.isArray(files) || files.length === 0) return warnings;

  for (const [idx, file] of files.entries()) {
    const storagePath = sanitizeText(file?.storagePath);
    const filename = sanitizeText(file?.filename) || `proposal-file-${idx + 1}`;
    const contentType = sanitizeText(file?.contentType) || 'application/octet-stream';
    if (!storagePath) {
      warnings.push('proposal_file_missing_storage_path');
      continue;
    }

    const { data: downloadedFile, error: downloadError } = await supabase.storage
      .from('customer-proposals')
      .download(storagePath);
    if (downloadError || !downloadedFile) {
      console.error('Proposal file download failed:', downloadError?.message || storagePath);
      warnings.push('proposal_file_download_failed');
      continue;
    }

    const safeName = sanitizeFileName(filename);
    const attachmentPath = `jobs/${jobId}/proposal-${Date.now()}-${idx}-${safeName}`;
    const { error: uploadError } = await supabase.storage
      .from('attachments')
      .upload(attachmentPath, downloadedFile, {
        upsert: false,
        contentType,
      });
    if (uploadError) {
      console.error('Proposal file attach upload failed:', uploadError.message);
      warnings.push('proposal_file_attach_upload_failed');
      continue;
    }

    const { error: attachmentError } = await supabase.from('attachments').insert({
      job_id: jobId,
      filename,
      storage_path: attachmentPath,
      // Customer-submitted paperwork should show in Admin Files section.
      is_admin_only: true,
    });
    if (attachmentError) {
      console.error('Proposal file attachment row insert failed:', attachmentError.message);
      warnings.push('proposal_file_attachment_insert_failed');
    }
  }

  return warnings;
}

async function sendResendEmail({ from, to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: 'Missing RESEND_API_KEY' };
  if (!from) return { ok: false, error: 'Missing email From address' };

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    return { ok: false, error: `Resend error: ${response.status} ${body}`.trim() };
  }
  return { ok: true };
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

  const missingEnv = validateEnv();
  if (missingEnv) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: `Missing server configuration: ${missingEnv}` }),
    };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const contactName = sanitizeText(payload.contactName);
    const email = sanitizeText(payload.email);
    const phone = sanitizeText(payload.phone);
    const description = sanitizeText(payload.description);
    const submissionId = sanitizeText(payload.submissionId);
    const turnstileToken = sanitizeText(payload.turnstileToken);
    const files = Array.isArray(payload.files) ? payload.files : [];

    if (!contactName || !email || !phone || !description || !turnstileToken) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing required proposal fields.' }),
      };
    }

    const turnstileValid = await verifyTurnstile(
      turnstileToken,
      event.headers['x-nf-client-connection-ip']
    );
    if (!turnstileValid) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Anti-spam validation failed. Please try again.' }),
      };
    }

    const supabase = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      }
    );

    const { data: latestJob } = await supabase
      .from('jobs')
      .select('job_code')
      .order('job_code', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextJobCode = (latestJob?.job_code ?? 0) + 1;

    const fileLines = files
      .filter((f) => f && typeof f === 'object')
      .map((f) => {
        const filename = sanitizeText(f.filename);
        const url = sanitizeText(f.publicUrl);
        return url ? `- ${filename}: ${url}` : `- ${filename}`;
      });

    const descriptionWithContact = [
      'Customer Proposal Submitted via roughcutmfg.com',
      '',
      `Contact Name: ${contactName}`,
      `Email: ${email}`,
      `Phone: ${phone}`,
      '',
      'Proposal Details:',
      description,
      '',
      fileLines.length > 0 ? 'Submitted Paperwork:' : null,
      ...fileLines,
    ]
      .filter(Boolean)
      .join('\n');

    const { data: insertedJob, error: jobError } = await supabase
      .from('jobs')
      .insert({
        job_code: nextJobCode,
        name: `Proposal - ${contactName}`,
        description: descriptionWithContact,
        status: 'toBeQuoted',
        board_type: 'admin',
        qty: 'Proposal',
        active: true,
      })
      .select('id, job_code')
      .single();

    if (jobError || !insertedJob) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Unable to route proposal to admin board.' }),
      };
    }

    const { data: proposalRow, error: proposalError } = await supabase
      .from('customer_proposals')
      .insert({
        submission_id: submissionId || null,
        contact_name: contactName,
        email,
        phone,
        description,
        status: 'needs_quote',
        linked_job_id: insertedJob.id,
      })
      .select('id')
      .single();

    if (!proposalError && proposalRow && files.length > 0) {
      const rows = files.map((f) => ({
        proposal_id: proposalRow.id,
        filename: sanitizeText(f.filename),
        storage_path: sanitizeText(f.storagePath),
        content_type: sanitizeText(f.contentType) || null,
        size_bytes: Number.isFinite(Number(f.sizeBytes)) ? Number(f.sizeBytes) : null,
        public_url: sanitizeText(f.publicUrl) || null,
      }));
      await supabase.from('customer_proposal_files').insert(rows);
    }

    const { adminEmail, fromAdmin, fromCustomer } = resolveProposalEmailConfig();
    const appUrl = process.env.APP_PUBLIC_URL || 'https://roughcutmfg.com/app';
    const warnings = [];
    const warningDetails = [];

    const attachmentWarnings = await attachProposalFilesToAdminJob({
      supabase,
      jobId: insertedJob.id,
      files,
    });
    if (attachmentWarnings.length > 0) {
      warnings.push(...attachmentWarnings);
    }

    if (adminEmail) {
      const sent = await sendResendEmail({
        from: fromAdmin,
        to: adminEmail,
        subject: `New Proposal - ${contactName}`,
        html: `
          <h2>New Customer Proposal</h2>
          <p><strong>Contact:</strong> ${contactName}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Phone:</strong> ${phone}</p>
          <p><strong>Description:</strong><br/>${description.replace(/\n/g, '<br/>')}</p>
          <p><strong>Admin Job Code:</strong> ${insertedJob.job_code}</p>
          <p><a href="${appUrl}">Open Employee App</a></p>
        `,
      });
      if (!sent.ok) {
        console.error('Admin proposal email failed:', sent.error);
        warnings.push('admin_email_failed');
        warningDetails.push(`Admin email failed: ${normalizeResendError(sent.error)}`);
      }
    }

    const customerSent = await sendResendEmail({
      from: fromCustomer,
      to: email,
      subject: 'Proposal received - Rough Cut Manufacturing',
      html: `
        <h2>Thanks for your proposal</h2>
        <p>Hi ${contactName},</p>
        <p>We received your proposal and routed it to our quoting board.</p>
        <p>Our team will contact you soon with next steps.</p>
        <p>- Rough Cut Manufacturing</p>
      `,
    });
    if (!customerSent.ok) {
      console.error('Customer proposal email failed:', customerSent.error);
      warnings.push('customer_email_failed');
      warningDetails.push(`Customer email failed: ${normalizeResendError(customerSent.error)}`);
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        ok: true,
        jobCode: insertedJob.job_code,
        warnings: warnings.length ? warnings : undefined,
        warningDetails: warningDetails.length ? warningDetails : undefined,
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Unexpected proposal submission error.',
      }),
    };
  }
}
