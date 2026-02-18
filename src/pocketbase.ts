/**
 * Facade: re-exports from modular API services (Supabase backend).
 * Import from './pocketbase' or from './services/api' for specific modules.
 */
export {
  supabase,
  authService,
  userService,
  jobService,
  shiftService,
  shiftEditService,
  inventoryService,
  inventoryHistoryService,
  quoteService,
  checklistService,
  checklistHistoryService,
  partsService,
  subscriptions,
} from './services/api';
export { supabase as default } from './services/api';
