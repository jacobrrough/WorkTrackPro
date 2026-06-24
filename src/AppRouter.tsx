// AppShell is provided by App.tsx — do NOT add AppShell inside any route wrapper.
import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { Routes, Route, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useApp } from './AppContext';
import ErrorBoundary from './ErrorBoundary';
import { useAppNavigate } from './hooks/useAppNavigate';
import { useInAppBack } from './hooks/useInAppBack';
import { useClockInByCode } from './hooks/useClockInByCode';
import { useNavigation } from './contexts/NavigationContext';
import { AdminGuard } from './components/AdminGuard';
import BottomNavigation from './BottomNavigation';
import { jobService, inventoryService } from './pocketbase';
import type { Job, ViewState } from './core/types';
import { lazyWithRetry } from './lib/lazyWithRetry';
import { ACCOUNTING_BUILD_ENABLED } from './lib/featureFlags';

const Dashboard = lazyWithRetry(() => import('./Dashboard'), 'Dashboard');
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
const ProjectHours = lazyWithRetry(() => import('./features/time/ProjectHours'), 'ProjectHours');
const AdminSettings = lazyWithRetry(
  () => import('./features/admin/AdminSettings'),
  'AdminSettings'
);
const TrelloImport = lazyWithRetry(() => import('./TrelloImport'), 'TrelloImport');
const ScannerScreen = lazyWithRetry(() => import('./ScannerScreen'), 'ScannerScreen');
const BoardList = lazyWithRetry(() => import('./features/boards/BoardList'), 'BoardList');
const BoardView = lazyWithRetry(() => import('./features/boards/BoardView'), 'BoardView');
const CardDetailView = lazyWithRetry(
  () => import('./features/boards/CardDetailView'),
  'CardDetailView'
);
const ChatView = lazyWithRetry(() => import('./features/chat/ChatView'), 'ChatView');
const NotificationSettingsView = lazyWithRetry(
  () => import('./features/notifications/NotificationSettingsView'),
  'NotificationSettingsView'
);
const AppearanceSettingsView = lazyWithRetry(
  () => import('./features/settings/AppearanceSettingsView'),
  'AppearanceSettingsView'
);

// WorkTrackAccounting — single lazy entry, gated by the build-time flag. When the
// flag is off this is null and the import() sits in a dead ternary branch, so Rollup
// excludes the entire accounting module (and all its chunks) from the build.
const AccountingRouter = ACCOUNTING_BUILD_ENABLED
  ? lazyWithRetry(() => import('./features/accounting/AccountingRouter'), 'AccountingRouter')
  : null;

// ─── Shared not-found fallback ───────────────────────────────────────────────

function NotFound({
  message,
  description,
  onBack,
}: {
  message: string;
  description?: string;
  onBack: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background-dark p-4 text-center">
      <p className="text-muted">{message}</p>
      {description && <p className="max-w-sm text-xs text-subtle">{description}</p>}
      <button
        type="button"
        onClick={onBack}
        className="rounded-sm bg-primary px-4 py-2 font-bold text-on-accent"
      >
        Back to Home
      </button>
    </div>
  );
}

// ─── Per-route error isolation ───────────────────────────────────────────────
// Wraps a single route element in its own ErrorBoundary so a crash in one feature
// (e.g. JobDetail) shows a scoped fallback while the rest of the app — the nav and
// every other route — keeps working. The top-level boundary in App.tsx remains as a
// final safety net for anything thrown outside a route (e.g. AppShell providers).

function RouteFallback() {
  // Full reload from the home route is the safest recovery: it remounts the app and
  // clears whatever transient state crashed the route, without trapping the user here.
  return (
    <NotFound
      message="This page hit an unexpected error."
      description="The rest of the app is still available. Go back home, or reload to try again."
      onBack={() => window.location.assign('/app')}
    />
  );
}

function RouteErrorBoundary({ children }: { children: ReactNode }) {
  return <ErrorBoundary fallback={<RouteFallback />}>{children}</ErrorBoundary>;
}

// ─── Shared inventory props ───────────────────────────────────────────────────
// Avoids duplicating the 12-prop destructure across InventoryRoute and InventoryDetailRoute.

