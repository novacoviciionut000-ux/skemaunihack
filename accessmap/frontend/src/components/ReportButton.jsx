import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { submitReport } from '../api/client';

export default function ReportButton({ onReportAdded }) {
    const [isReporting, setIsReporting] = useState(false);

    const handleReport = async () => {
        setIsReporting(true);
        try {
            // In a real app, use the device's Geolocation API here:
            // navigator.geolocation.getCurrentPosition(...)
            const mockLocation = { lat: 45.7489, lng: 21.2087 };
            const report = await submitReport(mockLocation.lat, mockLocation.lng, "BLOCKED_SIDEWALK");
            onReportAdded(report);
            alert("Obstacle reported successfully. Map updated.");
        } catch (error) {
            console.error("Failed to report", error);
        } finally {
            setIsReporting(false);
        }
    };

    return (
        <button
            onClick={handleReport}
            disabled={isReporting}
            aria-label="Report an obstacle at my current location"
            style={{
                padding: '16px', background: '#dc2626', color: 'white',
                borderRadius: '12px', border: 'none', fontSize: '16px', fontWeight: 'bold',
                display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px',
                width: '100%', cursor: 'pointer', minHeight: '56px'
            }}
        >
            <AlertTriangle size={24} />
            {isReporting ? 'Reporting...' : 'Report Obstacle Here'}
        </button>
    );
}