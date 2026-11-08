import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import type { Member, DonationCategory, ReceivingAccount, PaymentMethod } from '../../types/database';
import {
  getFinancialYear,
  suggestReceiptPrefix,
  formatSmsMessage,
  formatINR,
  validateReceiptNumber,
} from '../../lib/domain-logic';
import {
  Receipt,
  User,
  Calendar,
  IndianRupee,
  CreditCard,
  Building2,
  FileText,
  AlertCircle,
  CheckCircle2,
  MessageSquare,
  Copy,
  Printer,
  RotateCcw,
  AlertTriangle,
} from 'lucide-react';

interface RecordDonationScreenProps {
  onDonationSaved?: (donationId: string) => void;
}

export const RecordDonationScreen: React.FC<RecordDonationScreenProps> = ({ onDonationSaved }) => {
  const { activeChurch } = useAuth();

  // Form Fields
  const [receiptNumber, setReceiptNumber] = useState('');
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [donationDate, setDonationDate] = useState(() => {
    // Default to today in Asia/Kolkata
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  });
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [receivingAccountId, setReceivingAccountId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Cash');
  const [paymentReference, setPaymentReference] = useState('');
  const [notes, setNotes] = useState('');

  // Lookup data
  const [members, setMembers] = useState<Member[]>([]);
  const [categories, setCategories] = useState<DonationCategory[]>([]);
  const [accounts, setAccounts] = useState<ReceivingAccount[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [isLoadingLookups, setIsLoadingLookups] = useState(true);

  // Submission State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedDonation, setSavedDonation] = useState<{
    id: string;
    receiptNumber: string;
    amount: number;
    memberName: string;
    memberPhone: string | null;
    categoryName: string;
    donationDate: string;
  } | null>(null);

  const [copiedText, setCopiedText] = useState<string | null>(null);

  const currentFY = getFinancialYear(donationDate || new Date());
  const suggestedPrefix = activeChurch
    ? suggestReceiptPrefix(currentFY.fyCode, activeChurch.code)
    : 'REC/2026-27/';

  // Fetch church master data
  useEffect(() => {
    if (!supabase || !activeChurch) return;

    const fetchLookups = async () => {
      setIsLoadingLookups(true);
      try {
        // Members
        const { data: memData } = await supabase
          .from('members')
          .select('*')
          .eq('church_id', activeChurch.id)
          .order('full_name');
        if (memData) setMembers(memData as Member[]);

        // Active Categories
        const { data: catData } = await supabase
          .from('donation_categories')
          .select('*')
          .eq('church_id', activeChurch.id)
          .eq('is_active', true)
          .order('name');
        if (catData) {
          setCategories(catData as DonationCategory[]);
          if (catData.length > 0) setCategoryId(catData[0].id);
        }

        // Active Receiving Accounts
        const { data: accData } = await supabase
          .from('receiving_accounts')
          .select('*')
          .eq('church_id', activeChurch.id)
          .eq('is_active', true)
          .order('account_name');
        if (accData) {
          setAccounts(accData as ReceivingAccount[]);
          if (accData.length > 0) setReceivingAccountId(accData[0].id);
        }
      } catch (err: unknown) {
        console.error('Error loading donation lookups:', err);
      } finally {
        setIsLoadingLookups(false);
      }
    };

    fetchLookups();
  }, [activeChurch]);

  const selectedMember = members.find((m) => m.id === selectedMemberId);

  // Filter members for selector
  const filteredMembers = members.filter((m) => {
    if (!memberSearch) return true;
    const term = memberSearch.toLowerCase();
    return (
      m.full_name.toLowerCase().includes(term) ||
      m.member_number.toLowerCase().includes(term) ||
      (m.contact_phone && m.contact_phone.includes(term)) ||
      (m.village_name && m.village_name.toLowerCase().includes(term))
    );
  });

  const handleApplyPrefix = () => {
    if (!receiptNumber.startsWith(suggestedPrefix)) {
      setReceiptNumber(suggestedPrefix);
    }
  };

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !activeChurch) return;

    setErrorMessage(null);

    // Validate receipt number
    const receiptValidation = validateReceiptNumber(receiptNumber);
    if (!receiptValidation.valid) {
      setErrorMessage(receiptValidation.error || 'Please enter a valid receipt number.');
      return;
    }

    if (!selectedMemberId) {
      setErrorMessage('Please select a member.');
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setErrorMessage('Please enter a valid donation amount in INR (greater than 0).');
      return;
    }

    if (!categoryId) {
      setErrorMessage('Please select a donation category.');
      return;
    }

    if (!receivingAccountId) {
      setErrorMessage('Please select a receiving account.');
      return;
    }

    setIsSubmitting(true);

    try {
      // Generate client idempotency key to prevent double clicks
      const idempotencyKey = `rec-${activeChurch.id}-${receiptValidation.normalized}-${Date.now()}`;

      // Call atomic record_donation RPC
      const { data, error } = await supabase.rpc('record_donation', {
        p_church_id: activeChurch.id,
        p_member_id: selectedMemberId,
        p_receipt_number: receiptNumber.trim(),
        p_donation_date: donationDate,
        p_category_id: categoryId,
        p_amount: parsedAmount,
        p_receiving_account_id: receivingAccountId,
        p_payment_method: paymentMethod,
        p_payment_reference: paymentReference.trim() || null,
        p_notes: notes.trim() || null,
        p_idempotency_key: idempotencyKey,
      });

      if (error) {
        // Intercept unique receipt error
        if (
          error.message.includes('already exists') ||
          error.message.includes('uq_church_normalized_receipt')
        ) {
          setErrorMessage(
            'This receipt number already exists for this church. Please check the number and try again.'
          );
        } else {
          setErrorMessage(error.message);
        }
        setIsSubmitting(false);
        return;
      }

      // Success
      const memberObj = members.find((m) => m.id === selectedMemberId);
      const catObj = categories.find((c) => c.id === categoryId);

      const savedInfo = {
        id: data?.id || 'new-donation',
        receiptNumber: receiptNumber.trim(),
        amount: parsedAmount,
        memberName: memberObj?.full_name || 'Member',
        memberPhone: memberObj?.contact_phone || null,
        categoryName: catObj?.name || 'Tithe',
        donationDate: donationDate,
      };

      setSavedDonation(savedInfo);
      if (onDonationSaved && data?.id) {
        onDonationSaved(data.id);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save donation.';
      if (msg.includes('already exists')) {
        setErrorMessage(
          'This receipt number already exists for this church. Please check the number and try again.'
        );
      } else {
        setErrorMessage(msg);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetForNext = () => {
    setSavedDonation(null);
    setReceiptNumber('');
    setAmount('');
    setPaymentReference('');
    setNotes('');
    setErrorMessage(null);
  };

  // SUCCESS POST-SAVE VIEW
  if (savedDonation) {
    const formattedMsg = formatSmsMessage({
      memberName: savedDonation.memberName,
      churchName: activeChurch?.name || 'Church',
      amount: savedDonation.amount,
      category: savedDonation.categoryName,
      donationDate: savedDonation.donationDate,
      receiptNumber: savedDonation.receiptNumber,
    });

    const smsUrl = savedDonation.memberPhone
      ? `sms:${encodeURIComponent(savedDonation.memberPhone)}?body=${encodeURIComponent(formattedMsg)}`
      : `sms:?body=${encodeURIComponent(formattedMsg)}`;

    return (
      <div className="max-w-xl mx-auto space-y-6 animate-in fade-in">
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl text-center space-y-5">
          <div className="w-16 h-16 rounded-3xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mx-auto">
            <CheckCircle2 className="w-8 h-8" />
          </div>

          <div className="space-y-1">
            <h2 className="text-xl font-bold text-white tracking-tight">
              Donation Recorded Successfully!
            </h2>
            <p className="text-xs text-slate-400">
              Receipt permanently reserved in church registry.
            </p>
          </div>

          {/* Receipt Highlight Card */}
          <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800 text-left space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <span className="text-xs text-slate-400 font-mono">Receipt Number:</span>
              <span className="font-mono font-bold text-base text-sky-400 tracking-wider">
                {savedDonation.receiptNumber}
              </span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Member:</span>
              <span className="text-white font-medium">{savedDonation.memberName}</span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Amount:</span>
              <span className="text-emerald-400 font-semibold text-sm">
                {formatINR(savedDonation.amount)}
              </span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Category:</span>
              <span className="text-slate-300">{savedDonation.categoryName}</span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Donation Date:</span>
              <span className="text-slate-300 font-mono">{savedDonation.donationDate}</span>
            </div>
          </div>

          {/* Mode A: Send from my phone workflow */}
          <div className="bg-gradient-to-br from-sky-950/40 via-slate-950 to-slate-950 border border-sky-500/30 rounded-2xl p-4 text-left space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sky-400 text-xs font-semibold">
                <MessageSquare className="w-4 h-4" />
                <span>Mode A: Send SMS from my phone</span>
              </div>
              <span className="text-[10px] text-slate-400 font-mono">Personal SIM</span>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              Opens your device's SMS app pre-filled with the official receipt message.
              Requires carrier SMS balance or plan.
            </p>

            <div className="bg-slate-900 p-3 rounded-xl border border-slate-800 text-xs text-slate-300 font-mono leading-relaxed">
              "{formattedMsg}"
            </div>

            {savedDonation.memberPhone ? (
              <a
                href={smsUrl}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors shadow-lg shadow-emerald-600/20"
              >
                <MessageSquare className="w-4 h-4" />
                <span>Send SMS from my phone ({savedDonation.memberPhone})</span>
              </a>
            ) : (
              <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-xl flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>No phone number saved for this member. You can copy the message below.</span>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => handleCopy(formattedMsg, 'msg')}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs py-2 px-3 rounded-lg border border-slate-700 flex items-center justify-center gap-1.5 transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copiedText === 'msg' ? 'Copied Message!' : 'Copy Message'}</span>
              </button>

              {savedDonation.memberPhone && (
                <button
                  onClick={() => handleCopy(savedDonation.memberPhone!, 'phone')}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs py-2 px-3 rounded-lg border border-slate-700 flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copiedText === 'phone' ? 'Copied Number!' : 'Copy Phone'}</span>
                </button>
              )}
            </div>
          </div>

          {/* Action to Record Another */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleResetForNext}
              className="flex-1 bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors shadow-lg shadow-sky-600/20 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Record Another Donation</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Screen Title */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <span>Record New Donation</span>
          </h1>
          <p className="text-xs text-slate-400">
            Church: <strong className="text-slate-200">{activeChurch?.name}</strong> &bull;{' '}
            <span className="font-mono">{currentFY.label}</span>
          </p>
        </div>
        <div className="text-right">
          <span className="text-[11px] font-mono bg-sky-500/10 text-sky-300 border border-sky-500/30 px-2.5 py-1 rounded-lg">
            Currency: INR (₹)
          </span>
        </div>
      </div>

      {/* Form Card */}
      <form
        onSubmit={handleSubmit}
        className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-5"
      >
        {/* Error Message */}
        {errorMessage && (
          <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-start gap-3 text-xs text-red-300">
            <AlertCircle className="w-5 h-5 shrink-0 text-red-400 mt-0.5" />
            <div className="space-y-1">
              <strong className="block font-semibold">Validation Error</strong>
              <span>{errorMessage}</span>
            </div>
          </div>
        )}

        {/* 1. RECEIPT NUMBER (Prominently near top per Section 8) */}
        <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <label htmlFor="receipt-number" className="block text-xs font-semibold text-white">
              Manual Receipt Number <span className="text-red-400">*</span>
            </label>
            <button
              type="button"
              onClick={handleApplyPrefix}
              className="text-[11px] text-sky-400 hover:text-sky-300 underline font-mono"
            >
              Insert Suggestion ({suggestedPrefix})
            </button>
          </div>

          <div className="relative">
            <Receipt className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
            <input
              id="receipt-number"
              type="text"
              value={receiptNumber}
              onChange={(e) => setReceiptNumber(e.target.value)}
              required
              placeholder="e.g. 000125 or GBC/2026-27/001"
              className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-3.5 py-2.5 text-sm font-mono text-sky-300 placeholder-slate-600 focus:outline-none focus:border-sky-500 tracking-wide font-medium"
            />
          </div>
          <p className="text-[11px] text-slate-500">
            Leading zeros are preserved. Must be unique within {activeChurch?.name} across all years.
          </p>
        </div>

        {/* 2. MEMBER SELECTOR & INACTIVE WARNING */}
        <div className="space-y-2">
          <label htmlFor="member-search" className="block text-xs font-semibold text-white">
            Church Member <span className="text-red-400">*</span>
          </label>

          <div className="space-y-2">
            <input
              id="member-search"
              type="text"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              placeholder="Search by name, member number, or village..."
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
            />

            <select
              value={selectedMemberId}
              onChange={(e) => setSelectedMemberId(e.target.value)}
              required
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-sky-500"
            >
              <option value="">-- Choose Member ({filteredMembers.length} available) --</option>
              {filteredMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name} ({m.member_number}) {m.village_name ? `- ${m.village_name}` : ''}{' '}
                  [{m.membership_status.toUpperCase()}]
                </option>
              ))}
            </select>
          </div>

          {/* Non-blocking Inactive Member Notice */}
          {selectedMember && selectedMember.membership_status === 'inactive' && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center gap-2.5 text-xs text-amber-300">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
              <span>
                <strong>Notice:</strong> This member is currently marked <strong>Inactive</strong>.
                Donations are permitted and will be credited to financial totals &amp; history.
              </span>
            </div>
          )}
        </div>

        {/* 3. DONATION DATE & AMOUNT */}
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="donation-date" className="block text-xs font-semibold text-white mb-1.5">
              Donation Date (Asia/Kolkata) <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <Calendar className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
              <input
                id="donation-date"
                type="date"
                value={donationDate}
                onChange={(e) => setDonationDate(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-10 pr-3.5 py-2 text-sm text-white focus:outline-none focus:border-sky-500 font-mono"
              />
            </div>
          </div>

          <div>
            <label htmlFor="donation-amount" className="block text-xs font-semibold text-white mb-1.5">
              Amount (INR ₹) <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <IndianRupee className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
              <input
                id="donation-amount"
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                placeholder="500.00"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-10 pr-3.5 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-sky-500 font-mono font-semibold"
              />
            </div>
          </div>
        </div>

        {/* 4. CATEGORY & RECEIVING ACCOUNT */}
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="donation-category" className="block text-xs font-semibold text-white mb-1.5">
              Donation Category <span className="text-red-400">*</span>
            </label>
            <select
              id="donation-category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              required
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-sky-500"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="receiving-account" className="block text-xs font-semibold text-white mb-1.5">
              Receiving Account <span className="text-red-400">*</span>
            </label>
            <select
              id="receiving-account"
              value={receivingAccountId}
              onChange={(e) => setReceivingAccountId(e.target.value)}
              required
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-sky-500"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.account_name} ({a.account_type.toUpperCase()})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 5. PAYMENT METHOD & REFERENCE */}
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="payment-method" className="block text-xs font-semibold text-white mb-1.5">
              Payment Method <span className="text-red-400">*</span>
            </label>
            <select
              id="payment-method"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
              required
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-sky-500"
            >
              <option value="Cash">Cash</option>
              <option value="UPI">UPI</option>
              <option value="Bank Transfer">Bank Transfer</option>
              <option value="Cheque">Cheque</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div>
            <label htmlFor="payment-ref" className="block text-xs font-semibold text-white mb-1.5">
              Payment Reference <span className="text-slate-400 font-normal">(Optional)</span>
            </label>
            <input
              id="payment-ref"
              type="text"
              value={paymentReference}
              onChange={(e) => setPaymentReference(e.target.value)}
              placeholder="e.g. UPI txn ID / Cheque #12345"
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-sky-500 font-mono text-xs"
            />
          </div>
        </div>

        {/* 6. NOTES */}
        <div>
          <label htmlFor="donation-notes" className="block text-xs font-semibold text-white mb-1.5">
            Internal Notes <span className="text-slate-400 font-normal">(Optional)</span>
          </label>
          <textarea
            id="donation-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Special Thanksgiving note, memory of loved one, etc."
            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-sky-500"
          />
        </div>

        {/* SUBMIT BUTTON */}
        <div className="pt-3 border-t border-slate-800">
          <button
            type="submit"
            disabled={isSubmitting || isLoadingLookups}
            className="w-full bg-sky-600 hover:bg-sky-500 text-white font-semibold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-sky-600/20 text-xs sm:text-sm"
          >
            <Receipt className="w-4 h-4" />
            <span>{isSubmitting ? 'Reserving Receipt & Saving...' : 'Save & Issue Receipt'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
