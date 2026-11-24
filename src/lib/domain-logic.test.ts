import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getFinancialYear,
  normalizeReceiptNumber,
  validateReceiptNumber,
  buildAutoReceiptPrefix,
  sanitizeReceiptDigitsInput,
  validateNumericReceiptSuffix,
  buildFullReceiptNumber,
  extractReceiptSuffixDigits,
  calculateRankings,
  validateMemberStatusChange,
  checkRolePermission,
  validateGender,
  formatSmsMessage,
  sanitizeExcelCell,
  formatINR,
  validateDateOfBirth,
  normalizePhoneNumber,
  validateOnboardingProfile,
  resolveReviewedField,
  validateMemberSelfProfileUpdate,
  validateNewChurchMember,
  buildVillageSuggestions,
  filterVillageSuggestions,
  getHighestChurchRole,
  getAssignableStaffRoles,
  canManageStaffAssignmentStatus,
} from './domain-logic';

test('Financial Year boundary: 31 March falls into ending FY, 1 April falls into next FY', () => {
  // March 31, 2026 is the last day of FY 2025-26
  const fyMarch31 = getFinancialYear('2026-03-31');
  assert.equal(fyMarch31.fyCode, '2025-26');
  assert.equal(fyMarch31.label, 'FY 2025–26');
  assert.equal(fyMarch31.startDate, '2025-04-01');
  assert.equal(fyMarch31.endDate, '2026-03-31');

  // April 1, 2026 is the first day of FY 2026-27
  const fyApril1 = getFinancialYear('2026-04-01');
  assert.equal(fyApril1.fyCode, '2026-27');
  assert.equal(fyApril1.label, 'FY 2026–27');
  assert.equal(fyApril1.startDate, '2026-04-01');
  assert.equal(fyApril1.endDate, '2027-03-31');

  // Mid-year check: November 8, 2026
  const fyNov = getFinancialYear('2026-11-08');
  assert.equal(fyNov.fyCode, '2026-27');
});

test('Receipt number normalization trims whitespace and lowercases cleanly', () => {
  assert.equal(normalizeReceiptNumber('  GBC-CHN/2026-27/125  '), 'gbc-chn/2026-27/125');
  assert.equal(normalizeReceiptNumber('CH1/2026-27/42'), 'ch1/2026-27/42');
});

test('Receipt number validation checks required non-blank values', () => {
  assert.equal(validateReceiptNumber('').valid, false);
  assert.equal(validateReceiptNumber('   ').valid, false);
  assert.equal(validateReceiptNumber(null).valid, false);
  const ok = validateReceiptNumber('GBC-CHN/2026-27/456');
  assert.equal(ok.valid, true);
  assert.equal(ok.normalized, 'gbc-chn/2026-27/456');
});

test('Automatic receipt prefix uses church code and financial year from donation date with numeric-only suffix (no leading zeros)', () => {
  assert.equal(buildAutoReceiptPrefix('gbc-chn', '2026-03-31'), 'GBC-CHN/2025-26/');
  assert.equal(buildAutoReceiptPrefix('gbc-chn', '2026-04-01'), 'GBC-CHN/2026-27/');

  // Sanitization strips non-digits and leading zeros
  assert.equal(sanitizeReceiptDigitsInput('0042'), '42');
  assert.equal(sanitizeReceiptDigitsInput('abc0142xyz'), '142');
  assert.equal(sanitizeReceiptDigitsInput('000'), '');
  assert.equal(sanitizeReceiptDigitsInput('GBC-CHN/2026-27/0089'), '89');

  // Suffix validation rejects zero, empty, and non-numeric values
  assert.equal(validateNumericReceiptSuffix('').valid, false);
  assert.equal(validateNumericReceiptSuffix('0').valid, false);
  assert.equal(validateNumericReceiptSuffix('000').valid, false);
  assert.equal(validateNumericReceiptSuffix('A12').valid, false);
  const validNum = validateNumericReceiptSuffix('00142');
  assert.equal(validNum.valid, true);
  assert.equal(validNum.numericValue, '142');

  // Canonical full receipt builder & legacy suffix extraction
  const built = buildFullReceiptNumber('gbc-chn', '2026-11-16', '0142');
  assert.equal(built.valid, true);
  assert.equal(built.prefix, 'GBC-CHN/2026-27/');
  assert.equal(built.numericValue, '142');
  assert.equal(built.fullReceiptNumber, 'GBC-CHN/2026-27/142');
  assert.equal(built.normalizedKey, 'gbc-chn/2026-27/142');

  assert.equal(extractReceiptSuffixDigits('GBC-CHN/2026-27/0142'), '142');
  assert.equal(extractReceiptSuffixDigits('REC-0055'), '55');
});

