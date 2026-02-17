// Job status values matching V1's BoardColumnFactory
export type JobStatus =
  | 'pending'
  | 'rush'
  | 'inProgress'
  | 'qualityControl'
  | 'finished'
  | 'delivered'
  | 'onHold'
  // Admin board statuses
  | 'toBeQuoted'
  | 'quoted' // NEW: Quote has been created, waiting to send
  | 'rfqReceived'
  | 'rfqSent'
  | 'pod'
  | 'waitingForPayment'
  | 'projectCompleted';

// Inventory categories matching V1
export type InventoryCategory =
  | 'material'
  | 'foam'
  | 'trimCord'
  | 'printing3d'
  | 'chemicals'
  | 'hardware'
  | 'miscSupplies';

// Board types matching V1
export type BoardType = 'shopFloor' | 'admin' | 'inventory';

export interface User {
  id: string;
  email: string;
  name?: string;
  initials?: string;
  isAdmin: boolean;
}

export interface JobInventoryItem {
  id?: string;
  inventoryId: string;
  inventoryName?: string;
  quantity: number;
  unit: string;
}

export interface Comment {
  id: string;
  userId: string;
  userName?: string;
  userInitials?: string;
  text: string;
  timestamp: string;
}

export interface Attachment {
  id: string;
  filename: string;
  url: string;
  created: string;
  isAdminOnly?: boolean;
}

export interface Job {
  id: string;
  jobCode: number;
  po?: string;
  name: string;
  qty?: string;
  description?: string;
  ecd?: string; // Expected Completion Date
  dueDate?: string;
  laborHours?: number; // Expected time in hours (for calendar scheduling)
  active: boolean;
  status: JobStatus;
  boardType?: BoardType;
  attachments: Attachment[];
  attachmentCount: number;
  comments: Comment[];
  commentCount: number;
  inventoryItems: JobInventoryItem[];
  createdBy?: string;
  assignedUsers: string[];
  isRush: boolean;
  workers: string[]; // Worker initials currently on this job
  binLocation?: string; // Bin location in format A4c (Rack A, Shelf 4, Section c)
  /** Set by API when expand=job_inventory_via_job (back-relation); used for allocated calculation */
  expand?: {
    job_inventory?: Array<{
      id: string;
      job: string;
      inventory: string;
      quantity: number;
      unit: string;
    }>;
    job_inventory_via_job?: Array<{
      id: string;
      job: string;
      inventory: string;
      quantity: number;
      unit: string;
    }>;
  };
}

export interface Shift {
  id: string;
  user: string;
  userName?: string;
  userInitials?: string;
  job: string;
  jobName?: string;
  jobCode?: number;
  clockInTime: string;
  clockOutTime?: string;
  notes?: string;
}

export interface ShiftEdit {
  id: string;
  shift: string;
  editedBy: string;
  editedByName?: string;
  previousClockIn: string;
  newClockIn: string;
  previousClockOut?: string;
  newClockOut?: string;
  reason?: string;
  editTimestamp: string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
  checkedBy?: string;
  checkedByName?: string;
  checkedAt?: string;
}

export interface Checklist {
  id: string;
  job: string;
  status: JobStatus;
  items: ChecklistItem[];
  created: string;
  updated: string;
}

export interface ChecklistHistory {
  id: string;
  checklist: string;
  user: string;
  userName?: string;
  userInitials?: string;
  itemIndex: number;
  itemText: string;
  checked: boolean;
  timestamp: string;
}

export interface InventoryTransaction {
  id: string;
  inventoryId: string;
  type: 'received' | 'disposed' | 'used' | 'adjusted' | 'reconciled' | 'ordered' | 'orderReceived';
  quantity: number;
  jobId?: string;
  jobName?: string;
  notes?: string;
  createdBy?: string;
  createdAt: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  description?: string;
  category: InventoryCategory;
  inStock: number;
  /** Display: always use context's computed value (inStock - allocated), not DB. */
  available: number;
  /** Display: set by context from active jobs' job_inventory; optional on raw API items. */
  allocated?: number;
  disposed: number;
  onOrder: number;
  reorderPoint?: number;
  price?: number;
  unit: string;
  hasImage: boolean;
  imageUrl?: string;
  barcode?: string;
  binLocation?: string;
  vendor?: string;
  transactions?: InventoryTransaction[];
}

export interface InventoryHistory {
  id: string;
  inventory: string; // relation to inventory item
  user: string; // relation to user
  action:
    | 'manual_adjust'
    | 'reconcile_job'
    | 'reconcile_po'
    | 'order_received'
    | 'order_placed'
    | 'stock_correction';
  reason: string;
  previousInStock: number;
  newInStock: number;
  previousAvailable: number;
  newAvailable: number;
  changeAmount: number; // Can be negative
  relatedJob?: string; // optional relation to job
  relatedPO?: string; // optional PO number
  created: string; // timestamp
  expand?: {
    user?: User;
    relatedJob?: Job;
    inventory?: InventoryItem;
  };
}

