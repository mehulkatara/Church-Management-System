import test from 'node:test';
import assert from 'node:assert';
import { decodeJwtPayload, parseOAuthCallback } from './supabase';

test('OAuth JWT payload decoder extracts claims accurately', () => {
  // Test token from actual Supabase Google OAuth callback provided by user
  const token =
    'eyJhbGciOiJFUzI1NiIsImtpZCI6ImUyZDFjYjY1LWZkMmEtNGFlYS1iZGUzLTk5YzdkZmYxYjA3MiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL2hqYmVwenFpaXRrdHhscWlsaHpvLnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiI2ZWIzYWI0OS0wMzE3LTQ2YTAtYWM4ZC0xZjYyYWRjZmFiNWUiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzk0MzM4MjYwLCJpYXQiOjE3OTQzMzQ2NjAsImVtYWlsIjoiMDhiaWMwMTlAZ21haWwuY29tIiwicGhvbmUiOiIiLCJhcHBfbWV0YWRhdGEiOnsicHJvdmlkZXIiOiJnb29nbGUiLCJwcm92aWRlcnMiOlsiZ29vZ2xlIl19LCJ1c2VyX21ldGFkYXRhIjp7ImF2YXRhcl91cmwiOiJodHRwczovL2xoMy5nb29nbGV1c2VyY29udGVudC5jb20vYS9BQ2c4b2NKSkdxX2NycXFWTUNIWUZaOHk0cHNwWTRUdjFYaFlsNmprSEhzWHZGSDRWNm13YnlaNU1BPXM5Ni1jIiwiZW1haWwiOiIwOGJpYzAxOUBnbWFpbC5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwiZnVsbF9uYW1lIjoiTWVodWwgS2F0YXJhIiwiaXNzIjoiaHR0cHM6Ly9hY2NvdW50cy5nb29nbGUuY29tIiwibmFtZSI6Ik1laHVsIEthdGFyYSIsInBob25lX3ZlcmlmaWVkIjpmYWxzZSwicGljdHVyZSI6Imh0dHBzOi8vbGgzLmdvb2dsZXVzZXJjb250ZW50LmNvbS9hL0FDZzhvY0pKR3FfY3JxcVZNQ0hZRlo4eTRwc3BZNFR2MVhoWWw2amtISHNYdkZINFY2bXdieVo1TUE9czk2LWMiLCJwcm92aWRlcl9pZCI6IjExODE0MjU3NTkwNDUyMzU1Nzg1MiIsInN1YiI6IjExODE0MjU3NTkwNDUyMzU1Nzg1MiJ9LCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImFhbCI6ImFhbDEiLCJhbXIiOlt7Im1ldGhvZCI6Im9hdXRoIiwidGltZXN0YW1wIjoxNzk0MzM0NjYwfV0sInNlc3Npb25faWQiOiIyZmY0ZTcyMC02NWJjLTQ0M2QtYTcwYS0wZjU2YTZjMDJlZWMiLCJpc19hbm9ueW1vdXMiOmZhbHNlfQ.InVdyY7cwExM_7ZssLob-jqhKYf72xiCwuTN6M-8m-8aNQlkZpLKHT6de3dAbGKlwGcKpcSonMYtRc3vKQXyHA';

  const payload = decodeJwtPayload(token);
  assert.ok(payload, 'Payload must not be null');
  assert.strictEqual(payload.email, '08bic019@gmail.com');
  assert.strictEqual(payload.sub, '6eb3ab49-0317-46a0-ac8d-1f62adcfab5e');
  assert.strictEqual(payload.user_metadata?.full_name, 'Mehul Katara');
  assert.strictEqual(payload.iss, 'https://hjbepzqiitktxlqilhzo.supabase.co/auth/v1');

  // Verify extracted Supabase URL
  const detectedUrl = payload.iss.replace(/\/auth\/v1\/?$/, '');
  assert.strictEqual(detectedUrl, 'https://hjbepzqiitktxlqilhzo.supabase.co');
});

