import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import './public/public.css';
import {
  UserIcon,
  MailIcon,
  LockIcon,
  ArrowRightIcon,
  ArrowLeftIcon,
  CloseIcon,
  SupportIcon,
} from './public/icons';

type SignUpResult = boolean | 'needs_email_confirmation';

interface LoginProps {
  onLogin: (email: string, password: string) => Promise<void>;
  onSignUp?: (
    email: string,
    password: string,
    options?: { name?: string }
  ) => Promise<SignUpResult>;
  onResetPassword?: (email: string) => Promise<void>;
  error?: string | null;
  isLoading?: boolean;
}

const Login: React.FC<LoginProps> = ({ onLogin, onSignUp, onResetPassword, error, isLoading }) => {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [showContactAdmin, setShowContactAdmin] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [signUpSuccessMessage, setSignUpSuccessMessage] = useState<string | null>(null);
  const [contactMessage, setContactMessage] = useState('');
  const [contactSent, setContactSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'signup') {
      if (!onSignUp) return;
      if (password !== confirmPassword) return;
      setSignUpSuccessMessage(null);
      const result = await onSignUp(email, password, { name: name.trim() || undefined });
      if (result === 'needs_email_confirmation') {
        setSignUpSuccessMessage('Check your email to confirm your account, then log in.');
      }
      return;
    }
    await onLogin(email, password);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onResetPassword) {
      setResetSent(true);
      return;
    }
    setResetError(null);
    try {
      await onResetPassword(resetEmail);
      setResetSent(true);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Failed to send reset email');
    }
  };

  const handleContactAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    // In a real deployment, this would send an email or create a support ticket
    // For now, show a message with admin contact info
    setContactSent(true);
  };

  return (
    <div className="rcm-site h-[100dvh] w-full overflow-y-auto bg-gradient-to-b from-app-2 to-app">
      <div className="flex min-h-full w-full flex-col items-center justify-center px-6 py-10">
        <div className="mb-8 flex w-full max-w-[400px] flex-col items-center">
          {/* Themed badger mark — links back to the public site. */}
          <Link to="/" aria-label="Back to Rough Cut Manufacturing home" className="mb-5 block">
            <span
              className="rcm-badger"
              style={{ width: 72, height: 72 }}
              role="img"
              aria-label="Rough Cut Manufacturing logo"
            />
          </Link>
          <h1 className="text-center text-[32px] font-bold leading-tight tracking-tight text-white">
            WorkTrack Pro
          </h1>
          <p className="mt-2 text-center text-base font-normal leading-normal text-muted">
            Log in to manage your jobs and inventory
          </p>
          <Link
            to="/"
            className="mt-4 inline-flex min-h-[44px] touch-manipulation items-center gap-1.5 rounded-[10px] px-3 text-sm font-semibold text-primary transition-colors hover:text-primary/80"
          >
            <ArrowLeftIcon size={16} />
            Back to site
          </Link>
        </div>

        <form
          onSubmit={handleSubmit}
          method="post"
          action="#"
          className="w-full max-w-[400px] rounded-md border border-line bg-background-dark/50 p-4 shadow-xl backdrop-blur-sm"
          autoComplete="on"
          aria-label={mode === 'login' ? 'Login form' : 'Sign up form'}
        >
          {(error || signUpSuccessMessage) && (
            <div
              className={`mb-4 rounded-sm border p-3 ${
                signUpSuccessMessage
                  ? 'border-primary/30 bg-primary/20'
                  : 'border-red-500/30 bg-red-500/20'
              }`}
            >
              <p
                className={`text-center text-sm ${
                  signUpSuccessMessage ? 'text-white' : 'text-red-400'
                }`}
              >
                {signUpSuccessMessage ?? error}
              </p>
            </div>
          )}

          {mode === 'signup' && (
            <div className="mb-4 flex w-full flex-col">
              <label
                className="ml-1 pb-2 text-sm font-medium leading-normal text-white"
                htmlFor="signup-name"
              >
                Full Name (optional)
              </label>
              <div className="relative">
                <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  id="signup-name"
                  name="name"
                  type="text"
                  className="h-14 w-full rounded-sm border border-line bg-surface-2 pl-12 pr-4 text-base font-normal text-white placeholder:text-muted focus:border-primary focus:outline-0 focus:ring-2 focus:ring-primary/50"
                  placeholder="Jane Smith"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isLoading}
                  autoComplete="name"
                  aria-label="Full name"
                />
              </div>
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
              <MailIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
              <input
                id="login-email"
                name="email"
                type="email"
                inputMode="email"
                className="h-14 w-full rounded-sm border border-line bg-surface-2 pl-12 pr-4 text-base font-normal text-white placeholder:text-muted focus:border-primary focus:outline-0 focus:ring-2 focus:ring-primary/50"
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
              Password{mode === 'signup' ? ' (min 6 characters)' : ''}
            </label>
            <div className="relative">
              <LockIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
              <input
                id="login-password"
                name="password"
                type="password"
                className="h-14 w-full rounded-sm border border-line bg-surface-2 pl-12 pr-4 text-base font-normal text-white placeholder:text-muted focus:border-primary focus:outline-0 focus:ring-2 focus:ring-primary/50"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={mode === 'signup' ? 6 : undefined}
                disabled={isLoading}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                aria-label="Password"
              />
            </div>
          </div>

          {mode === 'signup' && (
            <div className="mb-4 flex w-full flex-col">
              <label
                className="ml-1 pb-2 text-sm font-medium leading-normal text-white"
                htmlFor="signup-confirm-password"
              >
                Confirm Password
              </label>
              <div className="relative">
                <LockIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  id="signup-confirm-password"
                  name="confirmPassword"
                  type="password"
                  className="h-14 w-full rounded-sm border border-line bg-surface-2 pl-12 pr-4 text-base font-normal text-white placeholder:text-muted focus:border-primary focus:outline-0 focus:ring-2 focus:ring-primary/50"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                  disabled={isLoading}
                  autoComplete="new-password"
                  aria-label="Confirm password"
                />
              </div>
              {password && confirmPassword && password !== confirmPassword && (
                <p className="mt-1 text-sm text-red-400">Passwords do not match</p>
              )}
            </div>
          )}

          {mode === 'login' && (
            <div className="mb-8 flex w-full justify-end">
              <button
                type="button"
                onClick={() => setShowForgotPassword(true)}
                className="inline-flex min-h-[44px] touch-manipulation items-center rounded-sm px-2 text-sm font-medium text-primary transition-colors hover:text-primary/80"
              >
                Forgot password?
              </button>
            </div>
          )}

          {mode === 'signup' && <div className="mb-8" />}

          <button
            type="submit"
            className="flex h-14 w-full items-center justify-center gap-2 rounded-sm bg-primary text-lg font-bold text-on-accent shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={
              isLoading ||
              (mode === 'signup' && (password !== confirmPassword || password.length < 6))
            }
          >
            {isLoading ? (
              <>
                <div className="h-5 w-5 animate-spin rounded-sm border-2 border-white border-t-transparent"></div>
                <span>{mode === 'login' ? 'Logging in...' : 'Creating account...'}</span>
              </>
            ) : (
              <>
                <span>{mode === 'login' ? 'Login' : 'Create account'}</span>
                <ArrowRightIcon />
              </>
            )}
          </button>

          <p className="mt-6 text-center text-xs text-muted/60">Connected to Supabase</p>
        </form>

        <div className="mt-8 flex flex-col items-center gap-2">
          <div className="flex items-center gap-1">
            <p className="text-sm text-muted">
              {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}
            </p>
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'login' ? 'signup' : 'login');
                setSignUpSuccessMessage(null);
              }}
              className="inline-flex min-h-[44px] touch-manipulation items-center rounded-sm px-2 text-sm font-bold text-primary hover:underline"
            >
              {mode === 'login' ? 'Sign up' : 'Log in'}
            </button>
          </div>
          {mode === 'login' && (
            <button
              type="button"
              onClick={() => setShowContactAdmin(true)}
              className="inline-flex min-h-[44px] touch-manipulation items-center rounded-sm px-2 text-xs text-muted hover:text-primary"
            >
              Contact Admin
            </button>
          )}
        </div>

        {/* Forgot Password Modal */}
        {showForgotPassword && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-md border border-line bg-background-dark p-4 shadow-2xl">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-xl font-bold text-white">Reset Password</h3>
                <button
                  type="button"
                  onClick={() => {
                    setShowForgotPassword(false);
                    setResetSent(false);
                    setResetError(null);
                    setResetEmail('');
                  }}
                  className="flex size-11 touch-manipulation items-center justify-center rounded-sm text-muted transition-colors hover:bg-white/10 hover:text-white"
                >
                  <CloseIcon />
                </button>
              </div>

              {resetSent ? (
                <div className="py-8 text-center">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-sm bg-primary/20">
                    <MailIcon size={28} className="text-primary" />
                  </div>
                  <h4 className="mb-2 text-lg font-bold text-white">Check your email</h4>
                  <p className="mb-4 text-sm text-muted">
                    {onResetPassword
                      ? "If an account exists for that email, we've sent a link to reset your password."
                      : 'Password reset is managed by your administrator. Please contact your admin or use "Contact Admin" on the login screen.'}
                  </p>
                  <button
                    onClick={() => {
                      setShowForgotPassword(false);
                      setResetSent(false);
                      setResetError(null);
                      setResetEmail('');
                    }}
                    className="mt-6 rounded-sm bg-white/10 px-6 py-3 font-medium text-white transition-colors hover:bg-white/20"
                  >
                    Got it
                  </button>
                </div>
              ) : (
                <form onSubmit={handleForgotPassword} method="post" action="#" autoComplete="on">
                  {resetError && (
                    <div className="mb-4 rounded-sm border border-red-500/30 bg-red-500/20 p-3">
                      <p className="text-center text-sm text-red-400">{resetError}</p>
                    </div>
                  )}
                  <p className="mb-4 text-sm text-muted">
                    Enter your email address and we'll send you a link to reset your password.
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
                      className="h-14 w-full rounded-sm border border-line bg-surface-2 px-4 text-white placeholder:text-subtle"
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
                      className="h-12 flex-1 rounded-sm bg-primary font-bold text-on-accent transition-colors hover:bg-primary/90"
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
            <div className="w-full max-w-md rounded-md border border-line bg-background-dark p-4 shadow-2xl">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-xl font-bold text-white">Contact Administrator</h3>
                <button
                  type="button"
                  onClick={() => {
                    setShowContactAdmin(false);
                    setContactSent(false);
                    setContactMessage('');
                  }}
                  className="flex size-11 touch-manipulation items-center justify-center rounded-sm text-muted transition-colors hover:bg-white/10 hover:text-white"
                >
                  <CloseIcon />
                </button>
              </div>

              {contactSent ? (
                <div className="py-8 text-center">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-sm bg-primary/20">
                    <SupportIcon size={28} className="text-primary" />
                  </div>
                  <h4 className="mb-2 text-lg font-bold text-white">Contact Your Administrator</h4>
                  <p className="mb-4 text-sm text-muted">
                    New accounts must be created by a system administrator.
                  </p>
                  <p className="text-sm text-muted">
                    Please speak with your supervisor or IT department to request access to
                    WorkTrack Pro.
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
                  <p className="mb-4 text-sm text-muted">
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
                      className="h-12 w-full rounded-sm border border-line bg-surface-2 px-4 text-white placeholder:text-subtle"
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
                      className="h-12 w-full rounded-sm border border-line bg-surface-2 px-4 text-white placeholder:text-subtle"
                      placeholder="John Doe"
                      required
                    />
                  </div>

                  <div className="mb-4 flex flex-col">
                    <label
                      className="pb-2 text-sm font-medium text-white"
                      htmlFor="contact-message"
                    >
                      Message (Optional)
                    </label>
                    <textarea
                      id="contact-message"
                      name="message"
                      autoComplete="off"
                      className="h-24 w-full resize-none rounded-sm border border-line bg-surface-2 p-4 text-white placeholder:text-subtle"
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
                      className="h-12 flex-1 rounded-sm bg-primary font-bold text-on-accent transition-colors hover:bg-primary/90"
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
    </div>
  );
};

export default Login;
