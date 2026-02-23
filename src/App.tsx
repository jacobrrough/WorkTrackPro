import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from './AppContext';
import { NavigationProvider } from './contexts/NavigationContext';
import { SettingsProvider } from './contexts/SettingsContext';
import { ClockInProvider } from './contexts/ClockInContext';
import Login from './Login';
import { jobService } from './pocketbase';
import PublicHome from './public/PublicHome';
import { lazyWithRetry } from './lib/lazyWithRetry';

const Dashboard = lazyWithRetry(() => import('./Dashboard'), 'Dashboard');
const JobList = lazyWithRetry(() => import('./JobList'), 'JobList');
const JobDetail = lazyWithRetry(() => import('./JobDetail'), 'JobDetail');
const ClockInScreen = lazyWithRetry(() => import('./ClockInScreen'), 'ClockInScreen');
const Inventory = lazyWithRetry(() => import('./Inventory'), 'Inventory');
const KanbanBoard = lazyWithRetry(() => import('./KanbanBoard'), 'KanbanBoard');
const Parts = lazyWithRetry(() => import('./features/admin/Parts'), 'Parts');
const PartDetail = lazyWithRetry(() => import('./features/admin/PartDetail'), 'PartDetail');
const AdminCreateJob = lazyWithRetry(() => import('./AdminCreateJob'), 'AdminCreateJob');
const Quotes = lazyWithRetry(() => import('./Quotes'), 'Quotes');
const Calendar = lazyWithRetry(() => import('./features/admin/Calendar'), 'Calendar');
const TimeReports = lazyWithRetry(() => import('./TimeReports'), 'TimeReports');
const AdminSettings = lazyWithRetry(
  () => import('./features/admin/AdminSettings'),
  'AdminSettings'
);
const TrelloImport = lazyWithRetry(() => import('./TrelloImport'), 'TrelloImport');

function AppViewFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background-dark">
      <p className="text-slate-400">Loading view...</p>
    </div>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <NavigationProvider>
      <SettingsProvider>
        <ClockInProvider>
          <Suspense fallback={<AppViewFallback />}>{children}</Suspense>
        </ClockInProvider>
      </SettingsProvider>
    </NavigationProvider>
  );
}

