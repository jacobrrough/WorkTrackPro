import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '@/services/api/supabaseClient';

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

interface PublicHomeProps {
  onEmployeeLogin: () => void;
}

const MAX_FILES = 10;
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB per file (common portal default)
const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim();

const PublicHome: React.FC<PublicHomeProps> = ({ onEmployeeLogin }) => {
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
        theme: 'dark',
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

      const response = await fetch('/api/submit-proposal', {
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
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error || payload?.message || 'Failed to submit proposal.');
      }

      setSuccessMessage(
        'Proposal submitted. Our team will review it and move it into quoting right away.'
      );
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
    <div className="min-h-screen bg-gradient-to-b from-background-dark to-[#2b1a3d] text-white">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-background-dark/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-sm bg-white/95">
              <img
                src="/logo"
                alt="Rough Cut Manufacturing logo"
                className="h-10 w-10 object-contain"
                onError={(e) => {
                  const target = e.currentTarget;
                  target.style.display = 'none';
                }}
              />
              <span className="material-symbols-outlined text-primary">
                precision_manufacturing
              </span>
            </div>
            <div>
              <h1 className="text-lg font-bold">Rough Cut Manufacturing</h1>
              <p className="text-xs text-slate-300">FOD-first protective part manufacturing</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onEmployeeLogin}
            className="min-h-[44px] rounded-sm border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/20"
          >
            Employee Login
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl space-y-8 px-4 py-8">
        <section className="rounded-sm border border-white/10 bg-black/20 p-6">
          <h2 className="text-3xl font-bold leading-tight text-white">
            Specialized Protective Products for Parts, Paint, and Process Integrity
          </h2>
          <p className="mt-3 max-w-3xl text-slate-200">
            We manufacture custom solutions using advanced fabrics, foams, and plastics, with a
            strong emphasis on FOD protection and prevention for demanding manufacturing
            environments.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              'Part and paint protection systems',
              'Custom foam inlays and inserts',
              'Knee pads and ergonomic protection',
              'FOD-focused process aids',
              'Prototype to production support',
              'Document-controlled proposal intake',
            ].map((item) => (
              <div
                key={item}
                className="rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100"
              >
                {item}
              </div>
            ))}
          </div>
        </section>

        <section
          id="submit-proposal"
          className="rounded-sm border border-primary/30 bg-primary/10 p-6 shadow-lg shadow-primary/10"
        >
          <h3 className="text-2xl font-bold">Submit a Proposal</h3>
          <p className="mt-2 text-sm text-slate-200">
            Submit your request and paperwork. It goes directly to our admin board as
            <span className="font-semibold text-white"> Needs Quote</span>.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block text-slate-200">Contact name *</span>
                <input
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  className="w-full rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-primary/60 focus:outline-none"
                  required
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-slate-200">Email *</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-primary/60 focus:outline-none"
                  required
                />
              </label>
              <label className="block text-sm sm:col-span-2">
                <span className="mb-1 block text-slate-200">Phone *</span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-primary/60 focus:outline-none"
                  required
                />
              </label>
            </div>

            <label className="block text-sm">
              <span className="mb-1 block text-slate-200">Proposal description *</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={6}
                className="w-full rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-primary/60 focus:outline-none"
                placeholder="Tell us what you need, materials, quantities, FOD requirements, and any timing details."
                required
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-slate-200">
                Upload paperwork (up to {MAX_FILES} files,{' '}
                {Math.floor(MAX_FILE_SIZE_BYTES / 1024 / 1024)}
                MB each)
              </span>
              <input
                type="file"
                multiple
                accept="*/*"
                onChange={handleFileSelection}
                className="block w-full rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-white file:mr-3 file:rounded-sm file:border-0 file:bg-primary/20 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-primary/30"
              />
            </label>

            {files.length > 0 && (
              <ul className="space-y-2 rounded-sm border border-white/10 bg-white/5 p-3 text-sm">
                {files.map((file, idx) => (
                  <li
                    key={`${file.name}-${idx}`}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate text-slate-100">
                      {file.name} ({(file.size / (1024 * 1024)).toFixed(1)} MB)
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFile(idx)}
                      className="rounded-sm border border-red-500/40 px-2 py-1 text-xs text-red-300 hover:bg-red-500/20"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div ref={turnstileContainerRef} className="min-h-[64px]" />

            {errorMessage && (
              <p className="rounded-sm border border-red-500/40 bg-red-500/15 px-3 py-2 text-sm text-red-200">
                {errorMessage}
              </p>
            )}
            {successMessage && (
              <p className="rounded-sm border border-green-500/40 bg-green-500/15 px-3 py-2 text-sm text-green-200">
                {successMessage}
              </p>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="min-h-[48px] rounded-sm bg-primary px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? 'Submitting...' : 'Submit Proposal'}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
};

export default PublicHome;
