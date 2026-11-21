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
 */
export function normalizeReceiptNumber(raw: string): string {
  if (!raw) return '';
  return raw.trim().toLowerCase();
}

/**
 * Builds the locked automatic receipt prefix from church code and Indian Financial Year
 * derived from the donation date: UPPER(CHURCH_CODE)/YYYY-YY/
 */
export function buildAutoReceiptPrefix(
  churchCode: string | null | undefined,
  donationDate: string | Date
): string {
  const cleanCode = (churchCode || 'CHURCH').trim().toUpperCase() || 'CHURCH';
  const fyCode = getFinancialYear(donationDate || new Date()).fyCode;
  return `${cleanCode}/${fyCode}/`;
}

/**
 * Builds the uppercase church code member ID prefix: UPPER(CHURCH_CODE)-
 * Example: "ABC-"
 */
export function buildChurchMemberPrefix(churchCode: string | null | undefined): string {
  const cleanCode = (churchCode || 'CHURCH').trim().toUpperCase() || 'CHURCH';
  return `${cleanCode}-`;
}

/**
 * Computes the next sequential church-code-prefixed member number (e.g. ABC-1, ABC-2)
 * using plain positive integers without leading zeros.
 * Existing legacy M-0001 member numbers are ignored so the church-code series starts at 1.
 */
export function computeNextChurchMemberNumber(
  churchCode: string | null | undefined,
  existingMemberNumbers: Array<string | null | undefined>
): string {
  const prefix = buildChurchMemberPrefix(churchCode);
  let maxSeq = 0;
  const taken = new Set<string>();

  for (const raw of existingMemberNumbers) {
    if (!raw || typeof raw !== 'string') continue;
    const upper = raw.trim().toUpperCase();
    if (!upper) continue;
    taken.add(upper);

    if (upper.startsWith(prefix)) {
      const suffix = upper.slice(prefix.length);
      if (/^[1-9][0-9]*$/.test(suffix)) {
        const parsed = Number(suffix);
        if (Number.isSafeInteger(parsed) && parsed > maxSeq) {
          maxSeq = parsed;
        }
      }
    }
  }

  let nextSeq = maxSeq + 1;
  while (taken.has(`${prefix}${nextSeq}`)) {
    nextSeq += 1;
  }

  return `${prefix}${nextSeq}`;
}

/**
 * Sanitizes receipt number input to digits only and strips all leading zeros.
 * Handles accidental pastes containing slashes by extracting the trailing segment first.
 */
export function sanitizeReceiptDigitsInput(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  const segment = raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw;
  const digitsOnly = segment.replace(/\D/g, '').slice(0, 20);
  return digitsOnly.replace(/^0+/, '');
}

/**
 * Validates the user-entered receipt number (positive integer digits only, no leading zeros).
 */
export function validateNumericReceiptSuffix(raw: string | undefined | null): {
  valid: boolean;
  error?: string;
  numericValue: string;
} {
  if (!raw || typeof raw !== 'string') {
    return { valid: false, error: 'Receipt number is required.', numericValue: '' };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: false, error: 'Receipt number cannot be blank.', numericValue: '' };
  }
  if (!/^[0-9]+$/.test(trimmed)) {
    return { valid: false, error: 'Receipt number must contain digits (0-9) only.', numericValue: '' };
  }
  if (trimmed.length > 20) {
    return { valid: false, error: 'Receipt number cannot exceed 20 digits.', numericValue: '' };
  }
  const stripped = trimmed.replace(/^0+/, '');
  if (!stripped) {
    return { valid: false, error: 'Receipt number must be greater than zero.', numericValue: '' };
  }
  return { valid: true, numericValue: stripped };
}

/**
 * Combines church code, donation date financial year, and positive numeric suffix
 * into the canonical receipt identifier and lowercase uniqueness key.
 */
export function buildFullReceiptNumber(
  churchCode: string | null | undefined,
  donationDate: string | Date,
  rawDigits: string | undefined | null
): {
  valid: boolean;
  error?: string;
  prefix: string;
  numericValue: string;
  fullReceiptNumber: string;
  normalizedKey: string;
} {
  const prefix = buildAutoReceiptPrefix(churchCode, donationDate);
  const validation = validateNumericReceiptSuffix(rawDigits);
  if (!validation.valid) {
    return {
      valid: false,
      error: validation.error,
      prefix,
      numericValue: '',
      fullReceiptNumber: '',
      normalizedKey: '',
    };
  }
  const fullReceiptNumber = `${prefix}${validation.numericValue}`;
  return {
    valid: true,
    prefix,
    numericValue: validation.numericValue,
    fullReceiptNumber,
    normalizedKey: fullReceiptNumber.toLowerCase(),
  };
}