test('Competition ranking logic: 1, 2, 2, 4 ties and active-only member filtering', () => {
  const donors = [
    { memberId: 'm1', memberName: 'Alice', totalAmount: 5000, isActive: true },
    { memberId: 'm2', memberName: 'Bob', totalAmount: 4000, isActive: false }, // Inactive member excluded
    { memberId: 'm3', memberName: 'Charlie', totalAmount: 3000, isActive: true },
    { memberId: 'm4', memberName: 'David', totalAmount: 3000, isActive: true }, // Tied with Charlie
    { memberId: 'm5', memberName: 'Eve', totalAmount: 1000, isActive: true },
  ];

  const ranked = calculateRankings(donors);
  assert.equal(ranked.length, 4);
  assert.equal(ranked.some((r) => r.memberId === 'm2'), false);

  // Rank 1: Alice (5000)
  assert.equal(ranked[0].memberId, 'm1');
  assert.equal(ranked[0].rank, 1);

  // Ranks 2 & 2: Charlie (3000) and David (3000)
  assert.equal(ranked[1].memberId, 'm3');
  assert.equal(ranked[1].rank, 2);
  assert.equal(ranked[2].memberId, 'm4');
  assert.equal(ranked[2].rank, 2);

  // Rank 4 (competition ranking jumps over 3): Eve (1000)
  assert.equal(ranked[3].memberId, 'm5');
  assert.equal(ranked[3].rank, 4);
});

test('Accountant-only member status change rule enforcement', () => {
  // Case 1: Platform Admin without church accountant role -> REJECTED
  const adminActor = { isPlatformAdmin: true, churchRoles: ['admin'] };
  const res1 = validateMemberStatusChange(adminActor, 'active', 'inactive', 'Moved away');
  assert.equal(res1.allowed, false);
  assert.match(res1.error || '', /Accountant assignment/i);

  // Case 2: Collector -> REJECTED
  const collectorActor = { isPlatformAdmin: false, churchRoles: ['collector'] };
  const res2 = validateMemberStatusChange(collectorActor, 'active', 'inactive', 'Moved away');
  assert.equal(res2.allowed, false);

  // Case 3: Accountant with valid reason -> ALLOWED
  const accountantActor = { isPlatformAdmin: false, churchRoles: ['accountant'] };
  const res3 = validateMemberStatusChange(accountantActor, 'active', 'inactive', 'Relocated to another city');
  assert.equal(res3.allowed, true);

  // Case 4: Accountant with missing reason -> REJECTED
  const res4 = validateMemberStatusChange(accountantActor, 'active', 'inactive', '');
  assert.equal(res4.allowed, false);
  assert.match(res4.error || '', /reason.*required/i);

  // Case 5: Same status -> REJECTED
  const res5 = validateMemberStatusChange(accountantActor, 'active', 'active', 'Already active');
  assert.equal(res5.allowed, false);
});

test('Role permission checks align with specifications', () => {
  // Collector cannot create members
  assert.equal(checkRolePermission('collector', 'create_member').allowed, false);
  // Collector can edit member basic info, village, and gender, but cannot change status
  assert.equal(checkRolePermission('collector', 'edit_member_basic').allowed, true);
  assert.equal(checkRolePermission('collector', 'change_member_status').allowed, false);
  assert.equal(checkRolePermission('collector', 'edit_village_name').allowed, true);
  assert.equal(checkRolePermission('collector', 'edit_gender').allowed, true);
  // Collector cannot edit or cancel saved donations
  assert.equal(checkRolePermission('collector', 'edit_donation').allowed, false);
  assert.equal(checkRolePermission('collector', 'cancel_donation').allowed, false);
  assert.equal(checkRolePermission('collector', 'correct_receipt_number').allowed, false);
  // Collector cannot generate bulk financial reports
  assert.equal(checkRolePermission('collector', 'generate_bulk_reports').allowed, false);

  // Member can only view own donations
  assert.equal(checkRolePermission('member', 'view_all_church_donations').allowed, false);
  assert.equal(checkRolePermission('member', 'view_own_donations_only').allowed, true);
  assert.equal(checkRolePermission('member', 'edit_gender').allowed, true);
});

test('Gender validation preserves null vs prefer_not_to_say', () => {
  assert.equal(validateGender(null), null);
  assert.equal(validateGender(''), null);
  assert.equal(validateGender('male'), 'male');
  assert.equal(validateGender('Female'), 'female');
  assert.equal(validateGender('other'), 'other');
  assert.equal(validateGender('prefer_not_to_say'), 'prefer_not_to_say');
  assert.notEqual(validateGender('prefer_not_to_say'), null);
});

test('SMS templating produces required wording and 2 decimal currency', () => {
  const msg = formatSmsMessage({
    memberName: 'Joseph Daniel',
    churchName: 'Grace Bethel Church',
    amount: 1500,
    category: 'Tithe',
    donationDate: '2026-11-08',
    receiptNumber: 'CH-2026-00125',
  });
  assert.equal(
    msg,
    'Thank you, Joseph Daniel. Grace Bethel Church has recorded your donation of INR 1500.00 towards Tithe on 2026-11-08. Receipt: CH-2026-00125.'
  );
});

