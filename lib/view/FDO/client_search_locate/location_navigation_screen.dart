import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:geolocator/geolocator.dart';
import 'package:get/get.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:http/http.dart' as http;
import 'package:intl/intl.dart';
import 'package:sarvam/constant/api.dart';
import 'package:url_launcher/url_launcher.dart';

/// One place the user can navigate to (member house, centre, branch).
class NavTarget {
  const NavTarget({
    required this.label,
    required this.name,
    required this.icon,
    required this.hue,
    this.point,
  });

  final String label;
  final String name;
  final IconData icon;
  final double hue;
  final LatLng? point;
}

enum _TravelMode { bike, car }

/// Google-Maps-style navigation from the live current location to a member,
/// centre or branch: road-following route, distance in KM, ETA and a
/// hand-off to turn-by-turn navigation in Google Maps.
class LocationNavigationScreen extends StatefulWidget {
  const LocationNavigationScreen({
    super.key,
    required this.title,
    required this.targets,
    this.initialIndex = 0,
  });

  final String title;
  final List<NavTarget> targets;
  final int initialIndex;

  @override
  State<LocationNavigationScreen> createState() =>
      _LocationNavigationScreenState();
}

class _LocationNavigationScreenState extends State<LocationNavigationScreen> {
  static const _green = Color(0xFF008A3D);
  static const _darkGreen = Color(0xFF10472A);
  static const _mutedGreen = Color(0xFF4B8A68);
  static const _border = Color(0xFFD2E9DB);
  static const _lightGreen = Color(0xFFE4F5EB);
  static const _routeBlue = Color(0xFF1A73E8);
  static const _routeCasing = Color(0xFF1558B0);

  /// Re-route only when the user drifts this far off the drawn road route.
  static const _offRouteMeters = 80.0;

  /// Minimum gap between route requests (keeps Routes API usage low).
  static const _minRerouteGap = Duration(seconds: 20);

  GoogleMapController? _map;
  StreamSubscription<Position>? _positionSub;
  LatLng? _current;
  late int _selected;
  _TravelMode _mode = _TravelMode.bike;

  List<LatLng> _routePoints = const [];
  double? _distanceMeters;
  double? _durationSeconds;
  double _fullDurationSeconds = 0;
  bool _loadingRoute = false;
  bool _following = true;
  String? _routeError;
  String? _locationError;
  DateTime? _lastRouteAt;
  int _routeRequestId = 0;

  NavTarget get _target => widget.targets[_selected];

  @override
  void initState() {
    super.initState();
    final firstAvailable = widget.targets.indexWhere((t) => t.point != null);
    _selected = widget.targets[widget.initialIndex].point != null
        ? widget.initialIndex
        : (firstAvailable >= 0 ? firstAvailable : widget.initialIndex);
    _startLocationUpdates();
  }

  @override
  void dispose() {
    _positionSub?.cancel();
    super.dispose();
  }

