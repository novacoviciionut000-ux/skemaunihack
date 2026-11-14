import React, { useRef, useEffect, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  Popup,
  Circle,
  useMap,
  ZoomControl,
} from 'react-leaflet';
import L from 'leaflet';
import {
  Layers,
  Check,
  Crosshair,
  Loader2,
  Navigation,
  Map as MapIcon,
  Globe,
  Eye,
  Mountain,
  Contrast,
  MapPin,
  Flag,
} from 'lucide-react';
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

// Real-time animated user client marker strictly tailored for blind/visually impaired navigation
export function createUserPuckIcon(heading = null) {
  const rotStyle = heading != null ? `transform: rotate(${heading}deg);` : '';

  return L.divIcon({
    className: 'user-marker-container',
    html: `
      <div class="realtime-puck-container">
        <div class="realtime-pulse-ring"></div>
        <div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; ${rotStyle} transition: transform 0.25s linear;">
          ${heading != null ? '<div class="realtime-radar-cone"></div>' : ''}
          ${heading != null ? '<div class="realtime-heading-arrow"></div>' : ''}
          <div class="realtime-puck-core">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="white"><circle cx="12" cy="12" r="7"/></svg>
          </div>
        </div>
      </div>
    `,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -22],
  });
}

export function renderMapStyleIcon(iconType, size = 17) {
  switch (iconType) {
    case 'satellite': return <Globe size={size} color="#1D4ED8" />;
    case 'accessibility': return <Eye size={size} color="#15803D" />;
    case 'topo': return <Mountain size={size} color="#B45309" />;
    case 'contrast': return <Contrast size={size} color="#1D4ED8" />;
    case 'map':
    default: return <MapIcon size={size} color="#1D4ED8" />;
  }
}

// 100% FREE Public Tile Layers (ZERO API Key Required)
export const MAP_STYLES = {
  osm: {
    id: 'osm',
    name: 'Hartă Stradală',
    subtitle: 'OpenStreetMap standard',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
    iconType: 'map',
  },
  satellite: {
    id: 'satellite',
    name: 'Satelit Aerial',
    subtitle: 'Imagini Esri de înaltă rezoluție',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
    maxZoom: 19,
    iconType: 'satellite',
  },
  accessibility: {
    id: 'accessibility',
    name: 'Trotuare & Marcaje',
    subtitle: 'CyclOSM: căi pietonale',
    url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
    attribution: '&copy; CyclOSM | Map data &copy; OSM',
    maxZoom: 18,
    iconType: 'accessibility',
  },
  topo: {
    id: 'topo',
    name: 'Topografic',
    subtitle: 'Curbe de nivel și relief',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: 'Map data &copy; OSM, SRTM',
    maxZoom: 17,
    iconType: 'topo',
  },
  hot: {
    id: 'hot',
    name: 'Contrast Înalt',
    subtitle: 'Humanitarian OSM (accentuat)',
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    attribution: '&copy; OSM contributors, Tiles by HOT',
    maxZoom: 19,
    iconType: 'contrast',
  },
};

