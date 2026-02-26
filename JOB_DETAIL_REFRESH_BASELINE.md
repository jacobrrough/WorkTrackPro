# Job Detail Refresh Baseline

This file locks the non-breaking contract for the Job Detail refresh.

## Existing Behavior That Must Be Preserved

- `src/App.tsx` keeps the existing `JobDetail` prop contract and custom navigation flow.
- `src/AppContext.tsx` action semantics remain unchanged for:
  - comment CRUD trigger paths
  - inventory add/remove on jobs
  - job update/save/reload
  - status progression from checklist completion
- `materialFromPart` behavior remains intact:
  - required material computation from part + dash quantities
  - debounced sync to `job_inventory`
  - manual materials remain preserved when possible
- Attachments and comments continue to use current service/API paths.
- Non-admin users do not gain access to financial data.

## Dependency Map (Current)

- Parent wiring: `src/App.tsx`
- Context actions/state: `src/AppContext.tsx`
- Services: `src/services/api/jobs.ts`, `src/services/api/parts.ts`
- Helper libs:
  - `src/lib/materialFromPart.ts`
  - `src/lib/variantAllocation.ts`
  - `src/lib/variantMath.ts`
  - `src/lib/formatJob.ts`
  - `src/lib/timeUtils.ts`
  - `src/lib/lunchUtils.ts`
- UI and supporting components:
  - `src/ChecklistDisplay.tsx`
  - `src/AttachmentsList.tsx`
  - `src/FileUploadButton.tsx`
  - `src/FileViewer.tsx`
  - `src/BinLocationScanner.tsx`

## Refactor Safety Rule

All extraction work is internal to Job Detail:
- move logic into focused hooks/components
- keep runtime behavior and output equivalent
- keep public props/actions unchanged
- keep toast-first UX and existing role gating
