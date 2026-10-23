'use client';

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { GoogleMap, Marker, Polyline, InfoWindow } from '@react-google-maps/api';
import { useGoogleMapsLoader } from '@/hooks/useGoogleMapsLoader';

export type MapEmployee = {
    id: string;
    name: string;
    employeeId: string | null;
    status: 'ACTIVE' | 'IDLE' | 'CLIENT_VISIT' | 'EN_ROUTE' | 'OFFLINE';
    lastLocation: { latitude: number; longitude: number } | null;
    lastUpdated: string | null;
    lastBatteryPercent?: number | null;
    punchIn?: string | Date | null;
    punchOut?: string | Date | null;
};

/**
 * Formats a date/timestamp into 12-hour format with AM/PM (e.g. "09:30 AM" or "09:30:15 AM") in Asia/Kolkata timezone.
 */
export function formatTime12h(
    dateStrOrObj?: string | Date | null,
    options: { includeSeconds?: boolean } = { includeSeconds: true }
): string {
    if (!dateStrOrObj) return '—';
    const d = typeof dateStrOrObj === 'string' ? new Date(dateStrOrObj) : dateStrOrObj;
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString('en-US', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        ...(options.includeSeconds ? { second: '2-digit' } : {}),
        hour12: true,
    });
}

const STATUS_COLOR: Record<MapEmployee['status'], string> = {
    ACTIVE: '#0ca30c',
    IDLE: '#7c5cd6',
    CLIENT_VISIT: '#2a78d6',
    EN_ROUTE: '#fab219',
    OFFLINE: '#898781',
};

export const STATUS_LABEL: Record<MapEmployee['status'], string> = {
    ACTIVE: 'Active',
    IDLE: 'Idle',
    CLIENT_VISIT: 'On Visit',
    EN_ROUTE: 'Moving',
    OFFLINE: 'Offline',
};

export type RouteActivity = 'PUNCH_IN' | 'PUNCH_OUT' | 'CLIENT_VISIT' | 'EN_ROUTE' | 'IDLE_PING' | 'COLLECTION' | 'CENTER_CREATED' | 'MEMBER_ENROLLED';
export type RoutePoint = {
    latitude: number;
    longitude: number;
    capturedAt: string;
    activityType: RouteActivity;
    /** 'EVENT' points come from EmployeeTrackingEvent (punch/visit/collection/center/enrollment); 'PING' from the continuous background trail. */
    source?: 'PING' | 'EVENT';
};

const WAYPOINT_COLOR: Record<RouteActivity, string> = {
    PUNCH_IN: '#0ca30c',
    PUNCH_OUT: '#d6362a',
    CLIENT_VISIT: '#2a78d6',
    EN_ROUTE: '#fab219',
    IDLE_PING: '#b7b4ad',
    COLLECTION: '#f97316',
    CENTER_CREATED: '#8b5cf6',
    MEMBER_ENROLLED: '#14b8a6',
};

export const WAYPOINT_LABEL: Record<RouteActivity, string> = {
    PUNCH_IN: 'Punch In',
    PUNCH_OUT: 'Punch Out',
    CLIENT_VISIT: 'Client Visit',
    EN_ROUTE: 'Moving',
    IDLE_PING: 'Idle',
    COLLECTION: 'Collection',
    CENTER_CREATED: 'Center Created',
    MEMBER_ENROLLED: 'Member Enrolled',
};

// Only these activity types get a marker on the map — Moving (EN_ROUTE),
// Idle, and Client Visit are still part of routeHistory (they still draw
// into the polyline / feed travelled-km and status), just not rendered as
// individual pins, so the map stays focused on the meaningful business stops.
const MAP_MARKER_TYPES: ReadonlySet<RouteActivity> = new Set(['PUNCH_IN', 'PUNCH_OUT', 'COLLECTION', 'CENTER_CREATED', 'MEMBER_ENROLLED']);

