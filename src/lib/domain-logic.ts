/**
 * Pure domain logic for Church Management System
 * Decoupled, fully unit-tested business rules & validations.
 */

export type UserRole = 'platform_admin' | 'admin' | 'accountant' | 'collector' | 'member';
export type MembershipStatus = 'active' | 'inactive';
export type Gender = 'male' | 'female' | 'other' | 'prefer_not_to_say';

export interface FinancialYearInfo {
  fyCode: string; // e.g. "2026-27"
  label: string; // e.g. "FY 2026–27"
  startDate: string; // "2026-04-01"
  endDate: string; // "2027-03-31"
  startYear: number;
  endYear: number;
}

/**
 * Normalizes a receipt number for case-insensitive, whitespace-trimmed uniqueness comparison.
 * Preserves leading zeroes.
 */
export function normalizeReceiptNumber(raw: string): string {
  if (!raw) return '';
  return raw.trim().toLowerCase();
}

/**
 * Validates a manually entered receipt number.
 */
export function validateReceiptNumber(raw: string | undefined | null): {
  valid: boolean;
  error?: string;
  normalized: string;
} {
  if (!raw || typeof raw !== 'string') {
    return { valid: false, error: 'Receipt number is required.', normalized: '' };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: 'Receipt number cannot be blank.', normalized: '' };
  }
  if (trimmed.length > 50) {
    return { valid: false, error: 'Receipt number cannot exceed 50 characters.', normalized: '' };
  }
  return { valid: true, normalized: trimmed.toLowerCase() };
}

/**
 * Suggests a receipt number prefix based on the financial year and optional receipt book code.
 */
export function suggestReceiptPrefix(fyCode: string, bookCode?: string): string {
  const cleanFy = fyCode.trim();
  if (bookCode && bookCode.trim()) {
    return `${bookCode.trim().toUpperCase()}/${cleanFy}/`;
  }
  return `REC/${cleanFy}/`;
}

/**
 * Calculates Indian Financial Year (1 April through 31 March) from a date.
 * Asia/Kolkata timezone friendly.
 */
export function getFinancialYear(dateInput: string | Date): FinancialYearInfo {
  let date: Date;
  if (typeof dateInput === 'string') {
    // Parse "YYYY-MM-DD" or ISO string
    const parts = dateInput.split('T')[0].split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1; // 0-indexed
      const day = parseInt(parts[2], 10);
      date = new Date(year, month, day);
    } else {
      date = new Date(dateInput);
    }
  } else {
    date = dateInput;
  }

  const year = date.getFullYear();
  const month = date.getMonth() + 1; // 1-12 (1 = Jan, 4 = April)

  let startYear: number;
  let endYear: number;

  if (month >= 4) {
    // April 1 through Dec 31
    startYear = year;
    endYear = year + 1;
  } else {
    // Jan 1 through March 31
    startYear = year - 1;
    endYear = year;
  }

  const endShort = String(endYear).slice(-2);
  const fyCode = `${startYear}-${endShort}`;
  const label = `FY ${startYear}–${endShort}`;
  const startDate = `${startYear}-04-01`;
  const endDate = `${endYear}-03-31`;

  return {
    fyCode,
    label,
    startDate,
    endDate,
    startYear,
    endYear,
  };
}

/**
 * Computes list of recent financial years for selection dropdowns.
 */
export function getFinancialYearOptions(count = 5): FinancialYearInfo[] {
  const current = getFinancialYear(new Date());
  const list: FinancialYearInfo[] = [];
  for (let i = 0; i < count; i++) {
    const startYear = current.startYear - i;
    const endYear = startYear + 1;
    const endShort = String(endYear).slice(-2);
    list.push({
      fyCode: `${startYear}-${endShort}`,
      label: `FY ${startYear}–${endShort}`,
      startDate: `${startYear}-04-01`,
      endDate: `${endYear}-03-31`,
      startYear,
      endYear,
    });
  }
  return list;
}

export interface DonorRankingInput {
  memberId: string;
  memberName: string;
  totalAmount: number;
  isActive: boolean;
  memberNumber?: string;
}

