import React, { useEffect, useMemo, useState } from 'react';
import {
  Church,
  Search,
  Lock,
  ShieldAlert,
  Clock,
  Receipt,
  Trophy,
  ArrowLeft,
  Eye,
  UserCheck,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { MemberPortalPayload } from '../../types/database';
import {
  formatINR,
  GENDER_LABELS,
  getFinancialYear,
  getFinancialYearOptions,
  buildMonthlyFyTrend,
  buildCategoryBreakdown,
  type DashboardDonationInput,
} from '../../lib/domain-logic';
import { redeemMemberShareLink } from '../../lib/member-share-links';
import { DashboardAnalytics } from '../dashboard/DashboardAnalytics';

interface MemberPortalScreenProps {
  onNavigatePath: (path: string) => void;
}

export const MemberPortalScreen: React.FC<MemberPortalScreenProps> = ({
  onNavigatePath,
}) => {
  const [payload, setPayload] = useState<MemberPortalPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedFy, setSelectedFy] = useState<string>(() => getFinancialYear(new Date()).fyCode);
  const [donationScope, setDonationScope] = useState<'fy' | 'all'>('fy');
  const [donationQuery, setDonationQuery] = useState('');
  const [isProfileExpanded, setIsProfileExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setIsLoading(true);
      const token =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('token') || ''
          : '';

      try {
        const result = await redeemMemberShareLink(token);
        if (cancelled) return;
        setPayload(result);

        // If current FY has neither donations nor leaderboard data, select the first FY that does
        if (result.success) {
          const currentFy = getFinancialYear(new Date()).fyCode;
          const fysWithEntries = (result.leaderboard_fys || []).map((f) => f.fy_code);
          if (fysWithEntries.length > 0 && !fysWithEntries.includes(currentFy)) {
            setSelectedFy(fysWithEntries[0]);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setPayload({
            success: false,
            error_code: 'invalid',
            message:
              err instanceof Error
                ? err.message
                : 'Unable to load your member portal right now.',
          });
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, []);

  const fyOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const fy of getFinancialYearOptions(5)) {
      map.set(fy.fyCode, fy.label);
    }
    for (const lb of payload?.leaderboard_fys || []) {
      if (!map.has(lb.fy_code)) {
        map.set(lb.fy_code, `FY ${lb.fy_code}`);
      }
    }
    for (const d of payload?.donations || []) {
      const fy = getFinancialYear(d.donation_date);
      if (!map.has(fy.fyCode)) {
        map.set(fy.fyCode, fy.label);
      }
    }
    return Array.from(map.entries())
      .map(([fyCode, label]) => ({ fyCode, label }))
      .sort((a, b) => b.fyCode.localeCompare(a.fyCode));
  }, [payload]);

  const allDonations = payload?.donations || [];

  const filteredDonations = useMemo(() => {
    const query = donationQuery.trim().toLowerCase();
    return allDonations.filter((d) => {
      if (donationScope === 'fy') {
        const fyCode = getFinancialYear(d.donation_date).fyCode;
        if (fyCode !== selectedFy) return false;
      }
      if (!query) return true;
      return (
        d.receipt_number.toLowerCase().includes(query) ||
        d.category_name.toLowerCase().includes(query) ||
        d.payment_method.toLowerCase().includes(query) ||
        d.receiving_account_name.toLowerCase().includes(query) ||
        (d.notes ? d.notes.toLowerCase().includes(query) : false)
      );
    });
  }, [allDonations, donationScope, selectedFy, donationQuery]);

  const filteredTotal = useMemo(
    () => filteredDonations.reduce((sum, item) => sum + Number(item.amount || 0), 0),
    [filteredDonations]
  );

  const lifetimeTotal = useMemo(
    () => allDonations.reduce((sum, item) => sum + Number(item.amount || 0), 0),
    [allDonations]
  );

  const activeLeaderboard = useMemo(() => {
    return (
      (payload?.leaderboard_fys || []).find((entry) => entry.fy_code === selectedFy) || {
        fy_code: selectedFy,
        top_10: [],
        my_standing: null,
      }
    );
  }, [payload, selectedFy]);

  const selectedFyLabel = useMemo(() => {
    const match = fyOptions.find((fy) => fy.fyCode === selectedFy);
    return match ? match.label : `FY ${selectedFy}`;
  }, [fyOptions, selectedFy]);

  const selectedFyStartYear = useMemo(() => {
    const m = /^(\d{4})/.exec(selectedFy);
    return m ? parseInt(m[1], 10) : getFinancialYear(new Date()).startYear;
  }, [selectedFy]);

  const selectedFyChartDonations = useMemo<DashboardDonationInput[]>(() => {
    return allDonations
      .filter((d) => getFinancialYear(d.donation_date).fyCode === selectedFy)
      .map((d) => ({
        donation_date: d.donation_date,
        amount: d.amount,
        category_name: d.category_name,
      }));
  }, [allDonations, selectedFy]);

  const monthlyTrend = useMemo(
    () => buildMonthlyFyTrend(selectedFyChartDonations, selectedFyStartYear),
    [selectedFyChartDonations, selectedFyStartYear]
  );

  const categoryBreakdown = useMemo(
    () => buildCategoryBreakdown(selectedFyChartDonations),
    [selectedFyChartDonations]
  );

  const formatTimestamp = (iso?: string | null) => {
    if (!iso) return 'Just now';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <header className="border-b border-slate-800 bg-slate-900/80">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
            <div className="h-5 w-52 bg-slate-800 rounded animate-pulse" />
            <div className="h-8 w-36 bg-slate-800 rounded-lg animate-pulse" />
          </div>
        </header>
        <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
          <div className="h-12 bg-slate-900 border border-slate-800 rounded-xl animate-pulse" />
          <div className="h-56 bg-slate-900 border border-slate-800 rounded-2xl animate-pulse" />
          <div className="h-64 bg-slate-900 border border-slate-800 rounded-2xl animate-pulse" />
          <div className="h-64 bg-slate-900 border border-slate-800 rounded-2xl animate-pulse" />
        </main>
      </div>
    );
  }

  if (!payload || !payload.success || !payload.member || !payload.church) {
    const code = payload?.error_code || 'invalid';
    const isExpiredOrRevoked = code === 'already_used' || code === 'revoked';
    const churchInfo = payload?.church;
    const churchSlug = churchInfo?.slug?.trim() || '';
    const churchName = churchInfo?.name?.trim() || '';
    const hasChurchRoute = isExpiredOrRevoked && Boolean(churchSlug);
    const signInPath = hasChurchRoute ? `/${churchSlug}` : '/';
    const primaryCtaLabel =
      hasChurchRoute && churchName
        ? `Go to Church Sign-In (${churchName})`
        : hasChurchRoute
        ? 'Go to Church Sign-In'
        : 'Go to Sign In';
    const headerLinkLabel = hasChurchRoute ? 'Church Sign-In' : 'Sign In';

    const title =
      code === 'already_used'
        ? 'Single-Use Link Expired'
        : code === 'revoked'
        ? 'Link Revoked or Replaced'
        : 'Invalid Member Link';

    const subtitle =
      payload?.message ||
      (code === 'already_used'
        ? 'This single-use link has already been opened once and cannot be reused. Please contact your church staff for a new link or sign in to your church account.'
        : code === 'revoked'
        ? 'This member link was revoked or replaced by a newer link. Please request a fresh link from your church staff or sign in to your church account.'
        : 'This member portal link is invalid or incomplete. Please check the URL sent by your church staff.');

    const StatusIcon = code === 'already_used' ? Clock : ShieldAlert;

    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
        <header className="border-b border-slate-800 bg-slate-900/80">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5 min-w-0">
              <Church className="w-5 h-5 text-sky-400 shrink-0" />
              <span className="text-sm font-semibold text-white truncate">
                {churchName || 'Member Portal'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => onNavigatePath(signInPath)}
              className="text-xs text-slate-300 hover:text-white flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{headerLinkLabel}</span>
            </button>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-5">
            <div className="w-11 h-11 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center text-amber-400">
              <StatusIcon className="w-5 h-5" />
            </div>

            <div className="space-y-2">
              <h1 className="text-xl font-bold text-white tracking-tight [text-wrap:balance]">
                {title}
              </h1>
              <p className="text-sm text-slate-300 leading-relaxed">{subtitle}</p>
            </div>

            {isExpiredOrRevoked && (
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <UserCheck className="w-4 h-4 text-sky-400 shrink-0" />
                  <span>Access Your Profile Anytime</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Sign in on{' '}
                  <strong className="text-white">
                    {churchName ? `${churchName}'s sign-in page` : 'your church sign-in page'}
                  </strong>{' '}
                  to create or complete your profile, then ask church staff (Accountant or Admin) to
                  link your profile to your member record. Once linked, you can log in anytime to
                  view your profile, donations, and leaderboard without needing single-use links.
                </p>
                {hasChurchRoute && (
                  <div className="pt-1 text-[11px] font-mono text-sky-400 truncate">
                    /{churchSlug}
                  </div>
                )}
              </div>
            )}

            <div className="pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-slate-500">
                Single-use links expire after opening
              </span>
              <button
                type="button"
                onClick={() => onNavigatePath(signInPath)}
                className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {primaryCtaLabel}
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const { church, member } = payload;
  const isActive = member.membership_status === 'active';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      {/* Top Sticky Header */}
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-sky-400 shrink-0">
              <Church className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white truncate">
                {church.name}
              </div>
              <div className="text-xs text-slate-400 truncate">
                <span className="font-mono">{church.code}</span>
                <span className="mx-1.5 text-slate-600">&middot;</span>
                <span>View-Only Member Portal</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <label htmlFor="portal-fy-select" className="sr-only">
              Financial Year
            </label>
            <select
              id="portal-fy-select"
              value={selectedFy}
              onChange={(e) => setSelectedFy(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono whitespace-nowrap shrink-0 focus:outline-none focus:border-sky-500"
            >
              {fyOptions.map((fy) => (
                <option key={fy.fyCode} value={fy.fyCode}>
                  {fy.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        {/* Single-Use & Read-Only Disclosure */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-300">
          <div className="flex items-center gap-2">
            <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>
              Single-use session opened at{' '}
              <span className="font-mono tabular-nums text-white">
                {formatTimestamp(payload.consumed_at)}
              </span>
              . This link cannot be reopened after you leave or reload.
            </span>
          </div>
          <span className="text-slate-400 flex items-center gap-1.5 whitespace-nowrap shrink-0">
            <Eye className="w-3.5 h-3.5 text-sky-400" />
            <span>View-only access</span>
          </span>
        </div>

        {/* Section 1: Collapsible Member Profile (Collapsed by Default) */}
        <section
          aria-labelledby="portal-profile-heading"
          className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden"
        >
          <button
            type="button"
            onClick={() => setIsProfileExpanded((prev) => !prev)}
            aria-expanded={isProfileExpanded}
            aria-controls="portal-profile-details"
            className="w-full px-6 py-4 text-left flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-800/40 transition-colors cursor-pointer"
          >
            <div className="space-y-1 min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
                <span className="font-medium text-sky-400">Member Profile</span>
                <span className="text-slate-600" aria-hidden="true">&middot;</span>
                <span className="font-mono tabular-nums text-sky-300 font-semibold">
                  {member.member_number}
                </span>
                <span className="text-slate-600" aria-hidden="true">&middot;</span>
                <span className={isActive ? 'text-emerald-400 font-medium' : 'text-slate-400 font-medium'}>
                  {isActive ? 'Active Member' : 'Inactive Member'}
                </span>
              </div>
              <h1
                id="portal-profile-heading"
                className="text-xl sm:text-2xl font-bold text-white tracking-tight [text-wrap:balance] truncate"
              >
                {member.full_name}
              </h1>
            </div>

            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 whitespace-nowrap shrink-0 self-start sm:self-center">
              <span>{isProfileExpanded ? 'Hide Details' : 'View Profile Details'}</span>
              {isProfileExpanded ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </span>
          </button>

          {isProfileExpanded && (
            <div
              id="portal-profile-details"
              className="px-6 pb-6 pt-5 border-t border-slate-800"
            >
              <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 text-xs">
                <div>
                  <dt className="text-slate-400 mb-1">Member Number</dt>
                  <dd className="text-sm font-mono tabular-nums font-medium text-white">
                    {member.member_number}
                  </dd>
                </div>

                <div>
                  <dt className="text-slate-400 mb-1">Mobile Number</dt>
                  <dd className="text-sm font-mono tabular-nums text-white">
                    {member.contact_phone || <span className="text-slate-500 font-sans">Not provided</span>}
                  </dd>
                </div>

                <div>
                  <dt className="text-slate-400 mb-1">Village / City</dt>
                  <dd className="text-sm text-white">
                    {member.village_name || <span className="text-slate-500">Not provided</span>}
                  </dd>
                </div>

                <div>
                  <dt className="text-slate-400 mb-1">Gender</dt>
                  <dd className="text-sm text-white">
                    {member.gender ? GENDER_LABELS[member.gender] : <span className="text-slate-500">Not provided</span>}
                  </dd>
                </div>

                <div>
                  <dt className="text-slate-400 mb-1">Date of Birth</dt>
                  <dd className="text-sm font-mono tabular-nums text-white">
                    {member.date_of_birth || <span className="text-slate-500 font-sans">Not provided</span>}
                  </dd>
                </div>

                <div>
                  <dt className="text-slate-400 mb-1">Joining Date</dt>
                  <dd className="text-sm font-mono tabular-nums text-white">
                    {member.joining_date}
                  </dd>
                </div>

                <div>
                  <dt className="text-slate-400 mb-1">Membership Status</dt>
                  <dd className={`text-sm font-medium ${isActive ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {isActive ? 'Active' : 'Inactive'}
                  </dd>
                </div>

                <div>
                  <dt className="text-slate-400 mb-1">Church Contact</dt>
                  <dd className="text-sm text-slate-300 font-mono tabular-nums">
                    {church.phone || church.address || church.name}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </section>

        {/* Section 2: Personal Financial Year Giving Analytics */}
        <DashboardAnalytics
          key={selectedFy}
          fyLabel={selectedFyLabel}
          isMember={true}
          isLoading={false}
          monthlyTrend={monthlyTrend}
          categoryBreakdown={categoryBreakdown}
        />

        {/* Section 3: Own Donation History */}
        <section
          aria-labelledby="portal-donations-heading"
          className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden"
        >
          <div className="p-6 border-b border-slate-800 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2
                  id="portal-donations-heading"
                  className="text-lg font-bold text-white tracking-tight flex items-center gap-2"
                >
                  <Receipt className="w-4 h-4 text-sky-400" />
                  <span>My Donations</span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Verified donation receipts issued under your membership
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <div className="inline-flex bg-slate-950 border border-slate-800 rounded-xl p-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setDonationScope('fy')}
                    className={`px-3 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      donationScope === 'fy'
                        ? 'bg-sky-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    FY {selectedFy}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDonationScope('all')}
                    className={`px-3 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      donationScope === 'all'
                        ? 'bg-sky-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    All Financial Years
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
              <div className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-3">
                <div className="text-xs text-slate-400">
                  {donationScope === 'fy' ? `Total in FY ${selectedFy}` : 'Filtered Total'}
                </div>
                <div className="text-lg font-bold text-white font-mono tabular-nums mt-1">
                  {formatINR(filteredTotal)}
                </div>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-3">
                <div className="text-xs text-slate-400">Receipts Shown</div>
                <div className="text-lg font-bold text-white font-mono tabular-nums mt-1">
                  {filteredDonations.length}
                </div>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-3">
                <div className="text-xs text-slate-400">All-Time Valid Giving</div>
                <div className="text-lg font-bold text-emerald-400 font-mono tabular-nums mt-1">
                  {formatINR(lifetimeTotal)}
                </div>
              </div>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-2.5" />
              <input
                type="text"
                value={donationQuery}
                onChange={(e) => setDonationQuery(e.target.value)}
                placeholder="Search by receipt number, category, payment method, or note..."
                className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-10 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            {filteredDonations.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <p className="text-sm font-medium text-slate-300">
                  {allDonations.length === 0
                    ? 'No donation receipts are recorded yet.'
                    : 'No receipts match the selected financial year or search filter.'}
                </p>
                {(donationQuery || donationScope === 'fy') && allDonations.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setDonationQuery('');
                      setDonationScope('all');
                    }}
                    className="text-xs text-sky-400 hover:text-sky-300 underline cursor-pointer"
                  >
                    Show all financial years
                  </button>
                )}
              </div>
            ) : (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 font-medium">
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Receipt #</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4">Payment &amp; Account</th>
                    <th className="py-3 px-4 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {filteredDonations.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3.5 px-4 font-mono tabular-nums text-slate-300 whitespace-nowrap">
                        {d.donation_date}
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums font-semibold text-sky-400 whitespace-nowrap">
                        {d.receipt_number}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="text-white font-medium">{d.category_name}</div>
                        {d.notes && (
                          <div className="text-xs text-slate-400 mt-0.5">{d.notes}</div>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="text-slate-200">{d.payment_method}</div>
                        <div className="text-xs text-slate-400">
                          {d.receiving_account_name}
                          {d.payment_reference ? (
                            <span className="font-mono"> &middot; {d.payment_reference}</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-white whitespace-nowrap">
                        {formatINR(Number(d.amount))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Section 3: Church Leaderboard */}
        <section
          aria-labelledby="portal-leaderboard-heading"
          className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden"
        >
          <div className="p-6 border-b border-slate-800 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2
                  id="portal-leaderboard-heading"
                  className="text-lg font-bold text-white tracking-tight flex items-center gap-2"
                >
                  <Trophy className="w-4 h-4 text-amber-400" />
                  <span>Church Leaderboard</span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  FY {selectedFy} standings &middot; Active members only
                </p>
              </div>
            </div>

            {/* Personal Standing Strip */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              {activeLeaderboard.my_standing ? (
                <>
                  <div className="space-y-0.5">
                    <div className="text-slate-400">Your Standing in FY {selectedFy}</div>
                    <div className="text-sm font-semibold text-white">
                      {activeLeaderboard.my_standing.display_name}
                      <span className="mx-1.5 text-slate-600">&middot;</span>
                      <span className="font-mono text-sky-400">
                        {activeLeaderboard.my_standing.display_member_number}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div>
                      <div className="text-slate-400">Rank</div>
                      <div className="text-base font-bold font-mono tabular-nums text-amber-400">
                        #{activeLeaderboard.my_standing.rank}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-slate-400">FY Total</div>
                      <div className="text-base font-bold font-mono tabular-nums text-white">
                        {formatINR(Number(activeLeaderboard.my_standing.total_amount))}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-slate-400">
                  No ranked donations recorded under your membership for FY {selectedFy}.
                </div>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            {activeLeaderboard.top_10.length === 0 ? (
              <div className="p-10 text-center text-sm text-slate-400">
                No leaderboard contributions recorded for FY {selectedFy}.
              </div>
            ) : (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 font-medium">
                    <th className="py-3 px-4 w-20">Rank</th>
                    <th className="py-3 px-4">Member</th>
                    <th className="py-3 px-4">Member #</th>
                    <th className="py-3 px-4 text-right">FY Giving Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {activeLeaderboard.top_10.map((entry, idx) => (
                    <tr
                      key={`${entry.rank}-${idx}`}
                      className={
                        entry.is_self
                          ? 'bg-sky-500/10 text-white'
                          : 'hover:bg-slate-800/30 transition-colors'
                      }
                    >
                      <td className="py-3.5 px-4 font-mono tabular-nums font-bold text-amber-400">
                        #{entry.rank}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="font-medium text-white">{entry.display_name}</span>
                        {entry.is_self && (
                          <span className="text-sky-400 font-medium">
                            <span className="mx-1.5 text-slate-600">&middot;</span>You
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-slate-400">
                        {entry.display_member_number}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-white">
                        {formatINR(Number(entry.total_amount))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </main>
    </div>
  );
};
