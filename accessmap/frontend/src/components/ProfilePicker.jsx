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
              border: isActive ? '2px solid #2563eb' : '2px solid #f3f4f6',
              background: isActive ? '#eff6ff' : '#f9fafb',
              color: isActive ? '#1d4ed8' : '#4b5563',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              fontFamily: 'inherit',
              transition: 'all 0.15s ease',
              boxShadow: isActive ? '0 4px 12px rgba(37, 99, 235, 0.12)' : 'none',
            }}
          >
            <Icon size={20} color={isActive ? '#2563eb' : '#6b7280'} />
            <span style={{ fontSize: 13, fontWeight: 700, lineHeight: 1 }}>{p.label}</span>
            <span style={{ fontSize: 10, color: isActive ? '#3b82f6' : '#9ca3af', lineHeight: 1 }}>
              {p.subtitle}
            </span>
          </button>
        );
      })}
    </div>
  );
}
