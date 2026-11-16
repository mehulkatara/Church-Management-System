import { supabase, supabaseConfig } from './supabase';
import type {
  Member,
  MemberShareLink,
  MemberPortalPayload,
  MemberPortalDonation,
  MemberPortalLeaderboardFy,
} from '../types/database';
import {
  getFinancialYearOptions,
  getFinancialYear,
  maskDonorDisplayName,
} from './domain-logic';

const PREVIEW_LINKS_KEY = 'cms_preview_share_links';

interface PreviewStoredShareLink extends MemberShareLink {
  raw_token: string;
  church_name: string;
  church_code: string;
  church_address: string | null;
  church_phone: string | null;
  member_snapshot: {
    id: string;
    member_number: string;
    full_name: string;
    contact_phone: string | null;
    village_name: string | null;
    gender: Member['gender'];
    date_of_birth: string | null;
    joining_date: string;
    membership_status: Member['membership_status'];
  };
}

// Single-flight cache prevents React StrictMode double-mount from burning a single-use token twice
const redemptionCache = new Map<string, Promise<MemberPortalPayload>>();

function isPreviewContext(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    !supabaseConfig.isConfigured ||
    Boolean(window.sessionStorage.getItem('cms_preview_persona'))
  );
}

function loadPreviewLinks(): PreviewStoredShareLink[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(PREVIEW_LINKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePreviewLinks(links: PreviewStoredShareLink[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREVIEW_LINKS_KEY, JSON.stringify(links));
  } catch {
    // ignore storage quota errors
  }
}

function generateRandomHexToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`;
}

export async function fetchLatestMemberShareLink(
  churchId: string,
  memberId: string
): Promise<MemberShareLink | null> {
  if (isPreviewContext()) {
    const all = loadPreviewLinks().filter(
      (item) => item.church_id === churchId && item.member_id === memberId
    );
    all.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return all[0] || null;
  }

  const { data, error } = await supabase
    .from('member_share_links')
    .select('id, church_id, member_id, status, created_by, created_at, consumed_at, revoked_at, revoked_by')
    .eq('church_id', churchId)
    .eq('member_id', memberId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as MemberShareLink | null) || null;
}

export async function createMemberShareLink(params: {
  churchId: string;
  member: Member;
  churchMeta?: { name: string; code: string; address: string | null; phone: string | null };
}): Promise<{ link: MemberShareLink; rawToken: string }> {
  const { churchId, member, churchMeta } = params;

  if (isPreviewContext()) {
    const now = new Date().toISOString();
    const existing = loadPreviewLinks().map((item) =>
      item.church_id === churchId && item.member_id === member.id && item.status === 'active'
        ? { ...item, status: 'revoked' as const, revoked_at: now }
        : item
    );

    const rawToken = generateRandomHexToken();
    const newLink: PreviewStoredShareLink = {
      id: `link-${Date.now()}`,
      church_id: churchId,
      member_id: member.id,
      status: 'active',
      created_by: 'preview-staff',
      created_at: now,
      consumed_at: null,
      revoked_at: null,
      revoked_by: null,
      raw_token: rawToken,
      church_name: churchMeta?.name || 'Grace Bethel Church, Chennai',
      church_code: churchMeta?.code || 'GBC-CHN',
      church_address: churchMeta?.address ?? '45 Anna Salai, Chennai',
      church_phone: churchMeta?.phone ?? '+91 98400 11223',
      member_snapshot: {
        id: member.id,
        member_number: member.member_number,
        full_name: member.full_name,
        contact_phone: member.contact_phone,
        village_name: member.village_name,
        gender: member.gender,
        date_of_birth: member.date_of_birth ?? null,
        joining_date: member.joining_date,
        membership_status: member.membership_status,
      },
    };

    savePreviewLinks([newLink, ...existing]);
    return { link: newLink, rawToken };
  }

  const { data, error } = await supabase.rpc('create_member_share_link', {
    p_church_id: churchId,
    p_member_id: member.id,
  });

  if (error) throw error;

  const res = data as {
    success?: boolean;
    link_id?: string;
    raw_token?: string;
    status?: MemberShareLink['status'];
    created_at?: string;
  };

  if (!res?.raw_token || !res?.link_id) {
    throw new Error('Could not generate single-use member link.');
  }

  return {
    rawToken: res.raw_token,
    link: {
      id: res.link_id,
      church_id: churchId,
      member_id: member.id,
      status: res.status || 'active',
      created_by: null,
      created_at: res.created_at || new Date().toISOString(),
      consumed_at: null,
      revoked_at: null,
      revoked_by: null,
    },
  };
}

export async function revokeMemberShareLink(
  churchId: string,
  linkId: string
): Promise<MemberShareLink> {
  if (isPreviewContext()) {
    const now = new Date().toISOString();
    let updated: PreviewStoredShareLink | null = null;
    const next = loadPreviewLinks().map((item) => {
      if (item.id === linkId && item.church_id === churchId) {
        updated = {
          ...item,
          status: 'revoked',
          revoked_at: now,
        };
        return updated;
      }
      return item;
    });
    savePreviewLinks(next);
    if (!updated) {
      throw new Error('Member share link not found.');
    }
    return updated;
  }

  const { data, error } = await supabase.rpc('revoke_member_share_link', {
    p_church_id: churchId,
    p_link_id: linkId,
  });

  if (error) throw error;
  const res = data as { link_id?: string; status?: MemberShareLink['status']; revoked_at?: string };

  return {
    id: res.link_id || linkId,
    church_id: churchId,
    member_id: '',
    status: res.status || 'revoked',
    created_by: null,
    created_at: '',
    consumed_at: null,
    revoked_at: res.revoked_at || new Date().toISOString(),
    revoked_by: null,
  };
}

function buildPreviewPortalPayload(stored: PreviewStoredShareLink): MemberPortalPayload {
  const fyList = getFinancialYearOptions(5);
  const currentFy = getFinancialYear(new Date());
  const prevFy = fyList[1] || currentFy;

  const donations: MemberPortalDonation[] = [
    {
      id: `prev-don-${stored.member_id}-1`,
      receipt_number: `GBC/${currentFy.fyCode}/0142`,
      donation_date: currentFy.startDate,
      amount: 5000,
      payment_method: 'UPI',
      payment_reference: 'UPI-41890211',
      notes: 'Monthly tithe offering',
      category_name: 'Tithe',
      receiving_account_name: 'SBI Main Church Account',
    },
    {
      id: `prev-don-${stored.member_id}-2`,
      receipt_number: `GBC/${currentFy.fyCode}/0089`,
      donation_date: currentFy.startDate,
      amount: 2500,
      payment_method: 'Cash',
      payment_reference: null,
      notes: 'Thanksgiving offering',
      category_name: 'Offering',
      receiving_account_name: 'Church General Cash',
    },
    {
      id: `prev-don-${stored.member_id}-3`,
      receipt_number: `GBC/${prevFy.fyCode}/0912`,
      donation_date: prevFy.startDate,
      amount: 10000,
      payment_method: 'Bank Transfer',
      payment_reference: 'NEFT-772341',
      notes: 'Building pledge contribution',
      category_name: 'Building Fund',
      receiving_account_name: 'HDFC Building Fund Account',
    },
  ];

  const leaderboardFys: MemberPortalLeaderboardFy[] = [
    {
      fy_code: currentFy.fyCode,
      my_standing: {
        rank: 2,
        display_name: stored.member_snapshot.full_name,
        display_member_number: stored.member_snapshot.member_number,
        total_amount: 7500,
        is_active: stored.member_snapshot.membership_status === 'active',
        is_self: true,
      },
      top_10: [
        {
          rank: 1,
          display_name: maskDonorDisplayName('Samuel Jayakumar', false, true),
          display_member_number: '••••',
          total_amount: 14500,
          is_active: true,
          is_self: false,
        },
        {
          rank: 2,
          display_name: stored.member_snapshot.full_name,
          display_member_number: stored.member_snapshot.member_number,
          total_amount: 7500,
          is_active: stored.member_snapshot.membership_status === 'active',
          is_self: true,
        },
        {
          rank: 3,
          display_name: maskDonorDisplayName('Grace Hannah', false, true),
          display_member_number: '••••',
          total_amount: 5200,
          is_active: true,
          is_self: false,
        },
      ],
    },
    {
      fy_code: prevFy.fyCode,
      my_standing: {
        rank: 1,
        display_name: stored.member_snapshot.full_name,
        display_member_number: stored.member_snapshot.member_number,
        total_amount: 10000,
        is_active: stored.member_snapshot.membership_status === 'active',
        is_self: true,
      },
      top_10: [
        {
          rank: 1,
          display_name: stored.member_snapshot.full_name,
          display_member_number: stored.member_snapshot.member_number,
          total_amount: 10000,
          is_active: stored.member_snapshot.membership_status === 'active',
          is_self: true,
        },
        {
          rank: 2,
          display_name: maskDonorDisplayName('Ebenezer Raj', false, true),
          display_member_number: '••••',
          total_amount: 8000,
          is_active: true,
          is_self: false,
        },
      ],
    },
  ];

  return {
    success: true,
    consumed_at: new Date().toISOString(),
    mask_names_by_default: true,
    church: {
      id: stored.church_id,
      code: stored.church_code,
      name: stored.church_name,
      address: stored.church_address,
      phone: stored.church_phone,
    },
    member: stored.member_snapshot,
    donations,
    leaderboard_fys: leaderboardFys,
  };
}

export async function redeemMemberShareLink(rawToken: string): Promise<MemberPortalPayload> {
  const cleanToken = (rawToken || '').trim();
  if (!cleanToken) {
    return {
      success: false,
      error_code: 'invalid',
      message: 'This member link is missing its access token.',
    };
  }

  const cached = redemptionCache.get(cleanToken);
  if (cached) {
    return cached;
  }

  const promise = (async (): Promise<MemberPortalPayload> => {
    // Support preview tokens stored locally when testing UI preview or unconfigured DB
    const previewLinks = loadPreviewLinks();
    const previewMatch = previewLinks.find((item) => item.raw_token === cleanToken);
    if (previewMatch) {
      if (previewMatch.status === 'revoked') {
        return {
          success: false,
          error_code: 'revoked',
          message: 'This member link was revoked or replaced by church staff. Please request a fresh link.',
        };
      }
      if (previewMatch.status === 'consumed') {
        return {
          success: false,
          error_code: 'already_used',
          message: 'This single-use link has already been opened and expired. Please ask your church staff for a new link.',
        };
      }

      const consumedAt = new Date().toISOString();
      const updated = previewLinks.map((item) =>
        item.id === previewMatch.id
          ? { ...item, status: 'consumed' as const, consumed_at: consumedAt }
          : item
      );
      savePreviewLinks(updated);
      return buildPreviewPortalPayload({ ...previewMatch, status: 'consumed', consumed_at: consumedAt });
    }

    if (!supabaseConfig.isConfigured) {
      return {
        success: false,
        error_code: 'invalid',
        message: 'This member link is invalid or could not be verified.',
      };
    }

    const { data, error } = await supabase.rpc('redeem_member_share_link', {
      p_raw_token: cleanToken,
    });

    if (error) {
      return {
        success: false,
        error_code: 'invalid',
        message: error.message || 'Unable to verify this member link.',
      };
    }

    return data as MemberPortalPayload;
  })();

  redemptionCache.set(cleanToken, promise);
  return promise;
}
