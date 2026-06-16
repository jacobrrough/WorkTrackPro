import { describe, it, expect, vi, afterEach } from 'vitest';
import { checklistService } from './checklists';
import type { Checklist } from '../../core/types';

describe('checklistService.ensureJobChecklistForStatus', () => {
  afterEach(() => vi.restoreAllMocks());

  it('preserves isMaterialCheck when cloning template items onto a job checklist', async () => {
    // No existing checklist for the job → seed from the template.
    vi.spyOn(checklistService, 'getByJobAndStatus').mockResolvedValue(null);
    vi.spyOn(checklistService, 'getTemplates').mockResolvedValue([
      {
        id: 'tmpl-pod',
        job: '',
        status: 'pod',
        items: [
          // The PO'd "check inventory" item drives the availability gate in ChecklistDisplay.
          // Include stale per-completion fields to prove they are NOT carried onto the job.
          {
            id: 'i1',
            text: 'Check inventory',
            checked: true,
            isMaterialCheck: true,
            checkedBy: 'someone',
            checkedAt: '2026-01-01',
          },
          { id: 'i2', text: 'MOVE', checked: false },
        ],
        created: '',
        updated: '',
      } as Checklist,
    ]);
    const createSpy = vi.spyOn(checklistService, 'create').mockImplementation(async (data) => ({
      id: 'new',
      job: data.job_id ?? '',
      status: data.status,
      items: data.items,
      created: '',
      updated: '',
    }));

    const result = await checklistService.ensureJobChecklistForStatus('job1', 'pod');

    const seededItems = createSpy.mock.calls[0][0].items;
    // The material-check flag survives seeding (the bug this guards against).
    expect(seededItems[0].isMaterialCheck).toBe(true);
    // A seeded item starts fresh: checked reset, stale completion metadata dropped.
    expect(seededItems[0].checked).toBe(false);
    expect(seededItems[0].checkedBy).toBeUndefined();
    expect(seededItems[0].checkedAt).toBeUndefined();
    // Non-material items carry no flag.
    expect(seededItems[1].isMaterialCheck).toBeUndefined();
    expect(result?.items[0].isMaterialCheck).toBe(true);
  });
});