// Board column definition matching V1
export interface BoardColumn {
  id: string;
  title: string;
  colorScheme: string;
  cards: Job[];
}

export interface QuoteLineItem {
  id?: string;
  inventoryId?: string;
  inventoryName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  isManual: boolean; // true if manually added/adjusted
}

export interface Quote {
  id: string;
  productName: string;
  description?: string;
  materialCost: number;
  laborHours: number;
  laborRate: number; // hourly rate
  laborCost: number;
  markupPercent: number; // markup percentage (e.g., 20 for 20%)
  subtotal: number; // material + labor
  markupAmount: number; // subtotal * markupPercent / 100
  total: number; // subtotal + markupAmount
  lineItems: QuoteLineItem[];
  referenceJobIds: string[]; // IDs of similar jobs used for calculation
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  expand?: {
    createdBy?: User;
    referenceJobs?: Job[];
  };
}

// View states
export type ViewState =
  | 'landing' // Public home page (roughcutmfg.com)
  | 'login'
  | 'dashboard'
  | 'job-list'
  | 'job-detail'
  | 'inventory'
  | 'inventory-detail'
  | 'add-inventory'
  | 'needs-ordering' // NEW: Low stock items screen
  | 'time-reports'
  | 'time-tracking'
  | 'admin-create-job'
  | 'admin-console'
  | 'board-shop'
  | 'board-admin'
  | 'clock-in'
  | 'quotes'
  | 'completed-jobs'
  | 'calendar';

// Column configurations matching V1's BoardColumnFactory
export const SHOP_FLOOR_COLUMNS: Omit<BoardColumn, 'cards'>[] = [
  { id: 'pending', title: 'Pending', colorScheme: 'red' },
  { id: 'rush', title: 'Rush', colorScheme: 'darkRed' },
  { id: 'inProgress', title: 'In Progress', colorScheme: 'blue' },
  { id: 'qualityControl', title: 'Quality Control', colorScheme: 'green' },
  { id: 'finished', title: 'Finished', colorScheme: 'yellow' },
  { id: 'delivered', title: 'Delivered', colorScheme: 'cyan' },
  { id: 'onHold', title: 'On Hold', colorScheme: 'gray' },
];

export const ADMIN_COLUMNS: Omit<BoardColumn, 'cards'>[] = [
  { id: 'toBeQuoted', title: 'To Be Quoted', colorScheme: 'red' },
  { id: 'quoted', title: 'Quoted', colorScheme: 'orange' },
  { id: 'rfqReceived', title: 'RFQ Received', colorScheme: 'blue' },
  { id: 'rfqSent', title: 'RFQ Sent', colorScheme: 'cyan' },
  { id: 'pod', title: "PO'd", colorScheme: 'green' },
  { id: 'inProgress', title: 'In Progress', colorScheme: 'blue' },
  { id: 'onHold', title: 'On Hold', colorScheme: 'gray' },
  { id: 'finished', title: 'Finished', colorScheme: 'yellow' },
  { id: 'delivered', title: 'Delivered', colorScheme: 'cyan' },
  { id: 'waitingForPayment', title: 'Waiting For Payment', colorScheme: 'yellow' },
  { id: 'projectCompleted', title: 'Project Completed', colorScheme: 'emerald' },
];

export const INVENTORY_CATEGORIES: { id: InventoryCategory; title: string; colorScheme: string }[] =
  [
    { id: 'material', title: 'Material', colorScheme: 'red' },
    { id: 'foam', title: 'Foam', colorScheme: 'gray' },
    { id: 'trimCord', title: 'Trim & Cord', colorScheme: 'green' },
    { id: 'printing3d', title: '3D Printing', colorScheme: 'purple' },
    { id: 'chemicals', title: 'Chemicals', colorScheme: 'orange' },
    { id: 'hardware', title: 'Hardware', colorScheme: 'cyan' },
    { id: 'miscSupplies', title: 'Misc. Supplies', colorScheme: 'yellow' },
  ];

// Helper to get status display name
export function getStatusDisplayName(status: JobStatus): string {
  const map: Record<JobStatus, string> = {
    pending: 'Pending',
    rush: 'Rush',
    inProgress: 'In Progress',
    qualityControl: 'Quality Control',
    finished: 'Finished',
    delivered: 'Delivered',
    onHold: 'On Hold',
    toBeQuoted: 'To Be Quoted',
    quoted: 'Quoted',
    rfqReceived: 'RFQ Received',
    rfqSent: 'RFQ Sent',
    pod: "PO'd",
    waitingForPayment: 'Waiting For Payment',
    projectCompleted: 'Project Completed',
  };
  return map[status] || status;
}

// Helper to get category display name
export function getCategoryDisplayName(category: InventoryCategory): string {
  const map: Record<InventoryCategory, string> = {
    material: 'Material',
    foam: 'Foam',
    trimCord: 'Trim & Cord',
    printing3d: '3D Printing',
    chemicals: 'Chemicals',
    hardware: 'Hardware',
    miscSupplies: 'Misc. Supplies',
  };
  return map[category] || category;
}
