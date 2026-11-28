import type { Gender } from '../types/database';
import {
  validateDateOfBirth,
  formatIndianMobileInput,
  normalizePhoneNumber,
} from './domain-logic';

/**
 * Minimum Google OAuth scopes required to read the user's identity,
 * full name, date of birth, addresses (village/city), gender, and phone number
 * from Google People API during onboarding.
 */
export const GOOGLE_PEOPLE_SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/user.birthday.read',
  'https://www.googleapis.com/auth/user.addresses.read',
  'https://www.googleapis.com/auth/user.gender.read',
  'https://www.googleapis.com/auth/user.phonenumbers.read',
] as const;

export const PEOPLE_API_ENDPOINT =
  'https://people.googleapis.com/v1/people/me?personFields=names,birthdays,addresses,genders,phoneNumbers';

export interface GooglePeopleRawName {
  metadata?: { primary?: boolean };
  displayName?: string;
  givenName?: string;
  middleName?: string;
  familyName?: string;
}

export interface GooglePeopleRawBirthday {
  metadata?: { primary?: boolean };
  date?: {
    year?: number;
    month?: number;
    day?: number;
  };
  text?: string;
}

export interface GooglePeopleRawAddress {
  metadata?: { primary?: boolean };
  formattedValue?: string;
  type?: string;
  extendedAddress?: string;
  streetAddress?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
}

export interface GooglePeopleRawGender {
  metadata?: { primary?: boolean };
  value?: string;
  formattedValue?: string;
}

export interface GooglePeopleRawPhoneNumber {
  metadata?: { primary?: boolean };
  value?: string;
  canonicalForm?: string;
  type?: string;
}

export interface GooglePeopleRawResponse {
  names?: GooglePeopleRawName[];
  birthdays?: GooglePeopleRawBirthday[];
  addresses?: GooglePeopleRawAddress[];
  genders?: GooglePeopleRawGender[];
  phoneNumbers?: GooglePeopleRawPhoneNumber[];
}

export interface GooglePeopleProfile {
  fullName: string | null;
  dateOfBirth: string | null; // YYYY-MM-DD
  villageOrCity: string | null;
  gender: Gender | null;
  phoneNumber: string | null; // 10-digit Indian mobile number
  importedFields: string[];
  missingFields: string[];
}

function pickPrimaryOrFirst<T extends { metadata?: { primary?: boolean } }>(
  items?: T[]
): T | undefined {
  if (!Array.isArray(items) || items.length === 0) return undefined;
  return items.find((item) => item.metadata?.primary) || items[0];
}

/**
 * Extracts full name from Google People API `names` array.
 */
export function extractNameFromPeople(names?: GooglePeopleRawName[]): string | null {
  const entry = pickPrimaryOrFirst(names);
  if (!entry) return null;

  if (entry.displayName && entry.displayName.trim()) {
    return entry.displayName.trim().replace(/\s+/g, ' ');
  }

  const combined = [entry.givenName, entry.middleName, entry.familyName]
    .filter((part): part is string => Boolean(part && part.trim()))
    .map((part) => part.trim())
    .join(' ');

  return combined || null;
}

/**
 * Extracts complete YYYY-MM-DD Date of Birth from Google People API `birthdays`.
 * Google omits `year` if the user restricted birth year visibility; in that case returns null.
 */
export function extractDateOfBirthFromPeople(
  birthdays?: GooglePeopleRawBirthday[]
): string | null {
  if (!Array.isArray(birthdays) || birthdays.length === 0) return null;

  const completeEntries = birthdays.filter(
    (b) => b.date && b.date.year && b.date.month && b.date.day
  );
  const entry = pickPrimaryOrFirst(completeEntries);
  if (!entry?.date?.year || !entry.date.month || !entry.date.day) return null;

  const formatted = `${String(entry.date.year).padStart(4, '0')}-${String(
    entry.date.month
  ).padStart(2, '0')}-${String(entry.date.day).padStart(2, '0')}`;

  const validation = validateDateOfBirth(formatted);
  return validation.valid ? formatted : null;
}

/**
 * Extracts Village / City locality from Google People API `addresses`.
 * Prioritizes `city`, falls back to `extendedAddress` or non-numeric locality segment.
 */
export function extractVillageOrCityFromPeople(
  addresses?: GooglePeopleRawAddress[]
): string | null {
  if (!Array.isArray(addresses) || addresses.length === 0) return null;

  // Prefer primary entry if it yields a locality; otherwise scan all addresses
  const primary = pickPrimaryOrFirst(addresses);
  const ordered = primary
    ? [primary, ...addresses.filter((a) => a !== primary)]
    : addresses;

  for (const addr of ordered) {
    if (addr.city && addr.city.trim()) {
      return addr.city.trim().replace(/\s+/g, ' ');
    }
    if (addr.extendedAddress && addr.extendedAddress.trim()) {
      return addr.extendedAddress.trim().replace(/\s+/g, ' ');
    }
    if (addr.formattedValue && addr.formattedValue.trim()) {
      const segments = addr.formattedValue
        .split(/[,\n]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !/^\d{4,}$/.test(s));

      // Pick the city/village segment based on standard address line structure:
      // 1 segment: ["Tambaram"] -> "Tambaram"
      // 2 segments: ["Tambaram", "Tamil Nadu"] -> "Tambaram"
      // 3 segments: ["45 Church Street", "Whitefield", "Karnataka"] -> "Whitefield"
      // 4+ segments: ["45 Church Street", "Whitefield", "Karnataka", "India"] -> "Whitefield"
      if (segments.length >= 4) {
        return segments[segments.length - 3].replace(/\s+/g, ' ');
      }
      if (segments.length === 3) {
        return segments[1].replace(/\s+/g, ' ');
      }
      if (segments.length >= 1) {
        return segments[0].replace(/\s+/g, ' ');
      }
    }
  }

  return null;
}