/**
 * Extracts trailing positive integer digits (without leading zeros) from an existing receipt number.
 */
export function extractReceiptSuffixDigits(fullReceipt: string | null | undefined): string {
  if (!fullReceipt || typeof fullReceipt !== 'string') return '';
  const trimmed = fullReceipt.trim();
  if (!trimmed) return '';
  if (trimmed.includes('/')) {
    const tail = trimmed.slice(trimmed.lastIndexOf('/') + 1);
    const tailDigits = tail.replace(/\D/g, '').replace(/^0+/, '');
    if (tailDigits) return tailDigits;
  }
  const trailingMatch = /(\d+)$/.exec(trimmed);
  if (!trailingMatch) return '';
  return trailingMatch[1].replace(/^0+/, '');
}

/**
 * Validates a full receipt number string.
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
  | 'assign_collector_role' // Admin or Accountant (from church members)
  | 'create_member'
  | 'edit_member_basic' // Collector can edit name, contact phone
  | 'change_member_status' // ONLY Accountant
  | 'edit_village_name' // Admin, Accountant, and Collector
  | 'edit_gender' // Admin, Accountant, Collector, or Member (own profile)
  | 'create_donation' // Admin, Accountant, Collector
  | 'edit_donation' // Admin or Accountant only
  | 'cancel_donation' // Admin or Accountant only
  | 'correct_receipt_number' // Admin or Accountant only
  | 'approve_access_request' // Accountant only
  | 'generate_bulk_reports' // Admin or Accountant only (Collector CANNOT)
  | 'view_all_church_donations' // Admin, Accountant, Collector
  | 'view_own_donations_only' // Member
  | 'manage_member_share_links'; // Admin, Accountant, Collector

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

    case 'assign_collector_role':
      return role === 'platform_admin' || role === 'admin' || role === 'accountant'
        ? { allowed: true }
        : { allowed: false, reason: 'Only Church Admins and Accountants can assign Collector access.' };

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
      return role === 'platform_admin' || role === 'admin' || role === 'accountant' || role === 'collector'
        ? { allowed: true }
        : { allowed: false, reason: 'Members cannot modify Village Name.' };

    case 'edit_gender':
      return role === 'platform_admin' || role === 'admin' || role === 'accountant' || role === 'collector' || role === 'member'
        ? { allowed: true }
        : { allowed: false, reason: 'Insufficient privileges to update member Gender.' };

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

    case 'manage_member_share_links':
      return role === 'platform_admin' || role === 'admin' || role === 'accountant' || role === 'collector'
        ? { allowed: true }
        : { allowed: false, reason: 'Only church staff can generate or revoke member links.' };

    default:
      return { allowed: false, reason: 'Action not permitted.' };
  }
}

const ROLE_PRECEDENCE: Record<string, number> = {
  platform_admin: 0,
  admin: 1,
  accountant: 2,
  collector: 3,
  member: 4,
};

/**
 * Resolves the highest-privilege role when a user has multiple approved roles
 * in the same church (for example, 'member' + assigned 'collector').
 */
export function getHighestChurchRole(
  roles: Array<UserRole | string | null | undefined>
): UserRole | 'none' {
  let best: UserRole | 'none' = 'none';
  let bestRank = Number.MAX_SAFE_INTEGER;

  for (const r of roles) {
    if (!r || !(r in ROLE_PRECEDENCE)) continue;
    const rank = ROLE_PRECEDENCE[r];
    if (rank < bestRank) {
      bestRank = rank;
      best = r as UserRole;
    }
  }
  return best;
}

/**
 * Returns which staff roles the actor is permitted to assign within a church.
 * Accountants can assign 'collector' (from church members).
 * Admins and Platform Admins can assign 'collector', 'accountant', and 'admin'.
 */
export function getAssignableStaffRoles(
  actorRole: UserRole | 'none',
  isPlatformAdmin = false
): Array<'collector' | 'accountant' | 'admin'> {
  if (isPlatformAdmin || actorRole === 'platform_admin' || actorRole === 'admin') {
    return ['collector', 'accountant', 'admin'];
  }
  if (actorRole === 'accountant') {
    return ['collector'];
  }
  return [];
}

/**
 * Checks whether the actor may suspend or restore a specific staff assignment role.
 */
export function canManageStaffAssignmentStatus(
  actorRole: UserRole | 'none',
  targetRole: string,
  isPlatformAdmin = false
): boolean {
  if (isPlatformAdmin || actorRole === 'platform_admin' || actorRole === 'admin') {
    return targetRole === 'admin' || targetRole === 'accountant' || targetRole === 'collector';
  }
  if (actorRole === 'accountant') {
    return targetRole === 'collector';
  }
  return false;
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
 * Strips non-digit characters and removes an optional leading +91 / 91 / 0 prefix
 * so Indian mobile inputs store only the 10-digit mobile number.
 */
export function formatIndianMobileInput(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return '';
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  } else if (digits.length > 10 && digits.startsWith('91')) {
    digits = digits.slice(2);
  }
  return digits.slice(0, 10);
}

