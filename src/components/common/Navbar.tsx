import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getFinancialYear } from '../../lib/domain-logic';
import {
  Church as ChurchIcon,
  ChevronDown,
  LogOut,
  User,
  Shield,
  Calendar,
  Menu,
  X,
  Building2,
  Check,
} from 'lucide-react';

interface NavbarProps {
  onMobileMenuToggle: () => void;
  isMobileMenuOpen: boolean;
  onNavigateToProfile: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onMobileMenuToggle,
  isMobileMenuOpen,
  onNavigateToProfile,
}) => {
  const {
    user,
    profile,
    activeChurch,
    authorizedChurches,
    activeRole,
    isPlatformAdmin,
    setActiveChurchId,
    signOut,
  } = useAuth();

  const [isChurchMenuOpen, setIsChurchMenuOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);

  const currentFY = getFinancialYear(new Date());

  const getRoleBadgeStyle = (role: string) => {
    switch (role) {
      case 'platform_admin':
        return 'bg-purple-500/20 text-purple-300 border-purple-500/30';
      case 'admin':
        return 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30';
      case 'accountant':
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
      case 'collector':
        return 'bg-sky-500/20 text-sky-300 border-sky-500/30';
      case 'member':
        return 'bg-slate-700/50 text-slate-300 border-slate-600';
      default:
        return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
    }
  };

  const formatRoleLabel = (role: string) => {
    switch (role) {
      case 'platform_admin':
        return 'Platform Admin';
      case 'admin':
        return 'Church Admin';
      case 'accountant':
        return 'Accountant';
      case 'collector':
        return 'Collector';
      case 'member':
        return 'Member';
      default:
        return 'Pending / No Role';
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur border-b border-slate-800">
      <div className="px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        {/* Left: Mobile Toggle & Brand */}
        <div className="flex items-center gap-3">
          <button
            onClick={onMobileMenuToggle}
            aria-label={isMobileMenuOpen ? 'Close Navigation Menu' : 'Open Navigation Menu'}
            className="md:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400">
              <ChurchIcon className="w-5 h-5" />
            </div>
            <div className="hidden sm:block">
              <span className="font-bold text-sm text-white tracking-tight">
                Church Management System
              </span>
              <span className="text-[10px] text-slate-400 block -mt-0.5">
                Multi-Church &bull; Verified Records
              </span>
            </div>
          </div>
        </div>

        {/* Center: Church Switcher (strictly authorized churches only) */}
        <div className="relative">
          {authorizedChurches.length > 0 ? (
            <div>
              <button
                onClick={() => setIsChurchMenuOpen(!isChurchMenuOpen)}
                aria-haspopup="true"
                aria-expanded={isChurchMenuOpen}
                className="flex items-center gap-2 bg-slate-800/80 hover:bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 transition-colors"
              >
                <Building2 className="w-4 h-4 text-sky-400 shrink-0" />
                <span className="font-medium max-w-[140px] sm:max-w-[220px] truncate text-left">
                  {activeChurch ? activeChurch.name : 'Select Church'}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              {isChurchMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setIsChurchMenuOpen(false)}
                  />
                  <div className="absolute left-0 sm:left-auto sm:right-0 mt-2 w-72 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-1.5 z-50 animate-in fade-in zoom-in-95">
                    <div className="px-2.5 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      Authorized Churches ({authorizedChurches.length})
                    </div>
                    <div className="max-h-60 overflow-y-auto space-y-0.5">
                      {authorizedChurches.map((church) => {
                        const isSelected = activeChurch?.id === church.id;
                        return (
                          <button
                            key={church.id}
                            onClick={() => {
                              setActiveChurchId(church.id);
                              setIsChurchMenuOpen(false);
                            }}
                            className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between transition-colors ${
                              isSelected
                                ? 'bg-sky-500/15 text-sky-300 font-semibold border border-sky-500/30'
                                : 'text-slate-300 hover:bg-slate-800'
                            }`}
                          >
                            <div className="truncate pr-2">
                              <div className="truncate">{church.name}</div>
                              <span className="text-[10px] text-slate-400 font-mono">
                                Code: {church.code}
                              </span>
                            </div>
                            {isSelected && <Check className="w-4 h-4 text-sky-400 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 px-3 py-1 rounded-lg">
              Pending Church Approval
            </div>
          )}
        </div>

        {/* Right: Badges & Profile Dropdown */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Financial Year Badge */}
          <div className="hidden lg:flex items-center gap-1.5 bg-slate-800/60 border border-slate-700/60 px-2.5 py-1 rounded-lg text-[11px] font-mono text-slate-300">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span>{currentFY.label}</span>
          </div>

          {/* Role Badge */}
          <div
            className={`border px-2.5 py-1 rounded-lg text-[11px] font-medium tracking-wide flex items-center gap-1.5 ${getRoleBadgeStyle(
              activeRole
            )}`}
          >
            <Shield className="w-3 h-3" />
            <span>{formatRoleLabel(activeRole)}</span>
          </div>

          {/* User Menu */}
          <div className="relative">
            <button
              onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
              aria-label="User profile menu"
              aria-haspopup="true"
              aria-expanded={isProfileMenuOpen}
              className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 hover:text-white hover:border-slate-600 transition-colors"
            >
              <User className="w-4 h-4" />
            </button>

            {isProfileMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setIsProfileMenuOpen(false)}
                />
                <div className="absolute right-0 mt-2 w-60 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-2 z-50 animate-in fade-in zoom-in-95">
                  <div className="px-3 py-2 border-b border-slate-800 mb-1">
                    <p className="text-xs font-semibold text-white truncate">
                      {profile?.full_name || 'Member'}
                    </p>
                    <p className="text-[11px] text-slate-400 font-mono truncate">
                      {user?.email}
                    </p>
                    {isPlatformAdmin && (
                      <span className="inline-block mt-1 text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded border border-purple-500/30">
                        Platform Administrator
                      </span>
                    )}
                  </div>

                  <button
                    onClick={() => {
                      setIsProfileMenuOpen(false);
                      onNavigateToProfile();
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg text-xs text-slate-300 hover:text-white hover:bg-slate-800 flex items-center gap-2 transition-colors"
                  >
                    <User className="w-3.5 h-3.5" />
                    My Member Profile
                  </button>

                  <button
                    onClick={() => {
                      setIsProfileMenuOpen(false);
                      signOut();
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 flex items-center gap-2 transition-colors"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Sign Out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
