import { supabase } from './supabase';
import { buildFullReceiptNumber } from './domain-logic';

export interface ReceiptAvailabilityResult {
  available: boolean;
  isShared: boolean;
  existingCount: number;
  existingTotal: number;
  formattedReceipt: string;
  error?: string;
}

export async function checkReceiptAvailability(params: {
  churchId: string;
  churchCode: string | null | undefined;
  donationDate: string;
  receiptDigits: string;
  excludeDonationId?: string | null;
}): Promise<ReceiptAvailabilityResult> {
  const { churchId, churchCode, donationDate, receiptDigits, excludeDonationId } = params;

  const built = buildFullReceiptNumber(churchCode, donationDate, receiptDigits);
  if (!built.valid) {
    return {
      available: false,
      isShared: false,
      existingCount: 0,
      existingTotal: 0,
      formattedReceipt: '',
      error: built.error || 'Enter a valid positive receipt number.',
    };
  }

  if (!supabase) {
    return {
      available: true,
      isShared: false,
      existingCount: 0,
      existingTotal: 0,
      formattedReceipt: built.fullReceiptNumber,
    };
  }

  const { data, error } = await supabase.rpc('check_receipt_number_availability', {
    p_church_id: churchId,
    p_donation_date: donationDate,
    p_receipt_number: built.numericValue,
    p_exclude_donation_id: excludeDonationId || null,
  });

  if (!error && data) {
    const payload = data as {
      available?: boolean;
      is_shared?: boolean;
      existing_count?: number;
      existing_total?: number;
      formatted_receipt?: string;
    };

    if (typeof payload.existing_count === 'number') {
      const count = payload.existing_count;
      return {
        available: true,
        isShared: Boolean(payload.is_shared ?? count > 0),
        existingCount: count,
        existingTotal: Number(payload.existing_total || 0),
        formattedReceipt: payload.formatted_receipt || built.fullReceiptNumber,
      };
    }
  }

  // Fallback query against active donations (counts existing rows sharing this receipt)
  let query = supabase
    .from('donations')
    .select('id, amount')
    .eq('church_id', churchId)
    .is('deleted_at', null)
    .ilike('receipt_number', built.fullReceiptNumber);

  if (excludeDonationId) {
    query = query.neq('id', excludeDonationId);
  }

  const { data: existingRows } = await query;
  const rows = (existingRows || []) as Array<{ id: string; amount: number | string }>;
  const existingCount = rows.length;
  const existingTotal = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);

  return {
    available: true,
    isShared: existingCount > 0,
    existingCount,
    existingTotal,
    formattedReceipt: built.fullReceiptNumber,
  };
}
