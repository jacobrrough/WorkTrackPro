import React, { useState } from 'react';

interface LoginProps {
  onLogin: (email: string, password: string) => Promise<void>;
  error?: string | null;
  isLoading?: boolean;
}

const Login: React.FC<LoginProps> = ({ onLogin, error, isLoading }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [logoError, setLogoError] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [showContactAdmin, setShowContactAdmin] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [contactMessage, setContactMessage] = useState('');
  const [contactSent, setContactSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onLogin(email, password);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    // Password reset needs to be configured in PocketBase
    // For now, show a message directing users to contact admin
    setResetSent(true);
  };

  const handleContactAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    // In a real deployment, this would send an email or create a support ticket
    // For now, show a message with admin contact info
    setContactSent(true);
  };

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-gradient-to-b from-background-dark to-[#2b1a3d] px-6">
      <div className="mb-8 flex w-full max-w-[400px] flex-col items-center">
        {/* Company Logo - fallback icon if image missing */}
        <div className="mb-4 flex h-24 w-24 items-center justify-center overflow-hidden rounded-md bg-white shadow-xl">
          {logoError ? (
            <span
              className="material-symbols-outlined text-5xl text-primary"
              aria-hidden
            >
              precision_manufacturing
            </span>
          ) : (
            <img
              src="/logo"
              alt="Company Logo"
              className="h-20 w-20 object-contain"
              onError={() => setLogoError(true)}
            />
          )}
        </div>
        <h1 className="text-center text-[32px] font-bold leading-tight tracking-tight text-white">
          WorkTrack Pro
        </h1>
        <p className="mt-2 text-center text-base font-normal leading-normal text-[#ad93c8]">
          Log in to manage your jobs and inventory
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        method="post"
        action="#"
        className="w-full max-w-[400px] rounded-md border border-[#4d3465] bg-background-dark/50 p-4 shadow-xl backdrop-blur-sm"
        autoComplete="on"
        aria-label="Login form"
      >
        {error && (
          <div className="mb-4 rounded-sm border border-red-500/30 bg-red-500/20 p-3">
            <p className="text-center text-sm text-red-400">{error}</p>
          </div>
        )}

        <div className="mb-4 flex w-full flex-col">
          <label
            className="ml-1 pb-2 text-sm font-medium leading-normal text-white"
            htmlFor="login-email"
          >
            Email Address
          </label>
          <div className="relative">
            <span
              className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-xl text-[#ad93c8]"
              aria-hidden
            >
              mail
            </span>
            <input
              id="login-email"
              name="email"
              type="email"
              inputMode="email"
              className="h-14 w-full rounded-sm border border-[#4d3465] bg-[#261a32] pl-12 pr-4 text-base font-normal text-white placeholder:text-[#ad93c8] focus:border-primary focus:outline-0 focus:ring-2 focus:ring-primary/50"
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isLoading}
              autoComplete="email"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-label="Email address"
            />
          </div>
        </div>

        <div className="mb-2 flex w-full flex-col">
          <label
            className="ml-1 pb-2 text-sm font-medium leading-normal text-white"
            htmlFor="login-password"
          >
            Password
          </label>
          <div className="relative">
            <span
              className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-xl text-[#ad93c8]"
              aria-hidden
            >
              lock
            </span>
            <input
              id="login-password"
              name="password"
              type="password"
              className="h-14 w-full rounded-sm border border-[#4d3465] bg-[#261a32] pl-12 pr-4 text-base font-normal text-white placeholder:text-[#ad93c8] focus:border-primary focus:outline-0 focus:ring-2 focus:ring-primary/50"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isLoading}
              autoComplete="current-password"
              aria-label="Password"
            />
          </div>
        </div>

        <div className="mb-8 flex w-full justify-end">
          <button
            type="button"
            onClick={() => setShowForgotPassword(true)}
            className="text-sm font-medium text-primary transition-colors hover:text-primary/80"
          >
            Forgot password?
          </button>
        </div>

        <button
          type="submit"
          className="flex h-14 w-full items-center justify-center gap-2 rounded-sm bg-primary text-lg font-bold text-white shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isLoading}
        >
          {isLoading ? (
            <>
              <div className="h-5 w-5 animate-spin rounded-sm border-2 border-white border-t-transparent"></div>
              <span>Logging in...</span>
            </>
          ) : (
            <>
              <span>Login</span>
              <span className="material-symbols-outlined text-xl">arrow_forward</span>
            </>
          )}
        </button>

        <p className="mt-6 text-center text-xs text-[#ad93c8]/60">
          Connected to Supabase
        </p>
      </form>

      <div className="mt-8 flex items-center gap-1">
        <p className="text-sm text-[#ad93c8]">Don't have an account?</p>
        <button
          onClick={() => setShowContactAdmin(true)}
          className="text-sm font-bold text-primary hover:underline"
        >
          Contact Admin
        </button>
      </div>

      {/* Forgot Password Modal */}
      {showForgotPassword && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-md border border-[#4d3465] bg-background-dark p-4 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-xl font-bold text-white">Reset Password</h3>
              <button
                onClick={() => {
                  setShowForgotPassword(false);
                  setResetSent(false);
                  setResetEmail('');
                }}
                className="text-slate-400 transition-colors hover:text-white"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {resetSent ? (
              <div className="py-8 text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-sm bg-primary/20">
                  <span className="material-symbols-outlined text-3xl text-primary">info</span>
                </div>
                <h4 className="mb-2 text-lg font-bold text-white">Password Reset</h4>
                <p className="mb-4 text-sm text-slate-400">
                  Password reset is managed by your administrator.
                </p>
                <p className="text-sm text-slate-400">
                  Please contact your admin to reset your password, or use the "Contact Admin"
                  button on the login screen.
                </p>
                <button
                  onClick={() => {
                    setShowForgotPassword(false);
                    setResetSent(false);
                    setResetEmail('');
                  }}
                  className="mt-6 rounded-sm bg-white/10 px-6 py-3 font-medium text-white transition-colors hover:bg-white/20"
                >
                  Got it
                </button>
              </div>
            ) : (
              <form onSubmit={handleForgotPassword} method="post" action="#" autoComplete="on">
                <p className="mb-4 text-sm text-slate-400">
                  Enter your email address and we'll send you instructions to reset your password.
                </p>
                <div className="mb-4 flex flex-col">
                  <label className="pb-2 text-sm font-medium text-white" htmlFor="reset-email">
                    Email Address
                  </label>
                  <input
                    id="reset-email"
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    className="h-14 w-full rounded-sm border border-[#4d3465] bg-[#261a32] px-4 text-white placeholder:text-slate-600"
                    placeholder="name@company.com"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowForgotPassword(false);
                      setResetEmail('');
                    }}
                    className="h-12 flex-1 rounded-sm bg-white/10 font-medium text-white transition-colors hover:bg-white/20"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="h-12 flex-1 rounded-sm bg-primary font-bold text-white transition-colors hover:bg-primary/90"
                  >
                    Send Reset Link
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Contact Admin Modal */}
      {showContactAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-md border border-[#4d3465] bg-background-dark p-4 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-xl font-bold text-white">Contact Administrator</h3>
              <button
                onClick={() => {
                  setShowContactAdmin(false);
                  setContactSent(false);
                  setContactMessage('');
                }}
                className="text-slate-400 transition-colors hover:text-white"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {contactSent ? (
              <div className="py-8 text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-sm bg-primary/20">
                  <span className="material-symbols-outlined text-3xl text-primary">
                    contact_support
                  </span>
                </div>
                <h4 className="mb-2 text-lg font-bold text-white">Contact Your Administrator</h4>
                <p className="mb-4 text-sm text-slate-400">
                  New accounts must be created by a system administrator.
                </p>
                <p className="text-sm text-slate-400">
                  Please speak with your supervisor or IT department to request access to WorkTrack
                  Pro.
                </p>
                <button
                  onClick={() => {
                    setShowContactAdmin(false);
                    setContactSent(false);
                    setContactMessage('');
                  }}
                  className="mt-6 rounded-sm bg-white/10 px-6 py-3 font-medium text-white transition-colors hover:bg-white/20"
                >
                  Got it
                </button>
              </div>
            ) : (
              <form onSubmit={handleContactAdmin} method="post" action="#" autoComplete="on">
                <p className="mb-4 text-sm text-slate-400">
                  Need an account? Send a message to the administrator to request access.
                </p>

                <div className="mb-4 flex flex-col">
                  <label className="pb-2 text-sm font-medium text-white" htmlFor="contact-email">
                    Your Email
                  </label>
                  <input
                    id="contact-email"
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    className="h-12 w-full rounded-sm border border-[#4d3465] bg-[#261a32] px-4 text-white placeholder:text-slate-600"
                    placeholder="your.email@company.com"
                    required
                  />
                </div>

                <div className="mb-4 flex flex-col">
                  <label className="pb-2 text-sm font-medium text-white" htmlFor="contact-name">
                    Your Name
                  </label>
                  <input
                    id="contact-name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    className="h-12 w-full rounded-sm border border-[#4d3465] bg-[#261a32] px-4 text-white placeholder:text-slate-600"
                    placeholder="John Doe"
                    required
                  />
                </div>

                <div className="mb-4 flex flex-col">
                  <label className="pb-2 text-sm font-medium text-white" htmlFor="contact-message">
                    Message (Optional)
                  </label>
                  <textarea
                    id="contact-message"
                    name="message"
                    autoComplete="off"
                    className="h-24 w-full resize-none rounded-sm border border-[#4d3465] bg-[#261a32] p-4 text-white placeholder:text-slate-600"
                    placeholder="I need access to WorkTrack Pro for..."
                    value={contactMessage}
                    onChange={(e) => setContactMessage(e.target.value)}
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowContactAdmin(false);
                      setContactMessage('');
                    }}
                    className="h-12 flex-1 rounded-sm bg-white/10 font-medium text-white transition-colors hover:bg-white/20"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="h-12 flex-1 rounded-sm bg-primary font-bold text-white transition-colors hover:bg-primary/90"
                  >
                    Send Request
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Login;