function useInventoryRouteProps() {
  const {
    inventory,
    jobs,
    dataPending,
    updateInventoryStock,
    updateInventoryItem,
    createInventory,
    markInventoryOrdered,
    receiveInventoryOrder,
    addInventoryAttachment,
    deleteInventoryAttachment,
    refreshInventory,
    currentUser,
    calculateAvailable,
    calculateAllocated,
    allocateInventoryToJob,
    setInventoryImage,
    clearInventoryImage,
  } = useApp();
  return {
    inventory,
    jobs,
    isLoading: dataPending,
    isAdmin: currentUser?.isAdmin ?? false,
    onUpdateStock: updateInventoryStock,
    onUpdateItem: updateInventoryItem,
    onCreateItem: createInventory,
    onMarkOrdered: markInventoryOrdered,
    onReceiveOrder: receiveInventoryOrder,
    onAddAttachment: addInventoryAttachment,
    onDeleteAttachment: deleteInventoryAttachment,
    onReloadInventory: refreshInventory,
    calculateAvailable,
    calculateAllocated,
    onAllocateToJob: allocateInventoryToJob,
    onSetImage: setInventoryImage,
    onRemoveImage: clearInventoryImage,
  };
}

// ─── Route wrappers ──────────────────────────────────────────────────────────

function DashboardRoute() {
  const appNavigate = useAppNavigate();
  return (
    <>
      <Dashboard onNavigate={appNavigate} />
      <BottomNavigation />
    </>
  );
}

function JobDetailRoute() {
  const { jobId } = useParams<{ jobId: string }>();
  const appNavigate = useAppNavigate();
  const back = useInAppBack('/app');
  const queryClient = useQueryClient();
  const {
    jobs,
    activeShift,
    clockIn,
    clockOut,
    inventory,
    shifts,
    addJobComment,
    addJobInventory,
    removeJobInventory,
    updateJob,
    deleteJob,
    refreshJob,
    currentUser,
    addAttachment,
    deleteAttachment,
    updateAttachmentAdminOnly,
    calculateAvailable,
  } = useApp();

  const { data: detailJob, isPending } = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => jobService.getJobById(jobId!),
    enabled: !!jobId,
    staleTime: 2 * 60 * 1000,
  });

  const navigation = useNavigation();

  useEffect(() => {
    if (detailJob && jobId) {
      queryClient.setQueryData<Job[]>(['jobs'], (prev) =>
        prev ? prev.map((j) => (j.id === jobId ? detailJob : j)) : [detailJob]
      );
      // Polish for deep links: arriving directly via URL or notification
      // - Updates "last viewed job" for Dashboard resume features.
      // - Clears stale job list search/filters so the user sees a clean state.
      navigation.updateState({
        lastViewedJobId: jobId,
        searchTerm: '', // clear list search on direct detail arrival
      });
    }
    // navigation.updateState is a stable useCallback([]); depending on the whole
    // `navigation` value-object (a fresh literal each render) is what caused the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailJob, jobId, queryClient, navigation.updateState]);

  const job = detailJob ?? jobs.find((j) => j.id === jobId);
  if (isPending && !job) {
    // Better UX for direct deep links: show lightweight loading instead of blank screen
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-background-dark">
        <div className="text-muted">Loading job…</div>
      </div>
    );
  }
  if (!job) {
    return (
      <NotFound
        message="Job not found."
        description="The job may have been deleted, completed, or you may no longer have access."
        onBack={back}
      />
    );
  }

  return (
    <JobDetail
      job={job}
      onNavigate={appNavigate}
      onBack={back}
      isClockedIn={activeShift?.job === job.id}
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
      onDeleteJob={deleteJob}
      onReloadJob={() => refreshJob(job.id)}
      currentUser={currentUser!}
      onAddAttachment={addAttachment}
      onDeleteAttachment={deleteAttachment}
      onUpdateAttachmentAdminOnly={updateAttachmentAdminOnly}
      calculateAvailable={calculateAvailable}
    />
  );
}

function ClockInRoute() {
  const appNavigate = useAppNavigate();
  const back = useInAppBack('/app');
  const { activeShift, activeJob, clockOut } = useApp();
  const onClockInByCode = useClockInByCode();
  return (
    <>
      <ClockInScreen
        onNavigate={appNavigate}
        onBack={back}
        onClockInByCode={onClockInByCode}
        activeShift={activeShift}
        activeJob={activeJob}
        onClockOut={clockOut}
      />
      <BottomNavigation />
    </>
  );
}

function ScannerRoute() {
  const appNavigate = useAppNavigate();
  const back = useInAppBack('/app');
  const { jobs, inventory, updateJob, updateInventoryItem, refreshJobs, refreshInventory } =
    useApp();
  // All outgoing navigation from the scanner replaces the scanner history entry
  // so it never sits in the middle of the stack. Without this, scanning a job
  // pushes /app/jobs/123 on top of /app/scanner — pressing back from the job
  // returns to the scanner instead of wherever the user came from.
  const navigateFromScanner = useCallback(
    (view: ViewState, id?: string) => appNavigate(view, id, { replace: true }),
    [appNavigate]
  );
  return (
    <ScannerScreen
      jobs={jobs}
      inventory={inventory}
      onNavigate={navigateFromScanner}
      onBack={back}
      onUpdateJob={updateJob}
      onUpdateInventoryItem={updateInventoryItem}
      onRefreshJobs={refreshJobs}
      onRefreshInventory={refreshInventory}
    />
  );
}

