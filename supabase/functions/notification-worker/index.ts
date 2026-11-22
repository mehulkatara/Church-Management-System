// Supabase Edge Function: Notification Worker
// Background queue processor for queued durable notification jobs using
// per-church capcom6/android-sms-gateway Cloud Server credentials (`church_sms_gateways`).
// SMS failure never undoes saved donations.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface SmsJob {
  id: string;
  church_id: string;
  donation_id: string | null;
  recipient_phone: string;
  recipient_name: string;
  message_body: string;
  attempts_count: number;
}

interface GatewayRecord {
  church_id: string;
  enabled: boolean;
  api_url: string;
  username: string;
  password: string;
  device_id: string | null;
  sim_number: number | null;
}

function encodeBasicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function validateHttpsGatewayUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  const parsed = new URL(trimmed);
  if (parsed.protocol !== 'https:') {
    throw new Error('Gateway URL must use HTTPS.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Gateway URL must not include embedded credentials.');
  }
  const host = parsed.hostname.toLowerCase();
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0' ||
    host.includes(':') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
  ) {
    throw new Error('Private or loopback hosts are not allowed for Gateway URL.');
  }
  return trimmed;
}

function formatPhoneToE164(raw: string): string {
  const trimmed = (raw || '').trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return trimmed;
  if (hasPlus) return `+${digits}`;
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith('0') && /^[6-9]\d{9}$/.test(digits.slice(1))) {
    return `+91${digits.slice(1)}`;
  }
  if (digits.length === 12 && digits.startsWith('91') && /^[6-9]\d{9}$/.test(digits.slice(2))) {
    return `+${digits}`;
  }
  return `+${digits}`;
}

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: 'Supabase environment not configured on Edge Function runtime' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (authHeader !== `Bearer ${serviceRoleKey}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized internal call' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: jobs, error: fetchError } = await supabase
    .from('notification_jobs')
    .select('id, church_id, donation_id, recipient_phone, recipient_name, message_body, attempts_count')
    .eq('status', 'queued')
    .lt('attempts_count', 3)
    .order('created_at', { ascending: true })
    .limit(10);

  if (fetchError) {
    return new Response(JSON.stringify({ error: fetchError.message }), { status: 500 });
  }

  if (!jobs || jobs.length === 0) {
    return new Response(JSON.stringify({ message: 'No queued jobs found' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const results = [];

  for (const job of jobs as SmsJob[]) {
    const attemptNumber = job.attempts_count + 1;
    const nowIso = new Date().toISOString();

    const { data: gateway } = await supabase
      .from('church_sms_gateways')
      .select('*')
      .eq('church_id', job.church_id)
      .maybeSingle();

    const gw = gateway as GatewayRecord | null;

    if (!gw || !gw.enabled || !gw.username || !gw.password) {
      await supabase
        .from('notification_jobs')
        .update({
          status: 'not_configured',
          provider: 'android_sms_gateway',
          error_message: 'Android SMS Gateway not configured or disabled for this church.',
          updated_at: nowIso,
        })
        .eq('id', job.id);

      results.push({ id: job.id, status: 'not_configured' });
      continue;
    }

    try {
      const baseUrl = validateHttpsGatewayUrl(gw.api_url || 'https://api.sms-gate.app/3rdparty/v1');
      const payload: Record<string, unknown> = {
        id: job.id,
        textMessage: { text: job.message_body },
        phoneNumbers: [formatPhoneToE164(job.recipient_phone)],
        withDeliveryReport: true,
      };
      if (gw.device_id && gw.device_id.trim()) payload.deviceId = gw.device_id.trim();
      if (gw.sim_number === 1 || gw.sim_number === 2) payload.simNumber = gw.sim_number;

      const response = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${encodeBasicAuth(gw.username, gw.password)}`,
        },
        body: JSON.stringify(payload),
      });

      const responseBody = await response.json().catch(() => ({ statusText: response.statusText }));

      if (response.ok) {
        const externalId =
          typeof (responseBody as { id?: string }).id === 'string'
            ? (responseBody as { id: string }).id
            : job.id;

        await supabase
          .from('notification_jobs')
          .update({
            status: 'submitted',
            provider: 'android_sms_gateway',
            external_id: externalId,
            attempts_count: attemptNumber,
            last_attempt_at: nowIso,
            error_message: null,
            updated_at: nowIso,
          })
          .eq('id', job.id);

        await supabase.from('notification_attempts').insert({
          job_id: job.id,
          attempt_number: attemptNumber,
          status: 'submitted',
          response_payload: responseBody,
        });

        results.push({ id: job.id, status: 'submitted', externalId });
      } else {
        const isTerminal = attemptNumber >= 3;
        await supabase
          .from('notification_jobs')
          .update({
            status: isTerminal ? 'failed' : 'queued',
            provider: 'android_sms_gateway',
            attempts_count: attemptNumber,
            last_attempt_at: nowIso,
            error_message: `Gateway error: ${response.status} ${JSON.stringify(responseBody)}`,
            updated_at: nowIso,
          })
          .eq('id', job.id);

        await supabase.from('notification_attempts').insert({
          job_id: job.id,
          attempt_number: attemptNumber,
          status: 'failed',
          response_payload: responseBody,
          error_message: `Status ${response.status}`,
        });

        results.push({ id: job.id, status: isTerminal ? 'failed' : 'queued', attempts: attemptNumber });
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const isTerminal = attemptNumber >= 3;
      await supabase
        .from('notification_jobs')
        .update({
          status: isTerminal ? 'failed' : 'queued',
          provider: 'android_sms_gateway',
          attempts_count: attemptNumber,
          last_attempt_at: nowIso,
          error_message: errorMsg,
          updated_at: nowIso,
        })
        .eq('id', job.id);

      results.push({ id: job.id, status: 'error', error: errorMsg });
    }
  }

  return new Response(JSON.stringify({ processed: results }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
