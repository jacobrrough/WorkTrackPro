import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProjectHourStatus } from '@/core/types';
import { projectHoursService } from '@/services/api/projectHours';

export function useProjectHoursData(includeArchived = false) {
  const projects = useQuery({
    queryKey: ['projectHours', 'projects', includeArchived],
    queryFn: () => projectHoursService.listProjects(includeArchived),
  });
  const entries = useQuery({
    queryKey: ['projectHours', 'entries'],
    queryFn: () => projectHoursService.listEntries(),
  });
  return { projects, entries };
}

export interface UseProjectHoursMutationsParams {
  showToast: (
    message: string,
    type: 'info' | 'success' | 'error' | 'warning',
    duration?: number
  ) => void;
}

export function useProjectHoursMutations({ showToast }: UseProjectHoursMutationsParams) {
  const queryClient = useQueryClient();

  // Every mutation invalidates the whole ['projectHours'] subtree so the roll-up,
  // per-project totals, and project list never disagree.
  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['projectHours'] }),
    [queryClient]
  );

  const createProject = useCallback(
    async (data: { name: string; description?: string }) => {
      const project = await projectHoursService.createProject(data);
      if (project) {
        invalidate();
        showToast('Project created', 'success');
      } else {
        showToast('Failed to create project', 'error');
      }
      return project;
    },
    [invalidate, showToast]
  );

  const renameProject = useCallback(
    async (id: string, name: string) => {
      const project = await projectHoursService.updateProject(id, { name });
      if (project) {
        invalidate();
        showToast('Project renamed', 'success');
      } else {
        showToast('Failed to rename project', 'error');
      }
      return project;
    },
    [invalidate, showToast]
  );

  const deleteProject = useCallback(
    async (id: string) => {
      const ok = await projectHoursService.deleteProject(id);
      if (ok) {
        invalidate();
        showToast('Project deleted', 'success');
      } else {
        showToast('Failed to delete project', 'error');
      }
      return ok;
    },
    [invalidate, showToast]
  );

  const setProjectStatus = useCallback(
    async (id: string, status: ProjectHourStatus) => {
      const project = await projectHoursService.updateProject(id, { status });
      if (project) {
        invalidate();
        showToast(
          status === 'finished' ? 'Project marked finished' : 'Project reopened',
          'success'
        );
      } else {
        showToast('Failed to update project', 'error');
      }
      return project;
    },
    [invalidate, showToast]
  );

  const archiveProject = useCallback(
    async (id: string) => {
      const ok = await projectHoursService.archiveProject(id);
      if (ok) {
        invalidate();
        showToast('Project archived', 'success');
      } else {
        showToast('Failed to archive project', 'error');
      }
      return ok;
    },
    [invalidate, showToast]
  );

  const unarchiveProject = useCallback(
    async (id: string) => {
      const ok = await projectHoursService.unarchiveProject(id);
      if (ok) {
        invalidate();
        showToast('Project restored', 'success');
      } else {
        showToast('Failed to restore project', 'error');
      }
      return ok;
    },
    [invalidate, showToast]
  );

  const addEntry = useCallback(
    async (data: { projectId: string; entryDate: string; hours: number; note?: string }) => {
      const entry = await projectHoursService.addEntry(data);
      if (entry) {
        invalidate();
        showToast('Hours logged', 'success');
      } else {
        showToast('Failed to log hours', 'error');
      }
      return entry;
    },
    [invalidate, showToast]
  );

  const updateEntry = useCallback(
    async (id: string, data: { entryDate?: string; hours?: number; note?: string | null }) => {
      const entry = await projectHoursService.updateEntry(id, data);
      if (entry) {
        invalidate();
        showToast('Entry updated', 'success');
      } else {
        showToast('Failed to update entry', 'error');
      }
      return entry;
    },
    [invalidate, showToast]
  );

  const markPaid = useCallback(
    async (ids: string[]) => {
      const count = await projectHoursService.markPaid(ids);
      if (count === null) {
        showToast('Failed to mark paid', 'error');
        return 0;
      }
      if (count > 0) {
        invalidate();
        showToast(`Marked ${count} ${count === 1 ? 'entry' : 'entries'} paid`, 'success');
      } else {
        showToast('Nothing owed to mark paid', 'info');
      }
      return count;
    },
    [invalidate, showToast]
  );

  const unmarkEntryPaid = useCallback(
    async (id: string) => {
      const entry = await projectHoursService.unmarkEntryPaid(id);
      if (entry) {
        invalidate();
        showToast('Entry marked unpaid', 'success');
      } else {
        showToast('Failed to unmark entry', 'error');
      }
      return entry;
    },
    [invalidate, showToast]
  );

  const deleteEntry = useCallback(
    async (id: string) => {
      const ok = await projectHoursService.deleteEntry(id);
      if (ok) {
        invalidate();
        showToast('Entry deleted', 'success');
      } else {
        showToast('Failed to delete entry', 'error');
      }
      return ok;
    },
    [invalidate, showToast]
  );

  return {
    createProject,
    renameProject,
    deleteProject,
    setProjectStatus,
    archiveProject,
    unarchiveProject,
    addEntry,
    updateEntry,
    deleteEntry,
    markPaid,
    unmarkEntryPaid,
  };
}