export interface DonorRankedOutput extends DonorRankingInput {
  rank: number;
}

/**
 * Standard competition ranking (1, 2, 2, 4).
 * Inactive members' valid donations are included in totals and ranking.
 * Ranking ties depend on total amount only.
 * Secondary stable ordering by memberName then memberId for consistent display.
 */
export function calculateRankings(donors: DonorRankingInput[]): DonorRankedOutput[] {
  // Sort primarily by totalAmount descending, secondarily by memberName ascending, then memberId
  const sorted = [...donors].sort((a, b) => {
    if (b.totalAmount !== a.totalAmount) {
      return b.totalAmount - a.totalAmount;
    }
    const nameDiff = a.memberName.localeCompare(b.memberName);
    if (nameDiff !== 0) return nameDiff;
    return a.memberId.localeCompare(b.memberId);
  });

  const ranked: DonorRankedOutput[] = [];
  let currentRank = 1;

  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    if (i > 0) {
      const prev = sorted[i - 1];
      if (item.totalAmount === prev.totalAmount) {
        // Equal rank
        ranked.push({ ...item, rank: ranked[i - 1].rank });
      } else {
        // Competition rank: current rank is 1 + index
        currentRank = i + 1;
        ranked.push({ ...item, rank: currentRank });
      }
    } else {
      ranked.push({ ...item, rank: 1 });
    }
  }

  return ranked;
}

/**
 * Validates whether a user can change membership status (active <-> inactive).
 * STRICT BUSINESS RULE:
 * "Only a user with an explicit, current Accountant assignment for the member's church may change membership status.
 * Do not let platform Admin access implicitly satisfy this permission.
 * An Admin would require a separate authorized Accountant assignment for the relevant church to perform this operation.
 * Require a reason for Active-to-Inactive and Inactive-to-Active changes."
 */
export function validateMemberStatusChange(
  actor: { isPlatformAdmin: boolean; churchRoles: string[] },
  currentStatus: MembershipStatus,
  newStatus: MembershipStatus,
  reason?: string
): { allowed: boolean; error?: string } {
  // Check if actor has explicit 'accountant' role in this church
  const hasAccountantRole = actor.churchRoles.includes('accountant');
  if (!hasAccountantRole) {
    return {
      allowed: false,
      error: 'Only users with an explicit Accountant assignment for this church can change membership status. Platform Admin access alone does not grant this permission.',
    };
  }

  if (currentStatus === newStatus) {
    return {
      allowed: false,
      error: `Member is already ${currentStatus}.`,
    };
  }

  if (!reason || reason.trim().length < 3) {
    return {
      allowed: false,
      error: 'A clear reason of at least 3 characters is strictly required to change membership status.',
    };
  }

  return { allowed: true };
}

/**
 * Checks role-based action permissions according to specification.
 */
export type PermittedAction =
  | 'create_church'
  | 'manage_staff_roles'
  | 'create_member'
  | 'edit_member_basic' // Collector can edit name, contact phone, contact email
  | 'change_member_status' // ONLY Accountant
  | 'edit_village_name' // Admin and Accountant
  | 'edit_gender' // Admin, Accountant, or Member (own profile)
  | 'create_donation' // Admin, Accountant, Collector
  | 'edit_donation' // Admin or Accountant only
  | 'cancel_donation' // Admin or Accountant only
  | 'correct_receipt_number' // Admin or Accountant only
  | 'approve_access_request' // Accountant only
  | 'generate_bulk_reports' // Admin or Accountant only (Collector CANNOT)
  | 'view_all_church_donations' // Admin, Accountant, Collector
  | 'view_own_donations_only'; // Member

