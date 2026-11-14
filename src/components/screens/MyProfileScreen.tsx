import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import type { Member, Gender } from '../../types/database';
import {
  GENDER_LABELS,
  validateMemberSelfProfileUpdate,
} from '../../lib/domain-logic';
import {
  User,
  Phone,
  Mail,
  CheckCircle,
  AlertCircle,
  Info,
  Lock,
} from 'lucide-react';

export const MyProfileScreen: React.FC = () => {
  const { user, profile, activeChurch, refreshUserData } = useAuth();

  const [member, setMember] = useState<Member | null>(null);
  const [fullName, setFullName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const isPreviewPersona =
      typeof window !== 'undefined' &&
      Boolean(window.sessionStorage.getItem('cms_preview_persona'));

    if (isPreviewPersona) {
      const storageKey = `cms_preview_member_${activeChurch?.id || 'default'}_${user?.id || 'anon'}`;
      let savedPreview: Partial<Member> | null = null;
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (raw) savedPreview = JSON.parse(raw) as Partial<Member>;
      } catch {
        savedPreview = null;
      }

      const previewMember: Member = {
        id: 'mem-preview-1',
        church_id: activeChurch?.id || 'c1111111-1111-1111-1111-111111111111',
        member_number: 'M-0042',
        full_name: savedPreview?.full_name || profile?.full_name || user?.user_metadata?.full_name || 'Member',
        contact_phone: savedPreview?.contact_phone ?? profile?.phone ?? '',
        contact_email: savedPreview?.contact_email ?? profile?.email ?? user?.email ?? '',
        village_name: 'Tambaram',
        gender: (savedPreview?.gender as Gender | null | undefined) ?? null,
        date_of_birth: '1993-05-14',
        joining_date: '2022-01-15',
        membership_status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: null,
        updated_by: null,
      };
      setMember(previewMember);
      setFullName(previewMember.full_name);
      setContactPhone(previewMember.contact_phone || '');
      setContactEmail(previewMember.contact_email || '');
      setGender(previewMember.gender || '');
      setIsLoading(false);
      return;
    }

    if (!supabase || !activeChurch || !user) {
      if (profile) {
        setFullName(profile.full_name);
        setContactPhone(profile.phone || '');
        setContactEmail(profile.email);
      }
      setIsLoading(false);
      return;
    }

    const fetchMyMemberRecord = async () => {
      setIsLoading(true);
      try {
        const { data: link } = await supabase
          .from('member_account_links')
          .select('*, member:members(*)')
          .eq('church_id', activeChurch.id)
          .eq('user_id', user.id)
          .maybeSingle();

        if (link?.member) {
          const m = link.member as Member;
          setMember(m);
          setFullName(m.full_name);
          setContactPhone(m.contact_phone || '');
          setContactEmail(m.contact_email || '');
          setGender(m.gender || '');
        } else if (profile) {
          setFullName(profile.full_name);
          setContactPhone(profile.phone || '');
          setContactEmail(profile.email);
        }
      } catch (err) {
        console.error('Error fetching member profile:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchMyMemberRecord();
  }, [activeChurch, user, profile]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveMessage(null);
    setErrors({});

    const validation = validateMemberSelfProfileUpdate({
      fullName,
      contactPhone,
      gender,
      contactEmail,
    });

    if (!validation.valid) {
      setErrors(validation.errors);
      return;
    }

    const isPreviewPersona =
      typeof window !== 'undefined' &&
      Boolean(window.sessionStorage.getItem('cms_preview_persona'));

    setIsSaving(true);

    try {
      if (isPreviewPersona) {
        const storageKey = `cms_preview_member_${activeChurch?.id || 'default'}_${user?.id || 'anon'}`;
        const updatedMember: Member | null = member
          ? {
              ...member,
              full_name: validation.normalized.fullName,
              contact_phone: validation.normalized.contactPhone,
              contact_email: validation.normalized.contactEmail,
              gender: validation.normalized.gender,
              updated_at: new Date().toISOString(),
            }
          : null;
        if (updatedMember) {
          setMember(updatedMember);
          try {
            window.localStorage.setItem(storageKey, JSON.stringify(updatedMember));
          } catch {
            // ignore
          }
        }
        setFullName(validation.normalized.fullName);
        setContactPhone(validation.normalized.contactPhone);
        setContactEmail(validation.normalized.contactEmail || '');
        if (validation.normalized.gender) {
          setGender(validation.normalized.gender);
        }
        setSaveMessage('Profile information successfully updated!');
        return;
      }

      if (!supabase || !user || !activeChurch) {
        throw new Error('Active church session is required to update your profile.');
      }

      const { data, error } = await supabase.rpc('update_my_member_profile', {
        p_church_id: activeChurch.id,
        p_full_name: validation.normalized.fullName,
        p_contact_phone: validation.normalized.contactPhone,
        p_gender: validation.normalized.gender,
        p_contact_email: validation.normalized.contactEmail,
      });

      if (error) throw error;

      const result = data as { member?: Member | null } | null;
      if (result?.member) {
        setMember(result.member);
        setFullName(result.member.full_name);
        setContactPhone(result.member.contact_phone || '');
        setContactEmail(result.member.contact_email || '');
        setGender(result.member.gender || '');
      }

      setSaveMessage('Profile information successfully updated!');
      await refreshUserData();
    } catch (err: unknown) {
      setErrors({
        form: err instanceof Error ? err.message : 'Failed to update profile.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto p-8 text-center text-xs text-slate-400">
        Loading member profile...
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
          <User className="w-5 h-5 text-sky-400" />
          <span>My Member Profile</span>
        </h1>
        <p className="text-xs text-slate-400">
          Update your required personal details (full name, phone number, and gender) for church notices and receipts
        </p>
      </div>

      {saveMessage && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 rounded-xl text-xs flex items-center gap-2">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{saveMessage}</span>
        </div>
      )}

      {errors.form && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-300 rounded-xl text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
          <span>{errors.form}</span>
        </div>
      )}

      {/* Profile Form */}
      <form
        onSubmit={handleSaveProfile}
        noValidate
        className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-5"
      >
        {/* Read-Only Identity Card */}
        <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-slate-500 block">Login / Authentication Email</span>
            <span className="text-white font-mono">{user?.email}</span>
          </div>

          <div>
            <span className="text-slate-500 block">Church Member #</span>
            <span className="text-sky-400 font-mono font-semibold">
              {member?.member_number || 'Pending Assignment'}
            </span>
          </div>

          <div>
            <span className="text-slate-500 flex items-center gap-1">
              <Lock className="w-3 h-3 text-amber-400" />
              Village / City Name (Accountant Managed)
            </span>
            <span className="text-slate-300 font-medium">
              {member?.village_name || 'Not provided'}
            </span>
          </div>

          <div>
            <span className="text-slate-500 flex items-center gap-1">
              <Lock className="w-3 h-3 text-amber-400" />
              Date of Birth
            </span>
            <span className="text-slate-300 font-mono">
              {member?.date_of_birth || 'Not recorded'}
            </span>
          </div>

          <div>
            <span className="text-slate-500 flex items-center gap-1">
              <Lock className="w-3 h-3 text-amber-400" />
              Membership Status
            </span>
            <span
              className={`inline-block px-2 py-0.5 rounded text-[10px] font-mono font-bold border mt-0.5 ${
                member?.membership_status === 'active'
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              {(member?.membership_status || 'active').toUpperCase()}
            </span>
          </div>
        </div>

        {/* Notice on Contact Email vs Authentication Email */}
        <div className="bg-sky-950/30 border border-sky-500/20 rounded-xl p-3 text-[11px] text-slate-400 flex items-start gap-2">
          <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
          <span>
            <strong>Security Boundary:</strong> Full Name, Phone Number, and Gender are mandatory
            when updating your profile. Editing your Contact Email updates where notifications
            and receipts are addressed, without altering your Google login email.
          </span>
        </div>

        {/* Editable Fields */}
        <div className="space-y-4 text-xs">
          {/* Mandatory Full Name */}
          <div>
            <label htmlFor="profile-full-name" className="block text-slate-300 font-medium mb-1">
              Full Name <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
              <input
                id="profile-full-name"
                type="text"
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  if (errors.fullName) setErrors((prev) => ({ ...prev, fullName: '' }));
                }}
                required
                placeholder="Enter your full name"
                className={`w-full bg-slate-950 border rounded-xl pl-10 pr-3.5 py-2.5 text-white text-sm focus:outline-none ${
                  errors.fullName
                    ? 'border-red-500/60 focus:border-red-400'
                    : 'border-slate-700 focus:border-sky-500'
                }`}
              />
            </div>
            {errors.fullName && (
              <p className="text-[11px] text-red-400 mt-1">{errors.fullName}</p>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            {/* Mandatory Phone Number */}
            <div>
              <label htmlFor="profile-phone" className="block text-slate-300 font-medium mb-1">
                Phone Number <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 text-slate-500 absolute left-3.5 top-2.5" />
                <input
                  id="profile-phone"
                  type="tel"
                  value={contactPhone}
                  onChange={(e) => {
                    setContactPhone(e.target.value);
                    if (errors.contactPhone) setErrors((prev) => ({ ...prev, contactPhone: '' }));
                  }}
                  required
                  placeholder="+91 98400 00000"
                  className={`w-full bg-slate-950 border rounded-xl pl-10 pr-3.5 py-2 text-white font-mono focus:outline-none ${
                    errors.contactPhone
                      ? 'border-red-500/60 focus:border-red-400'
                      : 'border-slate-700 focus:border-sky-500'
                  }`}
                />
              </div>
              {errors.contactPhone && (
                <p className="text-[11px] text-red-400 mt-1">{errors.contactPhone}</p>
              )}
            </div>

            {/* Optional Contact Email */}
            <div>
              <label htmlFor="profile-contact-email" className="block text-slate-300 font-medium mb-1">
                Contact Email <span className="text-slate-500 font-normal">(Optional)</span>
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-2.5" />
                <input
                  id="profile-contact-email"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => {
                    setContactEmail(e.target.value);
                    if (errors.contactEmail) setErrors((prev) => ({ ...prev, contactEmail: '' }));
                  }}
                  placeholder="contact@example.com"
                  className={`w-full bg-slate-950 border rounded-xl pl-10 pr-3.5 py-2 text-white focus:outline-none ${
                    errors.contactEmail
                      ? 'border-red-500/60 focus:border-red-400'
                      : 'border-slate-700 focus:border-sky-500'
                  }`}
                />
              </div>
              {errors.contactEmail && (
                <p className="text-[11px] text-red-400 mt-1">{errors.contactEmail}</p>
              )}
            </div>
          </div>

          {/* Mandatory Gender */}
          <div>
            <label htmlFor="profile-gender" className="block text-slate-300 font-medium mb-1">
              Gender <span className="text-red-400">*</span>
            </label>
            <select
              id="profile-gender"
              value={gender}
              onChange={(e) => {
                setGender(e.target.value as Gender | '');
                if (errors.gender) setErrors((prev) => ({ ...prev, gender: '' }));
              }}
              required
              className={`w-full bg-slate-950 border rounded-xl px-3.5 py-2 text-white focus:outline-none ${
                errors.gender
                  ? 'border-red-500/60 focus:border-red-400'
                  : 'border-slate-700 focus:border-sky-500'
              }`}
            >
              <option value="">-- Select Gender --</option>
              <option value="male">{GENDER_LABELS.male}</option>
              <option value="female">{GENDER_LABELS.female}</option>
              <option value="other">{GENDER_LABELS.other}</option>
              <option value="prefer_not_to_say">{GENDER_LABELS.prefer_not_to_say}</option>
            </select>
            {errors.gender && (
              <p className="text-[11px] text-red-400 mt-1">{errors.gender}</p>
            )}
          </div>
        </div>

        <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-3">
          <span className="text-[11px] text-slate-500">
            <span className="text-red-400">*</span> Required fields
          </span>
          <button
            type="submit"
            disabled={isSaving}
            className="bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white font-semibold text-xs py-2.5 px-5 rounded-xl transition-colors shadow-lg shadow-sky-600/20 cursor-pointer"
          >
            {isSaving ? 'Saving...' : 'Save Profile Changes'}
          </button>
        </div>
      </form>
    </div>
  );
};