test('Excel cell formula injection sanitization', () => {
  assert.equal(sanitizeExcelCell('=SUM(A1:A10)'), "'=SUM(A1:A10)");
  assert.equal(sanitizeExcelCell('+cmd|...'), "'+cmd|...");
  assert.equal(sanitizeExcelCell('-123'), "'-123");
  assert.equal(sanitizeExcelCell('@malicious'), "'@malicious");
  assert.equal(sanitizeExcelCell('Safe Text'), 'Safe Text');
  assert.equal(sanitizeExcelCell(500), 500);
});

test('Indian Rupee formatting includes INR symbol/code and two decimals', () => {
  const formatted = formatINR(12500.5);
  assert.ok(formatted.includes('12,500.50'));
});

test('Date of birth validation rejects missing, invalid format, future, or impossible dates', () => {
  assert.equal(validateDateOfBirth('').valid, false);
  assert.equal(validateDateOfBirth(null).valid, false);
  assert.equal(validateDateOfBirth('not-a-date').valid, false);
  assert.equal(validateDateOfBirth('2026-02-31').valid, false); // invalid calendar day

  // Future date check
  const future = new Date();
  future.setFullYear(future.getFullYear() + 1);
  const futureStr = future.toISOString().split('T')[0];
  assert.equal(validateDateOfBirth(futureStr).valid, false);
  assert.match(validateDateOfBirth(futureStr).error || '', /future/i);

  // Impossibly old date (> 150 years)
  assert.equal(validateDateOfBirth('1800-01-01').valid, false);

  // Valid date
  const valid = validateDateOfBirth('1990-05-15');
  assert.equal(valid.valid, true);
});

test('Indian mobile number validation rejects invalid numbers and strips +91/0 prefix', () => {
  assert.equal(normalizePhoneNumber('').valid, false);
  assert.equal(normalizePhoneNumber('123').valid, false); // too short
  assert.equal(normalizePhoneNumber('5876543210').valid, false); // must start with 6-9
  assert.equal(normalizePhoneNumber('9999999999').valid, false); // repeating digits rejected
  assert.equal(normalizePhoneNumber('+1 555 123 4567').valid, false); // non-Indian rejected
  assert.equal(normalizePhoneNumber('98765abc10').valid, false); // non-numeric rejected

  const res1 = normalizePhoneNumber('+91 98765 43210');
  assert.equal(res1.valid, true);
  assert.equal(res1.normalized, '9876543210');

  const res2 = normalizePhoneNumber('09876543210');
  assert.equal(res2.valid, true);
  assert.equal(res2.normalized, '9876543210');

  const res3 = normalizePhoneNumber('98401 23456');
  assert.equal(res3.valid, true);
  assert.equal(res3.normalized, '9840123456');
});

test('Onboarding profile validation allows draft with only church, but requires all fields for submit', () => {
  // Incomplete draft is valid
  const draftRes = validateOnboardingProfile({
    churchId: 'church-1',
    fullName: '',
    dateOfBirth: '',
    phone: '',
    gender: '',
    villageName: '',
    isDraft: true,
  });
  assert.equal(draftRes.valid, true);

  // Missing church even in draft is invalid
  const draftNoChurch = validateOnboardingProfile({
    churchId: '',
    fullName: '',
    dateOfBirth: '',
    phone: '',
    gender: '',
    villageName: '',
    isDraft: true,
  });
  assert.equal(draftNoChurch.valid, false);
  assert.ok(draftNoChurch.errors.churchId);

  // Full submission with missing fields is invalid
  const submitIncomplete = validateOnboardingProfile({
    churchId: 'church-1',
    fullName: '',
    dateOfBirth: '1995-10-12',
    phone: '+919876543210',
    gender: 'male',
    villageName: '',
    isDraft: false,
  });
  assert.equal(submitIncomplete.valid, false);
  assert.ok(submitIncomplete.errors.fullName);
  assert.ok(submitIncomplete.errors.villageName);

  // Complete submission is valid
  const submitComplete = validateOnboardingProfile({
    churchId: 'church-1',
    fullName: 'Peter Paul',
    dateOfBirth: '1992-04-20',
    phone: '+91 98401 23456',
    gender: 'male',
    villageName: 'Kallakurichi',
    isDraft: false,
  });
  assert.equal(submitComplete.valid, true);
  assert.equal(Object.keys(submitComplete.errors).length, 0);
});

test('Accountant side-by-side field resolution logic respects choices', () => {
  // Keeping existing
  assert.equal(
    resolveReviewedField('Original Name', 'Applicant Name', 'existing'),
    'Original Name'
  );
  // Using applicant
  assert.equal(
    resolveReviewedField('Original Name', 'Applicant Name', 'applicant'),
    'Applicant Name'
  );
  // Using custom override
  assert.equal(
    resolveReviewedField('Original Name', 'Applicant Name', 'custom', 'Custom Corrected Name'),
    'Custom Corrected Name'
  );
  // Fallback to existing if applicant is blank
  assert.equal(
    resolveReviewedField('Original Phone', '', 'applicant'),
    'Original Phone'
  );
});

