/**
 * Database Types for Church Management System
 */

export type UserRole = 'platform_admin' | 'admin' | 'accountant' | 'collector' | 'member';
export type MembershipStatus = 'active' | 'inactive';
export type AccessStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'returned_for_correction' | 'suspended';
export type Gender = 'male' | 'female' | 'other' | 'prefer_not_to_say';
export type PaymentMethod = 'Cash' | 'UPI' | 'Bank Transfer' | 'Cheque' | 'Other';
export type AccountType = 'cash' | 'bank';
export type ReceiptStatus = 'active' | 'cancelled' | 'corrected_old';
export type RevisionType = 'created' | 'corrected' | 'cancelled';
export type SmsJobStatus = 'not_configured' | 'queued' | 'submitted' | 'delivered' | 'failed' | 'unknown';

export interface Church {
  id: string;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  receipt_prefix: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlatformAdmin {
  user_id: string;
  notes: string | null;
  created_at: string;
  created_by: string | null;
}

export interface ChurchAccess {
  id: string;
  church_id: string;
  user_id: string;
  role: 'admin' | 'accountant' | 'collector' | 'member';
  status: 'approved' | 'suspended';
  granted_at: string;
  granted_by: string | null;
  notes: string | null;
  church?: Church;
  profile?: Profile;
}

export interface Member {
  id: string;
  church_id: string;
  member_number: string;
  full_name: string;
  contact_phone: string | null;
  contact_email: string | null;
  village_name: string | null;
  gender: Gender | null;
  date_of_birth?: string | null;
  joining_date: string;
  membership_status: MembershipStatus;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface MemberAccountLink {
  id: string;
  church_id: string;
  member_id: string;
  user_id: string;
  linked_at: string;
  linked_by: string | null;
  member?: Member;
  profile?: Profile;
}

export interface AccessRequest {
  id: string;
  church_id: string;
  user_id: string;
  applicant_name: string;
  applicant_email: string;
  applicant_phone: string | null;
  date_of_birth?: string | null;
  gender?: Gender | null;
  village_name?: string | null;
  submission_version: number;
  is_draft: boolean;
  reviewed_fields_snapshot?: Record<string, unknown> | null;
  status: AccessStatus;
  requested_at: string;
  decided_at: string | null;
  decided_by: string | null;
  decision_reason: string | null;
  linked_member_id: string | null;
  church?: Church;
}

export interface DonationCategory {
  id: string;
  church_id: string;
  name: string;
  code: string;
  is_active: boolean;
  created_at: string;
}

export interface ReceivingAccount {
  id: string;
  church_id: string;
  account_name: string;
  account_type: AccountType;
  bank_name: string | null;
  account_number_mask: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Donation {
  id: string;
  church_id: string;
  member_id: string;
  receipt_number: string;
  donation_date: string;
  category_id: string;
  amount: number;
  receiving_account_id: string;
  payment_method: PaymentMethod;
  payment_reference: string | null;
  notes: string | null;
  idempotency_key: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  deletion_reason: string | null;
  member?: Member;
  category?: DonationCategory;
  receiving_account?: ReceivingAccount;
}

export interface ReceiptRegistryEntry {
  id: string;
  church_id: string;
  normalized_receipt_number: string;
  original_receipt_number: string;
  donation_id: string;
  status: ReceiptStatus;
  reserved_at: string;
  reserved_by: string | null;
}

export interface DonationRevision {
  id: string;
  donation_id: string;
  church_id: string;
  revision_number: number;
  change_type: RevisionType;
  previous_snapshot: Partial<Donation> | null;
  new_snapshot: Partial<Donation>;
  actor_user_id: string | null;
  reason: string | null;
  created_at: string;
  actor_profile?: Profile;
}

export interface AuditLog {
  id: string;
  church_id: string | null;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  change_summary: string;
  previous_state: Record<string, unknown> | null;
  new_state: Record<string, unknown> | null;
  reason: string | null;
  client_ip: string | null;
  created_at: string;
  actor_profile?: Profile;
}

export interface ChurchSetting {
  church_id: string;
  setting_key: string;
  setting_value: Record<string, unknown>;
  updated_at: string;
  updated_by: string | null;
}

export interface NotificationItem {
  id: string;
  church_id: string;
  recipient_user_id: string;
  title: string;
  message: string;
  read: boolean;
  created_at: string;
}

export interface NotificationJob {
  id: string;
  church_id: string;
  donation_id: string | null;
  recipient_phone: string;
  recipient_name: string;
  message_body: string;
  status: SmsJobStatus;
  provider: string | null;
  external_id: string | null;
  attempts_count: number;
  last_attempt_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationAttempt {
  id: string;
  job_id: string;
  attempt_number: number;
  status: string;
  response_payload: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
}

export interface ReportExport {
  id: string;
  church_id: string;
  report_type: string;
  financial_year: string;
  filters: Record<string, unknown> | null;
  row_count: number;
  generated_by: string | null;
  file_name: string;
  created_at: string;
}
