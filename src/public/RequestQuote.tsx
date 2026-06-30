import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '@/services/api/supabaseClient';
import PublicHeader from './PublicHeader';
import PublicFooter from './PublicFooter';
import './public.css';

declare global {
  interface Window {
    turnstile?: {
      render: (selector: string | HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

type UploadedProposalFile = {
  filename: string;
  storagePath: string;
  contentType: string;
  sizeBytes: number;
  publicUrl?: string;
};

interface RequestQuoteProps {
  onEmployeeLogin: () => void;
}

const MAX_FILES = 10;
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB per file (common portal default)
const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim();

/**
 * /quote — the proposal form, moved out of the homepage onto its own roomy
 * route. Field names and the POST /api/submit-proposal contract are IDENTICAL
 * to the previous homepage form (sacred). Preserves the store→form
 * `?product=&variant=` description prefill.
 */
const RequestQuote: React.FC<RequestQuoteProps> = ({ onEmployeeLogin }) => {
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const turnstileWidgetIdRef = useRef<string | null>(null);
  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);

  // Prefill proposal description from store "Request quote" link (?product= & ?variant=)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const product = params.get('product')?.trim();
    if (!product) return;
    const variant = params.get('variant')?.trim();
    const prefill = variant
      ? `Requesting quote for product: ${product}-${variant}`
      : `Requesting quote for product: ${product}`;
    setDescription((prev) => (prev.trim() ? prev : prefill));
  }, []);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;

    const ensureWidget = () => {
      if (!window.turnstile || !turnstileContainerRef.current) return;
      if (turnstileWidgetIdRef.current) {
        window.turnstile.remove(turnstileWidgetIdRef.current);
      }
      turnstileWidgetIdRef.current = window.turnstile.render(turnstileContainerRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token: string) => setTurnstileToken(token),
        'expired-callback': () => setTurnstileToken(''),
        'error-callback': () => setTurnstileToken(''),
        theme: 'auto',
      });
    };

    if (window.turnstile) {
      ensureWidget();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = ensureWidget;
    document.head.appendChild(script);

    return () => {
      script.remove();
      if (window.turnstile && turnstileWidgetIdRef.current) {
        window.turnstile.remove(turnstileWidgetIdRef.current);
      }
    };
  }, []);

  const sanitizeFileName = (input: string) => input.replace(/[^a-zA-Z0-9._-]/g, '_');

  const handleFileSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    const merged = [...files, ...selected].slice(0, MAX_FILES);
    setFiles(merged);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, idx) => idx !== index));
  };

  const uploadFiles = async (submissionId: string): Promise<UploadedProposalFile[]> => {
    const uploaded: UploadedProposalFile[] = [];

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE_BYTES) {
        throw new Error(`"${file.name}" is larger than 25 MB.`);
      }

      const filePath = `${submissionId}/${Date.now()}-${sanitizeFileName(file.name)}`;
      const { error } = await supabase.storage.from('customer-proposals').upload(filePath, file, {
        upsert: false,
        contentType: file.type || 'application/octet-stream',
      });
      if (error) throw new Error(`Failed to upload "${file.name}": ${error.message}`);

      const { data } = supabase.storage.from('customer-proposals').getPublicUrl(filePath);
      uploaded.push({
        filename: file.name,
        storagePath: filePath,
        contentType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        publicUrl: data.publicUrl,
      });
    }

    return uploaded;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (!contactName.trim() || !email.trim() || !phone.trim() || !description.trim()) {
      setErrorMessage('Please complete all required fields.');
      return;
    }
    if (files.length > MAX_FILES) {
      setErrorMessage(`Please upload no more than ${MAX_FILES} files.`);
      return;
    }
    if (!TURNSTILE_SITE_KEY) {
      setErrorMessage('Turnstile is not configured. Add VITE_TURNSTILE_SITE_KEY to continue.');
      return;
    }
    if (!turnstileToken) {
      setErrorMessage('Please complete the anti-spam check.');
      return;
    }

    setIsSubmitting(true);
    try {
      const submissionId = crypto.randomUUID();
      const uploadedFiles = await uploadFiles(submissionId);

      const apiOrigin = (import.meta.env.VITE_API_ORIGIN as string) || '';
      const response = await fetch(`${apiOrigin}/api/submit-proposal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId,
          contactName: contactName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          description: description.trim(),
          turnstileToken,
          files: uploadedFiles,
        }),
      });

      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        message?: string;
        warnings?: string[];
        warningDetails?: string[];
        emailQueue?: {
          admin?: { id: string; status: number; lastEvent?: string | null } | null;
          customer?: { id: string; status: number; lastEvent?: string | null } | null;
        };
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error || payload?.message || 'Failed to submit proposal.');
      }

      const emailWarnings = payload?.warnings ?? [];
      const warningDetails = payload?.warningDetails ?? [];
      const customerLastEvent = payload?.emailQueue?.customer?.lastEvent ?? null;
      const customerFailed =
        customerLastEvent != null &&
        ['bounced', 'failed', 'suppressed', 'complained', 'canceled'].includes(
          customerLastEvent.toLowerCase()
        );
      if (customerFailed && !emailWarnings.includes('customer_email_failed')) {
        emailWarnings.push('customer_email_failed');
      }
      const queuedAdmin = payload?.emailQueue?.admin?.id ? 'admin' : null;
      const queuedCustomer = payload?.emailQueue?.customer?.id ? 'customer' : null;
      const queuedTargets = [queuedAdmin, queuedCustomer].filter(Boolean);
      if (emailWarnings.length > 0) {
        const detailsText = warningDetails.length > 0 ? ` ${warningDetails.join(' ')}` : '';
        setSuccessMessage(
          `Proposal submitted and routed to quoting, but one or more email notifications failed.${detailsText}`
        );
      } else {
        setSuccessMessage(
          queuedTargets.length > 0
            ? `Proposal submitted and email notification queued (${queuedTargets.join(' + ')}).`
            : 'Proposal submitted and routed to quoting.'
        );
      }
      setContactName('');
      setEmail('');
      setPhone('');
      setDescription('');
      setFiles([]);
      setTurnstileToken('');
      if (window.turnstile && turnstileWidgetIdRef.current) {
        window.turnstile.reset(turnstileWidgetIdRef.current);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to submit proposal.';
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="rcm-site rcm-page">
      <PublicHeader onEmployeeLogin={onEmployeeLogin} currentPath="home" />

      <main className="quote-wrap">
        <div className="ey">Request a Quote</div>
        <h1>Have a part to protect? Send us the details.</h1>
        <p className="lede">
          Complete this form and your request goes straight to our admin quoting board as{' '}
          <strong>Needs Quote</strong> for immediate review. Attach drawings, specs, or photos and
          we&rsquo;ll take it from there.
        </p>

        <form className="q-card" onSubmit={handleSubmit}>
          <div className="q-grid">
            <label className="field">
              <span>Contact name *</span>
              <input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>Email *</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className="field span-2">
              <span>Phone *</span>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required />
            </label>
            <label className="field span-2">
              <span>Proposal description *</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Tell us what you need, materials, quantities, FOD requirements, and any timing details."
                required
              />
            </label>
            <label className="field span-2">
              <span>
                Upload paperwork (up to {MAX_FILES} files,{' '}
                {Math.floor(MAX_FILE_SIZE_BYTES / 1024 / 1024)} MB each)
              </span>
              <input type="file" multiple accept="*/*" onChange={handleFileSelection} />
            </label>
          </div>

          {files.length > 0 && (
            <ul className="q-files" style={{ marginTop: '1rem' }}>
              {files.map((file, idx) => (
                <li key={`${file.name}-${idx}`}>
                  <span
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {file.name} ({(file.size / (1024 * 1024)).toFixed(1)} MB)
                  </span>
                  <button type="button" onClick={() => removeFile(idx)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div ref={turnstileContainerRef} style={{ minHeight: 64, marginTop: '1rem' }} />

          {errorMessage && (
            <p className="q-note err" style={{ marginTop: '1rem' }}>
              {errorMessage}
            </p>
          )}
          {successMessage && (
            <p className="q-note ok" style={{ marginTop: '1rem' }}>
              {successMessage}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="btn btn-primary"
            style={{ marginTop: '1.25rem', width: '100%' }}
          >
            {isSubmitting ? 'Submitting…' : 'Submit Proposal'}
          </button>
        </form>
      </main>

      <PublicFooter />
    </div>
  );
};

export default RequestQuote;
