'use client';

import { useEffect } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { NearbyVenueDto } from '@/app/api/venues/route';

const COLOR: Record<string, string> = {
  flagged: '#C6303A',
  clear: '#0F8B4C',
  unknown: '#8A8F98',
};

/** Square pin in the verdict colour — no default Leaflet blue. */
function pin(verdict: string): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<span style="display:block;width:14px;height:14px;background:${
      COLOR[verdict] ?? COLOR.unknown
    };border:2px solid #2B3440;"></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng]);
  }, [lat, lng, map]);
  return null;
}

export default function VenueMap({
  center,
  venues,
  onSelect,
}: {
  center: { lat: number; lng: number };
  venues: NearbyVenueDto[];
  onSelect: (id: string) => void;
}) {
  return (
    <MapContainer
      center={[center.lat, center.lng]}
      zoom={15}
      scrollWheelZoom
      className="h-[62vh] w-full border-2 border-slate-ink"
    >
      {/* OpenStreetMap raster tiles are free and require this attribution. */}
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <Recenter lat={center.lat} lng={center.lng} />
      {venues.map((venue) => (
        <Marker
          key={venue.id}
          position={[venue.lat, venue.lng]}
          icon={pin(venue.verdict)}
          eventHandlers={{ click: () => onSelect(venue.id) }}
        >
          <Popup>
            <span className="font-display uppercase tracking-wide">{venue.name}</span>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