export function checkRolePermission(
  role: UserRole | 'none',
  action: PermittedAction
): { allowed: boolean; reason?: string } {
  if (role === 'none') {
    return { allowed: false, reason: 'No access permissions granted for this church.' };
  }

  switch (action) {
    case 'create_church':
    case 'manage_staff_roles':
      return role === 'platform_admin' || role === 'admin'
        ? { allowed: true }
        : { allowed: false, reason: 'Requires Admin privileges.' };

    case 'create_member':
      return role === 'platform_admin' || role === 'admin' || role === 'accountant'
        ? { allowed: true }
        : { allowed: false, reason: 'Collectors and Members cannot register new members.' };

    case 'edit_member_basic':
      return role === 'platform_admin' || role === 'admin' || role === 'accountant' || role === 'collector'
        ? { allowed: true }
        : { allowed: false, reason: 'Insufficient privileges.' };

    case 'change_member_status':
      return role === 'accountant'
        ? { allowed: true }
        : { allowed: false, reason: 'Strictly restricted to church Accountants.' };

    case 'edit_village_name':
      return role === 'platform_admin' || role === 'admin' || role === 'accountant'
        ? { allowed: true }
        : { allowed: false, reason: 'Collectors and Members cannot modify Village Name.' };

    case 'edit_gender':
      return role === 'platform_admin' || role === 'admin' || role === 'accountant' || role === 'member'
        ? { allowed: true }
        : { allowed: false, reason: 'Collectors cannot update member Gender.' };

    case 'create_donation':
      return role === 'platform_admin' || role === 'admin' || role === 'accountant' || role === 'collector'
        ? { allowed: true }
        : { allowed: false, reason: 'Members cannot record donations.' };

    case 'edit_donation':
    case 'cancel_donation':
    case 'correct_receipt_number':
      return role === 'platform_admin' || role === 'admin' || role === 'accountant'
        ? { allowed: true }
        : { allowed: false, reason: 'Collectors cannot edit or cancel donations.' };

    case 'approve_access_request':
      return role === 'accountant'
        ? { allowed: true }
        : { allowed: false, reason: 'Only church Accountants can verify and approve member access.' };

    case 'generate_bulk_reports':
      return role === 'platform_admin' || role === 'admin' || role === 'accountant'
        ? { allowed: true }
        : { allowed: false, reason: 'Collectors cannot generate bulk financial or member exports.' };

    case 'view_all_church_donations':
      return role === 'platform_admin' || role === 'admin' || role === 'accountant' || role === 'collector'
        ? { allowed: true }
        : { allowed: false, reason: 'Members can only view their own donations.' };

    case 'view_own_donations_only':
      return { allowed: true };

    default:
      return { allowed: false, reason: 'Action not permitted.' };
  }
}

/**
 * Validates Gender values.
 * NULL means not provided and is distinct from 'prefer_not_to_say'.
 */
export function validateGender(
  val: string | null | undefined
): Gender | null {
  if (val === null || val === undefined || val === '') {
    return null;
  }
  const normalized = val.trim().toLowerCase();
  if (normalized === 'male' || normalized === 'female' || normalized === 'other' || normalized === 'prefer_not_to_say') {
    return normalized as Gender;
  }
  return null;
}

export const GENDER_LABELS: Record<Gender, string> = {
  male: 'Male',
  female: 'Female',
  other: 'Other',
  prefer_not_to_say: 'Prefer not to say',
};

/**
 * Standard SMS confirmation message formatting.
 * “Thank you, {member_name}. {church_name} has recorded your donation of INR {amount} towards {category} on {donation_date}. Receipt: {receipt_number}.”
 */
export function formatSmsMessage(vars: {
  memberName: string;
  churchName: string;
  amount: number | string;
  category: string;
  donationDate: string;
  receiptNumber: string;
}): string {
  const formattedAmount = Number(vars.amount).toFixed(2);
  return `Thank you, ${vars.memberName}. ${vars.churchName} has recorded your donation of INR ${formattedAmount} towards ${vars.category} on ${vars.donationDate}. Receipt: ${vars.receiptNumber}.`;
}

/**
 * Sanitizes cell contents for Excel export to prevent CSV / formula injection.
 * Escapes leading =, +, -, @, \t, \r with a leading single quote.
 */
export function sanitizeExcelCell(val: unknown): unknown {
  if (typeof val !== 'string') {
    return val;
  }
  const dangerousChars = ['=', '+', '-', '@', '\t', '\r'];
  if (val.length > 0 && dangerousChars.includes(val[0])) {
    return `'${val}`;
  }
  return val;
}

/**
 * Formats Indian Currency (INR) with 2 decimals.
 */
