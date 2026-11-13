import React, { useRef, useEffect, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  Popup,
  Circle,
  useMapEvents,
  useMap,
  ZoomControl,
} from 'react-leaflet';
import L from 'leaflet';
import { Layers, Check, Crosshair, Loader2, Navigation } from 'lucide-react';
import ReportMarker from './ReportMarker';
import { useIsMobile } from '../hooks/useIsMobile';
import 'leaflet/dist/leaflet.css';

// Fix default Leaflet marker icons for Vite
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Custom icons for start and end markers
const startIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const endIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// User live location pulsing marker
const userLocationIcon = L.divIcon({
  className: 'user-marker-container',
  html: `
    <div style="position: relative; width: 22px; height: 22px;">
      <div class="user-pulse-ring"></div>
      <div class="user-location-dot"></div>
    </div>
  `,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

// 100% FREE Public Tile Layers (ZERO API Key Required)
export const MAP_STYLES = {
  osm: {
    id: 'osm',
    name: 'Street Map',
    subtitle: 'Standard OpenStreetMap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
    icon: '🗺️',
  },
  satellite: {
    id: 'satellite',
    name: 'Satellite Aerial',
    subtitle: 'High-res Esri imagery',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP',
    maxZoom: 19,
    icon: '🛰️',
  },
  accessibility: {
    id: 'accessibility',
    name: 'Accessible Paths',
    subtitle: 'CyclOSM: sidewalks & ramps',
    url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.cyclosm.org">CyclOSM</a> | Map data &copy; OSM',
    maxZoom: 18,
    icon: '♿',
  },
  topo: {
    id: 'topo',
    name: 'Topographic',
    subtitle: 'Elevation & terrain lines',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: 'Map data &copy; OSM, SRTM | Style &copy; OpenTopoMap',
    maxZoom: 17,
    icon: '⛰️',
  },
  hot: {
    id: 'hot',
    name: 'High Contrast',
    subtitle: 'Humanitarian OSM (clear roads)',
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    attribution: '&copy; OSM contributors, Tiles by HOT',
    maxZoom: 19,
    icon: '📍',
  },
};

// Component that handles map click events
function MapClickHandler({ onMapClick }) {
  useMapEvents({
    click(e) {
      if (onMapClick) {
        onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng });
      }
    },
  });
  return null;
}

// Map center and flyTo controller
function MapController({ centerTarget }) {
  const map = useMap();

  useEffect(() => {
    if (centerTarget && centerTarget.lat && centerTarget.lng) {
      map.flyTo([centerTarget.lat, centerTarget.lng], centerTarget.zoom || 16, {
        duration: 1.2,
      });
    }
  }, [centerTarget, map]);

  return null;
}

// Component that auto-fits bounds when route changes
function FitBounds({ start, destination, routeData }) {
  const map = useMap();

  useEffect(() => {
    if (routeData && routeData.coordinates && routeData.coordinates.length > 1) {
      const bounds = L.latLngBounds(routeData.coordinates);
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
    } else if (start && destination) {
      const bounds = L.latLngBounds(
        [start.lat, start.lng],
        [destination.lat, destination.lng]
      );
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
    }
  }, [routeData, start, destination, map]);

  return null;
}

// Draggable marker component
function DraggableMarker({ position, icon, popupText, onDragEnd }) {
  const markerRef = useRef(null);

  const eventHandlers = {
    dragend() {
      const marker = markerRef.current;
      if (marker) {
        const latlng = marker.getLatLng();
        onDragEnd({ lat: latlng.lat, lng: latlng.lng });
      }
    },
  };

  return (
    <Marker
      draggable
      position={[position.lat, position.lng]}
      icon={icon}
      ref={markerRef}
      eventHandlers={eventHandlers}
    >
      <Popup>
        <strong>{popupText}</strong>
        <br />
        <small style={{ color: '#666' }}>Trage pentru a muta pinul</small>
      </Popup>
    </Marker>
  );
}