test('Member profile self-update requires full name, 10-digit Indian mobile, and gender (no email change)', () => {
  // Missing all mandatory fields
  const emptyRes = validateMemberSelfProfileUpdate({
    fullName: '   ',
    contactPhone: '',
    gender: '',
  });
  assert.equal(emptyRes.valid, false);
  assert.ok(emptyRes.errors.fullName);
  assert.ok(emptyRes.errors.contactPhone);
  assert.ok(emptyRes.errors.gender);

  // Missing gender only (must reject null/empty)
  const missingGender = validateMemberSelfProfileUpdate({
    fullName: 'David Paul',
    contactPhone: '9840123456',
    gender: '',
  });
  assert.equal(missingGender.valid, false);
  assert.ok(missingGender.errors.gender);

  // Invalid Indian phone numbers rejected (too short, wrong starting digit, repeating)
  assert.equal(
    validateMemberSelfProfileUpdate({
      fullName: 'David Paul',
      contactPhone: '123',
      gender: 'male',
    }).valid,
    false
  );
  assert.equal(
    validateMemberSelfProfileUpdate({
      fullName: 'David Paul',
      contactPhone: '5123456789',
      gender: 'male',
    }).valid,
    false
  );
  assert.equal(
    validateMemberSelfProfileUpdate({
      fullName: 'David Paul',
      contactPhone: '8888888888',
      gender: 'male',
    }).valid,
    false
  );

  // Valid update strips +91 and stores 10-digit Indian mobile number
  const validRes = validateMemberSelfProfileUpdate({
    fullName: '  David Paul  ',
    contactPhone: '+91 98401 23456',
    gender: 'prefer_not_to_say',
  });
  assert.equal(validRes.valid, true);
  assert.equal(Object.keys(validRes.errors).length, 0);
  assert.equal(validRes.normalized.fullName, 'David Paul');
  assert.equal(validRes.normalized.contactPhone, '9840123456');
  assert.equal(validRes.normalized.gender, 'prefer_not_to_say');
});

test('Add new church member requires full name, village/city name, and gender', () => {
  const emptyRes = validateNewChurchMember({
    fullName: '   ',
    villageName: '  ',
    gender: '',
  });
  assert.equal(emptyRes.valid, false);
  assert.ok(emptyRes.errors.fullName);
  assert.ok(emptyRes.errors.villageName);
  assert.ok(emptyRes.errors.gender);

  const missingVillageAndGender = validateNewChurchMember({
    fullName: 'Mary Joseph',
    villageName: '',
    gender: null,
  });
  assert.equal(missingVillageAndGender.valid, false);
  assert.equal(missingVillageAndGender.errors.fullName, undefined);
  assert.ok(missingVillageAndGender.errors.villageName);
  assert.ok(missingVillageAndGender.errors.gender);

  const validMinimal = validateNewChurchMember({
    fullName: '  Mary Joseph  ',
    villageName: '  Tambaram  ',
    gender: 'female',
  });
  assert.equal(validMinimal.valid, true);
  assert.equal(Object.keys(validMinimal.errors).length, 0);
  assert.equal(validMinimal.normalized.fullName, 'Mary Joseph');
  assert.equal(validMinimal.normalized.villageName, 'Tambaram');
  assert.equal(validMinimal.normalized.gender, 'female');
  assert.equal(validMinimal.normalized.contactPhone, null);
  assert.equal(validMinimal.normalized.dateOfBirth, null);
});

test('Village / City suggestions deduplicate case-insensitively and allow adding new entries', () => {
  const list = buildVillageSuggestions([
    null,
    '',
    '  Tambaram  ',
    'tambaram',
    'Kallakurichi',
    'Guindy',
    '  Whitefield ',
    undefined,
  ]);
  assert.deepEqual(list, ['Guindy', 'Kallakurichi', 'Tambaram', 'Whitefield']);

  // Empty query shows full database list and cannot add blank entry
  const emptyQuery = filterVillageSuggestions(list, '');
  assert.deepEqual(emptyQuery.matches, ['Guindy', 'Kallakurichi', 'Tambaram', 'Whitefield']);
  assert.equal(emptyQuery.canAddNew, false);

  // Exact match (case-insensitive) disables duplicate "add new"
  const exactMatch = filterVillageSuggestions(list, 'tambaram');
  assert.deepEqual(exactMatch.matches, ['Tambaram']);
  assert.equal(exactMatch.canAddNew, false);

  // Partial or brand new query enables adding new entry
  const partialNew = filterVillageSuggestions(list, '  New Colony  ');
  assert.deepEqual(partialNew.matches, []);
  assert.equal(partialNew.canAddNew, true);
  assert.equal(partialNew.trimmedQuery, 'New Colony');
});

