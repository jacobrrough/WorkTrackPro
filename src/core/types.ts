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

/** Canonical ordered list of all inventory categories (single source of truth for pickers). */
export function getAllInventoryCategories(): InventoryCategory[] {
  return Object.keys(CATEGORY_LABELS) as InventoryCategory[];
}

// View state (app navigation)
export type ViewState =
  | 'dashboard'
  | 'job-detail'
  | 'clock-in'
  | 'scanner'
  | 'inventory'
  | 'inventory-detail'
  | 'board-shop'
  | 'board-admin'
  | 'parts'
  | 'part-detail'
  | 'create-job'
  | 'quotes'
  | 'time-reports'
  | 'calendar'
  | 'admin-settings'
  | 'trello-import'
  | 'boards'
  | 'board-detail'
  | 'board-card-detail'
  | 'chat'
  | 'chat-conversation'
  | 'notification-settings'
  | 'project-hours';

export type BoardType = 'shopFloor' | 'admin';

// User
export interface User {
  id: string;
  email: string;
  name?: string;
  initials?: string;
  isAdmin: boolean;
  isApproved?: boolean;
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
  lunchStartTime?: string;
  lunchEndTime?: string;
  lunchMinutesUsed?: number;
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

// Attachment (can be linked to job, inventory item, or part drawing/product image)
export type AttachmentType = 'general' | 'drawing' | 'product_image';

export interface Attachment {
  id: string;
  jobId?: string;
  inventoryId?: string;
  partId?: string;
  boardCardId?: string;
  filename: string;
  storagePath: string;
  isAdminOnly: boolean;
  /** For part attachments: drawing (technical) or product_image (storefront) */
  attachmentType?: AttachmentType;
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
  inventoryName?: string;
  quantity: number;
  unit: string;
  /** Quantity of this BOM line already physically deducted via per-unit progress / Finished. */
  consumedQuantity?: number;
}

/** One part linked to a job with its variant quantities. Used when job has multiple parts (job_parts). */
export interface JobPartLink {
  partId: string;
  partNumber: string;
  dashQuantities: Record<string, number>;
  /** Part drawing rev this link was built to (from parts.rev). */
  rev?: string;
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
  /** Internal planned completion (calendar Apply). ECD is contract reference only; automation never writes ECD. */
  plannedCompletionDate?: string | null;
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
  /**
   * Billing customer (accounting.customers id). The job is the spine that links
   * operational work to its AR party: estimates/invoices created from the job
   * pre-fill this customer. Null/undefined when unlinked (all legacy jobs).
   */
  customerId?: string | null;
  estNumber?: string;
  invNumber?: string;
  rfqNumber?: string;
  owrNumber?: string;
  dashQuantities?: Record<string, number>;
  laborBreakdownByVariant?: Record<
    string,
    { qty: number; hoursPerUnit: number; totalHours: number }
  >;
  machineBreakdownByVariant?: Record<
    string,
    {
      qty: number;
      cncHoursPerUnit: number;
      cncHoursTotal: number;
      printer3DHoursPerUnit: number;
      printer3DHoursTotal: number;
    }
  >;
  cncCompletedAt?: string | null;
  cncCompletedBy?: string | null;
  printer3DCompletedAt?: string | null;
  printer3DCompletedBy?: string | null;
  /** Per-variant count of units whose CNC milestone is done (deducts CNC-able material). */
  cncDoneByVariant?: Record<string, number>;
  /** Per-variant count of units fully done (deducts the rest of the distributed BOM). */
  unitsDoneByVariant?: Record<string, number>;
  allocationSource?: 'variant' | 'total';
  allocationSourceUpdatedAt?: string;
  revision?: string;
  partId?: string;
  /** Part drawing rev this job was built to (when linked to a part). */
  partRev?: string;
  /**
   * Customer-facing quoted total captured at job creation (price snapshot). When present,
   * the invoice prefers this over re-quoting the (possibly since-edited) part. Undefined on
   * older jobs created before the snapshot existed — those fall back to the re-quote path.
   */
  quotedPrice?: number;
  /** Quoted material cost captured at job creation (snapshot). Undefined when unknown at creation. */
  quotedMaterialCost?: number;
  /** Quoted labor hours captured at job creation (snapshot). Undefined on older jobs. */
  quotedLaborHours?: number;
  /** When present, full list of parts linked to this job (job_parts). partId/partNumber/dashQuantities are the primary/first part. */
  parts?: JobPartLink[];
  /** User-estimated completion percent (0–100). When set, drives progress bar and at-risk if implied labor exceeds estimate. */
  progressEstimatePercent?: number | null;
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
  /** Drawing revision (letters, numbers, or symbols). Default '--'. */
  rev: string;
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
  /** When true, only first variant holds materials/costs; all variants treated as copies for BOM and quote */
  variantsAreCopies?: boolean;
  /** When true, part is visible on the public storefront */
  showOnStore?: boolean;
  createdAt?: string;
  updatedAt?: string;
  variants?: PartVariant[];
  materials?: PartMaterial[];
  /** Drawing files for this part (visible on job cards for standard users) */
  drawingAttachments?: Attachment[];
  /** Backward-compat first drawing file for this part */
  drawingAttachment?: Attachment | null;
  /** Product images for storefront (attachment_type = product_image) */
  productImages?: Attachment[];
}

export interface PartVariant {
  id: string;
  partId: string;
  variantSuffix: string;
  name?: string;
  description?: string;
  pricePerVariant?: number;
  laborHours?: number;
  requiresCNC?: boolean;
  cncTimeHours?: number;
  requires3DPrint?: boolean;
  printer3DTimeHours?: number;
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
  isMaterialCheck?: boolean;
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
  itemText?: string;
  checked?: boolean;
  timestamp: string;
  status?: JobStatus;
}

// Quote
export interface QuoteLineItem {
  id?: string;
  name: string;
  quantity: number;
  unit: string;
  unitCost?: number;
  unitPrice?: number;
  total?: number;
  totalPrice?: number;
  inventoryName?: string;
  isManual?: boolean;
}

export interface Quote {
  id: string;
  productName: string;
  description?: string;
  materialCost: number;
  laborHours: number;
  laborRate: number;
  laborCost: number;
  cncHours: number;
  cncRate: number;
  cncCost: number;
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

// Inventory history (transaction log)
// Closed set of audit actions written by inventoryHistoryService.createHistory. Narrowing the
// write path catches typos (a misspelled action would render with no label in the history UI).
export type InventoryHistoryAction =
  | 'manual_adjust'
  | 'order_placed'
  | 'order_received'
  | 'allocated_to_job';

export interface InventoryHistoryEntry {
  id: string;
  inventoryId: string;
  userId: string;
  userName?: string;
  userInitials?: string;
  action: string;
  reason: string;
  previousInStock: number;
  newInStock: number;
  previousAvailable?: number;
  newAvailable?: number;
  changeAmount: number;
  relatedJobId?: string;
  relatedJobName?: string;
  relatedPO?: string;
  createdAt: string;
}

// Job deliveries (packing slip / partial shipments)
export interface DeliveryLineItem {
  description: string;
  partNumber?: string;
  variantSuffix?: string;
  quantity: number;
  unit?: string;
}

export interface Delivery {
  id: string;
  jobId: string;
  deliveryNumber: number;
  deliveredAt: string;
  carrier?: string;
  trackingNumber?: string;
  recipientName?: string;
  notes?: string;
  lineItems: DeliveryLineItem[];
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface JobStatusHistoryEntry {
  id: string;
  jobId: string;
  userId: string;
  userName?: string;
  userInitials?: string;
  previousStatus: JobStatus;
  newStatus: JobStatus;
  createdAt: string;
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

// Custom boards
export type BoardVisibility = 'private' | 'members' | 'everyone';
export type BoardMemberRole = 'editor' | 'viewer';

export interface Board {
  id: string;
  name: string;
  description?: string;
  createdBy: string;
  visibility: BoardVisibility;
  columns: BoardColumn[];
  memberCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface BoardColumn {
  id: string;
  boardId: string;
  name: string;
  color?: string;
  sortOrder: number;
}

export interface BoardCard {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  description?: string;
  assigneeId?: string;
  assigneeName?: string;
  dueDate?: string;
  color?: string;
  sortOrder: number;
  createdAt?: string;
  attachments?: Attachment[];
  attachmentCount?: number;
}

export interface BoardMember {
  id: string;
  boardId: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  role: BoardMemberRole;
}

// ── Project Hours (hourly contractor pay logging) ───

export type ProjectHourStatus = 'active' | 'finished';

export interface ProjectHours {
  id: string;
  name: string;
  description?: string;
  status: ProjectHourStatus;
  archivedAt?: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectHourEntry {
  id: string;
  projectId: string;
  entryDate: string; // YYYY-MM-DD
  hours: number;
  rate: number;
  note?: string;
  paidAt?: string; // set when settled; undefined = still owed
  createdBy?: string;
  createdAt?: string;
}

// ── E2E Encrypted Chat ──────────────────────────────

export type ConversationType = 'direct' | 'group';
export type ConversationMemberRole = 'admin' | 'member';
export type MessageType = 'text' | 'file' | 'system';

export interface UserEncryptionKeys {
  id: string;
  userId: string;
  publicKey: string;
  encryptedPrivateKey: string;
  keySalt: string;
  keyIv: string;
  algorithm: string;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  type: ConversationType;
  name?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  members?: ConversationMember[];
  lastMessage?: Message;
  unreadCount?: number;
}

export interface ConversationMember {
  id: string;
  conversationId: string;
  userId: string;
  userName?: string;
  userInitials?: string;
  encryptedConversationKey?: string;
  keyIv?: string;
  role: ConversationMemberRole;
  joinedAt: string;
  leftAt?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  senderName?: string;
  senderInitials?: string;
  encryptedContent: string;
  contentIv: string;
  messageType: MessageType;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  decryptedContent?: string;
  attachments?: MessageAttachment[];
  receipts?: MessageReceipt[];
}

export interface MessageReceipt {
  id: string;
  messageId: string;
  userId: string;
  userName?: string;
  deliveredAt?: string;
  readAt?: string;
}

export interface MessageAttachment {
  id: string;
  messageId: string;
  storagePath: string;
  encryptedFileKey: string;
  fileKeyIv: string;
  fileIv: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  decryptedUrl?: string;
}

// ── System Notifications ───────────────────────────────

export type SystemNotificationType =
  // Jobs & Boards
  | 'status_change'
  | 'assignment'
  | 'unassignment'
  | 'rush'
  | 'overdue'
  | 'comment_mention'
  | 'checklist_complete'
  | 'delivery_update'
  | 'variant_update'
  // Inventory
  | 'low_stock'
  | 'critical_stock'
  | 'allocation_complete'
  | 'allocation_reversal'
  | 'reorder_point_hit'
  // Time Clock & Shifts
  | 'shift_edit_approved'
  | 'shift_edit_requested'
  | 'clock_anomaly'
  | 'lunch_break_reminder'
  // Chat
  | 'chat_mention'
  | 'new_direct_message'
  | 'thread_reply'
  // Admin & Users
  | 'new_user_pending_approval'
  | 'user_approved'
  | 'user_rejected'
  | 'proposal_submitted'
  // Quotes & Proposals
  | 'new_customer_proposal'
  | 'quote_assigned'
  | 'quote_updated'
  // Deliveries
  | 'delivery_scheduled'
  | 'delivery_completed'
  | 'delivery_delayed'
  // Dashboard & System
  | 'daily_summary'
  | 'system_alert'
  | 'maintenance_notice'
  // Legacy (backward compat with existing DB rows)
  | 'mention'
  | 'delivery'
  | 'po_received';

export interface SystemNotification {
  id: string;
  userId: string;
  type: SystemNotificationType;
  title: string;
  message: string;
  link?: string;
  metadata?: Record<string, unknown>;
  readAt?: string;
  createdAt: string;
}

// ── Notification Preferences ─────────────────────────────

export type NotificationChannel = 'in_app' | 'email';

export interface NotificationPreferences {
  in_app: Partial<Record<SystemNotificationType, boolean>>;
  email: Partial<Record<SystemNotificationType, boolean>>;
}

export interface UserNotificationPreferences {
  userId: string;
  preferences: NotificationPreferences;
  updatedAt: string;
}

// ── Dashboard Preferences ───────────────────────────────

export interface DashboardPreferences {
  quickActionOrder: string[];
  hiddenQuickActions: string[];
}

export interface UserDashboardPreferences {
  userId: string;
  preferences: DashboardPreferences;
  updatedAt: string;
}