/**
 * Maps Google People API `genders` entry into the application's Gender enum.
 */
export function extractGenderFromPeople(
  genders?: GooglePeopleRawGender[]
): Gender | null {
  const entry = pickPrimaryOrFirst(genders);
  const raw = (entry?.value || entry?.formattedValue || '').trim().toLowerCase();
  if (!raw) return null;

  if (raw === 'male') return 'male';
  if (raw === 'female') return 'female';
  if (raw === 'unspecified' || raw === 'rather_not_say' || raw === 'prefer not to say') {
    return 'prefer_not_to_say';
  }
  return 'other';
}

/**
 * Extracts a normalized 10-digit Indian mobile number from a raw phone string
 * (rejecting non-Indian international country codes).
 */
export function normalizeIndianPhoneCandidate(
  rawPhone?: string | null
): string | null {
  if (!rawPhone || typeof rawPhone !== 'string') return null;
  const compact = rawPhone.trim().replace(/[\s\-()]/g, '');
  if (!compact) return null;
  if (compact.startsWith('+') && !compact.startsWith('+91')) {
    return null;
  }

  const formatted = formatIndianMobileInput(compact);
  const check = normalizePhoneNumber(formatted);
  return check.valid ? check.normalized : null;
}

/**
 * Extracts a 10-digit Indian mobile number from Google People API `phoneNumbers`.
 * Prioritizes primary entries, then mobile entries, then remaining phone entries.
 */
export function extractPhoneNumberFromPeople(
  phoneNumbers?: GooglePeopleRawPhoneNumber[]
): string | null {
  if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) return null;

  const primary = pickPrimaryOrFirst(phoneNumbers);
  const ordered = primary
    ? [
        primary,
        ...phoneNumbers.filter((p) => p !== primary && p.type?.toLowerCase() === 'mobile'),
        ...phoneNumbers.filter((p) => p !== primary && p.type?.toLowerCase() !== 'mobile'),
      ]
    : phoneNumbers;

  for (const entry of ordered) {
    const candidates = [entry.canonicalForm, entry.value];
    for (const candidate of candidates) {
      const normalized = normalizeIndianPhoneCandidate(candidate);
      if (normalized) return normalized;
    }
  }

  return null;
}

/**
 * Parses a raw Google People API response into onboarding form values.
 */
export function parseGooglePeopleResponse(
  data: GooglePeopleRawResponse
): GooglePeopleProfile {
  const fullName = extractNameFromPeople(data.names);
  const dateOfBirth = extractDateOfBirthFromPeople(data.birthdays);
  const villageOrCity = extractVillageOrCityFromPeople(data.addresses);
  const gender = extractGenderFromPeople(data.genders);
  const phoneNumber = extractPhoneNumberFromPeople(data.phoneNumbers);

  const importedFields: string[] = [];
  const missingFields: string[] = [];

  if (fullName) importedFields.push('Full Name');
  else missingFields.push('Full Name');

  if (dateOfBirth) importedFields.push('Date of Birth');
  else missingFields.push('Date of Birth');

  if (villageOrCity) importedFields.push('Village / City Name');
  else missingFields.push('Village / City Name');

  if (gender) importedFields.push('Gender');
  else missingFields.push('Gender');

  if (phoneNumber) importedFields.push('Phone Number');
  else missingFields.push('Phone Number');

  return {
    fullName,
    dateOfBirth,
    villageOrCity,
    gender,
    phoneNumber,
    importedFields,
    missingFields,
  };
}

/**
 * Fetches the authenticated user's profile fields from Google People API
 * using their OAuth provider access token.
 */
export async function fetchGooglePeopleProfile(
  providerToken: string
): Promise<GooglePeopleProfile> {
  if (!providerToken || !providerToken.trim()) {
    throw new Error('Google access token is not available in the current session.');
  }

  const res = await fetch(PEOPLE_API_ENDPOINT, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${providerToken}`,
    },
  });

  if (!res.ok) {
    let apiMessage = `Google People API returned HTTP ${res.status}.`;
    try {
      const errBody = await res.json();
      if (errBody?.error?.message) {
        apiMessage = errBody.error.message;
      }
    } catch {
      // ignore parse failure
    }

    if (res.status === 401) {
      throw new Error('Your Google access token has expired.');
    }
    if (res.status === 403) {
      throw new Error(`Google People API access was denied (${apiMessage}).`);
    }
    throw new Error(apiMessage);
  }

  const payload = (await res.json()) as GooglePeopleRawResponse;
  return parseGooglePeopleResponse(payload);
}