test('Accountant can assign and toggle Collector access while role precedence elevates promoted members', () => {
  assert.equal(checkRolePermission('accountant', 'assign_collector_role').allowed, true);
  assert.equal(checkRolePermission('admin', 'assign_collector_role').allowed, true);
  assert.equal(checkRolePermission('collector', 'assign_collector_role').allowed, false);
  assert.equal(checkRolePermission('member', 'assign_collector_role').allowed, false);

  assert.deepEqual(getAssignableStaffRoles('accountant'), ['collector']);
  assert.deepEqual(getAssignableStaffRoles('admin'), ['collector', 'accountant', 'admin']);
  assert.deepEqual(getAssignableStaffRoles('collector'), []);

  // Accountant can toggle collector status, NOT admin or accountant status
  assert.equal(canManageStaffAssignmentStatus('accountant', 'collector'), true);
  assert.equal(canManageStaffAssignmentStatus('accountant', 'accountant'), false);
  assert.equal(canManageStaffAssignmentStatus('accountant', 'admin'), false);
  assert.equal(canManageStaffAssignmentStatus('admin', 'accountant'), true);

  // When a church member is also assigned Collector, highest role resolves to collector
  assert.equal(getHighestChurchRole(['member', 'collector']), 'collector');
  assert.equal(getHighestChurchRole(['collector', 'accountant', 'member']), 'accountant');
  assert.equal(getHighestChurchRole(['member']), 'member');
  assert.equal(getHighestChurchRole([]), 'none');
});

import {
  buildMemberPortalUrl,
  buildMemberShareWhatsAppUrl,
  normalizeChurchSlugInput,
  suggestChurchSlug,
  validateChurchSlug,
  extractChurchSlugFromPath,
  buildChurchPortalUrl,
  buildChurchMemberPrefix,
  computeNextChurchMemberNumber,
  normalizeChurchCodeInput,
  validateChurchCode,
  validateNewChurchInput,
  sanitizeMemberSearchQuery,
  buildMemberSearchOrFilter,
  DEFAULT_ANDROID_SMS_GATEWAY_URL,
  validateAndroidSmsGatewayUrl,
  formatPhoneForSmsGateway,
  buildAndroidSmsGatewayPayload,
} from './domain-logic';

test('All church staff including Collector can manage single-use member share links; Member cannot', () => {
  assert.equal(checkRolePermission('platform_admin', 'manage_member_share_links').allowed, true);
  assert.equal(checkRolePermission('admin', 'manage_member_share_links').allowed, true);
  assert.equal(checkRolePermission('accountant', 'manage_member_share_links').allowed, true);
  assert.equal(checkRolePermission('collector', 'manage_member_share_links').allowed, true);
  assert.equal(checkRolePermission('member', 'manage_member_share_links').allowed, false);
  assert.equal(checkRolePermission('none', 'manage_member_share_links').allowed, false);
});

test('Member portal URL and WhatsApp link builder behave consistently', () => {
  const url = buildMemberPortalUrl('https://church.example.com/', 'abc123token');
  assert.equal(url, 'https://church.example.com/member-portal?token=abc123token');

  const waWithPhone = buildMemberShareWhatsAppUrl({
    phone: '9840012345',
    memberName: 'Mary Joseph',
    churchName: 'Grace Bethel Church',
    portalUrl: url,
  });
  assert.match(waWithPhone, /^https:\/\/wa\.me\/919840012345\?text=/);
  assert.match(decodeURIComponent(waWithPhone), /single-use/i);

  const waNoPhone = buildMemberShareWhatsAppUrl({
    phone: null,
    memberName: 'Mary Joseph',
    churchName: 'Grace Bethel Church',
    portalUrl: url,
  });
  assert.match(waNoPhone, /^https:\/\/wa\.me\/\?text=/);
});

test('Church URL slug normalization, validation, path parsing, and portal URL generation work accurately', () => {
  assert.equal(normalizeChurchSlugInput('  Grace Bethel -- Chennai '), 'grace-bethel-chennai-');
  assert.equal(suggestChurchSlug('  Grace Bethel, Chennai! '), 'grace-bethel-chennai');
  assert.equal(suggestChurchSlug('GBC_CHN'), 'gbc-chn');

  const validSlug = validateChurchSlug('grace-bethel');
  assert.equal(validSlug.valid, true);
  assert.equal(validSlug.normalized, 'grace-bethel');

  assert.equal(validateChurchSlug('a').valid, false);
  assert.equal(validateChurchSlug('member-portal').valid, false);
  assert.equal(validateChurchSlug('login').valid, false);
  assert.equal(validateChurchSlug('auth').valid, false);
  assert.equal(validateChurchSlug('assets').valid, false);

  assert.equal(extractChurchSlugFromPath('/grace-bethel'), 'grace-bethel');
  assert.equal(extractChurchSlugFromPath('/Grace-Bethel/'), 'grace-bethel');
  assert.equal(extractChurchSlugFromPath('/c/grace-bethel'), null);
  assert.equal(extractChurchSlugFromPath('/c'), null);
  assert.equal(extractChurchSlugFromPath('/home'), null);
  assert.equal(extractChurchSlugFromPath('/login'), null);
  assert.equal(extractChurchSlugFromPath('/a'), null);

  assert.equal(
    buildChurchPortalUrl('https://church.example.com/', 'Grace Bethel'),
    'https://church.example.com/grace-bethel'
  );
});