function InventoryRoute() {
  const appNavigate = useAppNavigate();
  const props = useInventoryRouteProps();
  return (
    <>
      <Inventory {...props} onNavigate={appNavigate} />
      <BottomNavigation />
    </>
  );
}

function InventoryDetailRoute() {
  const { itemId } = useParams<{ itemId: string }>();
  const appNavigate = useAppNavigate();
  const back = useInAppBack('/app/inventory');
  const props = useInventoryRouteProps();

  const { isPending } = useQuery({
    queryKey: ['inventory-item', itemId],
    queryFn: () => inventoryService.getByIds([itemId!]).then((r) => r[0] ?? null),
    enabled: !!itemId,
    staleTime: 2 * 60 * 1000,
  });

  const item = props.inventory.find((i) => i.id === itemId);
  if (isPending && !item) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-background-dark">
        <div className="text-muted">Loading item…</div>
      </div>
    );
  }
  if (!item) {
    return (
      <NotFound
        message="Item not found."
        description="The inventory item may have been deleted or you may no longer have access."
        onBack={back}
      />
    );
  }
  return (
    <>
      <Inventory
        {...props}
        onNavigate={appNavigate}
        initialItemId={itemId}
        onBackFromDetail={back}
      />
      <BottomNavigation />
    </>
  );
}

// Shared KanbanBoard route — only boardType differs between shop and admin
function KanbanBoardRoute({ boardType }: { boardType: 'shopFloor' | 'admin' }) {
  const appNavigate = useAppNavigate();
  const {
    jobs,
    shifts,
    dataPending,
    deleteJob,
    deleteAttachment,
    currentUser,
    updateJobStatus,
    updateJob,
  } = useApp();
  const isAdmin = currentUser?.isAdmin ?? false;
  return (
    <>
      <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-background-dark">
        <KanbanBoard
          jobs={jobs}
          shifts={shifts}
          isLoading={dataPending}
          onNavigate={appNavigate}
          onCreateJob={() => appNavigate('create-job')}
          onDeleteJob={deleteJob}
          onDeleteAttachment={deleteAttachment}
          boardType={boardType}
          isAdmin={isAdmin}
          currentUser={currentUser!}
          onUpdateJobStatus={updateJobStatus}
          onUpdateJob={updateJob}
        />
      </div>
      <BottomNavigation />
    </>
  );
}

function BoardsRoute() {
  const appNavigate = useAppNavigate();
  return <BoardList onNavigate={appNavigate} />;
}

function BoardDetailRoute() {
  const { boardId } = useParams<{ boardId: string }>();
  const appNavigate = useAppNavigate();
  const back = useInAppBack('/app/boards');
  return <BoardView boardId={boardId!} onNavigate={appNavigate} onBack={back} />;
}

function BoardCardDetailRoute() {
  const { boardId, cardId } = useParams<{ boardId: string; cardId: string }>();
  const appNavigate = useAppNavigate();
  const back = useInAppBack(boardId ? `/app/boards/${boardId}` : '/app/boards');
  if (!boardId || !cardId) {
    return (
      <NotFound
        message="Card not found."
        description="The card may have been deleted, moved, or you may no longer have access."
        onBack={back}
      />
    );
  }
  return (
    <CardDetailView boardId={boardId} cardId={cardId} onNavigate={appNavigate} onBack={back} />
  );
}

function PartsRoute() {
  const appNavigate = useAppNavigate();
  const { jobs, currentUser } = useApp();
  return (
    <Parts
      jobs={jobs}
      currentUser={currentUser!}
      onNavigate={appNavigate}
      onNavigateBack={() => appNavigate('dashboard')}
    />
  );
}

function PartDetailRoute() {
  const { partId } = useParams<{ partId: string }>();
  const appNavigate = useAppNavigate();
  const back = useInAppBack('/app/parts');
  const { jobs, shifts } = useApp();
  return (
    <PartDetail
      partId={partId!}
      jobs={jobs}
      shifts={shifts}
      onNavigate={appNavigate}
      onNavigateBack={back}
    />
  );
}

