import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getFinancialYear,
  normalizeReceiptNumber,
  validateReceiptNumber,
  suggestReceiptPrefix,
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

test('Receipt number normalization preserves leading zeroes and trims whitespace', () => {
  assert.equal(normalizeReceiptNumber('  000125  '), '000125');
  assert.equal(normalizeReceiptNumber('CH-2026-00125'), 'ch-2026-00125');
  assert.equal(normalizeReceiptNumber('2026-27/000125'), '2026-27/000125');
  assert.equal(normalizeReceiptNumber('  REC-ABC  '), 'rec-abc');
});

test('Receipt number validation checks required non-blank values', () => {
  assert.equal(validateReceiptNumber('').valid, false);
  assert.equal(validateReceiptNumber('   ').valid, false);
  assert.equal(validateReceiptNumber(null).valid, false);
  const ok = validateReceiptNumber('00456');
  assert.equal(ok.valid, true);
  assert.equal(ok.normalized, '00456');
});

test('Receipt prefix suggestion generates clean prefix without hardcoding full number', () => {
  assert.equal(suggestReceiptPrefix('2026-27'), 'REC/2026-27/');
  assert.equal(suggestReceiptPrefix('2026-27', 'ch1'), 'CH1/2026-27/');
});

test('Competition ranking logic: 1, 2, 2, 4 ties and inactive member inclusion', () => {
  const donors = [
    { memberId: 'm1', memberName: 'Alice', totalAmount: 5000, isActive: true },
    { memberId: 'm2', memberName: 'Bob', totalAmount: 3000, isActive: false }, // Inactive member
    { memberId: 'm3', memberName: 'Charlie', totalAmount: 3000, isActive: true }, // Tied with Bob
    { memberId: 'm4', memberName: 'David', totalAmount: 1000, isActive: true },
  ];

  const ranked = calculateRankings(donors);
  // Rank 1: Alice (5000)
  assert.equal(ranked[0].memberId, 'm1');
  assert.equal(ranked[0].rank, 1);

  // Ranks 2 & 2: Bob (3000) and Charlie (3000)
  assert.equal(ranked[1].rank, 2);
  assert.equal(ranked[2].rank, 2);
  assert.equal(ranked[1].totalAmount, 3000);
  assert.equal(ranked[2].totalAmount, 3000);

  // Rank 4 (competition ranking jumps over 3): David (1000)
  assert.equal(ranked[3].memberId, 'm4');
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
  // Collector can edit member basic info (name, phone, email)
  assert.equal(checkRolePermission('collector', 'edit_member_basic').allowed, true);
  // Collector cannot change status, village, or gender
  assert.equal(checkRolePermission('collector', 'change_member_status').allowed, false);
  assert.equal(checkRolePermission('collector', 'edit_village_name').allowed, false);
  assert.equal(checkRolePermission('collector', 'edit_gender').allowed, false);
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

test('Phone number normalization handles Indian and international numbers', () => {
  assert.equal(normalizePhoneNumber('').valid, false);
  assert.equal(normalizePhoneNumber('123').valid, false); // too short

  const res1 = normalizePhoneNumber('+91 98765 43210');
  assert.equal(res1.valid, true);
  assert.equal(res1.normalized, '+919876543210');

  const res2 = normalizePhoneNumber('09876543210');
  assert.equal(res2.valid, true);
  assert.equal(res2.normalized, '09876543210');
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

