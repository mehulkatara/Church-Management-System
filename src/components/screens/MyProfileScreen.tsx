import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import type { Member, Gender } from '../../types/database';
import { GENDER_LABELS } from '../../lib/domain-logic';
import { User, Phone, Mail, MapPin, Shield, CheckCircle, Info, Lock } from 'lucide-react';

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

  useEffect(() => {
    if (!supabase || !activeChurch || !user) return;

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
    if (!supabase || !user) return;

    setIsSaving(true);
    setSaveMessage(null);

    try {
      // 1. Update basic profile table
      await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim(),
          phone: contactPhone.trim() || null,
        })
        .eq('id', user.id);

      // 2. If member record linked, update allowed member fields: name, contact_phone, contact_email, gender
      if (member) {
        await supabase
          .from('members')
          .update({
            full_name: fullName.trim(),
            contact_phone: contactPhone.trim() || null,
            contact_email: contactEmail.trim() || null,
            gender: gender ? (gender as Gender) : null,
          })
          .eq('id', member.id);
      }

      setSaveMessage('Profile information successfully updated!');
      await refreshUserData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to update profile.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
          <User className="w-5 h-5 text-sky-400" />
          <span>My Member Profile</span>
        </h1>
        <p className="text-xs text-slate-400">
          Personal contact details for church notices and financial receipts
        </p>
      </div>

      {saveMessage && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 rounded-xl text-xs flex items-center gap-2">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{saveMessage}</span>
        </div>
      )}

      {/* Profile Form */}
      <form
        onSubmit={handleSaveProfile}
        className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-5"
      >
        {/* Read-Only Identity Card */}
        <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 grid grid-cols-2 gap-3 text-xs">
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
            <span className="text-slate-500 block flex items-center gap-1">
              <Lock className="w-3 h-3 text-amber-400" />
              Village / City Name (Accountant Managed)
            </span>
            <span className="text-slate-300 font-medium">
              {member?.village_name || 'Not provided'}
            </span>
          </div>

          <div>
            <span className="text-slate-500 block flex items-center gap-1">
              <Lock className="w-3 h-3 text-amber-400" />
              Date of Birth
            </span>
            <span className="text-slate-300 font-mono">
              {member?.date_of_birth || 'Not recorded'}
            </span>
          </div>

          <div>
            <span className="text-slate-500 block flex items-center gap-1">
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
            <strong>Security Boundary:</strong> Editing your Contact Email updates where notifications
            and receipts are addressed, but does NOT alter your login credentials or account ownership.
          </span>
        </div>

        {/* Editable Fields */}
        <div className="space-y-4 text-xs">
          <div>
            <label className="block text-slate-300 font-medium mb-1">Full Name</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-sky-500"
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-300 font-medium mb-1">Contact Phone</label>
              <input
                type="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="+91 98400 00000"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-white font-mono focus:outline-none focus:border-sky-500"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Contact Email</label>
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="contact@example.com"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-white focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>

          {/* Gender */}
          <div>
            <label className="block text-slate-300 font-medium mb-1">
              Gender <span className="text-slate-400 font-normal">(Optional personal preference)</span>
            </label>
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value as Gender | '')}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-white focus:outline-none focus:border-sky-500"
            >
              <option value="">-- Not Provided (NULL) --</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
              <option value="prefer_not_to_say">Prefer not to say</option>
            </select>
          </div>
        </div>

        <div className="pt-3 border-t border-slate-800 flex justify-end">
          <button
            type="submit"
            disabled={isSaving}
            className="bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs py-2.5 px-5 rounded-xl transition-colors shadow-lg shadow-sky-600/20 cursor-pointer"
          >
            {isSaving ? 'Saving...' : 'Save Profile Changes'}
          </button>
        </div>
      </form>
    </div>
  );
};
