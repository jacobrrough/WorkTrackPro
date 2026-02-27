import React, { useCallback, useState } from 'react';
import { ViewState, Shift, Job } from '@/core/types';
import { useClockIn } from '@/contexts/ClockInContext';
import { useToast } from './Toast';

interface ClockInScreenProps {
  onNavigate: (view: ViewState) => void;
  onBack?: () => void;
  onClockInByCode: (code: number) => Promise<{ success: boolean; message: string }>;
  activeShift: Shift | null;
  activeJob: Job | null;
  onClockOut: () => void;
}

const ClockInScreen: React.FC<ClockInScreenProps> = ({
  onNavigate,
  onBack,
  onClockInByCode,
  activeShift,
  activeJob,
  onClockOut,
}) => {
  const clockInCtx = useClockIn();
  const { showToast } = useToast();
  const effectiveOnClockInByCode = useCallback(
    (code: number) => (clockInCtx?.onClockInByCode ?? onClockInByCode)(code),
    [clockInCtx, onClockInByCode]
  );
  const [jobCode, setJobCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleNumberClick = (num: string) => {
    if (jobCode.length < 6) {
      setJobCode(jobCode + num);
      setResult(null);
    }
  };

  const handleBackspace = () => {
    setJobCode(jobCode.slice(0, -1));
    setResult(null);
  };

  const handleClear = () => {
    setJobCode('');
    setResult(null);
  };

  const handleSubmit = async () => {
    if (!jobCode.trim()) return;

    setIsLoading(true);
    setResult(null);

    const code = parseInt(jobCode, 10);
    if (isNaN(code)) {
      setResult({ success: false, message: 'Invalid code' });
      setIsLoading(false);
      return;
    }

    const res = await effectiveOnClockInByCode(code);
    setResult(res);
    setIsLoading(false);
    if (res.success) {
      setJobCode('');
      setTimeout(() => onNavigate('dashboard'), 1000);
    } else if (typeof navigator !== 'undefined' && !navigator.onLine) {
      showToast('Clocked in offline — will sync when connected', 'warning');
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background-dark">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-white/10 bg-background-dark p-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack || (() => onNavigate('dashboard'))}
            className="flex size-10 items-center justify-center text-slate-400 hover:text-white"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <div>
            <h1 className="text-lg font-bold text-white">Clock In by Code</h1>
            <p className="text-xs text-slate-400">Enter your job code</p>
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center p-4">
        {/* Active Job Alert */}
        {activeShift && activeJob && (
          <div className="mb-4 w-full max-w-sm rounded-sm border border-green-500/30 bg-green-500/10 p-3">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-green-500">info</span>
              <div className="flex-1">
                <p className="font-semibold text-white">Currently clocked in</p>
                <p className="text-sm text-green-400">
                  {activeJob.name} (#{activeJob.jobCode})
                </p>
              </div>
              <button
                onClick={onClockOut}
                className="rounded-sm bg-red-500 px-4 py-2 text-sm font-bold text-white hover:bg-red-600"
              >
                Clock Out
              </button>
            </div>
          </div>
        )}

        {/* Code Display */}
        <div className="mb-4 w-full max-w-sm">
          <div className="rounded-sm border-2 border-primary/30 bg-card-dark p-4 text-center">
            <p className="mb-2 text-sm text-slate-400">Job Code</p>
            <div className="flex h-16 items-center justify-center text-5xl font-bold tracking-widest text-white">
              {jobCode || '----'}
            </div>
          </div>
        </div>

        {/* Result Message */}
        {result && (
          <div
            className={`mb-4 w-full max-w-sm rounded-sm p-3 ${result.success ? 'border border-green-500/30 bg-green-500/10' : 'border border-red-500/30 bg-red-500/10'}`}
          >
            <p
              className={`text-center font-semibold ${result.success ? 'text-green-400' : 'text-red-400'}`}
            >
              {result.message}
            </p>
          </div>
        )}

        {/* Number Pad */}
        <div className="w-full max-w-sm">
          <div className="mb-3 grid grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
              <button
                key={num}
                onClick={() => handleNumberClick(num.toString())}
                className="h-16 rounded-sm border border-white/10 bg-card-dark text-2xl font-bold text-white transition-all hover:bg-primary/20 active:scale-95"
              >
                {num}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <button
              onClick={handleClear}
              className="h-16 rounded-sm border border-white/10 bg-card-dark font-bold text-red-400 transition-all hover:bg-red-500/20 active:scale-95"
            >
              Clear
            </button>
            <button
              onClick={() => handleNumberClick('0')}
              className="h-16 rounded-sm border border-white/10 bg-card-dark text-2xl font-bold text-white transition-all hover:bg-primary/20 active:scale-95"
            >
              0
            </button>
            <button
              onClick={handleBackspace}
              className="flex h-16 items-center justify-center rounded-sm border border-white/10 bg-card-dark text-orange-400 transition-all hover:bg-orange-500/20 active:scale-95"
            >
              <span className="material-symbols-outlined text-3xl">backspace</span>
            </button>
          </div>

          {/* Submit Button - large on mobile for shop floor */}
          <button
            onClick={handleSubmit}
            disabled={!jobCode || isLoading}
            className="mt-6 flex h-24 min-h-24 w-full items-center justify-center gap-2 rounded-sm bg-primary py-3 text-lg font-bold text-white transition-all hover:bg-primary/90 active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500 md:h-14 md:min-h-0"
          >
            {isLoading ? (
              <>
                <div className="h-5 w-5 animate-spin rounded-sm border-2 border-white border-t-transparent"></div>
                <span>Clocking In...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined">login</span>
                <span>Clock In</span>
              </>
            )}
          </button>
        </div>
      </main>
    </div>
  );
};

export default ClockInScreen;