export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Validates Date of Birth according to strict domain rules:
 * - Must be a valid calendar date format (YYYY-MM-DD)
 * - Must not be in the future
 * - Must not be more than 150 years in the past
 */
export function validateDateOfBirth(dob: string | null | undefined): {
  valid: boolean;
  error?: string;
} {
  if (!dob || typeof dob !== 'string' || !dob.trim()) {
    return { valid: false, error: 'Date of birth is required.' };
  }
  const trimmed = dob.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) {
    return { valid: false, error: 'Date of birth must be in YYYY-MM-DD format.' };
  }
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;
  const day = parseInt(match[3], 10);

  const parsed = new Date(year, month, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month ||
    parsed.getDate() !== day
  ) {
    return { valid: false, error: 'Invalid calendar date.' };
  }

  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (parsed > today) {
    return { valid: false, error: 'Date of birth cannot be in the future.' };
  }

  const minDate = new Date();
  minDate.setFullYear(minDate.getFullYear() - 150);
  if (parsed < minDate) {
    return { valid: false, error: 'Please enter a realistic date of birth.' };
  }

  return { valid: true };
}

/**
 * Normalizes phone numbers (e.g. +91 98765 43210 -> +919876543210).
 */
export function normalizePhoneNumber(phone: string | null | undefined): {
  normalized: string;
  valid: boolean;
  error?: string;
} {
  if (!phone || typeof phone !== 'string' || !phone.trim()) {
    return { normalized: '', valid: false, error: 'Phone number is required.' };
  }
  const trimmed = phone.trim();
  // Strip spaces, dashes, parentheses
  const cleaned = trimmed.replace(/[\s\-()]/g, '');
  if (!/^\+?[0-9]{6,15}$/.test(cleaned)) {
    return {
      normalized: trimmed,
      valid: false,
      error: 'Please enter a valid phone number (at least 6 digits).',
    };
  }
  return { normalized: cleaned, valid: true };
}

export interface OnboardingProfileInput {
  fullName: string;
  dateOfBirth: string;
  phone: string;
  gender: Gender | '';
  villageName: string;
  churchId: string;
  isDraft?: boolean;
}

/**
 * Validates onboarding profile submissions.
 * When isDraft is true, incomplete fields are allowed.
 * When isDraft is false, all fields are strictly required.
 */
