import React, { useState } from 'react';
import { Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { upvoteReport } from '../api/client';

// SVG icons for each obstacle category
const OBSTACLE_CONFIGS = {
  BLOCKED_SIDEWALK: {
    label: 'Trotuar blocat / barieră',
    color: '#dc2626',
    bgColor: '#fef2f2',
    borderColor: '#fca5a5',
    svg: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`,
    badgeIcon: '🚫',
  },
  NO_RAMP: {
    label: 'Trepte fără rampă de acces',
    color: '#ea580c',
    bgColor: '#fff7ed',
    borderColor: '#fdba74',
    svg: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19h4v-4h4v-4h4V7h3"/></svg>`,
    badgeIcon: '🪜',
  },
  STAIRS_NO_RAMP: {
    label: 'Trepte fără rampă de acces',
    color: '#ea580c',
    bgColor: '#fff7ed',
    borderColor: '#fdba74',
    svg: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19h4v-4h4v-4h4V7h3"/></svg>`,
    badgeIcon: '🪜',
  },
  BROKEN_ELEVATOR: {
    label: 'Lift / elevator defect',
    color: '#7c3aed',
    bgColor: '#f5f3ff',
    borderColor: '#c4b5fd',
    svg: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><polyline points="9 8 12 5 15 8"/><line x1="12" y1="5" x2="12" y2="12"/><line x1="8" y1="16" x2="16" y2="16"/></svg>`,
    badgeIcon: '🛗',
  },
  POTHOLE: {
    label: 'Groapă / pavaj distrus',
    color: '#d97706',
    bgColor: '#fffbeb',
    borderColor: '#fde68a',
    svg: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16c3-2 5 2 9 0s5-3 9-1"/><circle cx="12" cy="8" r="2.5" fill="white"/></svg>`,
    badgeIcon: '🕳️',
  },
  CONSTRUCTION: {
    label: 'Zonă de șantier / lucrări',
    color: '#b91c1c',
    bgColor: '#fef2f2',
    borderColor: '#fecaca',
    svg: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 3 5 19 19 19"/><line x1="3" y1="21" x2="21" y2="21"/><line x1="8.5" y1="13.5" x2="15.5" y2="13.5"/></svg>`,
    badgeIcon: '🚧',
  },
  OTHER: {
    label: 'Alt obstacol de accesibilitate',
    color: '#475569',
    bgColor: '#f8fafc',
    borderColor: '#cbd5e1',
    svg: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="17" r="1" fill="white"/></svg>`,
    badgeIcon: '⚠️',
  },
};

// Cache generated divIcons so Leaflet doesn't re-create them every render
const iconCache = new Map();

function getCustomObstacleIcon(type) {
  const normType = (type || 'OTHER').toUpperCase();
  if (iconCache.has(normType)) {
    return iconCache.get(normType);
  }

  const cfg = OBSTACLE_CONFIGS[normType] || OBSTACLE_CONFIGS.OTHER;

  const icon = L.divIcon({
    className: `obstacle-pin-${normType.toLowerCase()}`,
    html: `
      <div style="position: relative; width: 38px; height: 46px; display: flex; flex-direction: column; align-items: center; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.32)); transition: transform 0.15s ease;">
        <div style="width: 36px; height: 36px; border-radius: 50%; background: ${cfg.color}; border: 2.5px solid white; display: flex; align-items: center; justify-content: center; box-shadow: inset 0 2px 4px rgba(255,255,255,0.25);">
          ${cfg.svg}
        </div>
        <div style="width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-top: 8px solid ${cfg.color}; margin-top: -1px;"></div>
      </div>
    `,
    iconSize: [38, 46],
    iconAnchor: [19, 46],
    popupAnchor: [0, -44],
  });

  iconCache.set(normType, icon);
  return icon;
}

export default function ReportMarker({ report }) {
  const [upvotes, setUpvotes] = useState(report.upvotes || 1);
  const [voted, setVoted] = useState(false);

  const normType = (report.type || 'OTHER').toUpperCase();
  const cfg = OBSTACLE_CONFIGS[normType] || OBSTACLE_CONFIGS.OTHER;
  const icon = getCustomObstacleIcon(normType);

  const handleUpvote = async (e) => {
    e.stopPropagation();
    if (voted) return;
    setUpvotes((u) => u + 1);
    setVoted(true);
    await upvoteReport(report.id);
  };

  return (
    <Marker position={[report.lat, report.lng]} icon={icon}>
      <Popup>
        <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', minWidth: 200, padding: 2 }}>
          {/* Category Tag */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: cfg.bgColor,
            border: `1px solid ${cfg.borderColor}`,
            padding: '4px 10px',
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 800,
            color: cfg.color,
            marginBottom: 8,
          }}>
            <span>{cfg.badgeIcon}</span>
            <span>{cfg.label}</span>
          </div>

          {/* Description */}
          {report.description && (
            <div style={{ fontSize: 13, color: '#334155', marginBottom: 10, lineHeight: 1.4 }}>
              {report.description}
            </div>
          )}

          {report.authorName && (
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>
              Raportat de: <strong style={{ color: '#1f2937' }}>{report.authorName}</strong>
            </div>
          )}


          {/* Coordinates info */}
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 10 }}>
            📍 {Number(report.lat).toFixed(5)}, {Number(report.lng).toFixed(5)}
          </div>

          {/* Upvote & confirmation action */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTop: '1px solid #f1f5f9',
            paddingTop: 8,
          }}>
            <span style={{ fontSize: 12, color: '#64748b' }}>
              Confirmat de <strong>{upvotes}</strong>
            </span>
            <button
              onClick={handleUpvote}
              disabled={voted}
              style={{
                background: voted ? '#dcfce7' : '#fee2e2',
                color: voted ? '#15803d' : '#991b1b',
                border: 'none',
                padding: '5px 12px',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 700,
                cursor: voted ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                transition: 'all 0.15s ease',
              }}
            >
              {voted ? '✓ Confirmat' : '👍 Confirmă'}
            </button>
          </div>
        </div>
      </Popup>
    </Marker>
  );
}
