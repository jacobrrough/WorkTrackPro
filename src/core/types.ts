// Job status and display
export type JobStatus =
  | 'pending'
  | 'rush'
  | 'inProgress'
  | 'qualityControl'
  | 'finished'
  | 'delivered'
  | 'onHold'
  | 'toBeQuoted'
  | 'quoted'
  | 'rfqReceived'
  | 'rfqSent'
  | 'pod'
  | 'waitingForPayment'
  | 'projectCompleted'
  | 'paid';

const STATUS_LABELS: Record<JobStatus, string> = {
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
  paid: 'Paid',
};

export function getStatusDisplayName(status: JobStatus): string {
  return STATUS_LABELS[status] ?? status;
}

// Inventory category and display
export type InventoryCategory =
  | 'material'
  | 'foam'
  | 'trimCord'
  | 'printing3d'
  | 'chemicals'
  | 'hardware'
  | 'miscSupplies';

const CATEGORY_LABELS: Record<InventoryCategory, string> = {
  material: 'Material',
  foam: 'Foam',
  trimCord: 'Trim & Cord',
  printing3d: '3D Printing',
  chemicals: 'Chemicals',
  hardware: 'Hardware',
  miscSupplies: 'Misc Supplies',
};

export function getCategoryDisplayName(category: InventoryCategory): string {
  return CATEGORY_LABELS[category] ?? category;
}

// View state (app navigation)
export type ViewState =
  | 'dashboard'
  | 'job-list'
  | 'job-detail'
  | 'clock-in'
  | 'inventory'
  | 'inventory-detail'
  | 'admin'
  | 'board-shop'
  | 'board-admin'
  | 'parts'
  | 'part-detail'
  | 'create-job'
  | 'quotes'
  | 'time-reports'
  | 'completed-jobs'
  | 'calendar'
  | 'admin-settings'
  | 'needs-ordering'
  | 'trello-import';

export type BoardType = 'shopFloor' | 'admin';

// User
export interface User {
  id: string;
  email: string;
  name?: string;
  initials?: string;
  isAdmin: boolean;
}

// Shift
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

// Comment
export interface Comment {
  id: string;
  jobId: string;
  user: string;
  userName?: string;
  userInitials?: string;
  text: string;
  createdAt: string;
}

// Attachment (can be linked to job, inventory item, or part drawing)
export interface Attachment {
  id: string;
  jobId?: string;
  inventoryId?: string;
  partId?: string;
  filename: string;
  storagePath: string;
  isAdminOnly: boolean;
  url?: string;
  created?: string;
}

// Job inventory item (expand shape)
export interface JobInventoryItem {
  id: string;
  jobId?: string;
  job?: string;
  inventoryId?: string;
  inventory?: string;
  quantity: number;
  unit: string;
}

// Job
export interface Job {
  id: string;
  jobCode: number;
  po?: string;
  name: string;
  qty?: string;
  description?: string;
  ecd?: string;
  dueDate?: string;
  laborHours?: number;
  active: boolean;
  status: JobStatus;
  boardType: BoardType;
  attachments: Attachment[];
  attachmentCount: number;
  comments: Comment[];
  commentCount: number;
  inventoryItems: JobInventoryItem[];
  createdBy?: string;
  assignedUsers: string[];
  isRush: boolean;
  workers: string[];
  binLocation?: string;
  partNumber?: string;
  variantSuffix?: string;
  estNumber?: string;
  invNumber?: string;
  rfqNumber?: string;
  owrNumber?: string;
  dashQuantities?: Record<string, number>;
  revision?: string;
  partId?: string;
  expand?: {
    job_inventory?: JobInventoryItem[];
    job_inventory_via_job?: JobInventoryItem[];
  };
}

// Inventory
export interface InventoryItem {
  id: string;
  name: string;
  description?: string;
  category: InventoryCategory;
  inStock: number;
  available: number;
  disposed: number;
  onOrder: number;
  reorderPoint?: number;
  price?: number;
  unit: string;
  hasImage?: boolean;
  imageUrl?: string;
  barcode?: string;
  binLocation?: string;
  vendor?: string;
  attachments?: Attachment[];
  attachmentCount?: number;
}

// Part
export interface Part {
  id: string;
  partNumber: string;
  name: string;
  description?: string;
  pricePerSet?: number;
  laborHours?: number;
  /** Part requires CNC cut; when true, CNC time is included in quote */
  requiresCNC?: boolean;
  /** CNC time per set (hours), used when requiresCNC is true */
  cncTimeHours?: number;
  /** Part requires 3D print; when true, 3D print time is included in quote */
  requires3DPrint?: boolean;
  /** 3D printer time per set (hours), used when requires3DPrint is true */
  printer3DTimeHours?: number;
  setComposition?: Record<string, number> | null;
  createdAt?: string;
  updatedAt?: string;
  variants?: PartVariant[];
  materials?: PartMaterial[];
  /** Drawing files for this part (visible on job cards for standard users) */
  drawingAttachments?: Attachment[];
  /** Backward-compat first drawing file for this part */
  drawingAttachment?: Attachment | null;
}

export interface PartVariant {
  id: string;
  partId: string;
  variantSuffix: string;
  name?: string;
  pricePerVariant?: number;
  laborHours?: number;
  createdAt?: string;
  updatedAt?: string;
  materials?: PartMaterial[];
}

export interface PartMaterial {
  id: string;
  /** Set for variant-level materials; empty for part-level (per_set) */
  partVariantId?: string;
  /** Set for part-level (per_set) materials */
  partId?: string;
  inventoryId: string;
  inventoryName?: string;
  quantityPerUnit: number;
  unit: string;
  usageType?: 'per_set' | 'per_variant';
  createdAt?: string;
  updatedAt?: string;
}

// Checklist
export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
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
  itemText?: string;
  checked?: boolean;
  timestamp: string;
}

// Quote
export interface QuoteLineItem {
  id?: string;
  name: string;
  quantity: number;
  unit: string;
  unitCost?: number;
  total?: number;
}

export interface Quote {
  id: string;
  productName: string;
  description?: string;
  materialCost: number;
  laborHours: number;
  laborRate: number;
  laborCost: number;
  markupPercent: number;
  subtotal: number;
  markupAmount: number;
  total: number;
  lineItems: QuoteLineItem[];
  referenceJobIds: string[];
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// Shift edit
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

// Kanban columns (shop floor)
export const SHOP_FLOOR_COLUMNS: { id: JobStatus; title: string; color: string }[] = [
  { id: 'pending', title: 'Pending', color: 'bg-pink-500' },
  { id: 'inProgress', title: 'In Progress', color: 'bg-blue-500' },
  { id: 'qualityControl', title: 'Quality Control', color: 'bg-green-500' },
  { id: 'finished', title: 'Finished', color: 'bg-yellow-500' },
  { id: 'delivered', title: 'Delivered', color: 'bg-cyan-500' },
  { id: 'onHold', title: 'On Hold', color: 'bg-gray-500' },
];