export function validateOnboardingProfile(
  input: OnboardingProfileInput
): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  if (!input.churchId || !input.churchId.trim()) {
    errors.churchId = 'Please select a church.';
  }

  // Drafts only require church selection
  if (input.isDraft) {
    return { valid: Object.keys(errors).length === 0, errors };
  }

  // Full validation for final submission
  if (!input.fullName || input.fullName.trim().length === 0) {
    errors.fullName = 'Full name is required.';
  }

  const dobValidation = validateDateOfBirth(input.dateOfBirth);
  if (!dobValidation.valid) {
    errors.dateOfBirth = dobValidation.error || 'Invalid date of birth.';
  }

  const phoneValidation = normalizePhoneNumber(input.phone);
  if (!phoneValidation.valid) {
    errors.phone = phoneValidation.error || 'Invalid phone number.';
  }

  const genderVal = validateGender(input.gender);
  if (!genderVal) {
    errors.gender = 'Please select a gender option.';
  }

  if (!input.villageName || input.villageName.trim().length === 0) {
    errors.villageName = 'Village / City Name is required.';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

export type MergeChoice = 'existing' | 'applicant' | 'custom';

export interface FieldMergeOption<T> {
  existingValue: T | null;
  applicantValue: T | null;
  choice: MergeChoice;
  customValue?: T | null;
}

/**
 * Resolves a single field value based on Accountant selection
 */
export function resolveReviewedField<T>(
  existingValue: T | null | undefined,
  applicantValue: T | null | undefined,
  choice: MergeChoice,
  customValue?: T | null
): T | null {
  if (choice === 'custom' && customValue !== undefined && customValue !== null && customValue !== '') {
    return customValue;
  }
  if (choice === 'applicant' && applicantValue !== undefined && applicantValue !== null && applicantValue !== '') {
    return applicantValue;
  }
  return existingValue ?? null;
}

export interface MemberSelfProfileInput {
  fullName: string;
  contactPhone: string;
  gender: Gender | '' | null | undefined;
  contactEmail?: string | null;
}

/**
 * Validates member profile self-updates.
 * Mandatory fields:
 * - fullName
 * - contactPhone
 * - gender
 * Optional field:
 * - contactEmail (validated for format only if provided)
 */
export function validateMemberSelfProfileUpdate(input: MemberSelfProfileInput): {
  valid: boolean;
  errors: Record<string, string>;
  normalized: {
    fullName: string;
    contactPhone: string;
    gender: Gender | null;
    contactEmail: string | null;
  };
} {
  const errors: Record<string, string> = {};

  const trimmedName = (input.fullName || '').trim();
  if (trimmedName.length === 0) {
    errors.fullName = 'Full name is required.';
  }

  const phoneValidation = normalizePhoneNumber(input.contactPhone);
  if (!phoneValidation.valid) {
    errors.contactPhone = phoneValidation.error || 'Valid phone number is required.';
  }

  const validatedGender = validateGender(input.gender);
  if (!validatedGender) {
    errors.gender = 'Please select a gender option.';
  }

  const trimmedEmail = (input.contactEmail || '').trim();
  if (trimmedEmail.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    errors.contactEmail = 'Please enter a valid contact email address.';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    normalized: {
      fullName: trimmedName,
      contactPhone: phoneValidation.valid ? phoneValidation.normalized : (input.contactPhone || '').trim(),
      gender: validatedGender,
      contactEmail: trimmedEmail.length > 0 ? trimmedEmail : null,
    },
  };
}

export interface NewChurchMemberInput {
  fullName: string;
  villageName: string;
  gender: Gender | '' | null | undefined;
  contactPhone?: string | null;
  contactEmail?: string | null;
  dateOfBirth?: string | null;
}

/**
 * Validates creating a new church member.
 * Mandatory fields:
 * - fullName
 * - villageName
 * - gender
 */
export function validateNewChurchMember(input: NewChurchMemberInput): {
  valid: boolean;
  errors: Record<string, string>;
  normalized: {
    fullName: string;
    villageName: string;
    gender: Gender | null;
    contactPhone: string | null;
    contactEmail: string | null;
    dateOfBirth: string | null;
  };
} {
  const errors: Record<string, string> = {};

  const trimmedName = (input.fullName || '').trim();
  if (trimmedName.length === 0) {
    errors.fullName = 'Full Name is required.';
  }

  const trimmedVillage = (input.villageName || '').trim();
  if (trimmedVillage.length === 0) {
    errors.villageName = 'Village / City Name is required.';
  }

  const validatedGender = validateGender(input.gender);
  if (!validatedGender) {
    errors.gender = 'Gender is required.';
  }

  const trimmedPhone = (input.contactPhone || '').trim();
  let normalizedPhone: string | null = trimmedPhone.length > 0 ? trimmedPhone : null;
  if (trimmedPhone.length > 0) {
    const phoneRes = normalizePhoneNumber(trimmedPhone);
    if (!phoneRes.valid) {
      errors.contactPhone = phoneRes.error || 'Please enter a valid phone number.';
    } else {
      normalizedPhone = phoneRes.normalized;
    }
  }

  const trimmedEmail = (input.contactEmail || '').trim();
  if (trimmedEmail.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    errors.contactEmail = 'Please enter a valid contact email address.';
  }

  const trimmedDob = (input.dateOfBirth || '').trim();
  if (trimmedDob.length > 0) {
    const dobRes = validateDateOfBirth(trimmedDob);
    if (!dobRes.valid) {
      errors.dateOfBirth = dobRes.error || 'Please enter a valid date of birth.';
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    normalized: {
      fullName: trimmedName,
      villageName: trimmedVillage,
      gender: validatedGender,
      contactPhone: normalizedPhone,
      contactEmail: trimmedEmail.length > 0 ? trimmedEmail : null,
      dateOfBirth: trimmedDob.length > 0 ? trimmedDob : null,
    },
  };
}
