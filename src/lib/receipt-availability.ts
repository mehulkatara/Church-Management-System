import { supabase } from './supabase';
import { buildFullReceiptNumber } from './domain-logic';

export interface ReceiptAvailabilityResult {
  available: boolean;
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
      formattedReceipt: '',
      error: built.error || 'Enter a valid positive receipt number.',
    };
  }

  if (!supabase) {
    return {
      available: true,
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
    return {
      available: Boolean((data as { available?: boolean }).available),
      formattedReceipt:
        (data as { formatted_receipt?: string }).formatted_receipt || built.fullReceiptNumber,
    };
  }

  // Fallback check against active/cancelled donations if the latest migration RPC is not yet deployed
  let query = supabase
    .from('donations')
    .select('id')
    .eq('church_id', churchId)
    .ilike('receipt_number', built.fullReceiptNumber)
    .limit(1);

  if (excludeDonationId) {
    query = query.neq('id', excludeDonationId);
  }

  const { data: existingRows } = await query;
  return {
    available: !existingRows || existingRows.length === 0,
    formattedReceipt: built.fullReceiptNumber,
  };
}
