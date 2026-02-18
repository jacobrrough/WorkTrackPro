import React, { useState, useCallback, useMemo } from 'react';
import { useApp } from './AppContext';
import { NavigationProvider } from './contexts/NavigationContext';
import { SettingsProvider } from './contexts/SettingsContext';
import Login from './Login';
import Dashboard from './Dashboard';
import JobList from './JobList';
import JobDetail from './JobDetail';
import ClockInScreen from './ClockInScreen';
import Inventory from './Inventory';
import AdminConsole from './AdminConsole';
import KanbanBoard from './KanbanBoard';
import Parts from './Parts';
import AdminCreateJob from './AdminCreateJob';
import Quotes from './Quotes';
import Calendar from './features/admin/Calendar';
import TimeReports from './TimeReports';
import CompletedJobs from './features/admin/CompletedJobs';
import AdminSettings from './features/admin/AdminSettings';
import TrelloImport from './TrelloImport';
import { jobService } from './pocketbase';

function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <NavigationProvider>
      <SettingsProvider>
        {children}
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
    refreshJobs,
    refreshShifts,
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
  const existingJobCodes = useMemo(() => jobs.map((j) => j.jobCode), [jobs]);

  const handleNavigate = useCallback((nextView: string, nextId?: string | { jobId?: string; partId?: string }) => {
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
  }, []);

  const handleLogin = useCallback(
    async (email: string, password: string) => {
      await login(email, password);
    },
    [login]
  );

  const onClockInByCode = useCallback(
    async (code: number): Promise<{ success: boolean; message: string }> => {
      const job = await getJobByCode(code);
      if (!job) return { success: false, message: 'Job not found' };
      const ok = await clockIn(job.id);
      return ok ? { success: true, message: 'Clocked in' } : { success: false, message: 'Failed to clock in' };
    },
    [getJobByCode, clockIn]
  );

  if (!currentUser && !isLoading) {
    return (
      <Login
        onLogin={handleLogin}
        error={authError}
        isLoading={isLoading}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background-dark">
        <p className="text-slate-400">Loading...</p>
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
          isAdmin={isAdmin}
          calculateAvailable={calculateAvailable}
          calculateAllocated={calculateAllocated}
          initialItemId={id}
          onBackFromDetail={() => handleNavigate('inventory')}
        />
      </AppShell>
    );
  }

  if (view === 'admin') {
    return (
      <AppShell>
        <AdminConsole
          jobs={jobs}
          shifts={shifts}
          users={users}
          onNavigate={handleNavigate}
          onUpdateJobStatus={updateJobStatus}
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
        />
      </AppShell>
    );
  }

  if (view === 'parts' || view === 'part-detail') {
    return (
      <AppShell>
        <Parts
          onNavigate={handleNavigate}
          onBack={() => handleNavigate(isAdmin ? 'admin' : 'dashboard')}
          initialPartId={id}
          isAdmin={isAdmin}
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

  if (view === 'completed-jobs' && currentUser) {
    return (
      <AppShell>
        <CompletedJobs
          jobs={jobs}
          currentUser={currentUser}
          onNavigate={handleNavigate}
          onBack={() => handleNavigate('dashboard')}
        />
      </AppShell>
    );
  }

  if (view === 'admin-settings') {
    return (
      <AppShell>
        <AdminSettings
          onNavigate={handleNavigate}
          onBack={() => handleNavigate('dashboard')}
        />
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