test('parseOAuthCallback parses full URL fragment and extracts tokens', () => {
  const token =
    'eyJhbGciOiJFUzI1NiIsImtpZCI6ImUyZDFjYjY1LWZkMmEtNGFlYS1iZGUzLTk5YzdkZmYxYjA3MiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL2hqYmVwenFpaXRrdHhscWlsaHpvLnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiI2ZWIzYWI0OS0wMzE3LTQ2YTAtYWM4ZC0xZjYyYWRjZmFiNWUiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzk0MzM4MjYwLCJpYXQiOjE3OTQzMzQ2NjAsImVtYWlsIjoiMDhiaWMwMTlAZ21haWwuY29tIiwicGhvbmUiOiIiLCJhcHBfbWV0YWRhdGEiOnsicHJvdmlkZXIiOiJnb29nbGUiLCJwcm92aWRlcnMiOlsiZ29vZ2xlIl19LCJ1c2VyX21ldGFkYXRhIjp7ImF2YXRhcl91cmwiOiJodHRwczovL2xoMy5nb29nbGV1c2VyY29udGVudC5jb20vYS9BQ2c4b2NKSkdxX2NycXFWTUNIWUZaOHk0cHNwWTRUdjFYaFlsNmprSEhzWHZGSDRWNm13YnlaNU1BPXM5Ni1jIiwiZW1haWwiOiIwOGJpYzAxOUBnbWFpbC5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwiZnVsbF9uYW1lIjoiTWVodWwgS2F0YXJhIiwiaXNzIjoiaHR0cHM6Ly9hY2NvdW50cy5nb29nbGUuY29tIiwibmFtZSI6Ik1laHVsIEthdGFyYSIsInBob25lX3ZlcmlmaWVkIjpmYWxzZSwicGljdHVyZSI6Imh0dHBzOi8vbGgzLmdvb2dsZXVzZXJjb250ZW50LmNvbS9hL0FDZzhvY0pKR3FfY3JxcVZNQ0hZRlo4eTRwc3BZNFR2MVhoWWw2amtISHNYdkZINFY2bXdieVo1TUE9czk2LWMiLCJwcm92aWRlcl9pZCI6IjExODE0MjU3NTkwNDUyMzU1Nzg1MiIsInN1YiI6IjExODE0MjU3NTkwNDUyMzU1Nzg1MiJ9LCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImFhbCI6ImFhbDEiLCJhbXIiOlt7Im1ldGhvZCI6Im9hdXRoIiwidGltZXN0YW1wIjoxNzk0MzM0NjYwfV0sInNlc3Npb25faWQiOiIyZmY0ZTcyMC02NWJjLTQ0M2QtYTcwYS0wZjU2YTZjMDJlZWMiLCJpc19hbm9ueW1vdXMiOmZhbHNlfQ.InVdyY7cwExM_7ZssLob-jqhKYf72xiCwuTN6M-8m-8aNQlkZpLKHT6de3dAbGKlwGcKpcSonMYtRc3vKQXyHA';

  // Setup global mock window
  (global as any).window = {
    location: {
      hash: `#access_token=${token}&refresh_token=26ssyschbbx4&token_type=bearer&expires_in=3600`,
    },
    localStorage: {
      setItem: () => {},
      getItem: () => null,
      removeItem: () => {},
    },
  };
  (global as any).localStorage = (global as any).window.localStorage;

  const result = parseOAuthCallback();

  assert.ok(result, 'Result should be parsed');
  assert.strictEqual(result.accessToken, token);
  assert.strictEqual(result.refreshToken, '26ssyschbbx4');
  assert.strictEqual(result.payload.email, '08bic019@gmail.com');
  assert.strictEqual(result.payload.user_metadata?.full_name, 'Mehul Katara');
  assert.strictEqual(result.supabaseUrl, 'https://hjbepzqiitktxlqilhzo.supabase.co');

  delete (global as any).window;
  delete (global as any).localStorage;
});
