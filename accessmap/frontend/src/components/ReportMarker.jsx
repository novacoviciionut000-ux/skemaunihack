import React from 'react';
import { Marker, Popup } from 'react-leaflet';
import L from 'leaflet';

// Create a custom red icon for obstacles to stand out
const obstacleIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

export default function ReportMarker({ report }) {
    return (
        <Marker position={[report.lat, report.lng]} icon={obstacleIcon}>
            <Popup>
                <strong style={{ display: 'block', marginBottom: '4px' }}>Reported Obstacle</strong>
                <span>Type: {report.type || 'Unknown'}</span>
            </Popup>
        </Marker>
    );
}