/**
 * Validates and normalizes Indian 10-digit mobile numbers without +91 prefix.
 * Accepts 10 digits starting with 6, 7, 8, or 9 (auto-stripping pasted +91 / 0 prefixes),
 * and rejects invalid lengths, non-Indian prefixes, or all-identical repeating digits.
 */
export function normalizePhoneNumber(phone: string | null | undefined): {
  normalized: string;
  valid: boolean;
  error?: string;
} {
  if (!phone || typeof phone !== 'string' || !phone.trim()) {
    return { normalized: '', valid: false, error: 'Mobile number is required.' };
  }
  const trimmed = phone.trim();
  // Allow digits, spaces, hyphens, parentheses, and an optional leading +
  if (!/^[+\d\s\-()]+$/.test(trimmed)) {
    return {
      normalized: trimmed,
      valid: false,
      error: 'Mobile number can only contain digits.',
    };
  }

  let cleaned = trimmed.replace(/[\s\-()]/g, '');
  if (cleaned.startsWith('+91') && cleaned.length === 13) {
    cleaned = cleaned.slice(3);
  } else if (cleaned.startsWith('91') && cleaned.length === 12) {
    cleaned = cleaned.slice(2);
  } else if (cleaned.startsWith('0') && cleaned.length === 11) {
    cleaned = cleaned.slice(1);
  }

  if (!/^[6-9][0-9]{9}$/.test(cleaned)) {
    return {
      normalized: trimmed,
      valid: false,
      error: 'Please enter a valid 10-digit Indian mobile number (starting with 6, 7, 8, or 9).',
    };
  }

  if (/^(\d)\1{9}$/.test(cleaned)) {
    return {
      normalized: trimmed,
      valid: false,
      error: 'Please enter a valid Indian mobile number (repeating digits are not allowed).',
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
}

/**
 * Validates member profile self-updates.
 * Members cannot alter their login or contact email from self-profile update.
 * Mandatory fields:
 * - fullName
 * - contactPhone (10-digit Indian mobile number)
 * - gender
 */
export function validateMemberSelfProfileUpdate(input: MemberSelfProfileInput): {
  valid: boolean;
  errors: Record<string, string>;
  normalized: {
    fullName: string;
    contactPhone: string;
    gender: Gender | null;
  };
} {
  const errors: Record<string, string> = {};

  const trimmedName = (input.fullName || '').trim();
  if (trimmedName.length === 0) {
    errors.fullName = 'Full name is required.';
  }

  const phoneValidation = normalizePhoneNumber(input.contactPhone);
  if (!phoneValidation.valid) {
    errors.contactPhone =
      phoneValidation.error || 'Valid 10-digit Indian mobile number is required.';
  }

  const validatedGender = validateGender(input.gender);
  if (!validatedGender) {
    errors.gender = 'Please select a gender option.';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    normalized: {
      fullName: trimmedName,
      contactPhone: phoneValidation.valid
        ? phoneValidation.normalized
        : (input.contactPhone || '').trim(),
      gender: validatedGender,
    },
  };
}

export interface NewChurchMemberInput {
  fullName: string;
  villageName: string;
  gender: Gender | '' | null | undefined;
  contactPhone?: string | null;
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
      dateOfBirth: trimmedDob.length > 0 ? trimmedDob : null,
    },
  };
}

/**
 * Builds a deduplicated, alphabetically sorted list of unique Village / City names
 * from raw database records (case-insensitive deduplication preserving first clean casing).
 */
export function buildVillageSuggestions(rawValues: Array<string | null | undefined>): string[] {
  const seen = new Map<string, string>();
  for (const raw of rawValues) {
    if (!raw || typeof raw !== 'string') continue;
    const trimmed = raw.trim().replace(/\s+/g, ' ');
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, trimmed);
    }
  }
  return Array.from(seen.values()).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );
}

/**
 * Filters database village suggestions against user input and determines
 * whether the typed value can be added as a brand-new entry.
 */