export default function Map({
  start,
  destination,
  routeData,
  obstacles,
  savedDetours = [],
  nearbyDetour,
  onMapClick,
  onStartChange,
  onDestinationChange,
  placingMode,
  userLocation,
  centerTarget,
  isLocating,
  onLocateMe,
  onUseAsStart,
}) {
  const isMobile = useIsMobile();
  const [activeStyle, setActiveStyle] = useState('osm');
  const [showStyleMenu, setShowStyleMenu] = useState(false);
  const currentTileConfig = MAP_STYLES[activeStyle] || MAP_STYLES.osm;

  const cursorStyle = placingMode ? 'crosshair' : '';

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      {/* Floating Map Style Selector (Top-Left) */}
      <div style={{
        position: 'absolute',
        top: isMobile ? 12 : 20,
        left: isMobile ? 12 : 20,
        zIndex: 1002,
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      }}>
        <button
          onClick={() => setShowStyleMenu(!showStyleMenu)}
          style={{
            background: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: isMobile ? 30 : 14,
            padding: isMobile ? '8px 12px' : '10px 14px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: isMobile ? 6 : 8,
            fontSize: isMobile ? 12.5 : 13,
            fontWeight: 700,
            color: '#1f2937',
            transition: 'all 0.15s ease',
            whiteSpace: 'nowrap',
          }}
          title="Schimbă stilul hărții"
        >
          <Layers size={isMobile ? 15 : 18} color="#2563eb" />
          <span>{currentTileConfig.icon} {isMobile ? 'Hartă' : currentTileConfig.name}</span>
        </button>

        {showStyleMenu && (
          <div style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: 0,
            background: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: 16,
            padding: 8,
            boxShadow: '0 12px 30px rgba(0,0,0,0.18)',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            minWidth: 230,
            animation: 'fadeIn 0.15s ease-out',
          }}>
            <div style={{ padding: '6px 10px', fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Selectează stilul hărții
            </div>
            {Object.values(MAP_STYLES).map((style) => {
              const isSelected = activeStyle === style.id;
              return (
                <button
                  key={style.id}
                  onClick={() => {
                    setActiveStyle(style.id);
                    setShowStyleMenu(false);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: 'none',
                    background: isSelected ? '#eff6ff' : 'transparent',
                    color: isSelected ? '#1d4ed8' : '#374151',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontFamily: 'inherit',
                    transition: 'background 0.1s ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.background = '#f9fafb';
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 18 }}>{style.icon}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: isSelected ? 700 : 600 }}>{style.name}</div>
                      <div style={{ fontSize: 10, color: isSelected ? '#3b82f6' : '#9ca3af' }}>{style.subtitle}</div>
                    </div>
                  </div>
                  {isSelected && <Check size={16} color="#2563eb" />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* "Locația mea" / Center on User GPS button */}
      <button
        onClick={onLocateMe}
        disabled={isLocating}
        style={{
          position: 'absolute',
          bottom: isMobile ? 210 : 85,
          right: 12,
          zIndex: 998,
          background: 'white',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          width: 44,
          height: 44,
          boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: isLocating ? 'wait' : 'pointer',
          color: userLocation ? '#2563eb' : '#334155',
          transition: 'all 0.15s ease',
        }}
        title="Centrează pe locația mea"
      >
        {isLocating ? (
          <Loader2 size={20} color="#2563eb" style={{ animation: 'spin 1s linear infinite' }} />
        ) : (
          <Crosshair size={22} color={userLocation ? '#2563eb' : '#334155'} />
        )}
      </button>

      <MapContainer
        center={[45.7489, 21.2087]}
        zoom={14}
        style={{ height: '100%', width: '100%', cursor: cursorStyle }}
        zoomControl={false}
      >
        {!isMobile && <ZoomControl position="bottomright" />}

        {/* Dynamic Tile Layer (100% Free, NO API Key) */}
        <TileLayer
          key={currentTileConfig.id}
          attribution={currentTileConfig.attribution}
          url={currentTileConfig.url}
          maxZoom={currentTileConfig.maxZoom}
        />

        <MapClickHandler onMapClick={onMapClick} />
        <MapController centerTarget={centerTarget} />
        <FitBounds start={start} destination={destination} routeData={routeData} />

        {/* User Current Live Location (Pulsing marker + accuracy ring) */}
        {userLocation && (
          <>
            <Circle
              center={[userLocation.lat, userLocation.lng]}
              radius={userLocation.accuracy ? Math.min(Math.max(userLocation.accuracy, 20), 100) : 35}
              pathOptions={{
                color: '#2563eb',
                fillColor: '#3b82f6',
                fillOpacity: 0.14,
                weight: 1.5,
              }}
            />
            <Marker position={[userLocation.lat, userLocation.lng]} icon={userLocationIcon}>
              <Popup>
                <div style={{ fontFamily: 'system-ui, sans-serif', padding: 2 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#1e40af', marginBottom: 4 }}>
                    📍 Ești aici
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
                    [{userLocation.lat.toFixed(5)}, {userLocation.lng.toFixed(5)}]
                  </div>
                  {onUseAsStart && (
                    <button
                      onClick={() => onUseAsStart({ lat: userLocation.lat, lng: userLocation.lng })}
                      style={{
                        background: '#2563eb',
                        color: 'white',
                        border: 'none',
                        borderRadius: 8,
                        padding: '6px 10px',
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        width: '100%',
                        justifyContent: 'center',
                      }}
                    >
                      <Navigation size={12} />
                      Pleacă de aici
                    </button>
                  )}
                </div>
              </Popup>
            </Marker>
          </>
        )}

        {/* Start marker (green, draggable) */}
        {start && (
          <DraggableMarker
            position={start}
            icon={startIcon}
            popupText="📍 Punct de plecare"
            onDragEnd={(pos) => {
              if (onStartChange) onStartChange(pos);
              else if (onMapClick) onMapClick(pos);
            }}
          />
        )}

        {/* Destination marker (blue, draggable) */}
        {destination && (
          <DraggableMarker
            position={destination}
            icon={endIcon}
            popupText="🏁 Destinație"
            onDragEnd={(pos) => {
              if (onDestinationChange) onDestinationChange(pos);
            }}
          />
        )}

        {/* Route polyline */}
        {routeData && routeData.coordinates && routeData.coordinates.length > 1 && (
          <>
            {/* Outline / shadow line */}
            <Polyline
              positions={routeData.coordinates}
              color={activeStyle === 'satellite' ? '#ffffff' : '#1e3a5f'}
              weight={9}
              opacity={activeStyle === 'satellite' ? 0.7 : 0.3}
              lineCap="round"
              lineJoin="round"
            />
            {/* Vibrant primary line */}
            <Polyline
              positions={routeData.coordinates}
              color="#2563eb"
              weight={5}
              opacity={1.0}
              lineCap="round"
              lineJoin="round"
            />
          </>
        )}

        {/* Saved crowdsourced detour paths */}
        {savedDetours && savedDetours.map((detour) => {
          const isNearby = nearbyDetour?.detour?.id === detour.id;
          return (
            <React.Fragment key={detour.id}>
              {detour.obstacleCoords && (
                <Circle
                  center={[detour.obstacleCoords.lat, detour.obstacleCoords.lng]}
                  radius={5}
                  pathOptions={{
                    color: '#ef4444',
                    fillColor: '#ef4444',
                    fillOpacity: 0.25,
                    weight: 2,
                  }}
                >
                  <Popup>
                    <strong>🚧 {detour.labelRo || 'Obstacol'} (ocolire salvată)</strong>
                  </Popup>
                </Circle>
              )}
              {detour.detourPath && detour.detourPath.length >= 2 && (
                <Polyline
                  positions={detour.detourPath}
                  pathOptions={{
                    color: isNearby ? '#10b981' : '#22c55e',
                    weight: isNearby ? 6 : 4,
                    opacity: isNearby ? 0.95 : 0.75,
                    dashArray: '8, 8',
                  }}
                >
                  <Popup>
                    <strong>🔄 Traseu de ocolire salvat</strong>
                    <br />
                    <small>Evită: {detour.labelRo || 'Obstacol'}</small>
                  </Popup>
                </Polyline>
              )}
            </React.Fragment>
          );
        })}

        {/* Obstacle markers */}
        {obstacles && obstacles.map((obs) => (
          <ReportMarker key={obs.id} report={obs} />
        ))}
      </MapContainer>
    </div>
  );
}