function CreateJobRoute() {
  const appNavigate = useAppNavigate();
  const { createJob, users, currentUser, jobs, shifts } = useApp();
  const existingJobCodes = useMemo(() => jobs.map((j) => j.jobCode), [jobs]);
  return (
    <AdminCreateJob
      onCreate={createJob}
      onNavigate={appNavigate}
      users={users}
      existingJobCodes={existingJobCodes}
      currentUser={currentUser!}
      jobs={jobs}
      shifts={shifts}
    />
  );
}

function QuotesRoute() {
  const appNavigate = useAppNavigate();
  const back = useInAppBack('/app');
  const { jobs, inventory, shifts, currentUser } = useApp();
  return (
    <Quotes
      jobs={jobs}
      inventory={inventory}
      shifts={shifts}
      currentUser={currentUser!}
      onNavigate={appNavigate}
      onBack={back}
    />
  );
}

function TimeReportsRoute() {
  const appNavigate = useAppNavigate();
  const back = useInAppBack('/app');
  const [searchParams] = useSearchParams();
  const initialJobId = searchParams.get('job') ?? undefined;
  const { shifts, users, jobs, currentUser, refreshShifts } = useApp();
  return (
    <TimeReports
      shifts={shifts}
      users={users}
      jobs={jobs}
      currentUser={currentUser!}
      onNavigate={appNavigate}
      onBack={back}
      onRefreshShifts={refreshShifts}
      initialJobId={initialJobId}
      readOnly={!currentUser?.isAdmin}
    />
  );
}

function ProjectHoursRoute() {
  const back = useInAppBack('/app');
  return <ProjectHours onBack={back} />;
}

function CalendarRoute() {
  const appNavigate = useAppNavigate();
  const back = useInAppBack('/app');
  const { jobs, shifts, currentUser, refreshJobs, refreshShifts, updateJob } = useApp();
  return (
    <Calendar
      jobs={jobs}
      shifts={shifts}
      currentUser={currentUser!}
      onNavigate={appNavigate}
      onBack={back}
      refreshJobs={refreshJobs}
      refreshShifts={refreshShifts}
      onUpdateJob={updateJob}
    />
  );
}

function AdminSettingsRoute() {
  const appNavigate = useAppNavigate();
  const back = useInAppBack('/app');
  return <AdminSettings onNavigate={appNavigate} onBack={back} />;
}

function TrelloImportRoute() {
  const appNavigate = useAppNavigate();
  const { refreshJobs } = useApp();
  return (
    <div className="flex min-h-screen flex-col bg-background-dark">
      <header className="sticky top-0 z-50 flex items-center justify-between border-b border-white/10 bg-background-dark/95 px-4 py-3 backdrop-blur-md">
        <button
          type="button"
          onClick={() => appNavigate('dashboard')}
          className="flex size-10 items-center justify-center rounded-sm text-muted hover:bg-white/10 hover:text-white"
        >
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <h1 className="text-lg font-bold text-white">Import Trello</h1>
        <div className="size-10" />
      </header>
      <main className="flex-1 overflow-y-auto p-4">
        <TrelloImport
          onClose={() => appNavigate('dashboard')}
          onImportComplete={() => {
            refreshJobs();
            appNavigate('dashboard');
          }}
        />
      </main>
    </div>
  );
}

function ChatRoute() {
  const appNavigate = useAppNavigate();
  const back = useInAppBack('/app');
  return <ChatView onNavigate={appNavigate} onBack={back} />;
}

function ChatConversationRoute() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const appNavigate = useAppNavigate();
  const back = useInAppBack('/app/chat');
  return <ChatView conversationId={conversationId} onNavigate={appNavigate} onBack={back} />;
}

function NotificationSettingsRoute() {
  const appNavigate = useAppNavigate();
  const back = useInAppBack('/app');
  return <NotificationSettingsView onNavigate={appNavigate} onBack={back} />;
}

function AppearanceSettingsRoute() {
  const back = useInAppBack('/app');
  return <AppearanceSettingsView onBack={back} />;
}

// ─── Router root ─────────────────────────────────────────────────────────────