export default function App() {
  const {
    currentUser,
    isLoading,
    authError,
    login,
    signUp,
    resetPasswordForEmail,
    jobs,
    shifts,
    users,
    inventory,
    activeShift,
    activeJob,
    clockIn,
    clockOut,
    createJob,
    updateJob,
    updateJobStatus,
    addJobComment,
    getJobByCode,
    addJobInventory,
    removeJobInventory,
    addAttachment,
    deleteAttachment,
    updateAttachmentAdminOnly,
    addInventoryAttachment,
    deleteInventoryAttachment,
    refreshJobs,
    refreshShifts,
    refreshInventory,
    calculateAvailable,
    calculateAllocated,
    createInventory,
    updateInventoryItem,
    updateInventoryStock,
    markInventoryOrdered,
    receiveInventoryOrder,
  } = useApp();

  const [view, setView] = useState<string>('dashboard');
  const [id, setId] = useState<string | undefined>(undefined);
  const [showLoadingHelp, setShowLoadingHelp] = useState(false);
  const existingJobCodes = useMemo(() => jobs.map((j) => j.jobCode), [jobs]);

  useEffect(() => {
    if (!isLoading) {
      setShowLoadingHelp(false);
      return;
    }

    const timeout = window.setTimeout(() => {
      setShowLoadingHelp(true);
    }, 10_000);

    return () => window.clearTimeout(timeout);
  }, [isLoading]);

  const handleNavigate = useCallback(
    (nextView: string, nextId?: string | { jobId?: string; partId?: string }) => {
      setView(nextView);
      if (nextId === undefined) {
        setId(undefined);
      } else if (typeof nextId === 'string') {
        setId(nextId);
      } else if (nextId && 'jobId' in nextId && nextId.jobId) {
        setId(nextId.jobId);
      } else if (nextId && 'partId' in nextId && nextId.partId) {
        setId(nextId.partId);
      } else {
        setId(undefined);
      }
    },
    []
  );

  const handleLogin = useCallback(
    async (email: string, password: string) => {
      await login(email, password);
    },
    [login]
  );

  const handleSignUp = useCallback(
    async (email: string, password: string, options?: { name?: string }) => {
      return signUp(email, password, options);
    },
    [signUp]
  );

  const onClockInByCode = useCallback(
    async (code: number): Promise<{ success: boolean; message: string }> => {
      const job = await getJobByCode(code);
      if (!job) return { success: false, message: 'Job not found' };
      const ok = await clockIn(job.id);
      return ok
        ? { success: true, message: 'Clocked in' }
        : { success: false, message: 'Failed to clock in' };
    },
    [getJobByCode, clockIn]
  );

  const isEmployeeAppPath =
    typeof window !== 'undefined'
      ? window.location.pathname === '/app' || window.location.pathname.startsWith('/app/')
      : true;

  if (!isEmployeeAppPath) {
    return <PublicHome onEmployeeLogin={() => window.location.assign('/app')} />;
  }

  if (!currentUser && !isLoading) {
    return (
      <Login
        onLogin={handleLogin}
        onSignUp={handleSignUp}
        onResetPassword={resetPasswordForEmail}
        error={authError}
        isLoading={isLoading}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background-dark">
        <div className="px-4 text-center">
          <p className="text-slate-400">Loading...</p>
          {showLoadingHelp && (
            <div className="mt-3 rounded-sm border border-primary/30 bg-primary/10 p-3 text-left">
              <p className="text-sm text-slate-200">Startup is taking longer than expected.</p>
              <p className="mt-1 text-xs text-slate-400">
                If this persists, refresh to recover from a stale cached bundle or a temporary
                network issue.
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-3 rounded-sm bg-primary px-3 py-2 text-xs font-bold text-white hover:bg-primary/90"
              >
                Retry Loading
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const isAdmin = currentUser?.isAdmin ?? false;

  if (view === 'dashboard') {
    return (
      <AppShell>
        <Dashboard onNavigate={handleNavigate} />
      </AppShell>
    );
  }

  if (view === 'job-list') {
    return (
      <AppShell>
        <JobList
          jobs={jobs}
          onNavigate={handleNavigate}
          onClockIn={clockIn}
          activeJobId={activeJob?.id}
          shifts={shifts}
          users={users}
        />
      </AppShell>
    );
  }

  if (view === 'job-detail' && id) {
    const job = jobs.find((j) => j.id === id);
    if (!job) {
      return (
        <AppShell>
          <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background-dark p-4">
            <p className="text-slate-400">Job not found.</p>
            <button
              onClick={() => handleNavigate('dashboard')}
              className="rounded-sm bg-primary px-4 py-2 font-bold text-white"
            >
              Back to Home
            </button>
          </div>
        </AppShell>
      );
    }
    const isClockedIn = activeShift?.job === job.id;
    return (
      <AppShell>
        <JobDetail
          job={job}
          onNavigate={handleNavigate}
          onBack={() => handleNavigate('dashboard')}
          isClockedIn={!!isClockedIn}
          onClockIn={() => clockIn(job.id)}
          onClockOut={clockOut}
          activeShift={activeShift}
          inventory={inventory}
          jobs={jobs}
          shifts={shifts}
          onAddComment={addJobComment}
          onAddInventory={addJobInventory}
          onRemoveInventory={removeJobInventory}
          onUpdateJob={updateJob}
          onReloadJob={async () => {
            const updated = await jobService.getJobById(job.id);
            if (updated) refreshJobs();
          }}
          currentUser={currentUser!}
          onAddAttachment={addAttachment}
          onDeleteAttachment={deleteAttachment}
          onUpdateAttachmentAdminOnly={updateAttachmentAdminOnly}
          calculateAvailable={calculateAvailable}
        />
      </AppShell>
    );
  }

  if (view === 'clock-in') {
    return (
      <AppShell>
        <ClockInScreen
          onNavigate={handleNavigate}
          onBack={() => handleNavigate('dashboard')}
          onClockInByCode={onClockInByCode}
          activeShift={activeShift}
          activeJob={activeJob}
          onClockOut={clockOut}
        />
      </AppShell>
    );
  }

  if (view === 'inventory') {
    return (
      <AppShell>
        <Inventory
          inventory={inventory}
          onNavigate={handleNavigate}
          onUpdateStock={updateInventoryStock}
          onUpdateItem={updateInventoryItem}
          onCreateItem={createInventory}
          onMarkOrdered={markInventoryOrdered}
          onReceiveOrder={receiveInventoryOrder}
          onAddAttachment={addInventoryAttachment}
          onDeleteAttachment={deleteInventoryAttachment}
          onReloadInventory={refreshInventory}
          isAdmin={isAdmin}
          calculateAvailable={calculateAvailable}
          calculateAllocated={calculateAllocated}
          initialItemId={id}
          onBackFromDetail={() => setId(undefined)}
        />
      </AppShell>
    );
  }

  if (view === 'inventory-detail' && id) {
    const item = inventory.find((i) => i.id === id);
    if (!item) {
      return (
        <AppShell>
          <div className="flex min-h-screen items-center justify-center bg-background-dark p-4">
            <p className="text-slate-400">Item not found.</p>
            <button
              onClick={() => handleNavigate('inventory')}
              className="mt-3 rounded-sm bg-primary px-4 py-2 font-bold text-white"
            >
              Back
            </button>
          </div>
        </AppShell>
      );
    }
    return (
      <AppShell>
        <Inventory
          inventory={inventory}
          onNavigate={handleNavigate}
          onUpdateStock={updateInventoryStock}
          onUpdateItem={updateInventoryItem}
          onCreateItem={createInventory}
          onMarkOrdered={markInventoryOrdered}
          onReceiveOrder={receiveInventoryOrder}
          onAddAttachment={addInventoryAttachment}
          onDeleteAttachment={deleteInventoryAttachment}
          onReloadInventory={refreshInventory}
          isAdmin={isAdmin}
          calculateAvailable={calculateAvailable}
          calculateAllocated={calculateAllocated}
          initialItemId={id}
          onBackFromDetail={() => handleNavigate('inventory')}
        />
      </AppShell>
    );
  }

  if (view === 'board-shop' || view === 'board-admin') {
    const boardType = view === 'board-admin' ? 'admin' : 'shopFloor';
    return (
      <AppShell>
        <KanbanBoard
          jobs={jobs}
          onNavigate={handleNavigate}
          onCreateJob={() => handleNavigate('create-job')}
          boardType={boardType}
          isAdmin={isAdmin}
          onUpdateJobStatus={updateJobStatus}
          onUpdateJob={updateJob}
        />
      </AppShell>
    );
  }

  if (view === 'parts') {
    return (
      <AppShell>
        <Parts
          jobs={jobs}
          currentUser={currentUser!}
          onNavigate={handleNavigate}
          onNavigateBack={() => handleNavigate('dashboard')}
        />
      </AppShell>
    );
  }

  if (view === 'part-detail' && id) {
    return (
      <AppShell>
        <PartDetail
          partId={id}
          jobs={jobs}
          shifts={shifts}
          onNavigate={handleNavigate}
          onNavigateBack={() => handleNavigate('parts')}
        />
      </AppShell>
    );
  }

  if (view === 'create-job' && currentUser) {
    return (
      <AppShell>
        <AdminCreateJob
          onCreate={createJob}
          onNavigate={handleNavigate}
          users={users}
          existingJobCodes={existingJobCodes}
          currentUser={currentUser}
          jobs={jobs}
          shifts={shifts}
        />
      </AppShell>
    );
  }

  if (view === 'quotes' && currentUser) {
    return (
      <AppShell>
        <Quotes
          jobs={jobs}
          inventory={inventory}
          shifts={shifts}
          currentUser={currentUser}
          onNavigate={handleNavigate}
          onBack={() => handleNavigate('dashboard')}
        />
      </AppShell>
    );
  }

  if (view === 'calendar' && currentUser) {
    return (
      <AppShell>
        <Calendar
          jobs={jobs}
          shifts={shifts}
          currentUser={currentUser}
          onNavigate={handleNavigate}
          onBack={() => handleNavigate('dashboard')}
        />
      </AppShell>
    );
  }

  if (view === 'time-reports' && currentUser) {
    return (
      <AppShell>
        <TimeReports
          shifts={shifts}
          users={users}
          jobs={jobs}
          currentUser={currentUser}
          onNavigate={handleNavigate}
          onBack={() => handleNavigate('dashboard')}
          onRefreshShifts={refreshShifts}
        />
      </AppShell>
    );
  }

  if (view === 'admin-settings') {
    return (
      <AppShell>
        <AdminSettings onNavigate={handleNavigate} onBack={() => handleNavigate('dashboard')} />
      </AppShell>
    );
  }

  if (view === 'trello-import') {
    return (
      <AppShell>
        <div className="flex min-h-screen flex-col bg-background-dark">
          <header className="sticky top-0 z-50 flex items-center justify-between border-b border-white/10 bg-background-dark/95 px-4 py-3 backdrop-blur-md">
            <button
              type="button"
              onClick={() => handleNavigate('dashboard')}
              className="flex size-10 items-center justify-center rounded-sm text-slate-400 hover:bg-white/10 hover:text-white"
            >
              <span className="material-symbols-outlined">arrow_back</span>
            </button>
            <h1 className="text-lg font-bold text-white">Import Trello</h1>
            <div className="size-10" />
          </header>
          <main className="flex-1 overflow-y-auto p-4">
            <TrelloImport
              onClose={() => handleNavigate('dashboard')}
              onImportComplete={() => {
                refreshJobs();
                handleNavigate('dashboard');
              }}
            />
          </main>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Dashboard onNavigate={handleNavigate} />
    </AppShell>
  );
}
