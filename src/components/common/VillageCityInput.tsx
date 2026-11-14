import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { MapPin, ChevronDown, Plus, Check, Database } from 'lucide-react';
import { filterVillageSuggestions } from '../../lib/domain-logic';

interface VillageCityInputProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  onAddNewVillage?: (newVillage: string) => void;
  disabled?: boolean;
  required?: boolean;
  hasError?: boolean;
  placeholder?: string;
  className?: string;
  compact?: boolean;
}

export const VillageCityInput: React.FC<VillageCityInputProps> = ({
  id,
  value,
  onChange,
  suggestions,
  onAddNewVillage,
  disabled = false,
  required = false,
  hasError = false,
  placeholder = 'Select or type village / city...',
  className = '',
  compact = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showAllOnOpen, setShowAllOnOpen] = useState(true);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [dropdownRect, setDropdownRect] = useState<{
    top: number;
    left: number;
    width: number;
    openUpward: boolean;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const queryForFilter = showAllOnOpen ? '' : value;
  const { matches, canAddNew, trimmedQuery } = filterVillageSuggestions(suggestions, queryForFilter);
  const exactCheck = filterVillageSuggestions(suggestions, value);
  const showAddNewOption = exactCheck.canAddNew && exactCheck.trimmedQuery.length > 0;
  const newEntryLabel = exactCheck.trimmedQuery;

  const totalOptions = matches.length + (showAddNewOption ? 1 : 0);

  const updatePosition = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUpward = spaceBelow < 210 && spaceAbove > spaceBelow;

    setDropdownRect({
      top: openUpward ? rect.top - 6 : rect.bottom + 6,
      left: rect.left,
      width: Math.max(rect.width, 220),
      openUpward,
    });
  }, []);

  useEffect(() => {
    if (!isOpen || disabled) return;
    updatePosition();

    const handleScrollOrResize = () => updatePosition();
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [isOpen, disabled, updatePosition]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        (!dropdownRef.current || !dropdownRef.current.contains(target))
      ) {
        setIsOpen(false);
        setHighlightedIndex(-1);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const selectExisting = (item: string) => {
    onChange(item);
    setIsOpen(false);
    setShowAllOnOpen(true);
    setHighlightedIndex(-1);
  };

  const selectAddNew = (newEntry: string) => {
    const cleaned = newEntry.trim().replace(/\s+/g, ' ');
    if (!cleaned) return;
    onChange(cleaned);
    if (onAddNewVillage) {
      onAddNewVillage(cleaned);
    }
    setIsOpen(false);
    setShowAllOnOpen(true);
    setHighlightedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;

    if (!isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setIsOpen(true);
      setHighlightedIndex(0);
      return;
    }

    if (!isOpen) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (totalOptions > 0) {
        setHighlightedIndex((prev) => (prev + 1) % totalOptions);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (totalOptions > 0) {
        setHighlightedIndex((prev) => (prev <= 0 ? totalOptions - 1 : prev - 1));
      }
    } else if (e.key === 'Enter' && highlightedIndex >= 0 && highlightedIndex < totalOptions) {
      e.preventDefault();
      if (highlightedIndex < matches.length) {
        selectExisting(matches[highlightedIndex]);
      } else if (showAddNewOption) {
        selectAddNew(newEntryLabel);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setIsOpen(false);
      setHighlightedIndex(-1);
    }
  };

  const inputPaddingClasses = compact
    ? 'pl-7 pr-7 py-1 text-xs rounded-lg'
    : 'pl-9 pr-9 py-2 text-xs rounded-xl';

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative flex items-center">
        <MapPin
          className={`${
            compact ? 'w-3.5 h-3.5 left-2' : 'w-4 h-4 left-3'
          } text-slate-500 absolute pointer-events-none`}
        />
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-autocomplete="list"
          autoComplete="off"
          value={value}
          disabled={disabled}
          required={required}
          placeholder={placeholder}
          onFocus={() => {
            if (disabled) return;
            setShowAllOnOpen(true);
            setIsOpen(true);
            setHighlightedIndex(-1);
          }}
          onChange={(e) => {
            onChange(e.target.value);
            setShowAllOnOpen(false);
            if (!isOpen) setIsOpen(true);
            setHighlightedIndex(-1);
          }}
          onKeyDown={handleKeyDown}
          className={`w-full bg-slate-950 border ${
            hasError ? 'border-red-500' : 'border-slate-700'
          } disabled:opacity-50 disabled:cursor-not-allowed ${inputPaddingClasses} text-white placeholder-slate-500 focus:outline-none focus:border-sky-500`}
        />
        {!disabled && (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Toggle village / city suggestions"
            onMouseDown={(e) => {
              e.preventDefault();
              if (isOpen) {
                setIsOpen(false);
              } else {
                setShowAllOnOpen(true);
                setIsOpen(true);
                inputRef.current?.focus();
              }
            }}
            className={`absolute ${
              compact ? 'right-1.5 p-0.5' : 'right-2.5 p-1'
            } text-slate-400 hover:text-white rounded transition-colors`}
          >
            <ChevronDown
              className={`${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} transition-transform ${
                isOpen ? 'rotate-180 text-sky-400' : ''
              }`}
            />
          </button>
        )}
      </div>

      {isOpen &&
        !disabled &&
        dropdownRect &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={dropdownRef}
            role="listbox"
            style={{
              position: 'fixed',
              top: dropdownRect.openUpward ? undefined : dropdownRect.top,
              bottom: dropdownRect.openUpward ? window.innerHeight - dropdownRect.top : undefined,
              left: dropdownRect.left,
              width: dropdownRect.width,
            }}
            className="z-[90] bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden text-xs"
          >
            <div className="px-3 py-1.5 bg-slate-950/90 border-b border-slate-800 flex items-center justify-between text-[10px] text-slate-400">
              <span className="flex items-center gap-1 font-medium">
                <Database className="w-3 h-3 text-sky-400" />
                <span>
                  {matches.length > 0
                    ? `Database Suggestions (${matches.length})`
                    : 'No matching village in database'}
                </span>
              </span>
              {!showAllOnOpen && trimmedQuery && suggestions.length > matches.length && (
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setShowAllOnOpen(true);
                  }}
                  className="text-sky-400 hover:text-sky-300 underline"
                >
                  Show all ({suggestions.length})
                </button>
              )}
            </div>

            <div className="max-h-48 overflow-y-auto divide-y divide-slate-800/50">
              {matches.map((item, idx) => {
                const isSelected = value.trim().toLowerCase() === item.toLowerCase();
                const isHighlighted = highlightedIndex === idx;
                return (
                  <button
                    key={item}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectExisting(item);
                    }}
                    className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 transition-colors ${
                      isHighlighted
                        ? 'bg-sky-500/20 text-white'
                        : isSelected
                        ? 'bg-slate-800/80 text-sky-300'
                        : 'text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <span className="truncate">{item}</span>
                    </span>
                    {isSelected && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                  </button>
                );
              })}

              {showAddNewOption && (
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectAddNew(newEntryLabel);
                  }}
                  className={`w-full text-left px-3 py-2.5 flex items-center gap-2 border-t border-slate-800 transition-colors ${
                    highlightedIndex === matches.length
                      ? 'bg-emerald-500/20 text-emerald-200'
                      : 'bg-emerald-950/30 text-emerald-300 hover:bg-emerald-500/15'
                  }`}
                >
                  <Plus className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="truncate">
                    Add new entry: <strong className="text-white">"{newEntryLabel}"</strong>
                  </span>
                </button>
              )}

              {matches.length === 0 && !showAddNewOption && (
                <div className="px-3 py-3 text-[11px] text-slate-500 text-center">
                  No entries in database yet. Type a village or city name to add it.
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
