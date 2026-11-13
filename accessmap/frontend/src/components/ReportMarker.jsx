import React, { useState } from 'react';
import { Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { upvoteReport } from '../api/client';

const obstacleIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const TYPE_NAMES = {
  BLOCKED_SIDEWALK: '🚧 Blocked Sidewalk',
  STAIRS_NO_RAMP: '🪜 Stairs / No Ramp',
  BROKEN_ELEVATOR: '🛗 Broken Elevator',
  CONSTRUCTION: '⚠️ Construction Zone',
};

export default function ReportMarker({ report }) {
  const [upvotes, setUpvotes] = useState(report.upvotes || 0);
  const [voted, setVoted] = useState(false);

  const handleUpvote = async (e) => {
    e.stopPropagation();
    if (voted) return;
    setUpvotes((u) => u + 1);
    setVoted(true);
    await upvoteReport(report.id);
  };

  return (
    <Marker position={[report.lat, report.lng]} icon={obstacleIcon}>
      <Popup>
        <div style={{ fontFamily: 'system-ui, sans-serif', minWidth: 160 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#dc2626', marginBottom: 4 }}>
            {TYPE_NAMES[report.type] || report.type || 'Accessibility Hazard'}
          </div>
          {report.description && (
            <div style={{ fontSize: 13, color: '#4b5563', marginBottom: 8 }}>
              {report.description}
            </div>
          )}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTop: '1px solid #f3f4f6',
            paddingTop: 8,
            marginTop: 4,
          }}>
            <span style={{ fontSize: 12, color: '#6b7280' }}>
              Confirmed by <strong>{upvotes}</strong>
            </span>
            <button
              onClick={handleUpvote}
              disabled={voted}
              style={{
                background: voted ? '#dcfce7' : '#fee2e2',
                color: voted ? '#15803d' : '#991b1b',
                border: 'none',
                padding: '4px 10px',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                cursor: voted ? 'default' : 'pointer',
              }}
            >
              {voted ? '✓ Confirmed' : '👍 Confirm'}
            </button>
          </div>
        </div>
      </Popup>
    </Marker>
  );
}
