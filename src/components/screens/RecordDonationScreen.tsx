import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import type { Member, DonationCategory, ReceivingAccount, PaymentMethod } from '../../types/database';
import {
  getFinancialYear,
  buildFullReceiptNumber,
  sanitizeReceiptDigitsInput,
  formatSmsMessage,
  formatINR,
} from '../../lib/domain-logic';
import { checkReceiptAvailability } from '../../lib/receipt-availability';
import { dispatchDonationSms, retrySmsJob, SmsDispatchResponse } from '../../lib/sms-gateway';
import { MemberSearchCombobox } from '../common/MemberSearchCombobox';
import {
  Receipt,
  Calendar,
  IndianRupee,
  AlertCircle,
  CheckCircle2,
  Copy,
  RotateCcw,
  AlertTriangle,
  Loader2,
  Server,
  Layers,
  PlusCircle,
} from 'lucide-react';

interface RecordDonationScreenProps {
  onDonationSaved?: (donationId: string) => void;
}

export const RecordDonationScreen: React.FC<RecordDonationScreenProps> = ({ onDonationSaved }) => {
  const { activeChurch } = useAuth();

  // Form Fields
  const [donationDate, setDonationDate] = useState(() => {
    // Default to today in Asia/Kolkata
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  });
  const currentFY = getFinancialYear(donationDate || new Date());
  const [receiptDigits, setReceiptDigits] = useState('');
  const receiptBuild = buildFullReceiptNumber(activeChurch?.code, donationDate || new Date(), receiptDigits);
  const lockedPrefix = receiptBuild.prefix;
  const fullReceiptPreview = receiptBuild.valid ? receiptBuild.fullReceiptNumber : '';

  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('500');
  const [receivingAccountId, setReceivingAccountId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Cash');
  const [paymentReference, setPaymentReference] = useState('');
  const [notes, setNotes] = useState('');

  // Lookup data
  const [categories, setCategories] = useState<DonationCategory[]>([]);
  const [accounts, setAccounts] = useState<ReceivingAccount[]>([]);
  const [isLoadingLookups, setIsLoadingLookups] = useState(true);

  // Live receipt status state (non-blocking: shows whether receipt is new or shared)
  const [receiptLookup, setReceiptLookup] = useState<{
    state: 'idle' | 'checking' | 'new' | 'shared';
    existingCount: number;
    existingTotal: number;
  }>({ state: 'idle', existingCount: 0, existingTotal: 0 });
  const checkCounterRef = useRef(0);
  const [submissionIdempotencyKey, setSubmissionIdempotencyKey] = useState(() =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `rec-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );

  // Submission State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedDonation, setSavedDonation] = useState<{
    id: string;
    receiptNumber: string;
    receiptDigits: string;
    amount: number;
    memberName: string;
    memberPhone: string | null;
    categoryName: string;
    donationDate: string;
  } | null>(null);
  const [smsStatus, setSmsStatus] = useState<
    | { state: 'idle' }
    | { state: 'sending' }
    | { state: 'done'; result: SmsDispatchResponse }
  >({ state: 'idle' });
  const [isRetryingSms, setIsRetryingSms] = useState(false);

  const [copiedText, setCopiedText] = useState<string | null>(null);

  const generateIdempotencyKey = () =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `rec-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  useEffect(() => {
    if (!activeChurch || !receiptBuild.valid || !donationDate) {
      setReceiptLookup({ state: 'idle', existingCount: 0, existingTotal: 0 });
      return;
    }

    const requestId = ++checkCounterRef.current;
    setReceiptLookup((prev) => ({ ...prev, state: 'checking' }));

    const timer = setTimeout(async () => {
      try {
        const res = await checkReceiptAvailability({
          churchId: activeChurch.id,
          churchCode: activeChurch.code,
          donationDate,
          receiptDigits: receiptBuild.numericValue,
        });
        if (requestId !== checkCounterRef.current) return;
        setReceiptLookup({
          state: res.isShared ? 'shared' : 'new',
          existingCount: res.existingCount,
          existingTotal: res.existingTotal,
        });
      } catch {
        if (requestId !== checkCounterRef.current) return;
        setReceiptLookup({ state: 'idle', existingCount: 0, existingTotal: 0 });
      }
    }, 220);

    return () => clearTimeout(timer);
  }, [activeChurch?.id, activeChurch?.code, donationDate, receiptBuild.valid, receiptBuild.numericValue]);

  // Fetch church master data
  useEffect(() => {
    setSelectedMember(null);
    setSubmissionIdempotencyKey(generateIdempotencyKey());
    if (!supabase || !activeChurch) return;

    const fetchLookups = async () => {
      setIsLoadingLookups(true);
      try {
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

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !activeChurch) return;

    setErrorMessage(null);

    // Validate receipt digits + automatic prefix
    const built = buildFullReceiptNumber(activeChurch.code, donationDate, receiptDigits);
    if (!built.valid) {
      setErrorMessage(built.error || 'Please enter a valid positive receipt number.');
      return;
    }

    if (!selectedMember) {
      setErrorMessage('Please search and select a church member.');
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
      // Call atomic record_donation RPC (shared receipt numbers allowed)
      const { data, error } = await supabase.rpc('record_donation', {
        p_church_id: activeChurch.id,
        p_member_id: selectedMember.id,
        p_receipt_number: built.numericValue,
        p_donation_date: donationDate,
        p_category_id: categoryId,
        p_amount: parsedAmount,
        p_receiving_account_id: receivingAccountId,
        p_payment_method: paymentMethod,
        p_payment_reference: paymentReference.trim() || null,
        p_notes: notes.trim() || null,
        p_idempotency_key: submissionIdempotencyKey,
      });

      if (error) {
        setErrorMessage(error.message);
        setIsSubmitting(false);
        return;
      }

      // Success
      const catObj = categories.find((c) => c.id === categoryId);

      const savedInfo = {
        id: data?.id || 'new-donation',
        receiptNumber: data?.receipt_number || built.fullReceiptNumber,
        receiptDigits: built.numericValue,
        amount: parsedAmount,
        memberName: selectedMember.full_name || 'Member',
        memberPhone: selectedMember.contact_phone || null,
        categoryName: catObj?.name || 'Tithe',
        donationDate: donationDate,
      };

      setSavedDonation(savedInfo);
      if (onDonationSaved && data?.id) {
        onDonationSaved(data.id);
      }

      if (savedInfo.memberPhone && data?.id) {
        setSmsStatus({ state: 'sending' });
        void dispatchDonationSms({
          churchId: activeChurch.id,
          donationId: data.id,
        }).then((dispatchRes) => {
          setSmsStatus({ state: 'done', result: dispatchRes });
        });
      } else {
        setSmsStatus({ state: 'idle' });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save donation.';
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRetrySavedSms = async () => {
    if (!activeChurch || !savedDonation) return;
    setIsRetryingSms(true);
    try {
      const jobId = smsStatus.state === 'done' ? smsStatus.result.jobId : undefined;
      const res = jobId
        ? await retrySmsJob(jobId)
        : await dispatchDonationSms({
            churchId: activeChurch.id,
            donationId: savedDonation.id,
          });
      setSmsStatus({ state: 'done', result: res });
    } finally {
      setIsRetryingSms(false);
    }
  };

  const handleAddAnotherOnSameReceipt = () => {
    const keepDigits = savedDonation?.receiptDigits || receiptDigits;
    setSavedDonation(null);
    setSmsStatus({ state: 'idle' });
    setIsRetryingSms(false);
    setReceiptDigits(keepDigits);
    setReceiptLookup({ state: 'idle', existingCount: 0, existingTotal: 0 });
    setSubmissionIdempotencyKey(generateIdempotencyKey());
    setAmount('500');
    setPaymentReference('');
    setNotes('');
    setErrorMessage(null);
  };

  const handleResetForNext = () => {
    setSavedDonation(null);
    setSmsStatus({ state: 'idle' });
    setIsRetryingSms(false);
    setSelectedMember(null);
    setReceiptDigits('');
    setReceiptLookup({ state: 'idle', existingCount: 0, existingTotal: 0 });
    setSubmissionIdempotencyKey(generateIdempotencyKey());
    setAmount('500');
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
              Receipt saved in church donation registry.
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

          {/* Plan B: Automatic Android SMS Gateway Delivery */}
          <div className="bg-gradient-to-br from-sky-950/40 via-slate-950 to-slate-950 border border-sky-500/30 rounded-2xl p-4 text-left space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sky-400 text-xs font-semibold">
                <Server className="w-4 h-4 shrink-0" />
                <span>Android SMS Gateway Delivery</span>
              </div>
              <span className="text-[11px] font-mono text-slate-400">Plan B</span>
            </div>

            {!savedDonation.memberPhone ? (
              <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-xl flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>No mobile number saved for this member — automatic SMS was skipped.</span>
              </div>
            ) : smsStatus.state === 'sending' ? (
              <div className="text-xs text-sky-300 bg-sky-500/10 border border-sky-500/20 p-3 rounded-xl flex items-center gap-2.5">
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                <span>Sending receipt SMS to {savedDonation.memberPhone} via Android SMS Gateway...</span>
              </div>
            ) : smsStatus.state === 'done' && smsStatus.result.ok ? (
              <div className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-xl space-y-1">
                <div className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>Submitted to Android SMS Gateway ({savedDonation.memberPhone})</span>
                </div>
                {smsStatus.result.externalId && (
                  <div className="text-[11px] font-mono text-emerald-200/80 pl-6">
                    Gateway Message ID: {smsStatus.result.externalId}
                  </div>
                )}
              </div>
            ) : smsStatus.state === 'done' ? (
              <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 p-3 rounded-xl space-y-2.5">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{smsStatus.result.message}</span>
                </div>
                <button
                  type="button"
                  onClick={handleRetrySavedSms}
                  disabled={isRetryingSms}
                  className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-sky-300 font-semibold text-xs py-2 px-3 rounded-lg border border-slate-700 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  {isRetryingSms ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="w-3.5 h-3.5" />
                  )}
                  <span>{isRetryingSms ? 'Retrying SMS...' : 'Retry SMS Dispatch'}</span>
                </button>
              </div>
            ) : null}

            <div className="bg-slate-900 p-3 rounded-xl border border-slate-800 text-xs text-slate-300 font-mono leading-relaxed">
              &ldquo;{formattedMsg}&rdquo;
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => handleCopy(formattedMsg, 'msg')}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs py-2 px-3 rounded-lg border border-slate-700 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copiedText === 'msg' ? 'Copied Message!' : 'Copy Message'}</span>
              </button>
            </div>
          </div>

          {/* Actions to Record Another */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2">
            <button
              type="button"
              onClick={handleAddAnotherOnSameReceipt}
              className="flex-1 bg-slate-800 hover:bg-slate-700 text-sky-300 font-semibold text-xs py-3 px-4 rounded-xl border border-slate-700 flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <PlusCircle className="w-4 h-4 shrink-0" />
              <span>Add Another to {savedDonation.receiptNumber}</span>
            </button>
            <button
              type="button"
              onClick={handleResetForNext}
              className="flex-1 bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors shadow-lg shadow-sky-600/20 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4 shrink-0" />
              <span>Record New Receipt</span>
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

        {/* 1. RECEIPT NUMBER (Locked Auto Prefix + Numeric Input Only + Live Shared-Receipt Indicator) */}
        <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="receipt-number" className="block text-xs font-semibold text-white">
              Receipt Number <span className="text-red-400">*</span>
            </label>
            <span className="text-[11px] font-mono text-slate-400 tabular-nums">
              Prefix locked to {lockedPrefix}
            </span>
          </div>

          <div className="flex items-stretch rounded-xl border border-slate-700 bg-slate-900 overflow-hidden focus-within:border-sky-500">
            <div className="flex items-center gap-2 px-3.5 py-2.5 bg-slate-950 border-r border-slate-700 text-slate-300 font-mono text-sm tabular-nums select-none shrink-0">
              <Receipt className="w-4 h-4 text-slate-500 shrink-0" />
              <span>{lockedPrefix}</span>
            </div>
            <input
              id="receipt-number"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={20}
              value={receiptDigits}
              onChange={(e) => setReceiptDigits(sanitizeReceiptDigitsInput(e.target.value))}
              required
              placeholder="e.g. 142"
              className="flex-1 min-w-0 bg-slate-900 px-3.5 py-2.5 text-sm font-mono tabular-nums text-sky-300 placeholder-slate-600 focus:outline-none tracking-wide font-medium"
            />
          </div>

          {receiptLookup.state === 'checking' && (
            <p className="text-[11px] text-slate-400 font-mono">
              Checking receipt {fullReceiptPreview}...
            </p>
          )}
          {receiptLookup.state === 'new' && (
            <p className="text-[11px] text-emerald-400 flex items-center gap-1.5 font-mono tabular-nums">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>New receipt: {fullReceiptPreview}</span>
            </p>
          )}
          {receiptLookup.state === 'shared' && (
            <p className="text-[11px] text-sky-300 flex items-center gap-1.5 font-mono tabular-nums">
              <Layers className="w-3.5 h-3.5 shrink-0 text-sky-400" />
              <span>
                Shared receipt: {fullReceiptPreview} already has {receiptLookup.existingCount}{' '}
                {receiptLookup.existingCount === 1 ? 'donation' : 'donations'} (
                {formatINR(receiptLookup.existingTotal)}) &mdash; this entry will be added under the same receipt.
              </span>
            </p>
          )}
          {receiptLookup.state === 'idle' && (
            <p className="text-[11px] text-slate-500">
              Enter positive numbers only (leading zeros are removed automatically). Existing receipt
              numbers can be reused to record multiple donations on the same receipt.
            </p>
          )}
        </div>

        {/* 2. UNIFIED LIVE MEMBER SEARCH & SELECTION COMBOBOX */}
        <div className="space-y-2">
          <label htmlFor="member-search-combobox" className="block text-xs font-semibold text-white">
            Church Member <span className="text-red-400">*</span>
          </label>

          {activeChurch && (
            <MemberSearchCombobox
              inputId="member-search-combobox"
              churchId={activeChurch.id}
              selectedMember={selectedMember}
              onSelectMember={(member) => {
                setSelectedMember(member);
                if (errorMessage === 'Please search and select a church member.') {
                  setErrorMessage(null);
                }
              }}
              onClearMember={() => setSelectedMember(null)}
              disabled={isSubmitting}
            />
          )}

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
            className="w-full bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-sky-600/20 text-xs sm:text-sm"
          >
            <Receipt className="w-4 h-4" />
            <span>{isSubmitting ? 'Validating & Saving...' : 'Save & Issue Receipt'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
