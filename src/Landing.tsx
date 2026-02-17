import React from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Public landing page for roughcutmfg.com.
 * Shown at / when user is not logged in. Employee Login goes to the app.
 */
const Landing: React.FC = () => {
  const navigate = useNavigate();

  const handleEmployeeLogin = () => {
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-slate-950 via-slate-900 to-background-dark">
      {/* Optional: subtle grid or texture */}
      <div
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.02)_1px,transparent_1px)] bg-[size:64px_64px]"
        aria-hidden
      />

      <main className="relative flex flex-1 flex-col items-center justify-center px-6 py-16">
        <div className="flex w-full max-w-md flex-col items-center text-center">
          {/* Logo / brand mark */}
          <div className="mb-8 flex h-20 w-20 items-center justify-center rounded-2xl border border-white/20 bg-white/10 shadow-xl">
            <span className="material-symbols-outlined text-4xl text-white/90">
              precision_manufacturing
            </span>
          </div>

          <h1 className="mb-3 text-4xl font-bold tracking-tight text-white md:text-5xl">
            Rough Cut
          </h1>
          <p className="mb-2 text-xl font-medium tracking-wide text-slate-400">Manufacturing</p>
          <p className="mb-12 mt-4 max-w-sm text-sm text-slate-500">
            Custom manufacturing and fabrication. Jobs, inventory, and time tracking for the team.
          </p>

          <button
            type="button"
            onClick={handleEmployeeLogin}
            className="flex h-14 w-full max-w-xs items-center justify-center gap-3 rounded-xl bg-primary px-6 text-lg font-bold text-white shadow-lg shadow-primary/30 transition-all hover:bg-primary/90 active:scale-[0.98]"
          >
            <span className="material-symbols-outlined text-2xl">login</span>
            Employee Login
          </button>

          <p className="mt-6 text-xs text-slate-600">
            Employees: use your company email and password to access WorkTrack Pro.
          </p>
        </div>
      </main>

      <footer className="relative py-6 text-center text-xs text-slate-600">
        © {new Date().getFullYear()} Rough Cut Manufacturing. All rights reserved.
      </footer>
    </div>
  );
};

export default Landing;
