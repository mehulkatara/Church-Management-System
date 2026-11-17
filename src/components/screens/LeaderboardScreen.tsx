import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import {
  calculateRankings,
  formatINR,
  getFinancialYearOptions,
  DonorRankingInput,
  DonorRankedOutput,
} from '../../lib/domain-logic';
import { Trophy, Sparkles } from 'lucide-react';

export const LeaderboardScreen: React.FC = () => {
  const { activeChurch, user } = useAuth();

  const fyOptions = getFinancialYearOptions(5);
  const [selectedFy, setSelectedFy] = useState(fyOptions[0].fyCode);
  const [rankings, setRankings] = useState<DonorRankedOutput[]>([]);
  const [currentMemberId, setCurrentMemberId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const currentFyInfo = fyOptions.find((f) => f.fyCode === selectedFy) || fyOptions[0];

  useEffect(() => {
    if (!supabase || !activeChurch) return;

    const fetchLeaderboard = async () => {
      setIsLoading(true);
      try {
        // 1. If logged in as member, find own member_id
        if (user) {
          const { data: link } = await supabase
            .from('member_account_links')
            .select('member_id')
            .eq('church_id', activeChurch.id)
            .eq('user_id', user.id)
            .maybeSingle();

          if (link) setCurrentMemberId(link.member_id);
        }

        // 2. Fetch all valid non-deleted donations for this church in this FY
        const { data: donations, error } = await supabase
          .from('donations')
          .select(`
            amount,
            donation_date,
            member_id,
            member:members(id, full_name, member_number, membership_status)
          `)
          .eq('church_id', activeChurch.id)
          .is('deleted_at', null)
          .gte('donation_date', currentFyInfo.startDate)
          .lte('donation_date', currentFyInfo.endDate);

        if (error) throw error;

        // Group by member
        const memberTotalsMap = new Map<string, DonorRankingInput>();

        for (const d of donations || []) {
          const m = d.member as unknown as {
            id: string;
            full_name: string;
            member_number: string;
            membership_status: string;
          } | null;
          if (!m) continue;

          const existing = memberTotalsMap.get(m.id) || {
            memberId: m.id,
            memberName: m.full_name,
            memberNumber: m.member_number,
            totalAmount: 0,
            isActive: m.membership_status === 'active',
          };

          existing.totalAmount += Number(d.amount);
          memberTotalsMap.set(m.id, existing);
        }

        // Compute competition ranking (1, 2, 2, 4)
        const computed = calculateRankings(Array.from(memberTotalsMap.values()));
        setRankings(computed);
      } catch (err) {
        console.error('Error calculating leaderboard:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchLeaderboard();
  }, [activeChurch, selectedFy, user, currentFyInfo.startDate, currentFyInfo.endDate]);

  const top10 = rankings.slice(0, 10);
  const currentMemberRankObj = currentMemberId
    ? rankings.find((r) => r.memberId === currentMemberId)
    : null;

  const getRankBadge = (rank: number) => {
    if (rank === 1) {
      return (
        <span className="w-6 h-6 rounded-full bg-amber-500/20 text-amber-300 font-bold text-xs tabular-nums flex items-center justify-center border border-amber-500/40">
          1
        </span>
      );
    }
    if (rank === 2) {
      return (
        <span className="w-6 h-6 rounded-full bg-slate-300/20 text-slate-200 font-bold text-xs tabular-nums flex items-center justify-center border border-slate-300/40">
          2
        </span>
      );
    }
    if (rank === 3) {
      return (
        <span className="w-6 h-6 rounded-full bg-amber-700/20 text-amber-500 font-bold text-xs tabular-nums flex items-center justify-center border border-amber-700/40">
          3
        </span>
      );
    }
    return (
      <span className="w-6 h-6 rounded-full bg-slate-800 text-slate-400 font-mono tabular-nums text-xs flex items-center justify-center">
        {rank}
      </span>
    );
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-400" />
            <span>Church Giving Leaderboard</span>
          </h1>
          <p className="text-xs text-slate-400">
            Church: <strong className="text-slate-200">{activeChurch?.name}</strong> &bull;{' '}
            <span className="font-mono">{currentFyInfo.label}</span>
          </p>
        </div>

        {/* Financial Year Selector */}
        <select
          value={selectedFy}
          onChange={(e) => setSelectedFy(e.target.value)}
          className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
        >
          {fyOptions.map((f) => (
            <option key={f.fyCode} value={f.fyCode}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {/* Current User's Personal Rank Card */}
      <div className="bg-gradient-to-r from-sky-950/40 via-slate-900 to-slate-900 border border-sky-500/30 rounded-2xl p-5 shadow-xl flex items-center justify-between">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[11px] text-slate-400 font-mono tracking-wider block">
              Your Personal Standing
            </span>
            <h2 className="text-base font-bold text-white">
              {currentMemberRankObj ? (
                <span>
                  Rank <strong className="text-sky-400 tabular-nums">#{currentMemberRankObj.rank}</strong> in{' '}
                  {currentFyInfo.label}
                </span>
              ) : (
                <span className="text-slate-400">Not ranked (No qualifying donations this FY)</span>
              )}
            </h2>
            {currentMemberRankObj && (
              <span className="text-xs text-emerald-400 font-mono tabular-nums">
                Total Giving: {formatINR(currentMemberRankObj.totalAmount)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Leaderboard Table (Top 10 Summary) */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <div>
            <h3 className="text-xs font-semibold text-white tracking-tight">
              Top Contributors ({currentFyInfo.label})
            </h3>
            <span className="text-[10px] text-slate-500">
              Competition ranking (1, 2, 2, 4). Includes valid non-deleted donations.
            </span>
          </div>
          <span className="text-[11px] text-slate-400 font-mono tabular-nums">
            {rankings.length} Qualifying Donors
          </span>
        </div>

        <div className="divide-y divide-slate-800/60 text-xs">
          {isLoading ? (
            <div className="py-8 text-center text-slate-500">Calculating rankings...</div>
          ) : top10.length === 0 ? (
            <div className="py-8 text-center text-slate-500">
              No donations recorded for {currentFyInfo.label} yet.
            </div>
          ) : (
            top10.map((donor) => {
              const isSelf = currentMemberId === donor.memberId;
              return (
                <div
                  key={donor.memberId}
                  className={`px-5 py-3.5 flex items-center justify-between hover:bg-slate-800/40 transition-colors ${
                    isSelf ? 'bg-sky-500/10' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {getRankBadge(donor.rank)}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white">{donor.memberName}</span>
                        {isSelf && (
                          <span className="text-sky-300 font-medium">
                            &middot; You
                          </span>
                        )}
                        {!donor.isActive && (
                          <span className="text-slate-400">
                            &middot; Historical
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono tabular-nums">
                        Rank #{donor.rank} &middot; {donor.memberNumber}
                      </span>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="font-mono tabular-nums font-bold text-emerald-400 text-sm">
                      {formatINR(donor.totalAmount)}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Note */}
        <div className="p-3 bg-slate-950/60 border-t border-slate-800 text-[11px] text-slate-500">
          Leaderboard ties depend on donation total only. Secondary ordering is stable.
        </div>
      </div>
    </div>
  );
};