export function filterVillageSuggestions(
  suggestions: string[],
  query: string
): {
  matches: string[];
  canAddNew: boolean;
  trimmedQuery: string;
} {
  const trimmedQuery = (query || '').trim().replace(/\s+/g, ' ');
  if (!trimmedQuery) {
    return {
      matches: suggestions,
      canAddNew: false,
      trimmedQuery: '',
    };
  }

  const lower = trimmedQuery.toLowerCase();
  const prefixMatches: string[] = [];
  const substringMatches: string[] = [];
  let hasExactMatch = false;

  for (const item of suggestions) {
    const itemLower = item.toLowerCase();
    if (itemLower === lower) {
      hasExactMatch = true;
    }
    if (itemLower.startsWith(lower)) {
      prefixMatches.push(item);
    } else if (itemLower.includes(lower)) {
      substringMatches.push(item);
    }
  }

  return {
    matches: [...prefixMatches, ...substringMatches],
    canAddNew: !hasExactMatch,
    trimmedQuery,
  };
}

/**
 * Builds the unauthenticated single-use member portal URL.
 */
export function buildMemberPortalUrl(origin: string, rawToken: string): string {
  const cleanOrigin = (origin || '').replace(/\/+$/, '');
  const cleanToken = (rawToken || '').trim();
  return `${cleanOrigin}/member-portal?token=${encodeURIComponent(cleanToken)}`;
}

/**
 * Builds a WhatsApp click-to-chat URL with a polite single-use link message.
 */
export function buildMemberShareWhatsAppUrl(params: {
  phone?: string | null;
  memberName: string;
  churchName: string;
  portalUrl: string;
}): string {
  const digits = (params.phone || '').replace(/\D/g, '');
  let waPhone = '';
  if (/^[6-9]\d{9}$/.test(digits)) {
    waPhone = `91${digits}`;
  } else if (/^91[6-9]\d{9}$/.test(digits)) {
    waPhone = digits;
  }

  const text = `Hello ${params.memberName}, here is your personal single-use view-only link for ${params.churchName}. Please note this link expires automatically after you open it once:\n${params.portalUrl}`;
  const encodedText = encodeURIComponent(text);
  return waPhone
    ? `https://wa.me/${waPhone}?text=${encodedText}`
    : `https://wa.me/?text=${encodedText}`;
}

const RESERVED_CHURCH_SLUGS = new Set([
  'home',
  'privacy',
  'privacy-policy',
  'terms',
  'terms-of-service',
  'member-portal',
  'api',
  'auth',
  'login',
  'c',
  'assets',
  'favicon-ico',
  'robots-txt',
]);

/**
 * Normalizes user input while typing into a custom church URL slug field
 * (lowercase, replaces spaces/symbols with hyphens, preserves a trailing hyphen while typing).
 */
export function normalizeChurchSlugInput(value: string): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
    .slice(0, 64);
}

/**
 * Generates a clean finalized kebab-case slug suggestion from a church name or code.
 */
export function suggestChurchSlug(codeOrName: string): string {
  const cleaned = normalizeChurchSlugInput(codeOrName).replace(/-+$/, '');
  return cleaned.slice(0, 64);
}

/**
 * Validates and finalizes a custom church URL slug before saving.
 */
export function validateChurchSlug(slug: string): {
  valid: boolean;
  normalized: string;
  error?: string;
} {
  const normalized = normalizeChurchSlugInput(slug).replace(/-+$/, '');

  if (!normalized) {
    return { valid: false, normalized, error: 'Church URL slug is required.' };
  }
  if (normalized.length < 2) {
    return {
      valid: false,
      normalized,
      error: 'URL slug must be at least 2 characters long.',
    };
  }
  if (normalized.length > 64) {
    return {
      valid: false,
      normalized,
      error: 'URL slug cannot exceed 64 characters.',
    };
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)) {
    return {
      valid: false,
      normalized,
      error: 'Use lowercase letters, numbers, and single hyphens only.',
    };
  }
  if (RESERVED_CHURCH_SLUGS.has(normalized)) {
    return {
      valid: false,
      normalized,
      error: `"${normalized}" is a reserved application route. Please choose another slug.`,
    };
  }

  return { valid: true, normalized };
}

/**
 * Extracts a church slug from root-level URL paths formatted as /<slug>.
 */
export function extractChurchSlugFromPath(pathname: string): string | null {
  const clean = (pathname || '').replace(/\/+$/, '');
  const match = /^\/([^/]+)$/.exec(clean);
  if (!match) return null;

  try {
    const decoded = decodeURIComponent(match[1]);
    const validation = validateChurchSlug(decoded);
    return validation.valid ? validation.normalized : null;
  } catch {
    return null;
  }
}

/**
 * Builds the full shareable login and member onboarding URL for a church.
 */
export function buildChurchPortalUrl(origin: string, slug: string): string {
  const cleanOrigin = (origin || '').replace(/\/+$/, '');
  const cleanSlug = suggestChurchSlug(slug);
  return `${cleanOrigin}/${cleanSlug}`;
}
