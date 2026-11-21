import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import type { Member } from '../../types/database';
import { buildMemberSearchOrFilter } from '../../lib/domain-logic';
import { Search, X, ChevronDown, Loader2, AlertCircle, UserCheck } from 'lucide-react';

interface MemberSearchComboboxProps {
  churchId: string;
  selectedMember: Member | null;
  onSelectMember: (member: Member) => void;
  onClearMember: () => void;
  disabled?: boolean;
  inputId?: string;
}

const MEMBER_SELECT_COLUMNS =
  'id, church_id, member_number, full_name, contact_phone, village_name, gender, date_of_birth, joining_date, membership_status, created_at, updated_at, created_by, updated_by';

export const MemberSearchCombobox: React.FC<MemberSearchComboboxProps> = ({
  churchId,
  selectedMember,
  onSelectMember,
  onClearMember,
  disabled = false,
  inputId = 'member-combobox-input',
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [results, setResults] = useState<Member[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const requestCounterRef = useRef(0);
  const hasLoadedInitialRef = useRef(false);

  const fetchSavedMembers = useCallback(
    async (queryText: string) => {
      if (!supabase || !churchId) {
        setResults([]);
        setIsSearching(false);
        return;
      }

      const requestId = ++requestCounterRef.current;
      setIsSearching(true);
      setSearchError(null);

      try {
        let query = supabase
          .from('members')
          .select(MEMBER_SELECT_COLUMNS)
          .eq('church_id', churchId);

        const orFilter = buildMemberSearchOrFilter(queryText);
        if (orFilter) {
          query = query.or(orFilter);
        }

        const { data, error } = await query
          .order('full_name', { ascending: true })
          .limit(30);

        if (requestId !== requestCounterRef.current) return;

        if (error) {
          setSearchError(error.message || 'Unable to load saved members.');
          setResults([]);
        } else {
          setResults((data as Member[]) || []);
          setHighlightedIndex(0);
          if (!orFilter) {
            hasLoadedInitialRef.current = true;
          }
        }
      } catch (err: unknown) {
        if (requestId !== requestCounterRef.current) return;
        setSearchError(
          err instanceof Error ? err.message : 'Unable to search saved members.'
        );
        setResults([]);
      } finally {
        if (requestId === requestCounterRef.current) {
          setIsSearching(false);
        }
      }
    },
    [churchId]
  );

  // Reset internal search state when active church changes
  useEffect(() => {
    requestCounterRef.current += 1;
    hasLoadedInitialRef.current = false;
    setSearchTerm('');
    setResults([]);
    setIsOpen(false);
    setSearchError(null);
    setHighlightedIndex(0);
  }, [churchId]);

  // Debounced live database lookup while typing (only when dropdown is open and no member is locked)
  useEffect(() => {
    if (!isOpen || selectedMember) return;

    const trimmed = searchTerm.trim();
    if (!trimmed) {
      if (!hasLoadedInitialRef.current) {
        void fetchSavedMembers('');
      }
      return;
    }

    const timer = setTimeout(() => {
      void fetchSavedMembers(trimmed);
    }, 180);

    return () => clearTimeout(timer);
  }, [searchTerm, isOpen, selectedMember, fetchSavedMembers]);

  // Close dropdown on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen]);

  // Keep keyboard-highlighted row scrolled cleanly into view
  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const activeItem = listRef.current.children[highlightedIndex] as
      | HTMLElement
      | undefined;
    if (activeItem) {
      activeItem.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIndex, isOpen]);

  const handleOpenOnFocus = () => {
    if (disabled || selectedMember) return;
    setIsOpen(true);
    if (!searchTerm.trim() && (!hasLoadedInitialRef.current || results.length === 0)) {
      void fetchSavedMembers('');
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = e.target.value;
    setSearchTerm(nextValue);
    setHighlightedIndex(0);
    if (!isOpen) {
      setIsOpen(true);
    }
    if (!nextValue.trim()) {
      void fetchSavedMembers('');
    }
  };

  const handlePickMember = (member: Member) => {
    onSelectMember(member);
    setSearchTerm('');
    setIsOpen(false);
    setSearchError(null);
  };

  const handleClearSelection = () => {
    onClearMember();
    setSearchTerm('');
    setSearchError(null);
    setHighlightedIndex(0);
    setIsOpen(true);
    void fetchSavedMembers('');
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        if (!results.length) {
          void fetchSavedMembers(searchTerm.trim());
        }
        return;
      }
      if (results.length > 0) {
        setHighlightedIndex((prev) => (prev + 1) % results.length);
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      if (results.length > 0) {
        setHighlightedIndex((prev) =>
          prev <= 0 ? results.length - 1 : prev - 1
        );
      }
      return;
    }

    if (e.key === 'Enter' && isOpen) {
      if (results.length > 0 && highlightedIndex >= 0 && highlightedIndex < results.length) {
        e.preventDefault();
        handlePickMember(results[highlightedIndex]);
      }
      return;
    }

    if (e.key === 'Escape') {
      if (isOpen) {
        e.preventDefault();
        setIsOpen(false);
      }
      return;
    }

    if (e.key === 'Tab') {
      setIsOpen(false);
    }
  };

  const listboxId = `${inputId}-listbox`;

  if (selectedMember) {
    return (
      <div
        ref={containerRef}
        className="w-full bg-slate-950 border border-sky-500/50 rounded-xl px-3.5 py-2.5 min-h-[46px] flex items-center justify-between gap-3 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <UserCheck className="w-4 h-4 text-sky-400 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate">
              {selectedMember.full_name}
            </p>
            <p className="text-xs text-slate-400 flex items-center gap-1.5 truncate">
              <span className="font-mono tabular-nums text-sky-300">
                {selectedMember.member_number}
              </span>
              {selectedMember.village_name && (
                <>
                  <span aria-hidden="true">&middot;</span>
                  <span className="truncate">{selectedMember.village_name}</span>
                </>
              )}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleClearSelection}
          disabled={disabled}
          aria-label={`Clear selected member ${selectedMember.full_name}`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-slate-600 transition-colors shrink-0 whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Clear</span>
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative flex items-center">
        <Search
          className="w-4 h-4 text-slate-500 absolute left-3.5 pointer-events-none"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-activedescendant={
            isOpen && results[highlightedIndex]
              ? `${listboxId}-option-${results[highlightedIndex].id}`
              : undefined
          }
          autoComplete="off"
          disabled={disabled}
          value={searchTerm}
          onFocus={handleOpenOnFocus}
          onClick={handleOpenOnFocus}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Type member name, number, or village..."
          className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-10 pr-16 py-2.5 min-h-[44px] text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500/40 disabled:opacity-50 disabled:cursor-not-allowed"
        />

        <div className="absolute right-2.5 flex items-center gap-1">
          {searchTerm && (
            <button
              type="button"
              onClick={() => {
                setSearchTerm('');
                setHighlightedIndex(0);
                setIsOpen(true);
                void fetchSavedMembers('');
                inputRef.current?.focus();
              }}
              aria-label="Clear search text"
              className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
          {isSearching ? (
            <Loader2
              className="w-4 h-4 text-sky-400 animate-spin mr-1"
              aria-label="Searching saved members"
            />
          ) : (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => {
                if (disabled) return;
                const nextOpen = !isOpen;
                setIsOpen(nextOpen);
                if (nextOpen) {
                  inputRef.current?.focus();
                  if (!results.length && !searchTerm.trim()) {
                    void fetchSavedMembers('');
                  }
                }
              }}
              aria-label={isOpen ? 'Close member list' : 'Open member list'}
              className="p-1 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
            >
              <ChevronDown
                className={`w-4 h-4 transition-transform duration-150 ${
                  isOpen ? 'rotate-180' : ''
                }`}
                aria-hidden="true"
              />
            </button>
          )}
        </div>
      </div>

      {isOpen && (
        <div className="absolute z-30 left-0 right-0 mt-1.5 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
          {searchError ? (
            <div className="p-3.5 flex items-center justify-between gap-3 text-xs text-red-300">
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" aria-hidden="true" />
                <span className="truncate">{searchError}</span>
              </div>
              <button
                type="button"
                onClick={() => void fetchSavedMembers(searchTerm.trim())}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 shrink-0 cursor-pointer"
              >
                Retry
              </button>
            </div>
          ) : isSearching && results.length === 0 ? (
            <div className="px-4 py-3.5 text-xs text-slate-400 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" aria-hidden="true" />
              <span>Searching saved church members...</span>
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-4 text-xs text-slate-400 flex items-center justify-between gap-3">
              <span>
                {searchTerm.trim()
                  ? `No saved member found matching "${searchTerm.trim()}".`
                  : 'No saved members found for this church.'}
              </span>
              {searchTerm.trim() && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm('');
                    void fetchSavedMembers('');
                    inputRef.current?.focus();
                  }}
                  className="text-sky-400 hover:text-sky-300 font-medium whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Clear search
                </button>
              )}
            </div>
          ) : (
            <ul
              ref={listRef}
              id={listboxId}
              role="listbox"
              aria-label="Saved church members"
              className="max-h-64 overflow-y-auto divide-y divide-slate-800/80"
            >
              {results.map((member, index) => {
                const isHighlighted = index === highlightedIndex;
                return (
                  <li
                    key={member.id}
                    id={`${listboxId}-option-${member.id}`}
                    role="option"
                    aria-selected={isHighlighted}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onMouseDown={(e) => {
                      // Prevent input blur before selection completes
                      e.preventDefault();
                      handlePickMember(member);
                    }}
                    className={`px-3.5 py-2.5 min-h-[44px] flex items-center justify-between gap-3 cursor-pointer transition-colors duration-100 ${
                      isHighlighted
                        ? 'bg-sky-500/15 text-white'
                        : 'text-slate-200 hover:bg-slate-800/70'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-white truncate">
                        {member.full_name}
                      </p>
                      <p className="text-xs text-slate-400 flex items-center gap-1.5 truncate mt-0.5">
                        <span className="font-mono tabular-nums text-sky-300">
                          {member.member_number}
                        </span>
                        {member.village_name && (
                          <>
                            <span aria-hidden="true">&middot;</span>
                            <span className="truncate">{member.village_name}</span>
                          </>
                        )}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {results.length > 0 && (
            <div className="px-3.5 py-1.5 bg-slate-950/90 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-500">
              <span>
                {isSearching
                  ? 'Updating saved matches...'
                  : `Showing ${results.length} saved member${results.length === 1 ? '' : 's'}`}
              </span>
              <span className="hidden sm:inline">Use &uarr; &darr; and Enter to select</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
