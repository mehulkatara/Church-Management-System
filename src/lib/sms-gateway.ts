import { supabase } from './supabase';
import { DEFAULT_ANDROID_SMS_GATEWAY_URL } from './domain-logic';
import type { AndroidSmsGatewayStatus } from '../types/database';

export interface SmsDispatchResponse {
  ok: boolean;
  status: 'submitted' | 'delivered' | 'failed' | 'not_configured' | 'skipped_no_phone' | 'queued';
  jobId?: string;
  externalId?: string;
  gatewayState?: string;
  message: string;
}

const DEFAULT_STATUS: AndroidSmsGatewayStatus = {
  configured: false,
  enabled: false,
  provider: 'android_sms_gateway',
  api_url: DEFAULT_ANDROID_SMS_GATEWAY_URL,
  username: null,
  has_password: false,
  device_id: null,
  sim_number: null,
  updated_at: null,
};

async function extractFunctionError(error: unknown): Promise<string> {
  if (error && typeof error === 'object') {
    const errObj = error as { message?: string; context?: Response };
    if (errObj.context && typeof errObj.context.json === 'function') {
      try {
        const body = await errObj.context.json();
        if (body?.error) return String(body.error);
        if (body?.message) return String(body.message);
      } catch {
        // ignore JSON parse failure on non-JSON response
      }
    }
    if (errObj.message) {
      if (errObj.message.includes('Failed to send a request to the Edge Function')) {
        return 'Edge Function sms-gateway-dispatch is not deployed yet in Supabase. Deploy it with: supabase functions deploy sms-gateway-dispatch';
      }
      return errObj.message;
    }
  }
  return 'Unable to reach SMS Gateway dispatch service.';
}

export async function getChurchSmsGatewayStatus(
  churchId: string
): Promise<AndroidSmsGatewayStatus> {
  if (!supabase || !churchId) return DEFAULT_STATUS;

  const { data, error } = await supabase.rpc('get_church_sms_gateway_status', {
    p_church_id: churchId,
  });

  if (error || !data) {
    return DEFAULT_STATUS;
  }

  const res = data as Partial<AndroidSmsGatewayStatus>;
  return {
    configured: Boolean(res.configured),
    enabled: Boolean(res.enabled),
    provider: 'android_sms_gateway',
    api_url: res.api_url || DEFAULT_ANDROID_SMS_GATEWAY_URL,
    username: res.username ?? null,
    has_password: Boolean(res.has_password),
    device_id: res.device_id ?? null,
    sim_number: res.sim_number === 1 || res.sim_number === 2 ? res.sim_number : null,
    updated_at: res.updated_at ?? null,
  };
}

export async function upsertChurchSmsGateway(params: {
  churchId: string;
  enabled: boolean;
  apiUrl: string;
  username: string;
  password: string;
  deviceId?: string | null;
  simNumber?: 1 | 2 | null;
}): Promise<AndroidSmsGatewayStatus> {
  if (!supabase) {
    throw new Error('Supabase client is not configured.');
  }

  const { data, error } = await supabase.rpc('upsert_church_sms_gateway', {
    p_church_id: params.churchId,
    p_enabled: params.enabled,
    p_api_url: params.apiUrl.trim() || DEFAULT_ANDROID_SMS_GATEWAY_URL,
    p_username: params.username.trim(),
    p_password: params.password.trim(),
    p_device_id: params.deviceId?.trim() || null,
    p_sim_number: params.simNumber ?? null,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as AndroidSmsGatewayStatus;
}

export async function dispatchDonationSms(params: {
  churchId: string;
  donationId: string;
}): Promise<SmsDispatchResponse> {
  if (!supabase) {
    return {
      ok: false,
      status: 'not_configured',
      message: 'Preview mode active: SMS Gateway dispatch runs when connected to Supabase.',
    };
  }

  const { data, error } = await supabase.functions.invoke('sms-gateway-dispatch', {
    body: {
      action: 'dispatch_donation',
      churchId: params.churchId,
      donationId: params.donationId,
    },
  });

  if (error) {
    const errMsg = await extractFunctionError(error);
    return {
      ok: false,
      status: 'failed',
      message: errMsg,
    };
  }

  return {
    ok: Boolean(data?.ok),
    status: data?.status || (data?.ok ? 'submitted' : 'failed'),
    jobId: data?.jobId,
    externalId: data?.externalId,
    gatewayState: data?.gatewayState,
    message: data?.message || (data?.ok ? 'Submitted to Android SMS Gateway.' : 'SMS dispatch failed.'),
  };
}

export async function retrySmsJob(jobId: string): Promise<SmsDispatchResponse> {
  if (!supabase) {
    return {
      ok: false,
      status: 'not_configured',
      message: 'Supabase client is not configured.',
    };
  }

  const { data, error } = await supabase.functions.invoke('sms-gateway-dispatch', {
    body: {
      action: 'retry_job',
      jobId,
    },
  });

  if (error) {
    const errMsg = await extractFunctionError(error);
    return {
      ok: false,
      status: 'failed',
      jobId,
      message: errMsg,
    };
  }

  return {
    ok: Boolean(data?.ok),
    status: data?.status || (data?.ok ? 'submitted' : 'failed'),
    jobId: data?.jobId || jobId,
    externalId: data?.externalId,
    message: data?.message || 'Retry processed.',
  };
}

export async function syncSmsJobStatus(jobId: string): Promise<SmsDispatchResponse> {
  if (!supabase) {
    return {
      ok: false,
      status: 'failed',
      message: 'Supabase client is not configured.',
    };
  }

  const { data, error } = await supabase.functions.invoke('sms-gateway-dispatch', {
    body: {
      action: 'sync_status',
      jobId,
    },
  });

  if (error) {
    const errMsg = await extractFunctionError(error);
    return {
      ok: false,
      status: 'failed',
      jobId,
      message: errMsg,
    };
  }

  return {
    ok: Boolean(data?.ok),
    status: data?.status || 'submitted',
    jobId: data?.jobId || jobId,
    gatewayState: data?.gatewayState,
    message: data?.message || 'Status synced.',
  };
}

export async function sendTestSms(params: {
  churchId: string;
  phone: string;
}): Promise<SmsDispatchResponse> {
  if (!supabase) {
    return {
      ok: false,
      status: 'not_configured',
      message: 'Supabase client is not configured.',
    };
  }

  const { data, error } = await supabase.functions.invoke('sms-gateway-dispatch', {
    body: {
      action: 'send_test',
      churchId: params.churchId,
      phone: params.phone,
    },
  });

  if (error) {
    const errMsg = await extractFunctionError(error);
    return {
      ok: false,
      status: 'failed',
      message: errMsg,
    };
  }

  return {
    ok: Boolean(data?.ok),
    status: data?.status || (data?.ok ? 'submitted' : 'failed'),
    jobId: data?.jobId,
    externalId: data?.externalId,
    message: data?.message || 'Test SMS processed.',
  };
}
