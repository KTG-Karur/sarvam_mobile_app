'use client';

import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import LocationSearchBox from './LocationSearchBox';

// Fix for default marker icon in Next.js
const createIcon = (iconUrl: string, shadowUrl: string) => {
    return L.icon({
        iconUrl,
        shadowUrl,
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41],
    });
};

// Use default Leaflet icons
const defaultIcon = createIcon(
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'
);

L.Marker.prototype.options.icon = defaultIcon;

export type CenterMapProps = {
    latitude: number;
    longitude: number;
    centerName: string;
    centerCode: string;
    address?: string;
    /** When true, the marker can be dragged and the map can be clicked to move it. */
    editable?: boolean;
    /** Fired with the new coordinates when the marker is dragged or the map is clicked (editable mode only). */
    onLocationChange?: (lat: number, lng: number) => void;
    /** Tailwind height class for the map container. Defaults to 75vh (the full-page Locate views). */
    heightClassName?: string;
    /** Show the place search box above the map. Defaults to on for editable maps. */
    searchable?: boolean;
};

/**
 * Component to update map view when coordinates change
 */
function MapUpdater({ latitude, longitude }: { latitude: number; longitude: number }) {
    const map = useMap();

    useEffect(() => {
        map.setView([latitude, longitude], map.getZoom());
    }, [map, latitude, longitude]);

    return null;
}

/** Captures map clicks to reposition the marker — only mounted in editable mode. */
function ClickToPlace({ onLocationChange }: { onLocationChange: (lat: number, lng: number) => void }) {
    useMapEvents({
        click(e) {
            onLocationChange(e.latlng.lat, e.latlng.lng);
        },
    });
    return null;
}

export default function CenterMapLeaflet({
    latitude,
    longitude,
    centerName,
    centerCode,
    address,
    editable = false,
    onLocationChange,
    heightClassName = 'h-[75vh]',
    searchable,
}: CenterMapProps) {
    const markerRef = useRef<L.Marker>(null);
    const showSearch = (searchable ?? editable) && !!onLocationChange;

    return (
        <div className="space-y-2">
        {showSearch && onLocationChange && (
            <LocationSearchBox
                onSelect={(lat, lng) => onLocationChange(lat, lng)}
                biasLat={latitude}
                biasLng={longitude}
            />
        )}
        <div className={`${heightClassName} w-full rounded-lg overflow-hidden border`}>
            <MapContainer
                center={[latitude, longitude]}
                zoom={15}
                style={{ height: '100%', width: '100%' }}
                scrollWheelZoom={true}
                className="z-0"
            >
                <MapUpdater latitude={latitude} longitude={longitude} />
                {editable && onLocationChange && <ClickToPlace onLocationChange={onLocationChange} />}
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <Marker
                    position={[latitude, longitude]}
                    draggable={editable}
                    ref={markerRef}
                    eventHandlers={
                        editable && onLocationChange
                            ? {
                                  dragend: () => {
                                      const marker = markerRef.current;
                                      if (!marker) return;
                                      const pos = marker.getLatLng();
                                      onLocationChange(pos.lat, pos.lng);
                                  },
                              }
                            : undefined
                    }
                >
                    <Popup>
                        <div className="space-y-1">
                            <h3 className="font-semibold">{centerName}</h3>
                            <p className="text-sm text-muted-foreground">Code: {centerCode}</p>
                            {address && (
                                <p className="text-sm text-muted-foreground">Address: {address}</p>
                            )}
                            <p className="text-xs text-muted-foreground">
                                Coordinates: {latitude.toFixed(6)}, {longitude.toFixed(6)}
                            </p>
                            {editable && (
                                <p className="text-xs text-primary font-medium">Drag marker or click map to reposition</p>
                            )}
                        </div>
                    </Popup>
                </Marker>
            </MapContainer>
        </div>
        </div>
    );
}