test('Church-code-prefixed new member IDs start at 1, use uppercase prefix, preserve legacy M-0001, and expand cleanly', () => {
  assert.equal(buildChurchMemberPrefix(' abc '), 'ABC-');
  assert.equal(computeNextChurchMemberNumber('abc', []), 'ABC-1');
  assert.equal(
    computeNextChurchMemberNumber('abc', ['M-0001', 'M-0002', 'M-0004']),
    'ABC-1'
  );
  assert.equal(
    computeNextChurchMemberNumber('abc', ['M-0001', 'ABC-1', 'abc-2']),
    'ABC-3'
  );
  assert.equal(
    computeNextChurchMemberNumber('GBC-CHN', ['M-0001', 'GBC-CHN-1']),
    'GBC-CHN-2'
  );
  assert.equal(
    computeNextChurchMemberNumber('M', ['M-0001', 'M-0002']),
    'M-1'
  );
  assert.equal(
    computeNextChurchMemberNumber('abc', ['ABC-9999']),
    'ABC-10000'
  );
});

test('New church creation requires all fields and restricts church code to A-Z, 0-9, and single inner hyphens', () => {
  assert.equal(normalizeChurchCodeInput(' gbc@chn! 01 '), 'GBCCHN01');
  assert.equal(normalizeChurchCodeInput('--gbc--chn_1'), 'GBC-CHN1');
  assert.equal(normalizeChurchCodeInput('gbc-'), 'GBC-');

  assert.equal(validateChurchCode('GBC-CHN').valid, true);
  assert.equal(validateChurchCode('AB').valid, true);
  assert.equal(validateChurchCode('A').valid, false);
  assert.equal(validateChurchCode('GBC_CHN').valid, false);
  assert.equal(validateChurchCode('GBC CHN').valid, false);
  assert.equal(validateChurchCode('-GBC').valid, false);
  assert.equal(validateChurchCode('GBC-').valid, false);
  assert.equal(validateChurchCode('GBC--CHN').valid, false);
  assert.equal(validateChurchCode('ABCDEFGHIJKLMNOPQRSTU').valid, false); // 21 chars

  const invalidAll = validateNewChurchInput({
    name: '   ',
    code: 'a!',
    slug: 'login',
    address: '',
    phone: '12345',
    email: 'not-an-email',
  });
  assert.equal(invalidAll.valid, false);
  assert.ok(invalidAll.errors.name);
  assert.ok(invalidAll.errors.code);
  assert.ok(invalidAll.errors.slug);
  assert.ok(invalidAll.errors.address);
  assert.ok(invalidAll.errors.phone);
  assert.ok(invalidAll.errors.email);

  const validChurch = validateNewChurchInput({
    name: '  Grace Bethel Church  ',
    code: 'gbc-chn',
    slug: 'grace-bethel',
    address: '  45 Anna Salai, Chennai  ',
    phone: '+91 98400 12345',
    email: '  Office@GraceBethel.ORG ',
  });
  assert.equal(validChurch.valid, true);
  assert.deepEqual(validChurch.normalized, {
    name: 'Grace Bethel Church',
    code: 'GBC-CHN',
    slug: 'grace-bethel',
    address: '45 Anna Salai, Chennai',
    phone: '9840012345',
    email: 'office@gracebethel.org',
  });
});

test('Live member search query sanitization and PostgREST OR filter handle blank, special characters, and codes safely', () => {
  assert.equal(sanitizeMemberSearchQuery('   '), '');
  assert.equal(sanitizeMemberSearchQuery(null), '');
  assert.equal(sanitizeMemberSearchQuery('  Mary, (Jane)  '), 'Mary Jane');
  assert.equal(sanitizeMemberSearchQuery('100%_test\\path'), '100\\%\\_test\\\\path');

  assert.equal(buildMemberSearchOrFilter('   '), null);
  assert.equal(
    buildMemberSearchOrFilter('ABC-12'),
    'full_name.ilike.%ABC-12%,member_number.ilike.%ABC-12%,village_name.ilike.%ABC-12%'
  );
  assert.equal(
    buildMemberSearchOrFilter('Mary, (Nellore)'),
    'full_name.ilike.%Mary Nellore%,member_number.ilike.%Mary Nellore%,village_name.ilike.%Mary Nellore%'
  );
});

