import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ViewState, Job, JobStatus } from '@/core/types';
import { useApp } from './AppContext';
import { useToast } from './Toast';
import { LoadingSpinner } from './Loading';
import { Login, Landing } from '@/features/auth';
import { Dashboard } from '@/features/dashboard';
import { JobDetail, KanbanBoard, AdminCreateJob } from '@/features/jobs';
import { Inventory, NeedsOrdering } from '@/features/inventory';
import { AdminConsole } from '@/features/admin';
import CompletedJobs from '@/features/admin/CompletedJobs';
import Calendar from '@/features/admin/Calendar';
import { TimeReports, ClockInScreen } from '@/features/time';
import { Quotes } from '@/features/quotes';
import { BottomNavigation } from './BottomNavigation';
import { SkipLink } from './components/SkipLink';
import { jobService } from './pocketbase';
import { getPath, getViewFromPath } from '@/core/routes';

const App: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    currentUser,
    isLoading,
    authError,
    users,
    jobs,
    shifts,
    inventory,
    login,
    logout,
    createJob,
    updateJobStatus,
    updateJob,
    addJobComment,
    addJobInventory,
    removeJobInventory,
    getJobByCode,
    clockIn,
    clockOut,
    activeShift,
    activeJob,
    updateInventoryStock,
    updateInventoryItem,
    createInventory,
    markInventoryOrdered,
    receiveInventoryOrder,
    refreshJobs,
    refreshShifts,
    calculateAvailable,
    calculateAllocated,
    addAttachment,
    deleteAttachment,
  } = useApp();

  const { showToast } = useToast();

  const {
    view: currentView,
    jobId: selectedJobId,
    inventoryId: selectedInventoryId,
  } = getViewFromPath(location.pathname);
  const [fullJobDetails, setFullJobDetails] = useState<Job | null>(null);
  const [loadingJobDetails, setLoadingJobDetails] = useState(false);

  const navigateTo = useCallback(
    (view: ViewState, id?: string) => {
      const path = getPath(view, id);
      // Prevent navigation loops: don't store returnTo if navigating to the same path
      // Only prevent storing state when going FROM inventory-detail TO job-detail (to prevent loops)
      // But allow storing state when going FROM job-detail TO inventory-detail (so we can return to job)
      const isLoopNavigation =
        path === location.pathname || (currentView === 'inventory-detail' && view === 'job-detail');

      // Store return path unless it would create a loop
      // Always store when coming from job-detail so we can return to it
      const state = isLoopNavigation
        ? undefined
        : { returnView: currentView, returnTo: location.pathname };

      navigate(path, { state });
    },
    [navigate, currentView, location.pathname]
  );

  const navigateBack = useCallback(() => {
    // Check location state for return path
    const state = location.state as { returnTo?: string; returnView?: ViewState } | null;

    if (currentView === 'job-detail') {
      // Check if we have a return path in state
      // Don't return to inventory-detail to prevent loops
      if (state?.returnTo && !state.returnTo.includes('/inventory/')) {
        navigate(state.returnTo);
      } else if (state?.returnView && state.returnView !== 'inventory-detail') {
        navigate(getPath(state.returnView));
      } else {
        // Default to jobs board
        navigate('/jobs');
      }
    } else if (currentView === 'inventory-detail') {
      // Check if we came from a job-detail page
      if (state?.returnTo && state.returnTo.includes('/jobs/')) {
        // Return to the job detail page we came from
        navigate(state.returnTo);
      } else if (state?.returnTo && !state.returnTo.includes('/inventory/')) {
        // Return to other non-inventory views
        navigate(state.returnTo);
      } else {
        // Default to inventory list (don't loop back to another inventory item)
        navigate('/inventory');
      }
    } else if (currentView === 'admin-create-job') {
      // Check if we came from admin-console or board-admin
      if (state?.returnTo) {
        navigate(state.returnTo);
      } else if (state?.returnView === 'board-admin') {
        navigate('/admin/board');
      } else if (state?.returnView === 'admin-console') {
        navigate('/admin');
      } else {
        // Try browser back, fallback to jobs
        if (window.history.length > 1) {
          navigate(-1);
        } else {
          navigate('/jobs');
        }
      }
    } else if (currentView === 'admin-console' || currentView === 'clock-in' || currentView === 'completed-jobs' || currentView === 'calendar') {
      navigate('/dashboard');
    } else if (currentView === 'needs-ordering') {
      navigate('/inventory');
    } else {
      // Try browser back, fallback to dashboard
      if (window.history.length > 1) {
        navigate(-1);
      } else {
        navigate('/dashboard');
      }
    }
  }, [currentView, navigate, location.state]);

  const canGoBack =
    currentView === 'job-detail' ||
    currentView === 'inventory-detail' ||
    currentView === 'admin-create-job' ||
    currentView === 'admin-console' ||
    currentView === 'quotes' ||
    currentView === 'completed-jobs' ||
    currentView === 'calendar' ||
    currentView === 'clock-in' ||
    currentView === 'needs-ordering';

  useEffect(() => {
    if (!isLoading && !currentUser && location.pathname !== '/' && location.pathname !== '/login') {
      navigate('/login');
      return;
    }
    if (!isLoading && currentUser && location.pathname === '/') {
      navigate('/dashboard');
      return;
    }
  }, [isLoading, currentUser, location.pathname, navigate]);

  useEffect(() => {
    if (selectedJobId && currentView === 'job-detail') {
      setLoadingJobDetails(true);
      jobService
        .getJobById(selectedJobId)
        .then((job) => {
          if (job) {
            setFullJobDetails(job);
          }
          setLoadingJobDetails(false);
        })
        .catch((error) => {
          console.error('Error loading job details:', error);
          setLoadingJobDetails(false);
        });
    }
  }, [selectedJobId, currentView]);

  const handleLogin = useCallback(
    async (email: string, password: string) => {
      const success = await login(email, password);
      if (success) {
        navigate('/dashboard');
        showToast('Welcome back!', 'success');
      }
    },
    [login, showToast, navigate]
  );

  const handleLogout = useCallback(() => {
    logout();
    navigate('/login');
    showToast('Logged out successfully', 'info');
  }, [logout, showToast, navigate]);

  const handleClockIn = useCallback(
    async (jobId: string) => {
      const success = await clockIn(jobId);
      showToast(
        success ? 'Clocked in successfully' : 'Failed to clock in',
        success ? 'success' : 'error'
      );
      return success;
    },
    [clockIn, showToast]
  );

  const handleClockOut = useCallback(async () => {
    const success = await clockOut();
    showToast(
      success ? 'Clocked out successfully' : 'Failed to clock out',
      success ? 'success' : 'error'
    );
    return success;
  }, [clockOut, showToast]);

  const handleCreateJob = useCallback(
    async (data: Partial<Job>) => {
      const job = await createJob(data);
      if (job) {
        showToast(`Job #${data.jobCode} created successfully`, 'success');
        await refreshJobs(); // Refresh job list to show new job
        navigateBack();
      } else {
        showToast('Failed to create job', 'error');
      }
      return job;
    },
    [createJob, showToast, navigateBack, refreshJobs]
  );

  const handleUpdateJobStatus = useCallback(
    async (jobId: string, status: JobStatus) => {
      const success = await updateJobStatus(jobId, status);
      if (!success) showToast('Failed to update job status', 'error');
      return success;
    },
    [updateJobStatus, showToast]
  );

  const handleDeleteJob = useCallback(
    async (jobId: string) => {
      const success = await jobService.deleteJob(jobId);
      showToast(success ? 'Job deleted' : 'Failed to delete job', success ? 'success' : 'error');
      if (success) refreshJobs();
    },
    [showToast, refreshJobs]
  );

  const handleClockInByCode = useCallback(
    async (code: number) => {
      const job = await getJobByCode(code);
      if (!job) return { success: false, message: 'Job code not found' };
      if (activeShift)
        return { success: false, message: 'Please clock out of your current job first' };
      const success = await clockIn(job.id);
      if (success) showToast(`Clocked in to Job #${code} - ${job.name}`, 'success');
      return { success, message: success ? `Clocked in to ${job.name}` : 'Failed to clock in' };
    },
    [getJobByCode, activeShift, clockIn, showToast]
  );

  const handleAddJobInventory = useCallback(
    async (jobId: string, inventoryId: string, quantity: number, unit: string) => {
      await addJobInventory(jobId, inventoryId, quantity, unit);
      if (selectedJobId === jobId) {
        const updatedJob = await jobService.getJobById(jobId);
        if (updatedJob) setFullJobDetails(updatedJob);
      }
    },
    [addJobInventory, selectedJobId]
  );

  const handleRemoveJobInventory = useCallback(
    async (jobId: string, jobInventoryId: string) => {
      await removeJobInventory(jobId, jobInventoryId);
      if (selectedJobId === jobId) {
        const updatedJob = await jobService.getJobById(jobId);
        if (updatedJob) setFullJobDetails(updatedJob);
      }
    },
    [removeJobInventory, selectedJobId]
  );

  const handleAddJobComment = useCallback(
    async (jobId: string, text: string) => {
      const comment = await addJobComment(jobId, text);
      if (comment && selectedJobId === jobId) {
        // Wait a moment for DB to fully update
        await new Promise((resolve) => setTimeout(resolve, 300));
        const updatedJob = await jobService.getJobById(jobId);
        if (updatedJob) {
          setFullJobDetails(updatedJob);
        }
      }
      return comment;
    },
    [addJobComment, selectedJobId]
  );

  const handleReloadJob = useCallback(async () => {
    if (selectedJobId) {
      const updatedJob = await jobService.getJobById(selectedJobId);
      if (updatedJob) setFullJobDetails(updatedJob);
    }
  }, [selectedJobId]);

  const userShifts = useMemo(
    () => (currentUser ? shifts.filter((s) => s.user === currentUser.id) : []),
    [shifts, currentUser]
  );

  const showFullScreenLoading = isLoading && currentView === 'login';

  return (
    <div className="flex h-full min-h-0 w-full max-w-full flex-1 flex-col items-center overflow-hidden bg-background-light font-sans dark:bg-background-dark">
      <SkipLink />
      {showFullScreenLoading ? (
        <LoadingSpinner key="loading" fullScreen text="Loading..." />
      ) : currentUser && currentView === 'board-shop' ? (
        <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
          <KanbanBoard
            key="board-shop"
            jobs={jobs}
            boardType="shopFloor"
            onNavigate={navigateTo}
            onBack={canGoBack ? navigateBack : undefined}
            onUpdateJobStatus={handleUpdateJobStatus}
            onCreateJob={() => navigateTo('admin-create-job')}
            onDeleteJob={handleDeleteJob}
            isAdmin={currentUser.isAdmin}
            currentUser={currentUser}
          />
        </div>
      ) : currentUser?.isAdmin && currentView === 'board-admin' ? (
        <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
          <KanbanBoard
            key="board-admin"
            jobs={jobs}
            boardType="admin"
            onNavigate={navigateTo}
            onBack={canGoBack ? navigateBack : undefined}
            onUpdateJobStatus={handleUpdateJobStatus}
            onCreateJob={() => navigateTo('admin-create-job')}
            onDeleteJob={handleDeleteJob}
            isAdmin={true}
            currentUser={currentUser}
          />
        </div>
      ) : currentUser && (currentView === 'inventory' || currentView === 'inventory-detail') ? (
        <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
          <Inventory
            key="inventory"
            inventory={inventory}
            onNavigate={navigateTo}
            onUpdateStock={updateInventoryStock}
            onUpdateItem={updateInventoryItem}
            onCreateItem={createInventory}
            onMarkOrdered={markInventoryOrdered}
            onReceiveOrder={receiveInventoryOrder}
            isAdmin={currentUser.isAdmin}
            calculateAvailable={calculateAvailable}
            calculateAllocated={calculateAllocated}
            initialItemId={selectedInventoryId || undefined}
            onBackFromDetail={
              currentView === 'inventory-detail' && canGoBack ? navigateBack : undefined
            }
          />
        </div>
      ) : currentUser && currentView === 'needs-ordering' ? (
        <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
          <NeedsOrdering
            key="needs-ordering"
            inventory={inventory}
            onNavigate={navigateTo}
            onBack={canGoBack ? navigateBack : undefined}
            onMarkOrdered={markInventoryOrdered}
            onReceiveOrder={receiveInventoryOrder}
            calculateAvailable={calculateAvailable}
            calculateAllocated={calculateAllocated}
          />
        </div>
      ) : (
        <div
          key="main-shell"
          className="relative mx-auto flex h-full min-h-0 w-full max-w-full flex-1 flex-col overflow-hidden bg-white shadow-2xl md:max-w-2xl lg:max-w-4xl xl:max-w-6xl dark:bg-background-dark"
        >
          <main
            id="main-content"
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
            tabIndex={-1}
          >
            {currentView === 'landing' && <Landing />}

            {currentView === 'login' && (
              <Login onLogin={handleLogin} error={authError} isLoading={isLoading} />
            )}

            {currentUser && (
              <>
                {currentView === 'dashboard' && (
                  <Dashboard
                    user={currentUser}
                    onNavigate={navigateTo}
                    onLogout={handleLogout}
                    activeJob={activeJob}
                    activeShift={activeShift}
                    recentShifts={userShifts.slice(0, 5)}
                    jobs={jobs}
                    inventory={inventory}
                    onClockOut={handleClockOut}
                  />
                )}

                {currentView === 'job-detail' &&
                  (loadingJobDetails ? (
                    <LoadingSpinner fullScreen text="Loading job details..." />
                  ) : fullJobDetails ? (
                    <JobDetail
                      job={fullJobDetails}
                      onNavigate={navigateTo}
                      onBack={canGoBack ? navigateBack : undefined}
                      isClockedIn={activeJob?.id === fullJobDetails.id}
                      onClockIn={() => handleClockIn(fullJobDetails.id)}
                      onClockOut={handleClockOut}
                      activeShift={activeShift}
                      inventory={inventory}
                      jobs={jobs}
                      shifts={shifts}
                      onAddComment={handleAddJobComment}
                      onAddInventory={handleAddJobInventory}
                      onRemoveInventory={handleRemoveJobInventory}
                      onUpdateJob={updateJob}
                      currentUser={currentUser}
                      onReloadJob={handleReloadJob}
                      onAddAttachment={addAttachment}
                      onDeleteAttachment={deleteAttachment}
                      calculateAvailable={calculateAvailable}
                    />
                  ) : (
                    <LoadingSpinner fullScreen text="Loading..." />
                  ))}

                {currentView === 'time-reports' && (
                  <TimeReports
                    shifts={shifts}
                    users={users}
                    jobs={jobs}
                    onNavigate={navigateTo}
                    onBack={canGoBack ? navigateBack : undefined}
                    currentUser={currentUser}
                    onRefreshShifts={refreshShifts}
                  />
                )}

                {currentView === 'clock-in' && (
                  <ClockInScreen
                    onNavigate={navigateTo}
                    onBack={canGoBack ? navigateBack : undefined}
                    onClockInByCode={handleClockInByCode}
                    activeShift={activeShift}
                    activeJob={activeJob}
                    onClockOut={handleClockOut}
                  />
                )}

                {currentUser.isAdmin && currentView === 'admin-create-job' && (
                  <AdminCreateJob
                    onCreate={handleCreateJob}
                    onNavigate={navigateTo}
                    users={users}
                    existingJobCodes={jobs.map((j) => j.jobCode)}
                    currentUser={currentUser}
                    jobs={jobs}
                    shifts={shifts}
                  />
                )}

                {currentUser.isAdmin && currentView === 'admin-console' && (
                  <AdminConsole
                    jobs={jobs}
                    shifts={shifts}
                    onNavigate={navigateTo}
                    onBack={canGoBack ? navigateBack : undefined}
                    users={users}
                    onUpdateJobStatus={handleUpdateJobStatus}
                  />
                )}

                {currentUser.isAdmin && currentView === 'quotes' && (
                  <Quotes
                    jobs={jobs}
                    inventory={inventory}
                    shifts={shifts}
                    currentUser={currentUser}
                    onNavigate={navigateTo}
                    onBack={canGoBack ? navigateBack : undefined}
                  />
                )}

                {currentUser.isAdmin && currentView === 'completed-jobs' && (
                  <CompletedJobs
                    jobs={jobs}
                    currentUser={currentUser}
                    onNavigate={navigateTo}
                    onBack={canGoBack ? navigateBack : undefined}
                  />
                )}

                {currentUser.isAdmin && currentView === 'calendar' && (
                  <Calendar
                    jobs={jobs}
                    shifts={shifts}
                    currentUser={currentUser}
                    onNavigate={navigateTo}
                    onBack={canGoBack ? navigateBack : undefined}
                  />
                )}
              </>
            )}
          </main>
          {/* Bottom Navigation - Show on all authenticated views except login */}
          {currentUser && currentView !== 'login' && (
            <BottomNavigation
              currentView={currentView}
              onNavigate={navigateTo}
              isAdmin={currentUser.isAdmin}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default App;
