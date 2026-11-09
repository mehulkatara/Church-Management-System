import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import type { Church, Gender, AccessRequest } from '../../types/database';
import {
  validateOnboardingProfile,
  validateDateOfBirth,
  normalizePhoneNumber,
  GENDER_LABELS,
} from '../../lib/domain-logic';
import {
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Building2,
  Calendar,
  Phone,
  Mail,
  User,
  MapPin,
  Save,
  Send,
  LogOut,
  Sparkles,
  Info,
  ArrowRight,
  AlertTriangle,
} from 'lucide-react';

interface CompleteProfileScreenProps {
  existingRequest?: AccessRequest | null;
  onSubmitted?: () => void;
}

export const CompleteProfileScreen: React.FC<CompleteProfileScreenProps> = ({
  existingRequest,
  onSubmitted,
}) => {
  const { user, profile, refreshUserData, signOut } = useAuth();

  const [churches, setChurches] = useState<Church[]>([]);
  const [selectedChurchId, setSelectedChurchId] = useState<string>('');
  const [fullName, setFullName] = useState<string>('');
  const [dateOfBirth, setDateOfBirth] = useState<string>('');
  const [phoneCountryCode, setPhoneCountryCode] = useState<string>('+91');
  const [phoneNumber, setPhoneNumber] = useState<string>('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [villageName, setVillageName] = useState<string>('');

  const [isLoadingChurches, setIsLoadingChurches] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isSavingDraft, setIsSavingDraft] = useState<boolean>(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submissionSuccess, setSubmissionSuccess] = useState<string | null>(null);
  const [draftSavedMessage, setDraftSavedMessage] = useState<string | null>(null);
  const [googleImportNotice, setGoogleImportNotice] = useState<string | null>(null);

  // Trusted Google email directly from auth (read-only)
  const googleEmail = user?.email || profile?.email || '';

  // Prefill from existing request draft or authenticated Google identity
  useEffect(() => {
    const fetchChurches = async () => {
      if (!supabase) {
        // Fallback for preview mode
        const mockChurches: Church[] = [
          {
            id: 'c1111111-1111-1111-1111-111111111111',
            code: 'BETHEL',
            name: 'Bethel Christian Assembly',
            address: '14 Anna Salai, Chennai',
            phone: '+91 44 2811 0000',
            email: 'admin@bethel.org',
            receipt_prefix: 'BCA',
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          {
            id: 'c2222222-2222-2222-2222-222222222222',
            code: 'GRACE',
            name: 'Grace Fellowship Church',
            address: '88 Ring Road, Bangalore',
            phone: '+91 80 2555 1234',
            email: 'office@grace.org',
            receipt_prefix: 'GFC',
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ];
        setChurches(mockChurches);
        setSelectedChurchId(mockChurches[0].id);
        setIsLoadingChurches(false);
        return;
      }

      try {
        const { data } = await supabase
          .from('churches')
          .select('*')
          .eq('is_active', true)
          .order('name');

        if (data && data.length > 0) {
          const activeChurches = data as Church[];
          setChurches(activeChurches);
          if (!selectedChurchId) {
            setSelectedChurchId(existingRequest?.church_id || activeChurches[0].id);
          }
        }
      } catch (err) {
        console.error('Error fetching churches:', err);
      } finally {
        setIsLoadingChurches(false);
      }
    };

    fetchChurches();
  }, [existingRequest]);

  useEffect(() => {
    if (existingRequest) {
      if (existingRequest.church_id) setSelectedChurchId(existingRequest.church_id);
      if (existingRequest.applicant_name) setFullName(existingRequest.applicant_name);
      if (existingRequest.date_of_birth) setDateOfBirth(existingRequest.date_of_birth);
      if (existingRequest.gender) setGender(existingRequest.gender);
      if (existingRequest.village_name) setVillageName(existingRequest.village_name);

      if (existingRequest.applicant_phone) {
        if (existingRequest.applicant_phone.startsWith('+91')) {
          setPhoneCountryCode('+91');
          setPhoneNumber(existingRequest.applicant_phone.slice(3).trim());
        } else if (existingRequest.applicant_phone.startsWith('+')) {
          const match = existingRequest.applicant_phone.match(/^(\+\d{1,4})(.*)$/);
          if (match) {
            setPhoneCountryCode(match[1]);
            setPhoneNumber(match[2].trim());
          } else {
            setPhoneNumber(existingRequest.applicant_phone);
          }
        } else {
          setPhoneNumber(existingRequest.applicant_phone);
        }
      }
    } else {
      // Prefill full name from Google metadata
      const googleName =
        user?.user_metadata?.full_name ||
        user?.user_metadata?.name ||
        profile?.full_name ||
        '';
      if (googleName && !fullName) {
        setFullName(googleName);
      }
    }
  }, [existingRequest, user, profile]);

  const getFullPhone = (): string => {
    if (!phoneNumber.trim()) return '';
    return `${phoneCountryCode}${phoneNumber.trim()}`;
  };

  // Optional "Fill available details from Google" (People API check)
  const handleGooglePeopleImport = () => {
    // Basic sign-in does not include People API by design per specification.
    // Display clear, non-blocking notice.
    setGoogleImportNotice(
      'Google People API integration is not configured for extended profile data (Date of Birth / Phone). Please enter these details manually.'
    );
  };

  // Save Incomplete Draft
  const handleSaveDraft = async () => {
    setIsSavingDraft(true);
    setErrors({});
    setDraftSavedMessage(null);

    const fullPhone = getFullPhone();
    const draftValidation = validateOnboardingProfile({
      fullName,
      dateOfBirth,
      phone: fullPhone,
      gender,
      villageName,
      churchId: selectedChurchId,
      isDraft: true,
    });

    if (!draftValidation.valid) {
      setErrors(draftValidation.errors);
      setIsSavingDraft(false);
      return;
    }

    try {
      if (supabase) {
        const { error } = await supabase.rpc('submit_profile_request', {
          p_church_id: selectedChurchId,
          p_full_name: fullName.trim() || 'Draft Applicant',
          p_date_of_birth: dateOfBirth || null,
          p_phone: fullPhone || null,
          p_gender: gender || null,
          p_village_name: villageName.trim() || null,
          p_is_draft: true,
        });

        if (error) throw error;
      }

      setDraftSavedMessage(
        'Your profile draft has been saved. You can sign out and return anytime to complete and submit it.'
      );
      await refreshUserData();
    } catch (err: unknown) {
      setErrors({ form: err instanceof Error ? err.message : 'Failed to save draft.' });
    } finally {
      setIsSavingDraft(false);
    }
  };

  // Submit to Church Accountant
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrors({});
    setSubmissionSuccess(null);
    setDraftSavedMessage(null);

    const fullPhone = getFullPhone();
    const validation = validateOnboardingProfile({
      fullName,
      dateOfBirth,
      phone: fullPhone,
      gender,
      villageName,
      churchId: selectedChurchId,
      isDraft: false,
    });

    if (!validation.valid) {
      setErrors(validation.errors);
      setIsSubmitting(false);
      return;
    }

    try {
      if (supabase) {
        const { error } = await supabase.rpc('submit_profile_request', {
          p_church_id: selectedChurchId,
          p_full_name: fullName.trim(),
          p_date_of_birth: dateOfBirth,
          p_phone: fullPhone,
          p_gender: gender,
          p_village_name: villageName.trim(),
          p_is_draft: false,
        });

        if (error) throw error;
      }

      setSubmissionSuccess(
        'Profile submitted successfully! Your church Accountant will review your details, verify your identity, and link your account.'
      );
      await refreshUserData();
      if (onSubmitted) onSubmitted();
    } catch (err: unknown) {
      setErrors({ form: err instanceof Error ? err.message : 'Submission failed.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const isReturnedForCorrection =
    existingRequest?.status === 'returned_for_correction';

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center px-4 py-8">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400 mx-auto">
            <Building2 className="w-6 h-6" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            Complete Your Profile
          </h1>
          <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
            Complete your details to request access. Your church Accountant will review
            your information and link your account to your member record.
          </p>
        </div>

        {/* Returned for Correction Alert Banner */}
        {isReturnedForCorrection && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 text-xs text-amber-200 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <strong className="font-semibold block text-amber-300">
                Action Required: Application Returned for Correction
              </strong>
              <p className="text-amber-200/90 leading-relaxed">
                {existingRequest.decision_reason ||
                  'The church Accountant has requested corrections on your application. Please review and update your information below, then resubmit.'}
              </p>
            </div>
          </div>
        )}

        {/* Draft Notice */}
        {existingRequest?.status === 'draft' && !isReturnedForCorrection && (
          <div className="bg-sky-950/30 border border-sky-500/20 rounded-2xl p-3.5 text-xs text-sky-200 flex items-center gap-2.5">
            <Info className="w-4 h-4 text-sky-400 shrink-0" />
            <span>Resumed your saved draft. Complete all required fields to submit.</span>
          </div>
        )}

        {/* General Form Error */}
        {errors.form && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-3.5 text-xs text-red-300 flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{errors.form}</span>
          </div>
        )}

        {/* Draft Saved Success Banner */}
        {draftSavedMessage && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-3.5 text-xs text-emerald-300 flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{draftSavedMessage}</span>
          </div>
        )}

        {/* Submission Success Banner */}
        {submissionSuccess && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4 text-xs text-emerald-300 space-y-2">
            <div className="flex items-center gap-2 font-semibold">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>{submissionSuccess}</span>
            </div>
            <p className="text-[11px] text-emerald-400/80">
              You will be redirected once your church Accountant verifies and approves access.
            </p>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* 1. Google Login Email (Strictly Read-Only) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-slate-300 font-medium">Google Login Email</label>
              <span className="text-[10px] font-mono bg-sky-500/10 text-sky-400 border border-sky-500/20 px-2 py-0.5 rounded">
                Authenticated with Google &bull; Read-Only
              </span>
            </div>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
              <input
                type="email"
                value={googleEmail}
                readOnly
                disabled
                className="w-full bg-slate-950/80 border border-slate-800 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-slate-300 font-mono cursor-not-allowed opacity-90 select-none"
              />
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Obtained directly from your Google identity. Contact email for church communications
              is maintained separately.
            </p>
          </div>

          {/* 2. Church Selection */}
          <div>
            <label className="block text-slate-300 font-medium mb-1.5">
              Select Your Church <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <Building2 className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
              <select
                value={selectedChurchId}
                onChange={(e) => setSelectedChurchId(e.target.value)}
                required
                disabled={isLoadingChurches}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-sky-500"
              >
                {churches.map((church) => (
                  <option key={church.id} value={church.id}>
                    {church.name} ({church.code}) {church.address ? `– ${church.address}` : ''}
                  </option>
                ))}
              </select>
            </div>
            {errors.churchId && (
              <p className="text-[11px] text-red-400 mt-1">{errors.churchId}</p>
            )}
          </div>

          {/* Optional Enhanced Google Prefill */}
          <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex items-center gap-2 text-slate-400">
              <Sparkles className="w-4 h-4 text-sky-400 shrink-0" />
              <span className="text-[11px]">
                Import details from your Google Account
              </span>
            </div>
            <button
              type="button"
              onClick={handleGooglePeopleImport}
              className="text-[11px] font-medium text-sky-400 hover:text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 px-3 py-1.5 rounded-lg border border-sky-500/20 transition-colors cursor-pointer self-start sm:self-auto shrink-0"
            >
              Fill available details from Google
            </button>
          </div>
          {googleImportNotice && (
            <p className="text-[11px] text-amber-300/90 bg-amber-500/10 p-2.5 rounded-lg border border-amber-500/20">
              {googleImportNotice}
            </p>
          )}

          {/* 3. Full Name */}
          <div>
            <label className="block text-slate-300 font-medium mb-1.5">
              Full Name <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                placeholder="e.g. Samuel Rajan"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
              />
            </div>
            {errors.fullName && (
              <p className="text-[11px] text-red-400 mt-1">{errors.fullName}</p>
            )}
          </div>

          {/* 4. Date of Birth & Gender (Side by Side) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Date of Birth */}
            <div>
              <label className="block text-slate-300 font-medium mb-1.5">
                Date of Birth <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <Calendar className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                <input
                  type="date"
                  value={dateOfBirth}
                  max={new Date().toISOString().split('T')[0]}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-sky-500 font-mono"
                />
              </div>
              {errors.dateOfBirth ? (
                <p className="text-[11px] text-red-400 mt-1">{errors.dateOfBirth}</p>
              ) : (
                <p className="text-[10px] text-slate-500 mt-1">Calendar date (YYYY-MM-DD)</p>
              )}
            </div>

            {/* Gender */}
            <div>
              <label className="block text-slate-300 font-medium mb-1.5">
                Gender <span className="text-red-400">*</span>
              </label>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value as Gender | '')}
                required
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-sky-500"
              >
                <option value="">-- Select Gender --</option>
                <option value="male">{GENDER_LABELS.male}</option>
                <option value="female">{GENDER_LABELS.female}</option>
                <option value="other">{GENDER_LABELS.other}</option>
                <option value="prefer_not_to_say">{GENDER_LABELS.prefer_not_to_say}</option>
              </select>
              {errors.gender ? (
                <p className="text-[11px] text-red-400 mt-1">{errors.gender}</p>
              ) : (
                <p className="text-[10px] text-slate-500 mt-1">Explicit selection required</p>
              )}
            </div>
          </div>

          {/* 5. Contact Phone Number */}
          <div>
            <label className="block text-slate-300 font-medium mb-1.5">
              Contact Phone Number <span className="text-red-400">*</span>
            </label>
            <div className="flex gap-2">
              <select
                value={phoneCountryCode}
                onChange={(e) => setPhoneCountryCode(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-sky-500 font-mono shrink-0 w-28"
              >
                <option value="+91">🇮🇳 +91</option>
                <option value="+1">🇺🇸 +1</option>
                <option value="+44">🇬🇧 +44</option>
                <option value="+971">🇦🇪 +971</option>
                <option value="+65">🇸🇬 +65</option>
                <option value="+61">🇦🇺 +61</option>
              </select>
              <div className="relative flex-1">
                <Phone className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  required
                  placeholder="98401 23456"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 font-mono"
                />
              </div>
            </div>
            {errors.phone && (
              <p className="text-[11px] text-red-400 mt-1">{errors.phone}</p>
            )}
          </div>

          {/* 6. Village / City Name */}
          <div>
            <label className="block text-slate-300 font-medium mb-1.5">
              Village / City Name <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <MapPin className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
              <input
                type="text"
                value={villageName}
                onChange={(e) => setVillageName(e.target.value)}
                required
                placeholder="e.g. Kallakurichi, Tambaram, or Whitefield"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
              />
            </div>
            {errors.villageName && (
              <p className="text-[11px] text-red-400 mt-1">{errors.villageName}</p>
            )}
            <p className="text-[10px] text-slate-500 mt-1">
              Locality name used by church administration to identify branch and parish boundaries.
            </p>
          </div>

          {/* Privacy Notice */}
          <div className="p-3.5 bg-slate-950 rounded-2xl border border-slate-800 text-[11px] text-slate-400 space-y-1">
            <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
              <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0" />
              <span>Identity Verification Notice</span>
            </div>
            <p className="leading-relaxed">
              Google authentication proves identity, but church access requires verification
              by an authorized Accountant. Details submitted here are stored in an isolated
              access request queue and will be used by the Accountant to link your profile to
              your church member record.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={isSavingDraft || isSubmitting}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-medium text-xs flex items-center justify-center gap-2 border border-slate-700 transition-colors cursor-pointer"
            >
              <Save className="w-4 h-4 text-slate-400" />
              <span>{isSavingDraft ? 'Saving Draft...' : 'Save Incomplete Draft'}</span>
            </button>

            <button
              type="submit"
              disabled={isSubmitting || isSavingDraft}
              className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs flex items-center justify-center gap-2 transition-colors shadow-lg shadow-sky-600/20 cursor-pointer"
            >
              <span>{isSubmitting ? 'Submitting to Accountant...' : 'Submit to Church Accountant'}</span>
              <Send className="w-4 h-4" />
            </button>
          </div>
        </form>

        {/* Footer: Sign Out Switch */}
        <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-500">
          <span>Signed in as <strong className="text-slate-300">{googleEmail}</strong></span>
          <button
            onClick={() => signOut()}
            className="flex items-center gap-1.5 text-slate-400 hover:text-red-400 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign out / Switch account</span>
          </button>
        </div>
      </div>
    </div>
  );
};