test('Android SMS Gateway URL validation, E.164 phone formatting, and POST /messages payload builder work cleanly', () => {
  const def = validateAndroidSmsGatewayUrl('');
  assert.equal(def.valid, true);
  assert.equal(def.normalized, DEFAULT_ANDROID_SMS_GATEWAY_URL);

  const validCustom = validateAndroidSmsGatewayUrl('https://api.sms-gate.app/3rdparty/v1/');
  assert.equal(validCustom.valid, true);
  assert.equal(validCustom.normalized, 'https://api.sms-gate.app/3rdparty/v1');

  assert.equal(validateAndroidSmsGatewayUrl('http://api.sms-gate.app/3rdparty/v1').valid, false);
  assert.equal(validateAndroidSmsGatewayUrl('https://192.168.1.50:8080').valid, false);
  assert.equal(validateAndroidSmsGatewayUrl('https://localhost:8080').valid, false);
  assert.equal(validateAndroidSmsGatewayUrl('https://127.0.0.1:8080').valid, false);

  assert.equal(formatPhoneForSmsGateway('9840012345'), '+919840012345');
  assert.equal(formatPhoneForSmsGateway('098400 12345'), '+919840012345');
  assert.equal(formatPhoneForSmsGateway('+91 98400-12345'), '+919840012345');
  assert.equal(formatPhoneForSmsGateway('123'), null);

  const payload = buildAndroidSmsGatewayPayload({
    phone: '+919840012345',
    text: 'Receipt test',
    messageId: 'job-123',
    deviceId: 'dev-xyz',
    simNumber: 2,
  });
  assert.deepEqual(payload, {
    id: 'job-123',
    textMessage: { text: 'Receipt test' },
    phoneNumbers: ['+919840012345'],
    withDeliveryReport: true,
    deviceId: 'dev-xyz',
    simNumber: 2,
  });

  const minimalPayload = buildAndroidSmsGatewayPayload({
    phone: '+919840012345',
    text: 'Receipt test',
  });
  assert.deepEqual(minimalPayload, {
    textMessage: { text: 'Receipt test' },
    phoneNumbers: ['+919840012345'],
    withDeliveryReport: true,
  });
});

import {
  formatCompactINR,
  computeCurrentMonthSummary,
  buildMonthlyFyTrend,
  buildCategoryBreakdown,
} from './domain-logic';

test('Dashboard analytics helpers compute current month summary, Apr-Mar FY trend, and category shares accurately', () => {
  assert.equal(formatCompactINR(0), '₹0');
  assert.equal(formatCompactINR(850), '₹850');
  assert.equal(formatCompactINR(12500), '₹12.5k');
  assert.equal(formatCompactINR(180000), '₹1.8L');
  assert.equal(formatCompactINR(25000000), '₹2.5Cr');

  const sampleDonations = [
    {
      donation_date: '2026-04-05',
      amount: 2000,
      deleted_at: null,
      category: { name: 'Tithe' },
    },
    {
      donation_date: '2026-11-10',
      amount: 1500.5,
      deleted_at: null,
      category: { name: 'Tithe' },
    },
    {
      donation_date: '2026-11-21',
      amount: 500,
      deleted_at: null,
      category: { name: 'Building Fund' },
    },
    {
      donation_date: '2026-11-22',
      amount: 9999,
      deleted_at: '2026-11-22T10:00:00Z', // soft-deleted must be excluded
      category: { name: 'Cancelled' },
    },
    {
      donation_date: '2027-02-14',
      amount: 1000,
      deleted_at: null,
      category: { name: 'Missionary' },
    },
  ];

  // Current month (Nov 2026) excludes deleted and other months
  const monthSummary = computeCurrentMonthSummary(sampleDonations, '2026-11-22');
  assert.equal(monthSummary.monthKey, '2026-11');
  assert.equal(monthSummary.monthLabel, 'Nov 2026');
  assert.equal(monthSummary.totalAmount, 2000.5);
  assert.equal(monthSummary.receiptCount, 2);

  // 12-month Financial Year trend runs Apr 2026 -> Mar 2027 and flags current month
  const trend = buildMonthlyFyTrend(sampleDonations, 2026, '2026-11-22');
  assert.equal(trend.length, 12);
  assert.equal(trend[0].monthKey, '2026-04');
  assert.equal(trend[0].shortLabel, 'Apr');
  assert.equal(trend[0].totalAmount, 2000);
  assert.equal(trend[0].receiptCount, 1);

  assert.equal(trend[7].monthKey, '2026-11');
  assert.equal(trend[7].isCurrentMonth, true);
  assert.equal(trend[7].totalAmount, 2000.5);
  assert.equal(trend[7].receiptCount, 2);

  assert.equal(trend[10].monthKey, '2027-02');
  assert.equal(trend[10].totalAmount, 1000);
  assert.equal(trend[11].monthKey, '2027-03');
  assert.equal(trend[11].totalAmount, 0);

  // Category breakdown ranks descending and excludes deleted rows
  const categories = buildCategoryBreakdown(sampleDonations);
  assert.equal(categories.length, 3);
  assert.deepEqual(categories[0], {
    categoryName: 'Tithe',
    totalAmount: 3500.5,
    receiptCount: 2,
    percentage: 70,
  });
  assert.deepEqual(categories[1], {
    categoryName: 'Missionary',
    totalAmount: 1000,
    receiptCount: 1,
    percentage: 20,
  });
  assert.deepEqual(categories[2], {
    categoryName: 'Building Fund',
    totalAmount: 500,
    receiptCount: 1,
    percentage: 10,
  });
});

