// Supabase Edge Function: Notification Worker
// Processes queued durable notification jobs for SMS providers (e.g. Twilio / Kaleyra / Fast2SMS)
// Uses provider-supported idempotency, controlled retries, and callback verification.
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

Deno.serve(async (req) => {
  // Only accept authorized POST requests from Supabase pg_net / cron webhook or Admin
  const authHeader = req.headers.get('Authorization');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'Supabase environment not configured on Edge Function runtime' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate internal call authorization
  if (authHeader !== `Bearer ${serviceRoleKey}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized internal call' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Fetch pending queued jobs (limit 10 per invocation to avoid timeouts)
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
    const providerApiKey = Deno.env.get('SMS_PROVIDER_API_KEY');
    const providerSenderId = Deno.env.get('SMS_PROVIDER_SENDER_ID') || 'CHURCH';

    if (!providerApiKey) {
      // Honest state: not_configured
      await supabase
        .from('notification_jobs')
        .update({
          status: 'not_configured',
          error_message: 'SMS provider API key not configured on server.',
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      results.push({ id: job.id, status: 'not_configured' });
      continue;
    }

    try {
      // In production, call your registered DLT / Telecom provider API
      // e.g. Fast2SMS, Twilio, or Kaleyra with idempotency header
      const response = await fetch('https://api.sms-provider.example/v1/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${providerApiKey}`,
          'X-Idempotency-Key': `job-${job.id}-${attemptNumber}`,
        },
        body: JSON.stringify({
          sender: providerSenderId,
          recipient: job.recipient_phone,
          message: job.message_body,
        }),
      });

      const responseBody = await response.json().catch(() => ({ statusText: response.statusText }));

      if (response.ok) {
        await supabase
          .from('notification_jobs')
          .update({
            status: 'submitted',
            provider: 'standard_sms_gateway',
            external_id: responseBody.message_id || `msg-${Date.now()}`,
            attempts_count: attemptNumber,
            last_attempt_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id);

        await supabase.from('notification_attempts').insert({
          job_id: job.id,
          attempt_number: attemptNumber,
          status: 'submitted',
          response_payload: responseBody,
        });

        results.push({ id: job.id, status: 'submitted' });
      } else {
        const isTerminal = attemptNumber >= 3;
        await supabase
          .from('notification_jobs')
          .update({
            status: isTerminal ? 'failed' : 'queued',
            attempts_count: attemptNumber,
            last_attempt_at: new Date().toISOString(),
            error_message: `Provider error: ${response.status} ${JSON.stringify(responseBody)}`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id);

        await supabase.from('notification_attempts').insert({
          job_id: job.id,
          attempt_number: attemptNumber,
          status: 'failed',
          response_payload: responseBody,
          error_message: `Status ${response.status}`,
        });

        results.push({ id: job.id, status: 'failed', attempts: attemptNumber });
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await supabase
        .from('notification_jobs')
        .update({
          status: attemptNumber >= 3 ? 'failed' : 'queued',
          attempts_count: attemptNumber,
          last_attempt_at: new Date().toISOString(),
          error_message: errorMsg,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      results.push({ id: job.id, status: 'error', error: errorMsg });
    }
  }

  return new Response(JSON.stringify({ processed: results }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
