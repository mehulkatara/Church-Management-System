// Supabase Edge Function: SMS Gateway Dispatch (Plan B via capcom6/android-sms-gateway)
// Dispatches receipt SMS messages immediately on donation save, handles retries,
// syncs delivery reports, and runs test SMS sends for Admin/Accountant setup.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface GatewayRecord {
  church_id: string;
  enabled: boolean;
  api_url: string;
  username: string;
  password: string;
  device_id: string | null;
  sim_number: number | null;
}

const DEFAULT_GATEWAY_URL = 'https://api.sms-gate.app/3rdparty/v1';

function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin');
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function jsonResponse(
  req: Request,
  body: Record<string, unknown>,
  status = 200
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...buildCorsHeaders(req),
    },
  });
}

function validateHttpsGatewayUrl(rawUrl: string | null | undefined): string {
  const trimmed = (rawUrl || DEFAULT_GATEWAY_URL).trim().replace(/\/+$/, '');
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

function formatPhoneToE164(raw: string | null | undefined): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;

  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  if (hasPlus) {
    return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
  }
  if (/^[6-9]\d{9}$/.test(digits)) {
    return `+91${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('0') && /^[6-9]\d{9}$/.test(digits.slice(1))) {
    return `+91${digits.slice(1)}`;
  }
  if (digits.length === 12 && digits.startsWith('91') && /^[6-9]\d{9}$/.test(digits.slice(2))) {
    return `+${digits}`;
  }
  if (/^[1-9]\d{7,14}$/.test(digits)) {
    return `+${digits}`;
  }
  return null;
}

function encodeBasicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function formatReceiptSmsMessage(params: {
  memberName: string;
  churchName: string;
  amount: number;
  category: string;
  donationDate: string;
  receiptNumber: string;
}): string {
  const formattedAmount = params.amount.toFixed(2);
  return `Thank you, ${params.memberName}. ${params.churchName} has recorded your donation of INR ${formattedAmount} towards ${params.category} on ${params.donationDate}. Receipt: ${params.receiptNumber}.`;
}

function renderBroadcastTemplate(
  template: string,
  vars: {
    fullName: string | null | undefined;
    memberNumber: string | null | undefined;
    villageName: string | null | undefined;
    churchName: string | null | undefined;
  }
): string {
  const cleanFullName = (vars.fullName || '').trim().replace(/\s+/g, ' ') || 'Member';
  const cleanFirstName = cleanFullName.split(' ')[0] || 'Member';
  const cleanMemberNumber = (vars.memberNumber || '').trim() || '-';
  const cleanVillage = (vars.villageName || '').trim() || 'your area';
  const cleanChurch = (vars.churchName || '').trim() || 'Church';

  const replacements: Record<string, string> = {
    full_name: cleanFullName,
    first_name: cleanFirstName,
    member_number: cleanMemberNumber,
    village_name: cleanVillage,
    church_name: cleanChurch,
  };

  return template
    .replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, rawKey: string) => {
      const key = rawKey.toLowerCase();
      return key in replacements ? replacements[key] : match;
    })
    .trim();
}

function mapGatewayState(
  rawState: string | undefined
): 'submitted' | 'delivered' | 'failed' {
  const s = (rawState || '').toLowerCase();
  if (s === 'delivered') return 'delivered';
  if (s === 'failed') return 'failed';
  return 'submitted';
}

async function getCallerChurchRoles(
  serviceClient: ReturnType<typeof createClient>,
  userId: string,
  churchId: string
): Promise<{ isPlatformAdmin: boolean; role: string | null }> {
  const { data: pa } = await serviceClient
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (pa) {
    return { isPlatformAdmin: true, role: 'admin' };
  }

  const { data: accessRows } = await serviceClient
    .from('church_access')
    .select('role')
    .eq('church_id', churchId)
    .eq('user_id', userId)
    .eq('status', 'approved');

  const roles = (accessRows || []).map((r: { role: string }) => r.role);
  if (roles.includes('admin')) return { isPlatformAdmin: false, role: 'admin' };
  if (roles.includes('accountant')) return { isPlatformAdmin: false, role: 'accountant' };
  if (roles.includes('collector')) return { isPlatformAdmin: false, role: 'collector' };
  if (roles.includes('member')) return { isPlatformAdmin: false, role: 'member' };
  return { isPlatformAdmin: false, role: null };
}

async function sendViaAndroidSmsGateway(params: {
  gateway: GatewayRecord;
  jobId: string;
  recipientPhone: string;
  messageBody: string;
}): Promise<{
  ok: boolean;
  httpStatus: number;
  externalId: string | null;
  gatewayState: string | null;
  responseBody: Record<string, unknown>;
  errorMessage: string | null;
}> {
  const baseUrl = validateHttpsGatewayUrl(params.gateway.api_url);
  const payload: Record<string, unknown> = {
    id: params.jobId,
    textMessage: { text: params.messageBody },
    phoneNumbers: [params.recipientPhone],
    withDeliveryReport: true,
  };
  if (params.gateway.device_id && params.gateway.device_id.trim()) {
    payload.deviceId = params.gateway.device_id.trim();
  }
  if (params.gateway.sim_number === 1 || params.gateway.sim_number === 2) {
    payload.simNumber = params.gateway.sim_number;
  }

  const response = await fetch(`${baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${encodeBasicAuth(params.gateway.username, params.gateway.password)}`,
    },
    body: JSON.stringify(payload),
  });

  const textBody = await response.text();
  let parsedBody: Record<string, unknown> = {};
  try {
    parsedBody = textBody ? JSON.parse(textBody) : {};
  } catch {
    parsedBody = { raw: textBody };
  }

  if (!response.ok) {
    const errText =
      (typeof parsedBody.message === 'string' && parsedBody.message) ||
      (typeof parsedBody.error === 'string' && parsedBody.error) ||
      textBody ||
      response.statusText ||
      `Gateway HTTP ${response.status}`;

    return {
      ok: false,
      httpStatus: response.status,
      externalId: null,
      gatewayState: null,
      responseBody: parsedBody,
      errorMessage: `Gateway error (${response.status}): ${errText}`,
    };
  }

  const externalId =
    (typeof parsedBody.id === 'string' && parsedBody.id) || params.jobId;
  const gatewayState =
    typeof parsedBody.state === 'string' ? parsedBody.state : 'Pending';

  return {
    ok: true,
    httpStatus: response.status,
    externalId,
    gatewayState,
    responseBody: parsedBody,
    errorMessage: null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: buildCorsHeaders(req) });
  }

  if (req.method !== 'POST') {
    return jsonResponse(req, { error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse(
      req,
      { error: 'Supabase environment variables are not configured on Edge Function runtime.' },
      500
    );
  }

  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResponse(req, { error: 'Missing bearer authentication token.' }, 401);
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser();

  if (userError || !user) {
    return jsonResponse(req, { error: 'Invalid or expired user session.' }, 401);
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, { error: 'Invalid JSON request body.' }, 400);
  }

  const action = typeof body.action === 'string' ? body.action : '';

  try {
    if (action === 'dispatch_donation') {
      const churchId = typeof body.churchId === 'string' ? body.churchId : '';
      const donationId = typeof body.donationId === 'string' ? body.donationId : '';
      if (!churchId || !donationId) {
        return jsonResponse(req, { error: 'churchId and donationId are required.' }, 400);
      }

      const { isPlatformAdmin, role } = await getCallerChurchRoles(serviceClient, user.id, churchId);
      if (!isPlatformAdmin && !['admin', 'accountant', 'collector'].includes(role || '')) {
        return jsonResponse(req, { error: 'Insufficient permissions to dispatch donation SMS.' }, 403);
      }

      const { data: donation, error: donError } = await serviceClient
        .from('donations')
        .select(`
          id,
          church_id,
          receipt_number,
          donation_date,
          amount,
          deleted_at,
          member:members(full_name, contact_phone),
          category:donation_categories(name),
          church:churches(name)
        `)
        .eq('id', donationId)
        .eq('church_id', churchId)
        .maybeSingle();

      if (donError || !donation || donation.deleted_at) {
        return jsonResponse(req, { error: 'Donation record not found or deleted.' }, 404);
      }

      const memberInfo = donation.member as unknown as {
        full_name: string;
        contact_phone: string | null;
      } | null;
      const categoryInfo = donation.category as unknown as { name: string } | null;
      const churchInfo = donation.church as unknown as { name: string } | null;

      const e164Phone = formatPhoneToE164(memberInfo?.contact_phone);
      if (!e164Phone) {
        return jsonResponse(req, {
          ok: false,
          status: 'skipped_no_phone',
          message: 'Member does not have a valid mobile number saved.',
        });
      }

      const smsText = formatReceiptSmsMessage({
        memberName: memberInfo?.full_name || 'Member',
        churchName: churchInfo?.name || 'Church',
        amount: Number(donation.amount),
        category: categoryInfo?.name || 'Offering',
        donationDate: String(donation.donation_date),
        receiptNumber: String(donation.receipt_number),
      });

      const { data: existingJob } = await serviceClient
        .from('notification_jobs')
        .select('*')
        .eq('church_id', churchId)
        .eq('donation_id', donationId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (
        existingJob &&
        (existingJob.status === 'submitted' || existingJob.status === 'delivered')
      ) {
        return jsonResponse(req, {
          ok: true,
          status: existingJob.status,
          jobId: existingJob.id,
          externalId: existingJob.external_id,
          message: 'Receipt SMS has already been submitted to Android SMS Gateway.',
        });
      }

      let jobId = existingJob?.id as string | undefined;
      let previousAttempts = Number(existingJob?.attempts_count || 0);

      if (!jobId) {
        const { data: insertedJob, error: insertErr } = await serviceClient
          .from('notification_jobs')
          .insert({
            church_id: churchId,
            donation_id: donationId,
            recipient_phone: e164Phone,
            recipient_name: memberInfo?.full_name || 'Member',
            message_body: smsText,
            status: 'queued',
            provider: 'android_sms_gateway',
            attempts_count: 0,
          })
          .select('id')
          .single();

        if (insertErr || !insertedJob) {
          throw new Error(insertErr?.message || 'Failed to create notification job.');
        }
        jobId = insertedJob.id;
        previousAttempts = 0;
      }

      const { data: gateway } = await serviceClient
        .from('church_sms_gateways')
        .select('*')
        .eq('church_id', churchId)
        .maybeSingle();

      const nowIso = new Date().toISOString();

      if (!gateway || !gateway.enabled || !gateway.username || !gateway.password) {
        const msg = !gateway
          ? 'Android SMS Gateway is not configured for this church yet. Ask Admin or Accountant to configure it in Settings.'
          : 'Automatic SMS delivery is currently disabled in Church Settings.';

        await serviceClient
          .from('notification_jobs')
          .update({
            status: 'not_configured',
            provider: 'android_sms_gateway',
            error_message: msg,
            updated_at: nowIso,
          })
          .eq('id', jobId);

        return jsonResponse(req, {
          ok: false,
          status: 'not_configured',
          jobId,
          message: msg,
        });
      }

      const attemptNumber = previousAttempts + 1;
      const dispatch = await sendViaAndroidSmsGateway({
        gateway: gateway as GatewayRecord,
        jobId,
        recipientPhone: e164Phone,
        messageBody: smsText,
      });

      if (dispatch.ok) {
        const mappedStatus = mapGatewayState(dispatch.gatewayState || undefined);
        await serviceClient
          .from('notification_jobs')
          .update({
            status: mappedStatus,
            provider: 'android_sms_gateway',
            external_id: dispatch.externalId,
            attempts_count: attemptNumber,
            last_attempt_at: nowIso,
            error_message: null,
            updated_at: nowIso,
          })
          .eq('id', jobId);

        await serviceClient.from('notification_attempts').insert({
          job_id: jobId,
          attempt_number: attemptNumber,
          status: mappedStatus,
          response_payload: dispatch.responseBody,
        });

        return jsonResponse(req, {
          ok: true,
          status: mappedStatus,
          jobId,
          externalId: dispatch.externalId,
          gatewayState: dispatch.gatewayState,
          message: 'Receipt SMS submitted to Android SMS Gateway.',
        });
      } else {
        await serviceClient
          .from('notification_jobs')
          .update({
            status: 'failed',
            provider: 'android_sms_gateway',
            attempts_count: attemptNumber,
            last_attempt_at: nowIso,
            error_message: dispatch.errorMessage,
            updated_at: nowIso,
          })
          .eq('id', jobId);

        await serviceClient.from('notification_attempts').insert({
          job_id: jobId,
          attempt_number: attemptNumber,
          status: 'failed',
          response_payload: dispatch.responseBody,
          error_message: dispatch.errorMessage,
        });

        return jsonResponse(req, {
          ok: false,
          status: 'failed',
          jobId,
          message: dispatch.errorMessage || 'Failed to send SMS via Android SMS Gateway.',
        });
      }
    }

    if (action === 'retry_job') {
      const jobId = typeof body.jobId === 'string' ? body.jobId : '';
      if (!jobId) {
        return jsonResponse(req, { error: 'jobId is required.' }, 400);
      }

      const { data: job, error: jobErr } = await serviceClient
        .from('notification_jobs')
        .select('*')
        .eq('id', jobId)
        .maybeSingle();

      if (jobErr || !job) {
        return jsonResponse(req, { error: 'Notification job not found.' }, 404);
      }

      const { isPlatformAdmin, role } = await getCallerChurchRoles(
        serviceClient,
        user.id,
        job.church_id
      );
      if (!isPlatformAdmin && !['admin', 'accountant', 'collector'].includes(role || '')) {
        return jsonResponse(req, { error: 'Insufficient permissions to retry SMS job.' }, 403);
      }

      const { data: gateway } = await serviceClient
        .from('church_sms_gateways')
        .select('*')
        .eq('church_id', job.church_id)
        .maybeSingle();

      const nowIso = new Date().toISOString();
      if (!gateway || !gateway.enabled || !gateway.username || !gateway.password) {
        const msg =
          'Android SMS Gateway is not configured or is disabled in Church Settings.';
        await serviceClient
          .from('notification_jobs')
          .update({
            status: 'not_configured',
            error_message: msg,
            updated_at: nowIso,
          })
          .eq('id', job.id);

        return jsonResponse(req, {
          ok: false,
          status: 'not_configured',
          jobId: job.id,
          message: msg,
        });
      }

      const e164Phone = formatPhoneToE164(job.recipient_phone) || job.recipient_phone;
      const attemptNumber = Number(job.attempts_count || 0) + 1;
      const dispatch = await sendViaAndroidSmsGateway({
        gateway: gateway as GatewayRecord,
        jobId: job.id,
        recipientPhone: e164Phone,
        messageBody: job.message_body,
      });

      if (dispatch.ok) {
        const mappedStatus = mapGatewayState(dispatch.gatewayState || undefined);
        await serviceClient
          .from('notification_jobs')
          .update({
            status: mappedStatus,
            provider: 'android_sms_gateway',
            external_id: dispatch.externalId,
            attempts_count: attemptNumber,
            last_attempt_at: nowIso,
            error_message: null,
            updated_at: nowIso,
          })
          .eq('id', job.id);

        await serviceClient.from('notification_attempts').insert({
          job_id: job.id,
          attempt_number: attemptNumber,
          status: mappedStatus,
          response_payload: dispatch.responseBody,
        });

        return jsonResponse(req, {
          ok: true,
          status: mappedStatus,
          jobId: job.id,
          externalId: dispatch.externalId,
          message: 'SMS re-submitted to Android SMS Gateway.',
        });
      } else {
        await serviceClient
          .from('notification_jobs')
          .update({
            status: 'failed',
            provider: 'android_sms_gateway',
            attempts_count: attemptNumber,
            last_attempt_at: nowIso,
            error_message: dispatch.errorMessage,
            updated_at: nowIso,
          })
          .eq('id', job.id);

        await serviceClient.from('notification_attempts').insert({
          job_id: job.id,
          attempt_number: attemptNumber,
          status: 'failed',
          response_payload: dispatch.responseBody,
          error_message: dispatch.errorMessage,
        });

        return jsonResponse(req, {
          ok: false,
          status: 'failed',
          jobId: job.id,
          message: dispatch.errorMessage || 'Retry failed.',
        });
      }
    }

    if (action === 'sync_status') {
      const jobId = typeof body.jobId === 'string' ? body.jobId : '';
      if (!jobId) {
        return jsonResponse(req, { error: 'jobId is required.' }, 400);
      }

      const { data: job, error: jobErr } = await serviceClient
        .from('notification_jobs')
        .select('*')
        .eq('id', jobId)
        .maybeSingle();

      if (jobErr || !job) {
        return jsonResponse(req, { error: 'Notification job not found.' }, 404);
      }

      const { isPlatformAdmin, role } = await getCallerChurchRoles(
        serviceClient,
        user.id,
        job.church_id
      );
      if (!isPlatformAdmin && !['admin', 'accountant', 'collector'].includes(role || '')) {
        return jsonResponse(req, { error: 'Insufficient permissions to sync SMS status.' }, 403);
      }

      if (!job.external_id) {
        return jsonResponse(req, { error: 'This job does not have a gateway message ID yet.' }, 400);
      }

      const { data: gateway } = await serviceClient
        .from('church_sms_gateways')
        .select('*')
        .eq('church_id', job.church_id)
        .maybeSingle();

      if (!gateway) {
        return jsonResponse(req, { error: 'Android SMS Gateway not configured for this church.' }, 400);
      }

      const baseUrl = validateHttpsGatewayUrl(gateway.api_url);
      const statusRes = await fetch(
        `${baseUrl}/messages/${encodeURIComponent(job.external_id)}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Basic ${encodeBasicAuth(gateway.username, gateway.password)}`,
          },
        }
      );

      const resBody = await statusRes.json().catch(() => ({}));
      if (!statusRes.ok) {
        return jsonResponse(
          req,
          {
            ok: false,
            error:
              (resBody as { message?: string }).message ||
              `Gateway status check failed (${statusRes.status}).`,
          },
          400
        );
      }

      const rawState = typeof (resBody as { state?: string }).state === 'string'
        ? (resBody as { state: string }).state
        : '';
      const mapped = mapGatewayState(rawState);

      await serviceClient
        .from('notification_jobs')
        .update({
          status: mapped,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      return jsonResponse(req, {
        ok: true,
        status: mapped,
        gatewayState: rawState,
        jobId: job.id,
        message: `Gateway status: ${rawState || mapped}`,
      });
    }

    if (action === 'send_test') {
      const churchId = typeof body.churchId === 'string' ? body.churchId : '';
      const testPhoneRaw = typeof body.phone === 'string' ? body.phone : '';
      if (!churchId || !testPhoneRaw) {
        return jsonResponse(req, { error: 'churchId and phone are required for test SMS.' }, 400);
      }

      const { isPlatformAdmin, role } = await getCallerChurchRoles(serviceClient, user.id, churchId);
      if (!isPlatformAdmin && !['admin', 'accountant'].includes(role || '')) {
        return jsonResponse(
          req,
          { error: 'Only Church Admins or Accountants can send test SMS messages.' },
          403
        );
      }

      const e164Phone = formatPhoneToE164(testPhoneRaw);
      if (!e164Phone) {
        return jsonResponse(req, { error: 'Please enter a valid mobile number (e.g., 9840012345).' }, 400);
      }

      const { data: gateway } = await serviceClient
        .from('church_sms_gateways')
        .select('*')
        .eq('church_id', churchId)
        .maybeSingle();

      if (!gateway || !gateway.username || !gateway.password) {
        return jsonResponse(
          req,
          { error: 'Please save your Android SMS Gateway credentials before sending a test SMS.' },
          400
        );
      }

      const { data: churchRow } = await serviceClient
        .from('churches')
        .select('name')
        .eq('id', churchId)
        .maybeSingle();

      const testText = `Test SMS from ${churchRow?.name || 'Church Management System'} via Android SMS Gateway.`;

      const { data: testJob, error: testJobErr } = await serviceClient
        .from('notification_jobs')
        .insert({
          church_id: churchId,
          donation_id: null,
          recipient_phone: e164Phone,
          recipient_name: 'Gateway Test',
          message_body: testText,
          status: 'queued',
          provider: 'android_sms_gateway',
          attempts_count: 1,
        })
        .select('id')
        .single();

      if (testJobErr || !testJob) {
        throw new Error(testJobErr?.message || 'Unable to log test notification job.');
      }

      const dispatch = await sendViaAndroidSmsGateway({
        gateway: gateway as GatewayRecord,
        jobId: testJob.id,
        recipientPhone: e164Phone,
        messageBody: testText,
      });

      const nowIso = new Date().toISOString();
      if (dispatch.ok) {
        const mapped = mapGatewayState(dispatch.gatewayState || undefined);
        await serviceClient
          .from('notification_jobs')
          .update({
            status: mapped,
            external_id: dispatch.externalId,
            last_attempt_at: nowIso,
            updated_at: nowIso,
          })
          .eq('id', testJob.id);

        await serviceClient.from('notification_attempts').insert({
          job_id: testJob.id,
          attempt_number: 1,
          status: mapped,
          response_payload: dispatch.responseBody,
        });

        return jsonResponse(req, {
          ok: true,
          status: mapped,
          jobId: testJob.id,
          externalId: dispatch.externalId,
          message: `Test SMS submitted to Android SMS Gateway (${dispatch.gatewayState || 'Pending'}).`,
        });
      } else {
        await serviceClient
          .from('notification_jobs')
          .update({
            status: 'failed',
            last_attempt_at: nowIso,
            error_message: dispatch.errorMessage,
            updated_at: nowIso,
          })
          .eq('id', testJob.id);

        await serviceClient.from('notification_attempts').insert({
          job_id: testJob.id,
          attempt_number: 1,
          status: 'failed',
          response_payload: dispatch.responseBody,
          error_message: dispatch.errorMessage,
        });

        return jsonResponse(req, {
          ok: false,
          status: 'failed',
          jobId: testJob.id,
          message: dispatch.errorMessage || 'Test SMS failed.',
        });
      }
    }

    if (action === 'send_broadcast') {
      const churchId = typeof body.churchId === 'string' ? body.churchId : '';
      const rawTemplate = typeof body.messageTemplate === 'string' ? body.messageTemplate.trim() : '';
      const rawTitle = typeof body.title === 'string' ? body.title.trim().replace(/\s+/g, ' ') : '';
      const audienceMode =
        body.audienceMode === 'village' || body.audienceMode === 'selected'
          ? body.audienceMode
          : 'all_active';
      const villageFilter = typeof body.villageFilter === 'string' ? body.villageFilter.trim() : '';
      const memberIds = Array.isArray(body.memberIds)
        ? body.memberIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        : [];

      if (!churchId || !rawTemplate) {
        return jsonResponse(req, { error: 'churchId and messageTemplate are required.' }, 400);
      }

      if (rawTemplate.length > 1600) {
        return jsonResponse(req, { error: 'Broadcast message cannot exceed 1,600 characters.' }, 400);
      }

      const { isPlatformAdmin, role } = await getCallerChurchRoles(serviceClient, user.id, churchId);
      if (!isPlatformAdmin && !['admin', 'accountant'].includes(role || '')) {
        return jsonResponse(
          req,
          { error: 'Only Accountants, Church Admins, and Platform Admins can send member broadcasts.' },
          403
        );
      }

      const { data: churchRow } = await serviceClient
        .from('churches')
        .select('id, name, is_active')
        .eq('id', churchId)
        .maybeSingle();

      if (!churchRow || !churchRow.is_active) {
        return jsonResponse(req, { error: 'Church not found or inactive.' }, 404);
      }

      const { data: gateway } = await serviceClient
        .from('church_sms_gateways')
        .select('*')
        .eq('church_id', churchId)
        .maybeSingle();

      if (!gateway || !gateway.enabled || !gateway.username || !gateway.password) {
        const msg = !gateway
          ? 'Android SMS Gateway is not configured for this church yet. Configure it in Church Settings -> SMS Delivery.'
          : 'Automatic SMS delivery is currently disabled in Church Settings.';
        return jsonResponse(req, {
          ok: false,
          status: 'not_configured',
          totalTargeted: 0,
          sentCount: 0,
          failedCount: 0,
          skippedNoPhoneCount: 0,
          message: msg,
        });
      }

      let membersQuery = serviceClient
        .from('members')
        .select('id, full_name, member_number, contact_phone, village_name, membership_status')
        .eq('church_id', churchId)
        .eq('membership_status', 'active')
        .order('full_name');

      if (audienceMode === 'selected') {
        if (memberIds.length === 0) {
          return jsonResponse(req, { error: 'Please select at least one active member.' }, 400);
        }
        membersQuery = membersQuery.in('id', memberIds);
      }

      const { data: rawMembers, error: memErr } = await membersQuery;
      if (memErr) {
        throw new Error(memErr.message);
      }

      let matchedMembers = (rawMembers || []) as Array<{
        id: string;
        full_name: string;
        member_number: string;
        contact_phone: string | null;
        village_name: string | null;
        membership_status: string;
      }>;

      if (audienceMode === 'village') {
        if (!villageFilter) {
          return jsonResponse(req, { error: 'Please choose a Village / City to filter recipients.' }, 400);
        }
        const normalizedVillage = villageFilter.replace(/\s+/g, ' ').toLowerCase();
        matchedMembers = matchedMembers.filter(
          (m) => (m.village_name || '').trim().replace(/\s+/g, ' ').toLowerCase() === normalizedVillage
        );
      }

      const readyRecipients: Array<{
        member: (typeof matchedMembers)[number];
        e164Phone: string;
      }> = [];
      let skippedNoPhoneCount = 0;

      for (const m of matchedMembers) {
        const e164Phone = formatPhoneToE164(m.contact_phone);
        if (e164Phone) {
          readyRecipients.push({ member: m, e164Phone });
        } else {
          skippedNoPhoneCount += 1;
        }
      }

      if (readyRecipients.length === 0) {
        return jsonResponse(
          req,
          {
            ok: false,
            status: 'failed',
            totalTargeted: matchedMembers.length,
            sentCount: 0,
            failedCount: 0,
            skippedNoPhoneCount,
            message: 'None of the selected active members have a valid mobile number.',
          },
          400
        );
      }

      const campaignTitle = rawTitle || rawTemplate.slice(0, 60) || 'Member Broadcast';
      const { data: campaign, error: campErr } = await serviceClient
        .from('broadcast_campaigns')
        .insert({
          church_id: churchId,
          title: campaignTitle,
          message_template: rawTemplate,
          audience_filter: {
            mode: audienceMode,
            village: audienceMode === 'village' ? villageFilter : null,
            selected_count: readyRecipients.length,
          },
          total_targeted: matchedMembers.length,
          sent_count: 0,
          failed_count: 0,
          skipped_no_phone_count: skippedNoPhoneCount,
          created_by: user.id,
        })
        .select('id')
        .single();

      if (campErr || !campaign) {
        throw new Error(campErr?.message || 'Failed to create broadcast campaign record.');
      }

      let sentCount = 0;
      let failedCount = 0;

      const BATCH_SIZE = 5;
      for (let i = 0; i < readyRecipients.length; i += BATCH_SIZE) {
        const chunk = readyRecipients.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
          chunk.map(async ({ member, e164Phone }) => {
            const personalizedText = renderBroadcastTemplate(rawTemplate, {
              fullName: member.full_name,
              memberNumber: member.member_number,
              villageName: member.village_name,
              churchName: churchRow.name,
            });

            const { data: jobRow, error: jobErr } = await serviceClient
              .from('notification_jobs')
              .insert({
                church_id: churchId,
                donation_id: null,
                broadcast_id: campaign.id,
                member_id: member.id,
                recipient_phone: e164Phone,
                recipient_name: member.full_name,
                message_body: personalizedText,
                status: 'queued',
                provider: 'android_sms_gateway',
                attempts_count: 0,
              })
              .select('id')
              .single();

            if (jobErr || !jobRow) {
              return false;
            }

            const nowIso = new Date().toISOString();
            const dispatch = await sendViaAndroidSmsGateway({
              gateway: gateway as GatewayRecord,
              jobId: jobRow.id,
              recipientPhone: e164Phone,
              messageBody: personalizedText,
            });

            if (dispatch.ok) {
              const mappedStatus = mapGatewayState(dispatch.gatewayState || undefined);
              await serviceClient
                .from('notification_jobs')
                .update({
                  status: mappedStatus,
                  external_id: dispatch.externalId,
                  attempts_count: 1,
                  last_attempt_at: nowIso,
                  error_message: null,
                  updated_at: nowIso,
                })
                .eq('id', jobRow.id);

              await serviceClient.from('notification_attempts').insert({
                job_id: jobRow.id,
                attempt_number: 1,
                status: mappedStatus,
                response_payload: dispatch.responseBody,
              });
              return true;
            } else {
              await serviceClient
                .from('notification_jobs')
                .update({
                  status: 'failed',
                  attempts_count: 1,
                  last_attempt_at: nowIso,
                  error_message: dispatch.errorMessage,
                  updated_at: nowIso,
                })
                .eq('id', jobRow.id);

              await serviceClient.from('notification_attempts').insert({
                job_id: jobRow.id,
                attempt_number: 1,
                status: 'failed',
                response_payload: dispatch.responseBody,
                error_message: dispatch.errorMessage,
              });
              return false;
            }
          })
        );

        for (const ok of results) {
          if (ok) sentCount += 1;
          else failedCount += 1;
        }
      }

      await serviceClient
        .from('broadcast_campaigns')
        .update({
          sent_count: sentCount,
          failed_count: failedCount,
          skipped_no_phone_count: skippedNoPhoneCount,
        })
        .eq('id', campaign.id);

      await serviceClient.from('audit_logs').insert({
        church_id: churchId,
        actor_user_id: user.id,
        action: 'broadcast.sent',
        entity_type: 'broadcast_campaign',
        entity_id: campaign.id,
        change_summary: `Broadcast "${campaignTitle}" dispatched to ${sentCount}/${readyRecipients.length} member phone(s) (${failedCount} failed, ${skippedNoPhoneCount} skipped without phone)`,
        new_state: {
          title: campaignTitle,
          audience_mode: audienceMode,
          village_filter: audienceMode === 'village' ? villageFilter : null,
          total_targeted: matchedMembers.length,
          sent_count: sentCount,
          failed_count: failedCount,
          skipped_no_phone_count: skippedNoPhoneCount,
        },
      });

      const finalStatus =
        sentCount === readyRecipients.length
          ? 'completed'
          : sentCount > 0
          ? 'partial'
          : 'failed';

      return jsonResponse(req, {
        ok: sentCount > 0,
        status: finalStatus,
        campaignId: campaign.id,
        totalTargeted: matchedMembers.length,
        sentCount,
        failedCount,
        skippedNoPhoneCount,
        message:
          sentCount > 0
            ? `Broadcast submitted to ${sentCount} of ${readyRecipients.length} member phone(s).${
                failedCount > 0 ? ` ${failedCount} failed (retryable in SMS Confirmations).` : ''
              }`
            : `Broadcast failed for all ${failedCount} recipient(s). Check gateway status and retry in SMS Confirmations.`,
      });
    }

    return jsonResponse(req, { error: 'Unsupported action.' }, 400);
  } catch (err: unknown) {
    return jsonResponse(
      req,
      { error: err instanceof Error ? err.message : 'Unexpected SMS gateway error.' },
      500
    );
  }
});
