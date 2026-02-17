/**
 * Shown when Supabase env vars are missing or invalid (e.g. "Invalid Supabase URL").
 */
import React from 'react';
import { getSupabaseUrl, isSupabaseUrlValid } from './lib/supabaseEnv';

const hasUrl = getSupabaseUrl().length > 0;
const urlInvalid = hasUrl && !isSupabaseUrlValid();

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
          <p className="mb-4 text-slate-300">
            In <strong>Netlify</strong> → Site configuration → Environment variables, set <code className="rounded bg-slate-800 px-1">VITE_SUPABASE_URL</code> to <strong>exactly</strong>:
          </p>
          <p className="mb-4 rounded bg-slate-800 p-3 font-mono text-sm text-green-400">
            https://YOUR-PROJECT-REF.supabase.co
          </p>
          <ul className="mb-6 list-inside list-disc text-sm text-slate-400">
            <li>No trailing slash (or one is OK)</li>
            <li>No spaces, quotes, or extra path</li>
            <li>Copy from Supabase → Project Settings → API → Project URL</li>
          </ul>
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
