import React from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup } from 'react-leaflet';
import L from 'leaflet';
import ReportMarker from './ReportMarker';
import 'leaflet/dist/leaflet.css';

// ==========================================
// VITE BUG FIX: Load default markers from web
// ==========================================
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});
// ==========================================

export default function Map({ start, destination, routeData, obstacles }) {
    return (
        <MapContainer
            center={[45.7489, 21.2087]}
            zoom={14}
            style={{ height: '100%', width: '100%' }}
            zoomControl={false}
        >
            <TileLayer
                attribution='&copy; OpenStreetMap'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {/* Markers are now completely safe to render! */}
            {start && <Marker position={[start.lat, start.lng]}><Popup>Start Location</Popup></Marker>}
            {destination && <Marker position={[destination.lat, destination.lng]}><Popup>Destination</Popup></Marker>}

            {routeData && routeData.coordinates && (
                <Polyline positions={routeData.coordinates} color="#2563eb" weight={6} opacity={0.8} />
            )}

            {obstacles && obstacles.map(obs => (
                <ReportMarker key={obs.id} report={obs} />
            ))}

        </MapContainer>
    );
}