export function AppRouter() {
  return (
    <Routes>
      <Route
        path="/app"
        element={
          <RouteErrorBoundary>
            <DashboardRoute />
          </RouteErrorBoundary>
        }
      />
      <Route
        path="/app/jobs/new"
        element={
          <AdminGuard>
            <RouteErrorBoundary>
              <CreateJobRoute />
            </RouteErrorBoundary>
          </AdminGuard>
        }
      />
      <Route
        path="/app/jobs/:jobId"
        element={
          <RouteErrorBoundary>
            <JobDetailRoute />
          </RouteErrorBoundary>
        }
      />
      <Route
        path="/app/clock-in"
        element={
          <RouteErrorBoundary>
            <ClockInRoute />
          </RouteErrorBoundary>
        }
      />
      <Route
        path="/app/scanner"
        element={
          <RouteErrorBoundary>
            <ScannerRoute />
          </RouteErrorBoundary>
        }
      />
      <Route
        path="/app/inventory"
        element={
          <RouteErrorBoundary>
            <InventoryRoute />
          </RouteErrorBoundary>
        }
      />
      <Route
        path="/app/inventory/:itemId"
        element={
          <RouteErrorBoundary>
            <InventoryDetailRoute />
          </RouteErrorBoundary>
        }
      />
      <Route
        path="/app/board/shop"
        element={
          <RouteErrorBoundary>
            <KanbanBoardRoute boardType="shopFloor" />
          </RouteErrorBoundary>
        }
      />
      <Route
        path="/app/board/admin"
        element={
          <AdminGuard>
            <RouteErrorBoundary>
              <KanbanBoardRoute boardType="admin" />
            </RouteErrorBoundary>
          </AdminGuard>
        }
      />
      <Route
        path="/app/boards"
        element={
          <RouteErrorBoundary>
            <BoardsRoute />
          </RouteErrorBoundary>
        }
      />
      <Route
        path="/app/boards/:boardId"
        element={
          <RouteErrorBoundary>
            <BoardDetailRoute />
          </RouteErrorBoundary>
        }
      />
      <Route
        path="/app/boards/:boardId/cards/:cardId"
        element={
          <RouteErrorBoundary>
            <BoardCardDetailRoute />
          </RouteErrorBoundary>
        }
      />
      <Route
        path="/app/parts"
        element={
          <AdminGuard>
            <RouteErrorBoundary>
              <PartsRoute />
            </RouteErrorBoundary>
          </AdminGuard>
        }
      />
      <Route
        path="/app/parts/:partId"
        element={
          <AdminGuard>
            <RouteErrorBoundary>
              <PartDetailRoute />
            </RouteErrorBoundary>
          </AdminGuard>
        }
      />
      <Route
        path="/app/quotes"
        element={
          <AdminGuard>
            <RouteErrorBoundary>
              <QuotesRoute />
            </RouteErrorBoundary>
          </AdminGuard>
        }
      />
      <Route
        path="/app/time-reports"
        element={
          <RouteErrorBoundary>
            <TimeReportsRoute />
          </RouteErrorBoundary>
        }
      />
      <Route
        path="/app/project-hours"
        element={
          <AdminGuard>
            <RouteErrorBoundary>
              <ProjectHoursRoute />
            </RouteErrorBoundary>
          </AdminGuard>
        }
      />
      <Route
        path="/app/calendar"
        element={
          <AdminGuard>
            <RouteErrorBoundary>
              <CalendarRoute />
            </RouteErrorBoundary>
          </AdminGuard>
        }
      />
      <Route
        path="/app/settings"
        element={
          <AdminGuard>
            <RouteErrorBoundary>
              <AdminSettingsRoute />
            </RouteErrorBoundary>
          </AdminGuard>
        }
      />
      <Route
        path="/app/import"
        element={
          <AdminGuard>
            <RouteErrorBoundary>
              <TrelloImportRoute />
            </RouteErrorBoundary>
          </AdminGuard>
        }
      />
      <Route
        path="/app/chat"
        element={
          <RouteErrorBoundary>
            <ChatRoute />
          </RouteErrorBoundary>
        }
      />
      <Route
        path="/app/chat/:conversationId"
        element={
          <RouteErrorBoundary>
            <ChatConversationRoute />
          </RouteErrorBoundary>
        }
      />
      <Route
        path="/app/notifications/settings"
        element={
          <RouteErrorBoundary>
            <NotificationSettingsRoute />
          </RouteErrorBoundary>
        }
      />
      <Route
        path="/app/appearance"
        element={
          <RouteErrorBoundary>
            <AppearanceSettingsRoute />
          </RouteErrorBoundary>
        }
      />
      {/* WorkTrackAccounting — mounted only when the build-time flag is on, so the
          module is unreachable AND excluded from the build when the flag is off.
          The whole accounting subtree gets one boundary so a crash in any
          accounting view falls back without taking down the rest of the app. */}
      {AccountingRouter && (
        <Route
          path="/app/accounting/*"
          element={
            <RouteErrorBoundary>
              <AccountingRouter />
            </RouteErrorBoundary>
          }
        />
      )}
      <Route path="/app/*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
