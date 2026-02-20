import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Main landing page for roughcutmfg.com.
 * Company website with Employee Login in the header linking to WorkTrack Pro.
 */
const Landing: React.FC = () => {
  return (
    <div className="flex h-screen flex-col overflow-y-auto bg-slate-950 text-white">
      {/* Header: logo left, Employee Login top right */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-slate-950/95 px-4 py-4 backdrop-blur sm:px-6 lg:px-8">
        <Link to="/" className="flex items-center gap-2 font-bold tracking-tight text-white">
          <span className="flex h-9 w-9 items-center justify-center rounded-sm bg-amber-500/20 text-amber-400">
            <span className="material-symbols-outlined text-xl">precision_manufacturing</span>
          </span>
          Rough Cut Manufacturing
        </Link>
        <Link
          to="/login"
          className="flex items-center gap-2 rounded-sm bg-amber-500 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-amber-400 active:scale-[0.98]"
        >
          <span className="material-symbols-outlined text-lg">login</span>
          Employee Login
        </Link>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl">
              Custom manufacturing and fabrication
            </h1>
            <p className="mt-6 text-lg text-slate-400">
              From concept to finished product. We handle jobs, inventory, and precision work for
              our clients.
            </p>
          </div>
        </section>

        {/* Quick sections */}
        <section className="border-t border-white/10 px-4 py-16 sm:px-6 lg:px-8">
          <div className="mx-auto grid max-w-4xl gap-12 sm:grid-cols-2">
            <div>
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-sm bg-amber-500/20 text-amber-400">
                <span className="material-symbols-outlined text-2xl">build</span>
              </div>
              <h2 className="text-xl font-semibold text-white">What we do</h2>
              <p className="mt-2 text-slate-400">
                Fabrication, machining, and custom manufacturing. We track every job and keep
                inventory and time in sync.
              </p>
            </div>
            <div>
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-sm bg-amber-500/20 text-amber-400">
                <span className="material-symbols-outlined text-2xl">groups</span>
              </div>
              <h2 className="text-xl font-semibold text-white">Our team</h2>
              <p className="mt-2 text-slate-400">
                Employees use WorkTrack Pro to clock in, manage jobs, and update inventory. Sign in
                via Employee Login above.
              </p>
            </div>
          </div>
        </section>

        {/* CTA / contact hint */}
        <section className="border-t border-white/10 px-4 py-12 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-slate-500">Interested in working with us? Reach out for a quote.</p>
            <p className="mt-2 text-sm text-slate-600">
              Current employees: use <strong className="text-slate-400">Employee Login</strong> in
              the top right to access WorkTrack Pro.
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 px-4 py-6 text-center text-sm text-slate-500 sm:px-6 lg:px-8">
        © {new Date().getFullYear()} Rough Cut Manufacturing. All rights reserved.
      </footer>
    </div>
  );
};

export default Landing;
