/**
 * Shown when Supabase env vars are missing or invalid (e.g. "Invalid Supabase URL").
 */
import React from 'react';
import { getSupabaseUrl, isSupabaseUrlValid } from './lib/supabaseEnv';

const detectedUrl = getSupabaseUrl();
const hasUrl = detectedUrl.length > 0;
const urlInvalid = hasUrl && !isSupabaseUrlValid();
// Show first/last few chars for debugging (mask middle for security)
const maskedUrl = detectedUrl.length > 20 
  ? `${detectedUrl.slice(0, 15)}...${detectedUrl.slice(-10)}`
  : detectedUrl || '(empty)';

const containerStyle: React.CSSProperties = { minHeight: '100vh', background: '#0f172a', color: '#e2e8f0' };

const SetupRequired: React.FC = () => (
  <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 p-6 text-white" style={containerStyle}>
    <div className="max-w-lg rounded-xl border border-amber-500/30 bg-slate-900/90 p-8 shadow-xl">
      <div className="mb-6 flex items-center gap-3">
        <span className="material-symbols-outlined text-4xl text-amber-400">settings</span>
        <div>
          <h1 className="text-xl font-bold">
            {urlInvalid ? 'Invalid Supabase URL' : 'Setup required'}
          </h1>
          <p className="text-sm text-slate-400">
            {urlInvalid
              ? 'The Supabase URL in Netlify is missing, wrong, or has extra characters.'
              : 'WorkTrack Pro needs Supabase to be configured.'}
          </p>
        </div>
      </div>

      {urlInvalid ? (
        <>
          <div className="mb-4 rounded bg-red-500/10 border border-red-500/30 p-3">
            <p className="mb-2 text-sm font-medium text-red-400">Detected URL value:</p>
            <p className="font-mono text-xs text-slate-300 break-all">{maskedUrl}</p>
            <p className="mt-2 text-xs text-slate-400">
              {detectedUrl.length === 0 
                ? 'The URL is empty — the build likely ran before env vars were set.'
                : 'This URL failed validation. Check for hidden characters or incorrect format.'}
            </p>
          </div>
          <p className="mb-4 text-slate-300">
            In <strong>Netlify</strong> → Site configuration → Environment variables, set <code className="rounded bg-slate-800 px-1">VITE_SUPABASE_URL</code> to <strong>exactly</strong>:
          </p>
          <p className="mb-4 rounded bg-slate-800 p-3 font-mono text-sm text-green-400">
            https://bbqudyybacwbubkgktwf.supabase.co
          </p>
          <ul className="mb-4 list-inside list-disc text-sm text-slate-400">
            <li>No trailing slash</li>
            <li>No spaces or quotes — paste the URL only (Netlify may add quotes; delete them)</li>
            <li>Copy from Supabase → Project Settings → API → Project URL</li>
          </ul>
          <div className="mb-6 rounded bg-amber-500/10 border border-amber-500/30 p-3">
            <p className="text-sm font-medium text-amber-400 mb-1">⚠️ Critical: After setting env vars, you MUST:</p>
            <ol className="list-decimal list-inside text-xs text-slate-300 space-y-1 mt-2">
              <li>Go to <strong>Deploys</strong> → <strong>Trigger deploy</strong></li>
              <li>Select <strong>"Clear cache and deploy site"</strong></li>
              <li>Wait for the deploy to finish (build must run with the new env vars)</li>
            </ol>
            <p className="text-xs text-slate-400 mt-2">Vite bakes env vars at build time. If you don't redeploy, the old (empty) values stay in the bundle.</p>
          </div>
        </>
      ) : (
        <>
          <p className="mb-6 text-slate-300">
            The app is running but the database connection is missing. This usually means:
          </p>
          <ol className="mb-6 list-decimal space-y-2 pl-5 text-sm text-slate-300">
            <li>
              <strong className="text-white">Supabase schema not run</strong> — In Supabase Dashboard → SQL Editor, run the SQL from your repo: <code className="rounded bg-slate-800 px-1">supabase/migrations/20250216000001_initial_schema.sql</code>
            </li>
            <li>
              <strong className="text-white">Both env vars in Netlify</strong> — Add <strong>both</strong>: <code className="rounded bg-slate-800 px-1">VITE_SUPABASE_URL</code> and <code className="rounded bg-slate-800 px-1">VITE_SUPABASE_ANON_KEY</code>. Get them from Supabase → Project Settings → API (Project URL + anon public key). Then trigger a new deploy.
            </li>
          </ol>
        </>
      )}

      <p className="text-xs text-slate-500">
        See <strong>SETUP-SUPABASE.md</strong> in the project for the full checklist.
      </p>
    </div>
  </div>
);

export default SetupRequired;
