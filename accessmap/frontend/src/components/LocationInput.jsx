import React, { useState, useEffect, useRef } from 'react';
import { Search, X, Loader2, MapPin } from 'lucide-react';
import { searchSuggestions } from '../api/client';

export default function LocationInput({
  icon: Icon,
  iconColor,
  iconBg,
  point,
  placeholder,
  onSelect,
  onClear,
  onFocus,
}) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const debounceTimer = useRef(null);

  // If a point was selected via map click or external state, format the display
  useEffect(() => {
    if (point) {
      if (!query || query.startsWith('📍') || query.startsWith('🏁') || query.includes('(')) {
        setQuery(`📍 ${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`);
      }
    } else {
      setQuery('');
    }
  }, [point]);

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    setActiveIndex(-1);

    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    if (val.trim().length >= 2) {
      setIsLoading(true);
      debounceTimer.current = setTimeout(async () => {
        try {
          const results = await searchSuggestions(val);
          setSuggestions(results);
          setIsOpen(results.length > 0);
        } catch (err) {
          console.error('Autocomplete error:', err);
        } finally {
          setIsLoading(false);
        }
      }, 250);
    } else {
      setSuggestions([]);
      setIsOpen(false);
      setIsLoading(false);
    }
  };

  const handleSelectSuggestion = (item) => {
    setQuery(item.displayName.split(',')[0]); // show primary name in input
    setIsOpen(false);
    setSuggestions([]);
    if (onSelect) {
      onSelect({ lat: item.lat, lng: item.lng, displayName: item.displayName });
    }
  };

  const handleClear = () => {
    setQuery('');
    setSuggestions([]);
    setIsOpen(false);
    if (onClear) onClear();
    if (inputRef.current) inputRef.current.focus();
  };

  const handleKeyDown = (e) => {
    if (!isOpen || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < suggestions.length) {
        handleSelectSuggestion(suggestions[activeIndex]);
      } else if (suggestions.length > 0) {
        handleSelectSuggestion(suggestions[0]);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {/* Left icon badge */}
        <div style={{
          width: 38,
          height: 38,
          borderRadius: '50%',
          background: iconBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          <Icon size={18} color={iconColor} />
        </div>

        {/* Input box */}
        <div style={{
          flex: 1,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
        }}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleInputChange}
            onFocus={() => {
              if (onFocus) onFocus();
              if (suggestions.length > 0 && query.trim().length >= 2) setIsOpen(true);
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            style={{
              width: '100%',
              padding: '11px 40px 11px 14px',
              fontSize: 14,
              borderRadius: 12,
              border: isOpen ? `2px solid ${iconColor}` : '2px solid #e5e7eb',
              outline: 'none',
              fontFamily: 'inherit',
              transition: 'all 0.15s ease',
              background: '#f9fafb',
              boxSizing: 'border-box',
            }}
          />

          {/* Right action indicator (loader or clear button) */}
          <div style={{ position: 'absolute', right: 12, display: 'flex', alignItems: 'center' }}>
            {isLoading ? (
              <Loader2 size={16} color="#9ca3af" style={{ animation: 'spin 1s linear infinite' }} />
            ) : query ? (
              <button
                type="button"
                onClick={handleClear}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 2,
                  display: 'flex',
                  alignItems: 'center',
                  color: '#9ca3af',
                }}
              >
                <X size={16} />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* Autocomplete Dropdown List */}
      {isOpen && suggestions.length > 0 && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          left: 48,
          right: 0,
          background: 'white',
          borderRadius: 14,
          border: '1px solid #e5e7eb',
          boxShadow: '0 12px 30px rgba(0,0,0,0.15)',
          zIndex: 2000,
          overflow: 'hidden',
          maxHeight: 260,
          overflowY: 'auto',
          animation: 'fadeIn 0.15s ease-out',
        }}>
          {suggestions.map((item, idx) => {
            const parts = item.displayName.split(',');
            const primaryTitle = parts[0];
            const secondaryTitle = parts.slice(1).join(',').trim();
            const isActive = idx === activeIndex;

            return (
              <div
                key={`${item.lat}-${item.lng}-${idx}`}
                onClick={() => handleSelectSuggestion(item)}
                onMouseEnter={() => setActiveIndex(idx)}
                style={{
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  cursor: 'pointer',
                  background: isActive ? '#eff6ff' : 'transparent',
                  borderBottom: idx < suggestions.length - 1 ? '1px solid #f3f4f6' : 'none',
                  transition: 'background 0.1s ease',
                }}
              >
                <MapPin size={16} color={isActive ? '#2563eb' : '#9ca3af'} style={{ marginTop: 2, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: isActive ? '#1d4ed8' : '#1f2937',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {primaryTitle}
                  </div>
                  {secondaryTitle && (
                    <div style={{
                      fontSize: 11,
                      color: '#6b7280',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      marginTop: 1,
                    }}>
                      {secondaryTitle}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