  Future<void> _startLocationUpdates() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        setState(
          () => _locationError = 'Turn on location (GPS) to get directions.',
        );
        return;
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        setState(
          () =>
              _locationError = 'Location permission is needed for directions.',
        );
        return;
      }
      setState(() => _locationError = null);

      final first = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
        ),
      );
      _onPosition(first);

      await _positionSub?.cancel();
      _positionSub =
          Geolocator.getPositionStream(
            locationSettings: const LocationSettings(
              accuracy: LocationAccuracy.high,
              distanceFilter: 10,
            ),
          ).listen(
            _onPosition,
            onError: (Object e) {
              if (kDebugMode) debugPrint('Navigation location error: $e');
            },
          );
    } catch (e) {
      if (!mounted) return;
      setState(() => _locationError = 'Unable to get your current location.');
    }
  }

  void _onPosition(Position position) {
    if (!mounted) return;
    final here = LatLng(position.latitude, position.longitude);
    setState(() => _current = here);

    if (_routePoints.length < 2) {
      if (!_loadingRoute && _canReroute) _loadRoute();
    } else {
      final offRoute = _updateRemainingFromRoute(here);
      if (offRoute > _offRouteMeters && !_loadingRoute && _canReroute) {
        _loadRoute();
      }
    }
    if (_following) {
      _map?.animateCamera(CameraUpdate.newLatLng(here));
    }
  }

  bool get _canReroute =>
      _lastRouteAt == null ||
      DateTime.now().difference(_lastRouteAt!) >= _minRerouteGap;

  /// Keeps distance / ETA live between re-routes by measuring what is left of
  /// the road route from the nearest point on it. Returns how far (m) the
  /// user is from the route.
  double _updateRemainingFromRoute(LatLng here) {
    var nearest = 0;
    var nearestDist = double.infinity;
    for (var i = 0; i < _routePoints.length; i++) {
      final d = _meters(here, _routePoints[i]);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = i;
      }
    }
    var remaining = 0.0;
    for (var i = nearest; i < _routePoints.length - 1; i++) {
      remaining += _meters(_routePoints[i], _routePoints[i + 1]);
    }
    final total = _pathMeters(_routePoints);
    if (total > 0) {
      final fraction = (remaining / total).clamp(0.0, 1.0);
      setState(() {
        _distanceMeters = remaining;
        _durationSeconds = _fullDurationSeconds * fraction;
      });
    }
    return nearestDist;
  }

  Future<void> _loadRoute() async {
    final from = _current;
    final to = _target.point;
    if (from == null || to == null) return;

    final requestId = ++_routeRequestId;
    _lastRouteAt = DateTime.now();
    setState(() {
      _loadingRoute = true;
      _routeError = null;
    });

    final route = await _fetchRoadRoute(from, to);
    if (!mounted || requestId != _routeRequestId) return;

    final hadRoute = _routePoints.length >= 2;
    setState(() {
      _loadingRoute = false;
      if (route != null) {
        _routePoints = route.points;
        _distanceMeters = route.distanceMeters;
        _durationSeconds = route.durationSeconds;
        _fullDurationSeconds = route.durationSeconds;
      } else if (!hadRoute) {
        // Never draw a fake straight line — show an estimate and a retry.
        final straight = _meters(from, to);
        _distanceMeters = straight * 1.3;
        _durationSeconds = _distanceMeters! / 1000 / 25 * 3600;
        _routeError = 'Road route unavailable. Check internet and retry.';
      }
    });
    if (!hadRoute) _fitRoute();
  }

  /// Google Routes API first (same roads & traffic ETA as Google Maps), then
  /// two public OSRM servers as backups.
  Future<_RoadRoute?> _fetchRoadRoute(LatLng from, LatLng to) async {
    return await _googleRoute(from, to) ??
        await _osrmRoute('https://router.project-osrm.org', from, to) ??
        await _osrmRoute(
          'https://routing.openstreetmap.de/routed-car',
          from,
          to,
        );
  }

  Future<_RoadRoute?> _googleRoute(LatLng from, LatLng to) async {
    try {
      Map<String, dynamic> waypoint(LatLng p) => {
        'location': {
          'latLng': {'latitude': p.latitude, 'longitude': p.longitude},
        },
      };
      final response = await http
          .post(
            Uri.parse(Api.googleRoutesUrl),
            headers: {
              'Content-Type': 'application/json',
              'X-Goog-Api-Key': Api.googleMapsApiKey,
              'X-Goog-FieldMask':
                  'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
            },
            body: jsonEncode({
              'origin': waypoint(from),
              'destination': waypoint(to),
              'travelMode': _mode == _TravelMode.bike ? 'TWO_WHEELER' : 'DRIVE',
              'routingPreference': 'TRAFFIC_AWARE',
              'languageCode': 'en-IN',
              'units': 'METRIC',
            }),
          )
          .timeout(const Duration(seconds: 15));
      if (response.statusCode != 200) {
        if (kDebugMode) {
          debugPrint('Google Routes ${response.statusCode}: ${response.body}');
        }
        return null;
      }
      final body = jsonDecode(response.body);
      final routes = body is Map ? body['routes'] : null;
      if (routes is! List || routes.isEmpty) return null;
      final route = routes.first as Map;
      final encoded = (route['polyline'] as Map?)?['encodedPolyline'];
      if (encoded is! String) return null;
      final points = _decodePolyline(encoded);
      if (points.length < 2) return null;
      final seconds =
          double.tryParse('${route['duration'] ?? ''}'.replaceAll('s', '')) ??
          0;
      return _RoadRoute(
        points: points,
        distanceMeters:
            (route['distanceMeters'] as num?)?.toDouble() ??
            _pathMeters(points),
        durationSeconds: seconds,
      );
    } catch (e) {
      if (kDebugMode) debugPrint('Google Routes error: $e');
      return null;
    }
  }

  Future<_RoadRoute?> _osrmRoute(String base, LatLng from, LatLng to) async {
    final url =
        '$base/route/v1/driving/'
        '${from.longitude},${from.latitude};${to.longitude},${to.latitude}'
        '?overview=full&geometries=geojson';
    try {
      final response = await http
          .get(Uri.parse(url), headers: {'User-Agent': 'SarvamMFI/1.0'})
          .timeout(const Duration(seconds: 15));
      if (response.statusCode != 200) return null;
      final body = jsonDecode(response.body);
      if (body is! Map || body['code'] != 'Ok') return null;
      final routes = body['routes'];
      if (routes is! List || routes.isEmpty) return null;
      final route = routes.first as Map;
      final coords = (route['geometry'] as Map?)?['coordinates'];
      if (coords is! List) return null;
      final points = coords
          .whereType<List>()
          .where((c) => c.length >= 2)
          .map(
            (c) => LatLng((c[1] as num).toDouble(), (c[0] as num).toDouble()),
          )
          .toList();
      if (points.length < 2) return null;
      return _RoadRoute(
        points: points,
        distanceMeters: (route['distance'] as num).toDouble(),
        durationSeconds: (route['duration'] as num).toDouble(),
      );
    } catch (e) {
      if (kDebugMode) debugPrint('OSRM ($base) error: $e');
      return null;
    }
  }

  /// Decodes a Google encoded polyline into points.
  static List<LatLng> _decodePolyline(String encoded) {
    final points = <LatLng>[];
    var index = 0, lat = 0, lng = 0;
    while (index < encoded.length) {
      for (var coord = 0; coord < 2; coord++) {
        var shift = 0, result = 0, b = 0;
        do {
          b = encoded.codeUnitAt(index++) - 63;
          result |= (b & 0x1f) << shift;
          shift += 5;
        } while (b >= 0x20 && index < encoded.length);
        final delta = (result & 1) != 0 ? ~(result >> 1) : (result >> 1);
        if (coord == 0) {
          lat += delta;
        } else {
          lng += delta;
        }
      }
      points.add(LatLng(lat / 1e5, lng / 1e5));
    }
    return points;
  }

  void _resetRoute() {
    _routeRequestId++;
    _routePoints = const [];
    _distanceMeters = null;
    _durationSeconds = null;
    _routeError = null;
    _lastRouteAt = null;
    _loadingRoute = false;
  }

  void _selectTarget(int index) {
    if (index == _selected || widget.targets[index].point == null) return;
    setState(() {
      _selected = index;
      _resetRoute();
    });
    _loadRoute();
  }

  void _selectMode(_TravelMode mode) {
    if (mode == _mode) return;
    setState(() {
      _mode = mode;
      _resetRoute();
    });
    _loadRoute();
  }

  Future<void> _fitRoute() async {
    final map = _map;
    final to = _target.point;
    if (map == null || to == null) return;
    final pts = [..._routePoints, ?_current, to];
    if (pts.length < 2) {
      await map.animateCamera(CameraUpdate.newLatLngZoom(to, 15));
      return;
    }
    final bounds = LatLngBounds(
      southwest: LatLng(
        pts.map((p) => p.latitude).reduce(math.min),
        pts.map((p) => p.longitude).reduce(math.min),
      ),
      northeast: LatLng(
        pts.map((p) => p.latitude).reduce(math.max),
        pts.map((p) => p.longitude).reduce(math.max),
      ),
    );
    setState(() => _following = false);
    try {
      await map.animateCamera(CameraUpdate.newLatLngBounds(bounds, 60));
    } catch (_) {
      // Map not laid out yet — the next position update will retry.
    }
  }

  void _recenter() {
    final here = _current;
    if (here == null) return;
    setState(() => _following = true);
    _map?.animateCamera(CameraUpdate.newLatLngZoom(here, 17));
  }

  Future<void> _startNavigation() async {
    final to = _target.point;
    if (to == null) return;
    final bike = _mode == _TravelMode.bike;
    final app = Uri.parse(
      'google.navigation:q=${to.latitude},${to.longitude}&mode=${bike ? 'l' : 'd'}',
    );
    final web = Uri.parse(
      'https://www.google.com/maps/dir/?api=1'
      '${_current != null ? '&origin=${_current!.latitude},${_current!.longitude}' : ''}'
      '&destination=${to.latitude},${to.longitude}'
      '&travelmode=${bike ? 'two-wheeler' : 'driving'}&dir_action=navigate',
    );
    try {
      if (await launchUrl(app, mode: LaunchMode.externalApplication)) return;
    } catch (_) {}
    try {
      if (await launchUrl(web, mode: LaunchMode.externalApplication)) return;
    } catch (_) {}
    Get.snackbar(
      'Navigation',
      'Could not open Google Maps on this device.',
      snackPosition: SnackPosition.BOTTOM,
      backgroundColor: Colors.redAccent,
      colorText: Colors.white,
      margin: EdgeInsets.all(16.w),
    );
  }

  // ── Geometry helpers ──────────────────────────────────────────────────

  static double _meters(LatLng a, LatLng b) => Geolocator.distanceBetween(
    a.latitude,
    a.longitude,
    b.latitude,
    b.longitude,
  );

  static double _pathMeters(List<LatLng> pts) {
    var total = 0.0;
    for (var i = 0; i < pts.length - 1; i++) {
      total += _meters(pts[i], pts[i + 1]);
    }
    return total;
  }

  String _formatKm(double meters) => meters < 1000
      ? '${meters.round()} m'
      : '${(meters / 1000).toStringAsFixed(meters < 10000 ? 2 : 1)} km';

  String _formatDuration(double seconds) {
    final mins = (seconds / 60).round();
    if (mins < 1) return '< 1 min';
    if (mins < 60) return '$mins min';
    final h = mins ~/ 60;
    final m = mins % 60;
    return m == 0 ? '$h hr' : '$h hr $m min';
  }

  // ── UI ────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final to = _target.point;
    final markers = <Marker>{
      if (to != null)
        Marker(
          markerId: const MarkerId('destination'),
          position: to,
          infoWindow: InfoWindow(title: _target.label, snippet: _target.name),
          icon: BitmapDescriptor.defaultMarkerWithHue(_target.hue),
        ),
    };
    // Google-Maps look: a darker casing under a bright blue road line.
    final polylines = <Polyline>{
      if (_routePoints.length >= 2) ...{
        Polyline(
          polylineId: const PolylineId('route-casing'),
          points: _routePoints,
          color: _routeCasing,
          width: 10,
          zIndex: 1,
          startCap: Cap.roundCap,
          endCap: Cap.roundCap,
          jointType: JointType.round,
        ),
        Polyline(
          polylineId: const PolylineId('route'),
          points: _routePoints,
          color: _routeBlue,
          width: 7,
          zIndex: 2,
          startCap: Cap.roundCap,
          endCap: Cap.roundCap,
          jointType: JointType.round,
        ),
      },
    };

    return Scaffold(
      backgroundColor: const Color(0xFFF5FBF7),
      appBar: AppBar(
        backgroundColor: _green,
        foregroundColor: Colors.white,
        elevation: 0,
        title: Text(
          widget.title,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(fontSize: 17.sp, fontWeight: FontWeight.w800),
        ),
      ),
      body: Column(
        children: [
          _targetSelector(),
          Expanded(
            child: Stack(
              children: [
                GoogleMap(
                  initialCameraPosition: CameraPosition(
                    target: to ?? _current ?? const LatLng(10.0104, 77.4768),
                    zoom: 14,
                  ),
                  onMapCreated: (c) {
                    _map = c;
                    _fitRoute();
                  },
                  myLocationEnabled: _current != null,
                  myLocationButtonEnabled: false,
                  zoomControlsEnabled: false,
                  compassEnabled: true,
                  trafficEnabled: true,
                  markers: markers,
                  polylines: polylines,
                ),
                Positioned(
                  right: 12.w,
                  top: 12.h,
                  child: Column(
                    children: [
                      _mapButton(
                        Icons.my_location_rounded,
                        _recenter,
                        active: _following,
                      ),
                      SizedBox(height: 8.h),
                      _mapButton(Icons.alt_route_rounded, _fitRoute),
                    ],
                  ),
                ),
                if (_loadingRoute)
                  Positioned(
                    top: 12.h,
                    left: 12.w,
                    child: _pill(
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          SizedBox(
                            width: 14.w,
                            height: 14.w,
                            child: const CircularProgressIndicator(
                              strokeWidth: 2,
                              color: _routeBlue,
                            ),
                          ),
                          SizedBox(width: 8.w),
                          Text(
                            'Finding best route…',
                            style: TextStyle(
                              fontSize: 11.sp,
                              color: _darkGreen,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ),
          _infoPanel(),
        ],
      ),
    );
  }

  Widget _pill(Widget child) => Container(
    padding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 8.h),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(20.r),
      boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 6)],
    ),
    child: child,
  );

  Widget _targetSelector() {
    return Container(
      color: Colors.white,
      padding: EdgeInsets.fromLTRB(12.w, 10.h, 12.w, 10.h),
      child: Row(
        children: [
          for (var i = 0; i < widget.targets.length; i++) ...[
            if (i > 0) SizedBox(width: 8.w),
            Expanded(child: _targetChip(i)),
          ],
        ],
      ),
    );
  }

  Widget _targetChip(int index) {
    final t = widget.targets[index];
    final selected = index == _selected;
    final enabled = t.point != null;
    return InkWell(
      onTap: enabled ? () => _selectTarget(index) : null,
      borderRadius: BorderRadius.circular(10.r),
      child: Opacity(
        opacity: enabled ? 1 : .45,
        child: Container(
          padding: EdgeInsets.symmetric(vertical: 8.h, horizontal: 6.w),
          decoration: BoxDecoration(
            color: selected ? _green : _lightGreen,
            borderRadius: BorderRadius.circular(10.r),
          ),
          child: Column(
            children: [
              Icon(
                t.icon,
                size: 18.sp,
                color: selected ? Colors.white : _darkGreen,
              ),
              SizedBox(height: 3.h),
              Text(
                t.label,
                style: TextStyle(
                  fontSize: 11.sp,
                  fontWeight: FontWeight.w800,
                  color: selected ? Colors.white : _darkGreen,
                ),
              ),
              Text(
                enabled ? t.name : 'No location',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 9.sp,
                  color: selected ? const Color(0xFFCFEBDA) : _mutedGreen,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _mapButton(IconData icon, VoidCallback onTap, {bool active = false}) {
    return Material(
      color: Colors.white,
      shape: const CircleBorder(),
      elevation: 3,
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: Padding(
          padding: EdgeInsets.all(10.w),
          child: Icon(
            icon,
            size: 20.sp,
            color: active ? _routeBlue : _darkGreen,
          ),
        ),
      ),
    );
  }

  Widget _modeToggle() {
    Widget option(_TravelMode mode, IconData icon, String label) {
      final selected = _mode == mode;
      return Expanded(
        child: InkWell(
          onTap: () => _selectMode(mode),
          borderRadius: BorderRadius.circular(20.r),
          child: Container(
            padding: EdgeInsets.symmetric(vertical: 7.h),
            decoration: BoxDecoration(
              color: selected ? _routeBlue : Colors.transparent,
              borderRadius: BorderRadius.circular(20.r),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  icon,
                  size: 16.sp,
                  color: selected ? Colors.white : _darkGreen,
                ),
                SizedBox(width: 5.w),
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 12.sp,
                    fontWeight: FontWeight.w700,
                    color: selected ? Colors.white : _darkGreen,
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Container(
      padding: EdgeInsets.all(3.w),
      decoration: BoxDecoration(
        color: const Color(0xFFEFF4FB),
        borderRadius: BorderRadius.circular(22.r),
      ),
      child: Row(
        children: [
          option(_TravelMode.bike, Icons.two_wheeler_rounded, 'Bike'),
          option(_TravelMode.car, Icons.directions_car_rounded, 'Car'),
        ],
      ),
    );
  }

  Widget _infoPanel() {
    final to = _target.point;
    final distance = _distanceMeters;
    final duration = _durationSeconds;
    final hasRoute = _routePoints.length >= 2;
    final arrival = duration == null
        ? null
        : DateFormat(
            'h:mm a',
          ).format(DateTime.now().add(Duration(seconds: duration.round())));

    return Container(
      padding: EdgeInsets.fromLTRB(16.w, 12.h, 16.w, 12.h),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(20.r)),
        boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 10)],
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (_locationError != null)
              _notice(
                Icons.location_off_outlined,
                _locationError!,
                actionLabel: 'Retry',
                onAction: _startLocationUpdates,
              )
            else if (to == null)
              _notice(
                Icons.wrong_location_outlined,
                'No GPS location is saved for this ${_target.label.toLowerCase()}.',
              )
            else ...[
              _modeToggle(),
              SizedBox(height: 12.h),
              Row(
                children: [
                  Expanded(
                    child: _metric(
                      Icons.schedule_rounded,
                      duration == null ? '--' : _formatDuration(duration),
                      arrival == null ? 'Estimated time' : 'Arrive by $arrival',
                      highlight: true,
                    ),
                  ),
                  Container(width: 1, height: 40.h, color: _border),
                  Expanded(
                    child: _metric(
                      Icons.straighten_rounded,
                      distance == null
                          ? '--'
                          : '${hasRoute ? '' : '~'}${_formatKm(distance)}',
                      hasRoute ? 'Road distance' : 'Approx. distance',
                    ),
                  ),
                ],
              ),
              if (_routeError != null) ...[
                SizedBox(height: 8.h),
                _notice(
                  Icons.route_outlined,
                  _routeError!,
                  actionLabel: 'Retry',
                  onAction: () {
                    _lastRouteAt = null;
                    _loadRoute();
                  },
                ),
              ],
              SizedBox(height: 8.h),
              Row(
                children: [
                  Icon(_target.icon, size: 16.sp, color: _mutedGreen),
                  SizedBox(width: 6.w),
                  Expanded(
                    child: Text(
                      '${_target.label}: ${_target.name}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 12.sp, color: _mutedGreen),
                    ),
                  ),
                  if (_current == null)
                    Text(
                      'Getting your location…',
                      style: TextStyle(fontSize: 11.sp, color: _mutedGreen),
                    ),
                ],
              ),
            ],
            SizedBox(height: 12.h),
            SizedBox(
              height: 50.h,
              child: FilledButton.icon(
                onPressed: to == null ? null : _startNavigation,
                icon: const Icon(Icons.navigation_rounded),
                label: Text(
                  'Start Navigation',
                  style: TextStyle(
                    fontSize: 14.sp,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                style: FilledButton.styleFrom(
                  backgroundColor: _routeBlue,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(25.r),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _metric(
    IconData icon,
    String value,
    String caption, {
    bool highlight = false,
  }) {
    return Column(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 18.sp, color: highlight ? _green : _darkGreen),
            SizedBox(width: 5.w),
            Flexible(
              child: Text(
                value,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 20.sp,
                  fontWeight: FontWeight.w800,
                  color: highlight ? _green : _darkGreen,
                ),
              ),
            ),
          ],
        ),
        SizedBox(height: 2.h),
        Text(
          caption,
          style: TextStyle(fontSize: 10.sp, color: _mutedGreen),
        ),
      ],
    );
  }

  Widget _notice(
    IconData icon,
    String message, {
    String? actionLabel,
    VoidCallback? onAction,
  }) {
    return Row(
      children: [
        Icon(icon, color: Colors.redAccent, size: 20.sp),
        SizedBox(width: 8.w),
        Expanded(
          child: Text(
            message,
            style: TextStyle(fontSize: 12.sp, color: _darkGreen),
          ),
        ),
        if (actionLabel != null)
          TextButton(onPressed: onAction, child: Text(actionLabel)),
      ],
    );
  }
}

class _RoadRoute {
  const _RoadRoute({
    required this.points,
    required this.distanceMeters,
    required this.durationSeconds,
  });

  final List<LatLng> points;
  final double distanceMeters;
  final double durationSeconds;
}
