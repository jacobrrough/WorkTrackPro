import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(_error: Error): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex min-h-screen items-center justify-center bg-background-dark p-4">
          <div className="w-full max-w-lg rounded-sm border border-red-500/20 bg-[#1a1625] p-4">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex size-12 items-center justify-center rounded-sm bg-red-500/20">
                <span className="material-symbols-outlined text-2xl text-red-500">error</span>
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Something went wrong</h2>
                <p className="text-sm text-slate-400">The application encountered an error</p>
              </div>
            </div>

            {this.state.error && (
              <div className="mb-4 rounded-sm border border-red-500/20 bg-red-500/10 p-4">
                {this.state.error.message &&
                (this.state.error.message.includes('supabaseUrl') ||
                  this.state.error.message.includes('Supabase') ||
                  this.state.error.message.includes('VITE_SUPABASE')) ? (
                  <>
                    <p className="mb-2 font-medium text-amber-400">
                      Supabase not configured correctly
                    </p>
                    <p className="text-sm text-slate-300">
                      Set <code className="rounded bg-black/30 px-1">VITE_SUPABASE_URL</code> and{' '}
                      <code className="rounded bg-black/30 px-1">VITE_SUPABASE_ANON_KEY</code> in
                      your Netlify site environment variables, then redeploy. Use your project URL
                      (e.g. https://xxxx.supabase.co) and anon key from the Supabase dashboard.
                    </p>
                  </>
                ) : (
                  <p className="break-all font-mono text-sm text-red-400">
                    {this.state.error.toString()}
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => window.location.reload()}
                className="flex-1 rounded-sm bg-primary px-4 py-3 font-medium text-white transition-colors hover:bg-primary/90"
              >
                Reload App
              </button>
              <button
                onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
                className="flex-1 rounded-sm bg-slate-700 px-4 py-3 font-medium text-white transition-colors hover:bg-slate-600"
              >
                Try Again
              </button>
            </div>

            {process.env.NODE_ENV === 'development' && this.state.errorInfo && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm text-slate-400 hover:text-slate-300">
                  View Error Details
                </summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded bg-black/30 p-2 text-xs text-slate-500">
                  {this.state.errorInfo.componentStack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
