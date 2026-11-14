import React from 'react';
import { Accessibility, Footprints, Eye } from 'lucide-react';

const PROFILES = [
  {
    id: 'wheelchair',
    label: 'Wheelchair',
    subtitle: 'Ramps, zero steps',
    icon: Accessibility,
  },
  {
    id: 'limited_mobility',
    label: 'Mobility',
    subtitle: 'Avoid steep slopes',
    icon: Footprints,
  },
  {
    id: 'low_vision',
    label: 'Low Vision',
    subtitle: 'Audible / high tactile',
    icon: Eye,
  },
];

export default function ProfilePicker({ selected, onSelect }) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      {PROFILES.map((p) => {
        const Icon = p.icon;
        const isActive = selected === p.id;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            style={{
              flex: 1,
              padding: '10px 12px',
              borderRadius: 14,
              border: isActive ? '2px solid #1D4ED8' : '2px solid #F1F5F9',
              background: isActive ? '#EFF6FF' : '#F8FAFC',
              color: isActive ? '#1D4ED8' : '#475569',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              fontFamily: 'inherit',
              transition: 'all 0.15s ease',
              boxShadow: isActive ? '0 4px 12px rgba(29, 78, 216, 0.12)' : 'none',
            }}
          >
            <Icon size={20} color={isActive ? '#1D4ED8' : '#64748B'} />
            <span style={{ fontSize: 13, fontWeight: 700, lineHeight: 1 }}>{p.label}</span>
            <span style={{ fontSize: 10, color: isActive ? '#1D4ED8' : '#94A3B8', lineHeight: 1 }}>
              {p.subtitle}
            </span>
          </button>
        );
      })}
    </div>
  );
}
