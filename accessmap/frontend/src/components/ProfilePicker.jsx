import React from 'react';
import { PersonStanding, EyeOff, Navigation } from 'lucide-react'; // Using Navigation as a wheelchair proxy if icon missing

const PROFILES = [
    { id: 'wheelchair', label: 'Wheelchair', icon: Navigation },
    { id: 'limited_mobility', label: 'Mobility', icon: PersonStanding },
    { id: 'low_vision', label: 'Vision', icon: EyeOff },
];

export default function ProfilePicker({ selected, onSelect }) {
    return (
        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
            <legend className="sr-only">Select your routing profile</legend>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between' }}>
                {PROFILES.map((p) => {
                    const Icon = p.icon;
                    const isActive = selected === p.id;
                    return (
                        <button
                            key={p.id}
                            onClick={() => onSelect(p.id)}
                            aria-pressed={isActive}
                            aria-label={`${p.label} profile`}
                            style={{
                                flex: 1, padding: '12px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center',
                                gap: '4px', borderRadius: '12px', border: isActive ? '3px solid #2563eb' : '2px solid #ccc',
                                background: isActive ? '#eff6ff' : 'white', fontWeight: 'bold', fontSize: '14px',
                                color: isActive ? '#1d4ed8' : '#4b5563', cursor: 'pointer', minHeight: '64px'
                            }}
                        >
                            <Icon size={24} />
                            {p.label}
                        </button>
                    );
                })}
            </div>
        </fieldset>
    );
}