import {
  validateExpenseInput,
  computeExpenseCurrentMonthSummary,
  buildMonthlyExpenseFyTrend,
  buildExpenseCategoryBreakdown,
  buildMonthlyCashFlowTrend,
} from './domain-logic';

test('validateExpenseInput enforces positive amount, required fields, and sanitizes optional fields', () => {
  assert.equal(
    validateExpenseInput({
      amount: 0,
      expenseDate: '2026-11-10',
      categoryId: 'cat-1',
      paidFromAccountId: 'acc-1',
      paymentMethod: 'Cash',
      payeeName: 'EB Office',
    }).valid,
    false
  );

  assert.equal(
    validateExpenseInput({
      amount: 1200,
      expenseDate: '2026-11-10',
      categoryId: 'cat-1',
      paidFromAccountId: 'acc-1',
      paymentMethod: 'Cash',
      payeeName: '   ',
    }).valid,
    false
  );

  assert.equal(
    validateExpenseInput({
      amount: 1200,
      expenseDate: '2026-11-10',
      categoryId: '',
      paidFromAccountId: 'acc-1',
      paymentMethod: 'UPI',
      payeeName: 'TNEB',
    }).valid,
    false
  );

  const validRes = validateExpenseInput({
    amount: '2450.5',
    expenseDate: '2026-11-10',
    categoryId: 'cat-1',
    paidFromAccountId: 'acc-1',
    paymentMethod: 'Bank Transfer',
    payeeName: '  Tamil Nadu Electricity Board  ',
    billReference: '  INV-2026-99  ',
    notes: '   ',
  });

  assert.equal(validRes.valid, true);
  assert.deepEqual(validRes.sanitized, {
    amount: 2450.5,
    expenseDate: '2026-11-10',
    categoryId: 'cat-1',
    paidFromAccountId: 'acc-1',
    paymentMethod: 'Bank Transfer',
    payeeName: 'Tamil Nadu Electricity Board',
    billReference: 'INV-2026-99',
    notes: null,
  });
});

test('Expense analytics and net cash-flow helpers exclude cancelled entries and compute church-scoped totals accurately', () => {
  const sampleDonations = [
    {
      donation_date: '2026-04-05',
      amount: 5000,
      deleted_at: null,
      category: { name: 'Tithe' },
    },
    {
      donation_date: '2026-11-15',
      amount: 3200,
      deleted_at: null,
      category: { name: 'Offering' },
    },
  ];

  const sampleExpenses = [
    {
      expense_date: '2026-04-12',
      amount: 1500,
      deleted_at: null,
      category: { name: 'Utilities' },
    },
    {
      expense_date: '2026-11-08',
      amount: 4000,
      deleted_at: null,
      category: { name: 'Staff Salaries' },
    },
    {
      expense_date: '2026-11-19',
      amount: 1000,
      deleted_at: null,
      category: { name: 'Utilities' },
    },
    {
      expense_date: '2026-11-22',
      amount: 7500,
      deleted_at: '2026-11-22T09:00:00Z', // cancelled must be excluded
      category: { name: 'Cancelled Vendor Bill' },
    },
  ];

  const monthExp = computeExpenseCurrentMonthSummary(sampleExpenses, '2026-11-22');
  assert.equal(monthExp.monthKey, '2026-11');
  assert.equal(monthExp.totalAmount, 5000);
  assert.equal(monthExp.entryCount, 2);

  const expTrend = buildMonthlyExpenseFyTrend(sampleExpenses, 2026, '2026-11-22');
  assert.equal(expTrend.length, 12);
  assert.equal(expTrend[0].totalAmount, 1500);
  assert.equal(expTrend[7].totalAmount, 5000);
  assert.equal(expTrend[7].isCurrentMonth, true);

  const expBreakdown = buildExpenseCategoryBreakdown(sampleExpenses);
  assert.equal(expBreakdown.length, 2);
  assert.deepEqual(expBreakdown[0], {
    categoryName: 'Staff Salaries',
    totalAmount: 4000,
    entryCount: 1,
    percentage: 61.5,
  });
  assert.deepEqual(expBreakdown[1], {
    categoryName: 'Utilities',
    totalAmount: 2500,
    entryCount: 2,
    percentage: 38.5,
  });

  const cashFlow = buildMonthlyCashFlowTrend(sampleDonations, sampleExpenses, 2026, '2026-11-22');
  assert.equal(cashFlow[0].collectionsAmount, 5000);
  assert.equal(cashFlow[0].expensesAmount, 1500);
  assert.equal(cashFlow[0].netAmount, 3500);

  assert.equal(cashFlow[7].collectionsAmount, 3200);
  assert.equal(cashFlow[7].expensesAmount, 5000);
  assert.equal(cashFlow[7].netAmount, -1800);
  assert.equal(cashFlow[7].isCurrentMonth, true);
});