const LEGEND_ITEMS: { label: string; color: string }[] = [
    { label: 'Punch In', color: WAYPOINT_COLOR.PUNCH_IN },
    { label: 'Punch Out', color: WAYPOINT_COLOR.PUNCH_OUT },
    { label: 'Collection', color: WAYPOINT_COLOR.COLLECTION },
    { label: 'Center Created', color: WAYPOINT_COLOR.CENTER_CREATED },
    { label: 'Member Enrolled', color: WAYPOINT_COLOR.MEMBER_ENROLLED },
];

/** SVG data-URI teardrop pin — all map markers now use this (only the 5 meaningful business-event types are ever rendered as markers, see MAP_MARKER_TYPES). */
function pinIconUrl(color: string): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="34" viewBox="0 0 26 34"><path d="M13 0C5.8 0 0 5.8 0 13c0 9.2 13 21 13 21s13-11.8 13-21C26 5.8 20.2 0 13 0z" fill="${color}"/><circle cx="13" cy="13" r="5.5" fill="white"/></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Live employee marker — a pulsing ring (SVG <animate>) behind a solid dot, so an on-shift employee reads as "live" at a glance. */
function liveDotIconUrl(color: string, pulsing: boolean): string {
    const ring = pulsing
        ? `<circle cx="16" cy="16" r="8" fill="${color}" opacity="0.55"><animate attributeName="r" from="8" to="15" dur="1.8s" repeatCount="indefinite"/><animate attributeName="opacity" from="0.55" to="0" dur="1.8s" repeatCount="indefinite"/></circle>`
        : '';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">${ring}<circle cx="16" cy="16" r="7" fill="${color}" stroke="white" stroke-width="2.5"/></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const DEFAULT_CENTER = { lat: 11.1271, lng: 78.6569 }; // Tamil Nadu, India — a sane default when no employee has a location yet.

const MAP_CONTAINER_STYLE: React.CSSProperties = { height: '100%', width: '100%' };

const MAP_OPTIONS: google.maps.MapOptions = {
    disableDefaultUI: false,
    streetViewControl: false,
    mapTypeControl: true,
    fullscreenControl: true,
    styles: [
        // Slightly muted labels so route markers/polyline stay the visual focus.
        { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
        { featureType: 'poi', elementType: 'labels.icon', stylers: [{ visibility: 'simplified' }] },
    ],
};

export type SnappedRoutePoint = { latitude: number; longitude: number };

export function LiveTrackingMap({
    employees,
    routeHistory,
    snappedPath,
    showLegend,
    selectedEmployeeId,
    onSelectEmployee,
}: {
    employees: MapEmployee[];
    routeHistory?: RoutePoint[];
    /** Road-matched path (Google Roads API, cached — see EmployeeRouteSnapshot).
     * When present, drawn instead of the raw straight-line polyline; the
     * individual waypoint markers still show the true captured GPS either way. */
    snappedPath?: SnappedRoutePoint[] | null;
    /** Shows the color-key legend overlay — on by default whenever a route is drawn. */
    showLegend?: boolean;
    selectedEmployeeId?: string | null;
    onSelectEmployee?: (id: string | null) => void;
}) {
    const { isLoaded } = useGoogleMapsLoader();
    const [openMarker, setOpenMarker] = useState<string | null>(null);
    const mapRef = useRef<google.maps.Map | null>(null);

    const located = employees.filter((e) => e.lastLocation);
    const hasRoute = !!(routeHistory && routeHistory.length > 0);
    const legendVisible = showLegend ?? hasRoute;

    const center = useMemo(() => {
        if (selectedEmployeeId) {
            const target = located.find((e) => e.id === selectedEmployeeId);
            if (target?.lastLocation) return { lat: target.lastLocation.latitude, lng: target.lastLocation.longitude };
        }
        if (located.length > 0) return { lat: located[0].lastLocation!.latitude, lng: located[0].lastLocation!.longitude };
        if (routeHistory && routeHistory.length > 0) return { lat: routeHistory[0].latitude, lng: routeHistory[0].longitude };
        return DEFAULT_CENTER;
    }, [located, routeHistory, selectedEmployeeId]);

    // Pan and zoom map to selected employee when selection changes
    useEffect(() => {
        if (selectedEmployeeId) {
            setOpenMarker(`emp-${selectedEmployeeId}`);
            const target = located.find((e) => e.id === selectedEmployeeId);
            if (target?.lastLocation && mapRef.current) {
                mapRef.current.panTo({ lat: target.lastLocation.latitude, lng: target.lastLocation.longitude });
                mapRef.current.setZoom(15);
            }
        }
    }, [selectedEmployeeId, located]);

    const onMapLoad = useCallback((map: google.maps.Map) => {
        mapRef.current = map;
    }, []);

    if (!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) {
        return (
            <div className="flex h-full items-center justify-center bg-slate-50 dark:bg-slate-900 text-sm text-slate-400 text-center p-4">
                Map unavailable — NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not configured.
            </div>
        );
    }
    if (!isLoaded) {
        return <div className="flex h-full items-center justify-center text-sm text-slate-400">Loading map...</div>;
    }

    const path = snappedPath && snappedPath.length > 1
        ? snappedPath.map((p) => ({ lat: p.latitude, lng: p.longitude }))
        : routeHistory && routeHistory.length > 1
            ? routeHistory.map((r) => ({ lat: r.latitude, lng: r.longitude }))
            : null;
    const isSnapped = !!(snappedPath && snappedPath.length > 1);

    return (
        <div style={{ position: 'relative', height: '100%', width: '100%' }}>
            <GoogleMap
                mapContainerStyle={MAP_CONTAINER_STYLE}
                center={center}
                zoom={located.length > 0 || hasRoute ? 13 : 7}
                options={MAP_OPTIONS}
                onLoad={onMapLoad}
            >
                {located.map((e) => (
                    <Marker
                        key={e.id}
                        position={{ lat: e.lastLocation!.latitude, lng: e.lastLocation!.longitude }}
                        icon={{ url: liveDotIconUrl(STATUS_COLOR[e.status], e.status !== 'OFFLINE'), scaledSize: new google.maps.Size(32, 32), anchor: new google.maps.Point(16, 16) }}
                        onClick={() => {
                            setOpenMarker(`emp-${e.id}`);
                            onSelectEmployee?.(e.id);
                        }}
                    >
                        {openMarker === `emp-${e.id}` && (
                            <InfoWindow
                                onCloseClick={() => {
                                    setOpenMarker(null);
                                    onSelectEmployee?.(null);
                                }}
                            >
                                <div className="hr-tracking-popup">
                                    <div className="hr-tracking-popup-title">{e.name}</div>
                                    {e.employeeId && <div className="hr-tracking-popup-sub font-mono font-semibold">{e.employeeId}</div>}
                                    <div className="hr-tracking-popup-row">
                                        <span className="hr-tracking-popup-dot" style={{ background: STATUS_COLOR[e.status] }} />
                                        {STATUS_LABEL[e.status]}
                                    </div>
                                    {e.lastBatteryPercent != null && <div className="hr-tracking-popup-meta">Battery: {Math.round(e.lastBatteryPercent)}%</div>}
                                    {e.punchIn && (
                                        <div className="hr-tracking-popup-meta font-medium text-emerald-600 dark:text-emerald-400">
                                            Punch In: {formatTime12h(e.punchIn, { includeSeconds: false })}
                                        </div>
                                    )}
                                    {e.punchOut && (
                                        <div className="hr-tracking-popup-meta font-medium text-rose-600 dark:text-rose-400">
                                            Punch Out: {formatTime12h(e.punchOut, { includeSeconds: false })}
                                        </div>
                                    )}
                                    {e.lastUpdated && (
                                        <div className="hr-tracking-popup-meta">
                                            Updated: {formatTime12h(e.lastUpdated, { includeSeconds: false })}
                                        </div>
                                    )}
                                    <a
                                        href={`/dashboard/hr/tracking/employee/${e.id}`}
                                        className="mt-2 block text-xs font-semibold text-primary hover:underline"
                                    >
                                        View Full Route Trail →
                                    </a>
                                </div>
                            </InfoWindow>
                        )}
                    </Marker>
                ))}

                {path && (
                    <>
                        {/* Google Maps route casing for depth & contrast */}
                        <Polyline
                            path={path}
                            options={{
                                strokeColor: '#174ea6',
                                strokeWeight: 6.5,
                                strokeOpacity: 0.55,
                                zIndex: 1,
                            }}
                        />
                        {/* Iconic Google Maps navigation blue route line */}
                        <Polyline
                            path={path}
                            options={{
                                strokeColor: '#1a73e8',
                                strokeWeight: 4.5,
                                strokeOpacity: 1.0,
                                zIndex: 2,
                            }}
                        />
                    </>
                )}

                {routeHistory?.filter((r) => MAP_MARKER_TYPES.has(r.activityType)).map((r, i) => {
                    const key = `${r.capturedAt}-${i}`;
                    return (
                        <Marker
                            key={key}
                            position={{ lat: r.latitude, lng: r.longitude }}
                            icon={{ url: pinIconUrl(WAYPOINT_COLOR[r.activityType]), scaledSize: new google.maps.Size(26, 34), anchor: new google.maps.Point(13, 34) }}
                            onClick={() => setOpenMarker(key)}
                        >
                            {openMarker === key && (
                                <InfoWindow onCloseClick={() => setOpenMarker(null)}>
                                    <div className="hr-tracking-popup">
                                        <div className="hr-tracking-popup-row" style={{ fontWeight: 600 }}>
                                            <span className="hr-tracking-popup-dot" style={{ background: WAYPOINT_COLOR[r.activityType] }} />
                                            {WAYPOINT_LABEL[r.activityType]}
                                        </div>
                                        <div className="hr-tracking-popup-meta font-medium">
                                            {formatTime12h(r.capturedAt, { includeSeconds: true })}
                                        </div>
                                    </div>
                                </InfoWindow>
                            )}
                        </Marker>
                    );
                })}
            </GoogleMap>

            {legendVisible && (
                <div className="hr-tracking-legend">
                    {LEGEND_ITEMS.map((item) => (
                        <div key={item.label} className="hr-tracking-legend-row">
                            <span className="hr-tracking-legend-dot" style={{ background: item.color }} />
                            {item.label}
                        </div>
                    ))}
                </div>
            )}

            <style jsx global>{`
                .hr-tracking-popup { font-family: inherit; min-width: 120px; }
                .hr-tracking-popup-title { font-weight: 700; font-size: 13px; }
                .hr-tracking-popup-sub { font-size: 11px; color: #64748b; margin-bottom: 4px; }
                .hr-tracking-popup-row { display: flex; align-items: center; gap: 6px; font-size: 12px; margin-top: 2px; }
                .hr-tracking-popup-meta { font-size: 11px; color: #94a3b8; margin-top: 2px; }
                .hr-tracking-popup-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
                .hr-tracking-legend {
                    position: absolute;
                    bottom: 24px;
                    left: 12px;
                    z-index: 10;
                    background: rgba(255, 255, 255, 0.92);
                    backdrop-filter: blur(4px);
                    border-radius: 10px;
                    padding: 8px 12px;
                    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.15);
                    font-size: 11px;
                    line-height: 1.6;
                    color: #334155;
                    max-width: 150px;
                }
                .hr-tracking-legend-row { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
                .hr-tracking-legend-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
                @media (prefers-color-scheme: dark) {
                    .hr-tracking-legend {
                        background: rgba(30, 41, 59, 0.92);
                        color: #e2e8f0;
                    }
                }
            `}</style>
        </div>
    );
}
