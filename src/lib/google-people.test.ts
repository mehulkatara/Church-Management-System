import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGooglePeopleResponse,
  extractNameFromPeople,
  extractDateOfBirthFromPeople,
  extractVillageOrCityFromPeople,
  extractGenderFromPeople,
} from './google-people';

test('Google People API parser extracts name, DOB, village/city, and gender from primary entries', () => {
  const result = parseGooglePeopleResponse({
    names: [
      { metadata: { primary: false }, displayName: 'Alias Name' },
      { metadata: { primary: true }, displayName: '  Samuel   Rajan  ' },
    ],
    birthdays: [
      { metadata: { primary: true }, date: { year: 1994, month: 6, day: 5 } },
    ],
    addresses: [
      {
        metadata: { primary: true },
        city: 'Tambaram',
        region: 'Tamil Nadu',
        postalCode: '600045',
        formattedValue: '12 Main Road, Tambaram, Tamil Nadu 600045',
      },
    ],
    genders: [{ metadata: { primary: true }, value: 'male' }],
  });

  assert.equal(result.fullName, 'Samuel Rajan');
  assert.equal(result.dateOfBirth, '1994-06-05');
  assert.equal(result.villageOrCity, 'Tambaram');
  assert.equal(result.gender, 'male');
  assert.deepEqual(result.importedFields, [
    'Full Name',
    'Date of Birth',
    'Village / City Name',
    'Gender',
  ]);
  assert.deepEqual(result.missingFields, []);
});

test('Google People API birthday parser skips partial birthdays without year', () => {
  assert.equal(
    extractDateOfBirthFromPeople([{ metadata: { primary: true }, date: { month: 8, day: 19 } }]),
    null
  );
  assert.equal(
    extractDateOfBirthFromPeople([
      { metadata: { primary: false }, date: { year: 1990, month: 12, day: 3 } },
    ]),
    '1990-12-03'
  );
});

test('Google People API address parser falls back from city to extendedAddress or formattedValue', () => {
  assert.equal(
    extractVillageOrCityFromPeople([{ extendedAddress: 'Kallakurichi' }]),
    'Kallakurichi'
  );
  assert.equal(
    extractVillageOrCityFromPeople([
      { formattedValue: '45 Church Street, Whitefield, Karnataka, 560066' },
    ]),
    'Whitefield'
  );
  assert.equal(extractVillageOrCityFromPeople([]), null);
});

test('Google People API gender and name fallback mapping works cleanly', () => {
  assert.equal(extractGenderFromPeople([{ value: 'female' }]), 'female');
  assert.equal(extractGenderFromPeople([{ value: 'unspecified' }]), 'prefer_not_to_say');
  assert.equal(extractGenderFromPeople([{ value: 'nonbinary' }]), 'other');
  assert.equal(extractGenderFromPeople([]), null);

  assert.equal(
    extractNameFromPeople([{ givenName: 'Mary', familyName: 'Joseph' }]),
    'Mary Joseph'
  );
});
