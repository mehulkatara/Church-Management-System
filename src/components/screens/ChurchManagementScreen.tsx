import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import type { Church } from '../../types/database';
import {
  buildAutoReceiptPrefix,
  buildChurchMemberPrefix,
  buildChurchPortalUrl,
  formatIndianMobileInput,
  normalizeChurchCodeInput,
  normalizeChurchSlugInput,
  suggestChurchSlug,
  validateChurchSlug,
  validateNewChurchInput,
} from '../../lib/domain-logic';
import {
  getPreviewChurches,
  savePreviewChurches,
  checkChurchSlugAvailability,
} from '../../lib/church-slug';
import { Modal } from '../common/Modals';
import {
  Building2,
  Plus,
  Phone,
  Mail,
  MapPin,
  Link2,
  Copy,
  Check,
  Edit3,
} from 'lucide-react';

export const ChurchManagementScreen: React.FC = () => {
  const { refreshUserData, updateScopedChurchInState } = useAuth();

  const [churches, setChurches] = useState<Church[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [code, setCode] = useState('');
  const [slug, setSlug] = useState('');
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [copiedChurchId, setCopiedChurchId] = useState<string | null>(null);

  // Edit Slug Modal State
  const [editingChurch, setEditingChurch] = useState<Church | null>(null);
  const [editSlugValue, setEditSlugValue] = useState('');
  const [editSlugError, setEditSlugError] = useState<string | null>(null);
  const [isSavingEditSlug, setIsSavingEditSlug] = useState(false);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const fetchChurches = async () => {
    if (!supabase) {
      setChurches(getPreviewChurches());
      return;
    }
    const { data } = await supabase.from('churches').select('*').order('name');
    if (data) setChurches(data as Church[]);
  };

  useEffect(() => {
    fetchChurches();
  }, []);

  const handleCopyChurchLink = async (church: Church) => {
    const url = buildChurchPortalUrl(origin, church.slug);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedChurchId(church.id);
      setTimeout(() => {
        setCopiedChurchId((prev) => (prev === church.id ? null : prev));
      }, 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleCreateChurch = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg(null);
    setFieldErrors({});

    try {
      const targetSlug = slug || suggestChurchSlug(name || code);
      const validation = validateNewChurchInput({
        name,
        code,
        slug: targetSlug,
        address,
        phone,
        email,
      });

      if (!validation.valid) {
        setFieldErrors(validation.errors);
        setErrorMsg(
          Object.values(validation.errors)[0] || 'Please fill in all required church fields.'
        );
        setIsSubmitting(false);
        return;
      }

      const availability = await checkChurchSlugAvailability(validation.normalized.slug, null);
      if (!availability.available) {
        setFieldErrors({
          slug: availability.reason || 'This URL slug is already in use.',
        });
        setErrorMsg(availability.reason || 'This URL slug is already in use.');
        setIsSubmitting(false);
        return;
      }

      if (!supabase) {
        const cleanCode = validation.normalized.code;
        const existing = getPreviewChurches();
        if (existing.some((c) => c.code.toUpperCase() === cleanCode)) {
          setFieldErrors({ code: `Church code "${cleanCode}" already exists.` });
          throw new Error(`Church code "${cleanCode}" already exists.`);
        }
        const now = new Date().toISOString();
        const newChurch: Church = {
          id: `c-${Date.now()}`,
          code: cleanCode,
          slug: availability.normalizedSlug,
          name: validation.normalized.name,
          address: validation.normalized.address,
          phone: validation.normalized.phone,
          email: validation.normalized.email,
          is_active: true,
          created_at: now,
          updated_at: now,
        };
        const updatedList = [...existing, newChurch];
        savePreviewChurches(updatedList);
        setChurches(updatedList);
      } else {
        const { error } = await supabase
          .from('churches')
          .insert({
            code: validation.normalized.code,
            slug: availability.normalizedSlug,
            name: validation.normalized.name,
            address: validation.normalized.address,
            phone: validation.normalized.phone,
            email: validation.normalized.email,
            is_active: true,
          })
          .select()
          .single();

        if (error) throw error;
        await fetchChurches();
        await refreshUserData();
      }

      setIsModalOpen(false);
      setCode('');
      setSlug('');
      setSlugManuallyEdited(false);
      setName('');
      setAddress('');
      setPhone('');
      setEmail('');
      setFieldErrors({});
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create church.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveEditedSlug = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingChurch) return;

    setIsSavingEditSlug(true);
    setEditSlugError(null);

    try {
      const validation = validateChurchSlug(editSlugValue);
      if (!validation.valid) {
        setEditSlugError(validation.error || 'Invalid URL slug.');
        setIsSavingEditSlug(false);
        return;
      }

      const availability = await checkChurchSlugAvailability(
        validation.normalized,
        editingChurch.id
      );
      if (!availability.available) {
        setEditSlugError(availability.reason || 'This URL slug is already in use.');
        setIsSavingEditSlug(false);
        return;
      }

      if (!supabase) {
        const updatedList = getPreviewChurches().map((c) =>
          c.id === editingChurch.id
            ? { ...c, slug: availability.normalizedSlug, updated_at: new Date().toISOString() }
            : c
        );
        savePreviewChurches(updatedList);
        setChurches(updatedList);
        const updatedTarget = updatedList.find((c) => c.id === editingChurch.id);
        if (updatedTarget) updateScopedChurchInState(updatedTarget);
      } else {
        const { data, error } = await supabase
          .from('churches')
          .update({ slug: availability.normalizedSlug })
          .eq('id', editingChurch.id)
          .select()
          .single();

        if (error) throw error;
        if (data) updateScopedChurchInState(data as Church);
        await fetchChurches();
        await refreshUserData();
      }

      setEditingChurch(null);
    } catch (err: unknown) {
      setEditSlugError(err instanceof Error ? err.message : 'Failed to update church URL slug.');
    } finally {
      setIsSavingEditSlug(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Building2 className="w-5 h-5 text-sky-400" />
            <span>Multi-Church Administration</span>
          </h1>
          <p className="text-xs text-slate-400">
            Create churches and manage their dedicated sign-in URLs
          </p>
        </div>

        <button
          onClick={() => {
            setErrorMsg(null);
            setFieldErrors({});
            setSlugManuallyEdited(false);
            setCode('');
            setSlug('');
            setName('');
            setAddress('');
            setPhone('');
            setEmail('');
            setIsModalOpen(true);
          }}
          className="bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs py-2 px-3.5 rounded-xl flex items-center gap-2 transition-colors shadow-lg shadow-sky-600/20 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Add Church</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {churches.map((church) => {
          const isCopied = copiedChurchId === church.id;
          return (
            <div
              key={church.id}
              className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3 shadow-xl"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-mono text-sky-400 uppercase font-semibold">
                    Code: {church.code}
                  </div>
                  <h3 className="text-base font-bold text-white mt-0.5">{church.name}</h3>
                </div>
                <span
                  className={`text-[11px] font-mono font-semibold shrink-0 ${
                    church.is_active ? 'text-emerald-400' : 'text-slate-400'
                  }`}
                >
                  {church.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>

              <div className="space-y-1 text-xs text-slate-400 pt-2 border-t border-slate-800/80">
                {church.address && (
                  <div className="flex items-center gap-2">
                    <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span>{church.address}</span>
                  </div>
                )}
                {church.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span className="font-mono tabular-nums">{church.phone}</span>
                  </div>
                )}
                {church.email && (
                  <div className="flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span>{church.email}</span>
                  </div>
                )}
              </div>

              {/* Dedicated Church URL Bar */}
              <div className="pt-2 border-t border-slate-800/80 space-y-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <Link2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span>Dedicated Sign-In URL</span>
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setEditSlugValue(church.slug);
                        setEditSlugError(null);
                        setEditingChurch(church);
                      }}
                      className="text-[11px] text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded-lg border border-slate-700 flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Edit3 className="w-3 h-3" />
                      <span>Edit Slug</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopyChurchLink(church)}
                      className="text-[11px] text-sky-300 hover:text-sky-200 bg-sky-500/10 hover:bg-sky-500/20 px-2 py-1 rounded-lg border border-sky-500/20 flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      {isCopied ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>{isCopied ? 'Copied!' : 'Copy Link'}</span>
                    </button>
                  </div>
                </div>
                <div className="px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg font-mono text-[11px] text-sky-300 truncate">
                  {buildChurchPortalUrl(origin, church.slug)}
                </div>
              </div>

              <div className="pt-2 border-t border-slate-800/80 space-y-1 text-xs font-mono">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Auto Member ID Series:</span>
                  <span className="text-sky-300 font-semibold tabular-nums">
                    {buildChurchMemberPrefix(church.code)}1, {buildChurchMemberPrefix(church.code)}2, ...
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Auto Receipt Format:</span>
                  <span className="text-sky-300 font-semibold tabular-nums">
                    {buildAutoReceiptPrefix(church.code, new Date())}#
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* CREATE CHURCH MODAL */}
      {isModalOpen && (
        <Modal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          title="Create New Church"
          maxWidth="md"
        >
          <form onSubmit={handleCreateChurch} className="space-y-4 text-xs">
            {errorMsg && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl">
                {errorMsg}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Church Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => {
                    const nextName = e.target.value;
                    setName(nextName);
                    if (!slugManuallyEdited) {
                      setSlug(suggestChurchSlug(nextName || code));
                    }
                    if (fieldErrors.name) {
                      setFieldErrors((prev) => ({ ...prev, name: '' }));
                    }
                  }}
                  required
                  placeholder="e.g. Grace Bethel Church"
                  className={`w-full bg-slate-950 border ${
                    fieldErrors.name ? 'border-red-500' : 'border-slate-700'
                  } rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500`}
                />
                {fieldErrors.name && (
                  <p className="text-[11px] text-red-400 mt-1">{fieldErrors.name}</p>
                )}
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Unique Church Code <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={code}
                  maxLength={20}
                  onChange={(e) => {
                    const nextCode = normalizeChurchCodeInput(e.target.value);
                    setCode(nextCode);
                    if (!slugManuallyEdited && !name.trim()) {
                      setSlug(suggestChurchSlug(nextCode));
                    }
                    if (fieldErrors.code) {
                      setFieldErrors((prev) => ({ ...prev, code: '' }));
                    }
                  }}
                  required
                  placeholder="e.g. GBC-CHN"
                  className={`w-full bg-slate-950 border ${
                    fieldErrors.code ? 'border-red-500' : 'border-slate-700'
                  } rounded-xl px-3 py-2 text-white font-mono uppercase focus:outline-none focus:border-sky-500`}
                />
                {fieldErrors.code ? (
                  <p className="text-[11px] text-red-400 mt-1">{fieldErrors.code}</p>
                ) : (
                  <p className="text-[11px] text-slate-500 mt-1">
                    Letters, numbers, and - only (2&ndash;20 chars)
                  </p>
                )}
              </div>
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">
                Custom URL Slug <span className="text-red-400">*</span>
              </label>
              <div
                className={`flex items-stretch bg-slate-950 border ${
                  fieldErrors.slug ? 'border-red-500' : 'border-slate-700'
                } rounded-xl overflow-hidden focus-within:border-sky-500`}
              >
                <span className="px-3 py-2 bg-slate-900 border-r border-slate-800 text-slate-400 font-mono flex items-center select-none">
                  /
                </span>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => {
                    setSlugManuallyEdited(true);
                    setSlug(normalizeChurchSlugInput(e.target.value));
                    if (fieldErrors.slug) {
                      setFieldErrors((prev) => ({ ...prev, slug: '' }));
                    }
                  }}
                  required
                  placeholder="e.g. grace-bethel"
                  className="flex-1 bg-transparent px-3 py-2 text-white font-mono focus:outline-none"
                />
              </div>
              {fieldErrors.slug ? (
                <p className="text-[11px] text-red-400 mt-1">{fieldErrors.slug}</p>
              ) : (
                <p className="text-[11px] text-slate-500 mt-1 font-mono truncate">
                  {buildChurchPortalUrl(origin, slug || 'church-slug')}
                </p>
              )}
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">
                Address <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  if (fieldErrors.address) {
                    setFieldErrors((prev) => ({ ...prev, address: '' }));
                  }
                }}
                required
                placeholder="Church street address, city, pin code"
                className={`w-full bg-slate-950 border ${
                  fieldErrors.address ? 'border-red-500' : 'border-slate-700'
                } rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500`}
              />
              {fieldErrors.address && (
                <p className="text-[11px] text-red-400 mt-1">{fieldErrors.address}</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Phone <span className="text-red-400">*</span>
                </label>
                <input
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  value={phone}
                  onChange={(e) => {
                    setPhone(formatIndianMobileInput(e.target.value));
                    if (fieldErrors.phone) {
                      setFieldErrors((prev) => ({ ...prev, phone: '' }));
                    }
                  }}
                  required
                  placeholder="9840012345"
                  className={`w-full bg-slate-950 border ${
                    fieldErrors.phone ? 'border-red-500' : 'border-slate-700'
                  } rounded-xl px-3 py-2 text-white font-mono tabular-nums focus:outline-none focus:border-sky-500`}
                />
                {fieldErrors.phone ? (
                  <p className="text-[11px] text-red-400 mt-1">{fieldErrors.phone}</p>
                ) : (
                  <p className="text-[11px] text-slate-500 mt-1">10-digit Indian mobile number</p>
                )}
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Email <span className="text-red-400">*</span>
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (fieldErrors.email) {
                      setFieldErrors((prev) => ({ ...prev, email: '' }));
                    }
                  }}
                  required
                  placeholder="office@church.org"
                  className={`w-full bg-slate-950 border ${
                    fieldErrors.email ? 'border-red-500' : 'border-slate-700'
                  } rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500`}
                />
                {fieldErrors.email && (
                  <p className="text-[11px] text-red-400 mt-1">{fieldErrors.email}</p>
                )}
              </div>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-[11px] text-slate-400 space-y-1">
              <div>
                Member IDs:{' '}
                <span className="font-mono text-sky-300 tabular-nums">
                  {buildChurchMemberPrefix(code || 'CODE')}1, {buildChurchMemberPrefix(code || 'CODE')}2, ...
                </span>{' '}
                &middot; Receipts:{' '}
                <span className="font-mono text-sky-300 tabular-nums">
                  {buildAutoReceiptPrefix(code || 'CODE', new Date())}#
                </span>
              </div>
              <div className="text-slate-500">
                Church code is stored in uppercase and locked once members exist.
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-3.5 py-1.5 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-lg cursor-pointer"
              >
                {isSubmitting ? 'Creating...' : 'Create Church'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* EDIT CHURCH URL SLUG MODAL */}
      {editingChurch && (
        <Modal
          isOpen={Boolean(editingChurch)}
          onClose={() => setEditingChurch(null)}
          title={`Edit URL Slug — ${editingChurch.name}`}
          maxWidth="md"
        >
          <form onSubmit={handleSaveEditedSlug} className="space-y-4 text-xs">
            {editSlugError && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl">
                {editSlugError}
              </div>
            )}

            <div>
              <label className="block text-slate-300 font-medium mb-1">
                Custom URL Slug <span className="text-red-400">*</span>
              </label>
              <div className="flex items-stretch bg-slate-950 border border-slate-700 rounded-xl overflow-hidden focus-within:border-sky-500">
                <span className="px-3 py-2 bg-slate-900 border-r border-slate-800 text-slate-400 font-mono flex items-center select-none">
                  /
                </span>
                <input
                  type="text"
                  value={editSlugValue}
                  onChange={(e) => {
                    setEditSlugValue(normalizeChurchSlugInput(e.target.value));
                    if (editSlugError) setEditSlugError(null);
                  }}
                  required
                  placeholder="grace-bethel"
                  className="flex-1 bg-transparent px-3 py-2 text-white font-mono focus:outline-none"
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5 font-mono truncate">
                Live link: {buildChurchPortalUrl(origin, editSlugValue || editingChurch.slug)}
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setEditingChurch(null)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSavingEditSlug}
                className="px-3.5 py-1.5 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-lg cursor-pointer"
              >
                {isSavingEditSlug ? 'Saving...' : 'Save URL Slug'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