// Map center and flyTo controller
function MapController({ centerTarget, followUser, userLocation }) {
  const map = useMap();

  useEffect(() => {
    if (followUser && userLocation && userLocation.lat && userLocation.lng) {
      map.panTo([userLocation.lat, userLocation.lng], { animate: true, duration: 0.6 });
    }
  }, [followUser, userLocation?.lat, userLocation?.lng, map]);

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
        <small style={{ color: '#64748B' }}>Trage pentru a muta pinul</small>
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
  onStartChange,
  onDestinationChange,
  userLocation,
  centerTarget,
  isLocating,
  onLocateMe,
  onUseAsStart,
  profile = 'wheelchair',
  followUser = false,
}) {
  const isMobile = useIsMobile();
  const [activeStyle, setActiveStyle] = useState('osm');
  const [showStyleMenu, setShowStyleMenu] = useState(false);
  const currentTileConfig = MAP_STYLES[activeStyle] || MAP_STYLES.osm;

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      {/* Floating Map Style Selector (Top-Left) */}
      <div style={{
        position: 'absolute',
        top: isMobile ? 12 : 20,
        left: isMobile ? 12 : 20,
        zIndex: 1002,
        fontFamily: 'inherit',
      }}>
        <button
          onClick={() => setShowStyleMenu(!showStyleMenu)}
          style={{
            background: 'white',
            border: '1px solid #E2E8F0',
            borderRadius: isMobile ? 30 : 14,
            padding: isMobile ? '8px 12px' : '10px 14px',
            boxShadow: '0 4px 16px rgba(15, 23, 42, 0.12)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: isMobile ? 6 : 8,
            fontSize: isMobile ? 12.5 : 13,
            fontWeight: 700,
            color: '#1E293B',
            transition: 'all 0.15s ease',
            whiteSpace: 'nowrap',
          }}
          title="Schimbă stilul hărții"
        >
          <Layers size={isMobile ? 15 : 18} color="#1D4ED8" />
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {renderMapStyleIcon(currentTileConfig.iconType, 16)}
            <span>{isMobile ? 'Hartă' : currentTileConfig.name}</span>
          </span>
        </button>

        {showStyleMenu && (
          <div style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: 0,
            background: 'white',
            border: '1px solid #E2E8F0',
            borderRadius: 16,
            padding: 8,
            boxShadow: '0 12px 30px rgba(15, 23, 42, 0.18)',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            minWidth: 230,
            animation: 'fadeIn 0.15s ease-out',
          }}>
            <div style={{ padding: '6px 10px', fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
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
                    background: isSelected ? '#EFF6FF' : 'transparent',
                    color: isSelected ? '#1D4ED8' : '#334155',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontFamily: 'inherit',
                    transition: 'background 0.1s ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.background = '#F8FAFC';
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      background: isSelected ? '#EFF6FF' : '#F1F5F9',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                      {renderMapStyleIcon(style.iconType, 16)}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: isSelected ? 700 : 600 }}>{style.name}</div>
                      <div style={{ fontSize: 10, color: isSelected ? '#1D4ED8' : '#94A3B8' }}>{style.subtitle}</div>
                    </div>
                  </div>
                  {isSelected && <Check size={16} color="#1D4ED8" />}
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
          border: '1px solid #E2E8F0',
          borderRadius: 12,
          width: 44,
          height: 44,
          boxShadow: '0 4px 14px rgba(15, 23, 42, 0.18)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: isLocating ? 'wait' : 'pointer',
          color: userLocation ? '#1D4ED8' : '#334155',
          transition: 'all 0.15s ease',
        }}
        title="Centrează pe locația mea"
      >
        {isLocating ? (
          <Loader2 size={20} color="#1D4ED8" style={{ animation: 'spin 1s linear infinite' }} />
        ) : (
          <Crosshair size={22} color={userLocation ? '#1D4ED8' : '#334155'} />
        )}
      </button>

      <MapContainer
        center={[45.7489, 21.2087]}
        zoom={14}
        // Without these, zooming far out repeats the world sideways and shows grey bands
        // past the poles. Zoom 3 is the smallest level that still fills a typical screen.
        minZoom={3}
        maxBounds={[[-85.06, -180], [85.06, 180]]}
        maxBoundsViscosity={1.0}
        worldCopyJump={false}
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
      >
        {!isMobile && <ZoomControl position="bottomright" />}

        {/* Dynamic Tile Layer (100% Free, NO API Key) */}
        <TileLayer
          key={currentTileConfig.id}
          attribution={currentTileConfig.attribution}
          url={currentTileConfig.url}
          maxZoom={currentTileConfig.maxZoom}
          noWrap
          bounds={[[-85.06, -180], [85.06, 180]]}
        />

        <MapController centerTarget={centerTarget} followUser={followUser} userLocation={userLocation} />
        <FitBounds start={start} destination={destination} routeData={routeData} />

        {/* User Current Live Location (Real-time animated puck with orientation beam & pulse) */}
        {userLocation && (
          <>
            <Circle
              center={[userLocation.lat, userLocation.lng]}
              radius={userLocation.accuracy ? Math.min(Math.max(userLocation.accuracy, 15), 60) : 25}
              pathOptions={{
                color: '#1D4ED8',
                fillColor: '#1D4ED8',
                fillOpacity: 0.12,
                weight: 1.5,
              }}
            />
            <Marker
              position={[userLocation.lat, userLocation.lng]}
              icon={createUserPuckIcon(userLocation.heading)}
            >
              <Popup>
                <div style={{ fontFamily: 'inherit', padding: 2 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#1E40AF', marginBottom: 2 }}>
                    Poziția ta (GPS Live)
                  </div>
                  <div style={{ fontSize: 11, color: '#64748B', marginBottom: 4 }}>
                    [{userLocation.lat.toFixed(5)}, {userLocation.lng.toFixed(5)}]
                  </div>
                  {userLocation.heading != null && (
                    <div style={{ fontSize: 11, color: '#1D4ED8', fontWeight: 600, marginBottom: 4 }}>
                      Direcție de deplasare: {Math.round(userLocation.heading)}°
                    </div>
                  )}
                  {userLocation.speed != null && userLocation.speed > 0 && (
                    <div style={{ fontSize: 11, color: '#15803D', fontWeight: 600, marginBottom: 6 }}>
                      Viteză de mers: {(userLocation.speed * 3.6).toFixed(1)} km/h
                    </div>
                  )}
                  {onUseAsStart && (
                    <button
                      onClick={() => onUseAsStart({ lat: userLocation.lat, lng: userLocation.lng })}
                      style={{
                        background: '#1D4ED8',
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
            popupText="Punct de plecare"
            onDragEnd={(pos) => {
              if (onStartChange) onStartChange(pos);
            }}
          />
        )}

        {/* Destination marker (blue, draggable) */}
        {destination && (
          <DraggableMarker
            position={destination}
            icon={endIcon}
            popupText="Destinație"
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
              color={activeStyle === 'satellite' ? '#FFFFFF' : '#1E293B'}
              weight={9}
              opacity={activeStyle === 'satellite' ? 0.7 : 0.3}
              lineCap="round"
              lineJoin="round"
            />
            {/* Vibrant primary line */}
            <Polyline
              positions={routeData.coordinates}
              color="#1D4ED8"
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
                    color: '#B91C1C',
                    fillColor: '#B91C1C',
                    fillOpacity: 0.25,
                    weight: 2,
                  }}
                >
                  <Popup>
                    <strong>Obstacol semnalat: {detour.labelRo || 'Obstacol'}</strong>
                  </Popup>
                </Circle>
              )}
              {detour.detourPath && detour.detourPath.length >= 2 && (
                <Polyline
                  positions={detour.detourPath}
                  pathOptions={{
                    color: isNearby ? '#15803D' : '#15803D',
                    weight: isNearby ? 6 : 4,
                    opacity: isNearby ? 0.95 : 0.75,
                    dashArray: '8, 8',
                  }}
                >
                  <Popup>
                    <strong>Traseu de ocolire trotuar</strong>
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
