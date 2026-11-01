export type ProjectStatus = "draft" | "awaiting_approval" | "changes_requested" | "active" | "completed" | "cancelled";

export type Client = { id: string; name: string; email: string; company: string | null; phone?: string | null; notes?: string | null; billing_address?: string | null; gstin?: string | null };

export type PricingType = "fixed" | "hourly";
export type QuotePricing = {
  subtotal_cents: number;
  discount_bps: number;
  discount_cents: number;
  tax_label: string | null;
  tax_bps: number;
  tax_cents: number;
  total_cents: number;
};

export type Project = {
  id: string;
  owner_id: string;
  client_id: string;
  title: string;
  summary: string | null;
  currency: string;
  budget_cents: number;
  approved_extras_cents: number;
  start_date: string | null;
  due_date: string | null;
  extra_days: number;
  exclusions: string | null;
  terms: string | null;
  extra_revision_cents: number | null;
  discount_bps?: number | null;
  tax_bps?: number | null;
  tax_label?: string | null;
  status: ProjectStatus;
  approved_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Deliverable = {
  id: string;
  project_id: string;
  position: number;
  title: string;
  description: string | null;
  revisions_included: number;
  progress?: import("./progress").Progress;
  progress_updated_at?: string | null;
  pricing_type?: PricingType | null;
  hours?: string | number | null;
  rate_cents?: number | null;
  amount_cents?: number | null;
};

export type Milestone = {
  id: string;
  project_id: string;
  position: number;
  title: string;
  amount_cents: number;
  due_date: string | null;
  status: "pending" | "paid";
  paid_at: string | null;
  payment_note: string | null;
  change_order_id: string | null;
  /** Money received so far (part payments add up). */
  paid_cents?: number;
};

export type ScopeData = {
  title: string;
  summary: string | null;
  currency: string;
  budget_cents: number;
  start_date: string | null;
  due_date: string | null;
  /** v1.1 — absent on scopes sent before these fields existed. */
  exclusions?: string | null;
  terms?: string | null;
  extra_revision_cents?: number | null;
  /** v1.2 — itemised quote totals; null/absent when deliverables aren't priced. */
  pricing?: QuotePricing | null;
  /** email is present for the freelancer; the public portal omits it. */
  client: { name: string; company: string | null; email?: string };
  deliverables: {
    id: string;
    title: string;
    description: string | null;
    revisions_included: number;
    pricing_type?: PricingType | null;
    hours?: string | number | null;
    rate_cents?: number | null;
    amount_cents?: number | null;
  }[];
  milestones: { title: string; amount_cents: number; due_date: string | null }[];
};

export type ScopeSnapshot = {
  id: string;
  project_id: string;
  version: number;
  data: ScopeData;
  content_hash: string;
  created_at: string;
};

export type ScopeDecision = {
  id: string;
  snapshot_id: string;
  decision: "approved" | "rejected";
  comment: string | null;
  client_name: string;
  content_hash: string;
  created_at: string;
};

export type RevisionRequest = {
  id: string;
  project_id: string;
  deliverable_id: string | null;
  kind: "revision" | "new_work";
  description: string;
  requested_by: string;
  in_scope: boolean;
  revision_number: number | null;
  status: "open" | "resolved" | "converted";
  resolution_note: string | null;
  created_at: string;
  resolved_at: string | null;
};

export type ChangeOrder = {
  id: string;
  project_id: string;
  number: number;
  revision_request_id: string | null;
  title: string;
  description: string | null;
  pricing_type: "fixed" | "hourly";
  hours: string | null;
  hourly_rate_cents: number | null;
  amount_cents: number;
  additional_days: number;
  status: "sent" | "approved" | "rejected" | "withdrawn";
  decided_at: string | null;
  work_completed_at: string | null;
  created_at: string;
};

export type ActivityEntry = {
  id: string;
  project_id: string;
  actor: "freelancer" | "client" | "system";
  actor_name: string | null;
  event: string;
  summary: string;
  metadata?: Record<string, unknown>;
  created_at: string;
};

export type ShareLinkStatus = {
  id: string;
  project_id: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
};

/** Shape returned by public.portal_view(). */
export type PortalView = {
  project: {
    title: string;
    status: ProjectStatus;
    currency: string;
    budget_cents: number;
    approved_extras_cents: number;
    start_date: string | null;
    due_date: string | null;
    extra_days: number;
    approved_at: string | null;
  };
  freelancer: { name: string };
  /** UPI details for rupee projects (null otherwise). */
  payment?: { upi_id: string; payee_name: string | null } | null;
  client: { name: string; company: string | null };
  snapshot: null | {
    id: string;
    version: number;
    data: ScopeData;
    content_hash: string;
    created_at: string;
    decision: null | { decision: "approved" | "rejected"; comment: string | null; client_name: string; created_at: string };
  };
  deliverables: {
    id: string;
    title: string;
    description: string | null;
    revisions_included: number;
    revisions_used: number;
    /** Rounds requested beyond the included ones (v1.1; absent before). */
    revisions_extra?: number;
    progress?: import("./progress").Progress;
    progress_updated_at?: string | null;
  }[];
  revision_requests: {
    id: string;
    kind: "revision" | "new_work";
    description: string;
    deliverable_title: string | null;
    in_scope: boolean;
    revision_number: number | null;
    status: "open" | "resolved" | "converted";
    resolution_note: string | null;
    created_at: string;
  }[];
  change_orders: {
    id: string;
    number: number;
    title: string;
    description: string | null;
    pricing_type: "fixed" | "hourly";
    hours: number | null;
    hourly_rate_cents: number | null;
    amount_cents: number;
    additional_days: number;
    status: "sent" | "approved" | "rejected";
    created_at: string;
    decided_at: string | null;
    work_completed_at: string | null;
    decision: null | { client_name: string; comment: string | null; created_at: string };
  }[];
  milestones: { title: string; amount_cents: number; due_date: string | null; status: "pending" | "paid"; paid_at: string | null; paid_cents?: number; invoice_number?: string | null }[];
  /** Invoices the freelancer issued for this project (void ones are hidden). */
  invoices?: (import("./invoice").InvoiceDoc & { paid: boolean; paid_at: string | null; paid_cents?: number })[];
};
