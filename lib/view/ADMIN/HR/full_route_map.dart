// ignore_for_file: deprecated_member_use

import 'dart:async';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:sarvam/services/hr_api_service.dart';

import 'route_details.dart';

/// FullRouteMap — a full-screen, edge-to-edge map view of a day's route with
/// punch-in/punch-out markers and a route polyline. Auto-tracking points are
/// used exclusively to draw the route and never rendered as map markers.
/// Reached from RouteDetails' "View Full Route on Map" button.
class FullRouteMap extends StatefulWidget {
  const FullRouteMap({
    super.key,
    required this.dateLabel,
    required this.inProgress,
    required this.distanceKm,
    required this.totalDuration,
    required this.stops,
  });

  final String dateLabel;
  final bool inProgress;
  final double distanceKm;
  final String totalDuration;
  final List<RouteStop> stops;

  @override
  State<FullRouteMap> createState() => _FullRouteMapState();
}

class _FullRouteMapState extends State<FullRouteMap>
    with TickerProviderStateMixin {
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);
  static const _greenAccent = Color(0xFF0D6842);
  static const _amber = Color(0xFFF59E0B);
  static const _slateGrey = Color(0xFF64748B);
  static const _outRed = Color(0xFFE5202E);
  static const _routeBlue = Color(0xFF1565FF);

  late final AnimationController _entranceCtrl;
  late final Animation<double> _fade;

  GoogleMapController? _mapController;
  MapType _mapType = MapType.normal;
  List<LatLng> _roadVisitedPoints = const [];
  bool _roadSnapped = false;

  /// Once the route is snapped to roads, pin IN/OUT on the line itself: the
  /// raw punch fix is often a few metres inside a building.
  LatLng _pinPosition(LatLng raw, {required bool isEnd}) {
    if (!_roadSnapped || _roadVisitedPoints.isEmpty) return raw;
    return isEnd ? _roadVisitedPoints.last : _roadVisitedPoints.first;
  }

  final Map<String, BitmapDescriptor> _bitmapCache = {};
  bool _bitmapsReady = false;

  List<LatLng>? _arrowSource;
  Set<Marker> _arrowCache = const {};

  Offset? _endLabelOffset;

  @override
  void initState() {
    super.initState();
    _entranceCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 650),
    );
    _fade = CurvedAnimation(parent: _entranceCtrl, curve: Curves.easeOut);
    _entranceCtrl.forward();
    // Auto-tracking coordinates immediately form the visible route line
    _roadVisitedPoints = orderedVisitedRouteStops(widget.stops)
        .map((s) => s.position)
        .toList();
    _prepareBitmaps();
    unawaited(_loadRoadRoute());
  }

  Future<void> _loadRoadRoute() async {
    final visited = orderedVisitedRouteStops(widget.stops)
        .map((stop) => <String, double>{
              'latitude': stop.position.latitude,
              'longitude': stop.position.longitude,
            })
        .toList();
    if (visited.length < 2) return;
    try {
      final roadPoints = await HrApiService.roadRoute(visited);
      if (!mounted || roadPoints.length < 2) return;
      setState(() {
        _roadSnapped = true;
        _roadVisitedPoints = roadPoints
            .map((point) => LatLng(point['latitude']!, point['longitude']!))
            .toList();
      });
    } catch (_) {
      // Keep direct auto-tracking GPS points fallback already in place
    }
  }

  @override
  void dispose() {
    _entranceCtrl.dispose();
    _mapController?.dispose();
    super.dispose();
  }

  int get _visitedCount =>
      widget.stops.where((s) => s.status != VisitStatus.pending).length;

  // ── Custom marker bitmap generation ────────────────────────────────────
  /// Round badge (white ring, soft shadow, bold label) — the IN / OUT pin.
  Future<BitmapDescriptor> _badgePin({
    required String label,
    required Color color,
  }) async {
    const double size = 110;
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder, const Rect.fromLTWH(0, 0, size, size));
    const center = Offset(size / 2, size / 2);
    const radius = size / 2 - 12;

    canvas.drawCircle(
      center.translate(0, 3),
      radius + 6,
      Paint()
        ..color = Colors.black.withOpacity(0.28)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 5),
    );
    canvas.drawCircle(center, radius + 6, Paint()..color = Colors.white);
    canvas.drawCircle(center, radius, Paint()..color = color);

    final textPainter = TextPainter(
      text: TextSpan(
        text: label,
        style: const TextStyle(
          fontSize: 34,
          fontWeight: FontWeight.w800,
          color: Colors.white,
          fontFamily: 'Roboto',
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    textPainter.paint(
      canvas,
      Offset(center.dx - textPainter.width / 2, center.dy - textPainter.height / 2),
    );

    final image = await recorder.endRecording().toImage(size.toInt(), size.toInt());
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    return BitmapDescriptor.fromBytes(data!.buffer.asUint8List());
  }

  /// White chevron pointing north; markers rotate it to the travel bearing.
  Future<BitmapDescriptor> _arrowIcon() async {
    const double size = 44;
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder, const Rect.fromLTWH(0, 0, size, size));
    final chevron = Path()
      ..moveTo(size * 0.2, size * 0.62)
      ..lineTo(size * 0.5, size * 0.32)
      ..lineTo(size * 0.8, size * 0.62);
    canvas.drawPath(
      chevron,
      Paint()
        ..color = Colors.white
        ..style = PaintingStyle.stroke
        ..strokeWidth = 7
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round,
    );
    final image = await recorder.endRecording().toImage(size.toInt(), size.toInt());
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    return BitmapDescriptor.fromBytes(data!.buffer.asUint8List());
  }

  Future<void> _prepareBitmaps() async {
    if (widget.stops.isEmpty) return;
    _bitmapCache['punch_in'] = await _badgePin(label: 'IN', color: _greenAccent);
    _bitmapCache['punch_out'] = await _badgePin(label: 'OUT', color: _outRed);
    _bitmapCache['arrow'] = await _arrowIcon();
    for (final stop in milestoneStops(widget.stops)) {
      _bitmapCache['stop_${stop.label}'] =
          await roundBadgePin(label: stop.label, color: milestonePinColor);
    }
    if (mounted) setState(() => _bitmapsReady = true);
  }

  /// Direction arrows spread along the path. Spacing scales with route length
  /// so short routes still get a few arrows and long ones don't get crowded.
  Set<Marker> _arrowMarkers(List<LatLng> points) {
    if (!identical(points, _arrowSource)) {
      _arrowSource = points;
      _arrowCache = _computeArrowMarkers(points);
    }
    return _arrowCache;
  }

  Set<Marker> _computeArrowMarkers(List<LatLng> points) {
    final icon = _bitmapCache['arrow'];
    if (icon == null || points.length < 2) return const {};

    var total = 0.0;
    for (var i = 1; i < points.length; i++) {
      total += Geolocator.distanceBetween(
        points[i - 1].latitude,
        points[i - 1].longitude,
        points[i].latitude,
        points[i].longitude,
      );
    }
    final spacing = (total / 12).clamp(60.0, 400.0);

    final markers = <Marker>{};
    var sinceLast = spacing / 2;
    for (var i = 1; i < points.length; i++) {
      final a = points[i - 1];
      final b = points[i];
      final segment = Geolocator.distanceBetween(
        a.latitude,
        a.longitude,
        b.latitude,
        b.longitude,
      );
      if (segment < 1) continue;
      sinceLast += segment;
      if (sinceLast < spacing) continue;
      sinceLast = 0;
      markers.add(
        Marker(
          markerId: MarkerId('arrow_$i'),
          position: LatLng(
            (a.latitude + b.latitude) / 2,
            (a.longitude + b.longitude) / 2,
          ),
          icon: icon,
          rotation: Geolocator.bearingBetween(
            a.latitude,
            a.longitude,
            b.latitude,
            b.longitude,
          ),
          flat: true,
          anchor: const Offset(0.5, 0.5),
          zIndex: 1,
          consumeTapEvents: false,
        ),
      );
    }
    return markers;
  }

  BitmapDescriptor _bitmapFor(RouteStop stop, bool isEnd) {
    final key = isEnd ? 'punch_out' : 'punch_in';
    return _bitmapCache[key] ??
        BitmapDescriptor.defaultMarkerWithHue(
          isEnd ? BitmapDescriptor.hueRed : BitmapDescriptor.hueGreen,
        );
  }

  Set<Marker> _buildMarkers() {
    final markers = <Marker>{};
    if (widget.stops.isEmpty) return markers;
    markers.addAll(_arrowMarkers(_roadVisitedPoints));

    // Auto-tracking locations supply the polyline only. Showing a pin for
    // every 50m breadcrumb makes the map unreadable, so retain pins solely
    // for punch-in and (once completed) punch-out.
    RouteStop? punchIn;
    try {
      punchIn = widget.stops.firstWhere(
        (s) => s.title.toLowerCase().contains('punch-in') || s.label == 'Start',
      );
    } catch (_) {
      punchIn = widget.stops.first;
    }
    markers.add(
      Marker(
        markerId: const MarkerId('punch_in'),
        position: _pinPosition(punchIn.position, isEnd: false),
        icon: _bitmapFor(punchIn, false),
        anchor: const Offset(0.5, 0.5),
        zIndex: 2,
        infoWindow: InfoWindow(title: 'Punch-In', snippet: punchIn.address),
      ),
    );

    if (!widget.inProgress && widget.stops.length > 1) {
      RouteStop? punchOut;
      try {
        punchOut = widget.stops.lastWhere(
          (s) => s.title.toLowerCase().contains('punch-out') || s.label == 'End',
        );
      } catch (_) {
        punchOut = widget.stops.last;
      }
      markers.add(
        Marker(
          markerId: const MarkerId('punch_out'),
          position: _pinPosition(punchOut.position, isEnd: true),
          icon: _bitmapFor(punchOut, true),
          anchor: const Offset(0.5, 0.5),
          zIndex: 3,
          infoWindow: InfoWindow(title: 'Punch-Out', snippet: punchOut.address),
        ),
      );
    }

    // Visits, collections, centre creation, enrolments — numbered like the
    // Location Details list.
    for (final stop in milestoneStops(widget.stops)) {
      final icon = _bitmapCache['stop_${stop.label}'];
      if (icon == null) continue;
      markers.add(
        Marker(
          markerId: MarkerId('stop_${stop.label}'),
          position: stop.position,
          icon: icon,
          anchor: const Offset(0.5, 0.5),
          zIndex: 2.5,
          infoWindow: InfoWindow(
            title: stop.title,
            snippet: '${stop.time} · ${stop.address}',
          ),
        ),
      );
    }
    return markers;
  }

  Set<Polyline> _buildPolylines() {
    final points = _roadVisitedPoints.isNotEmpty
        ? _roadVisitedPoints
        : orderedVisitedRouteStops(widget.stops).map((s) => s.position).toList();
    // A wider white casing under the blue line keeps the route legible on
    // both the map and satellite layers.
    return {
      if (points.length > 1) ...[
        Polyline(
          polylineId: const PolylineId('visited_casing'),
          points: points,
          color: Colors.white,
          width: 10,
          geodesic: false,
          startCap: Cap.roundCap,
          endCap: Cap.roundCap,
          jointType: JointType.round,
          zIndex: 1,
        ),
        Polyline(
          polylineId: const PolylineId('visited'),
          points: points,
          color: _routeBlue,
          width: 7,
          geodesic: false,
          startCap: Cap.roundCap,
          endCap: Cap.roundCap,
          jointType: JointType.round,
          zIndex: 2,
        ),
      ],
    };
  }

  Future<void> _fitBounds() async {
    final controller = _mapController;
    if (controller == null || widget.stops.isEmpty) return;
    double minLat = widget.stops.first.position.latitude;
    double maxLat = minLat;
    double minLng = widget.stops.first.position.longitude;
    double maxLng = minLng;
    for (final s in widget.stops) {
      minLat = minLat < s.position.latitude ? minLat : s.position.latitude;
      maxLat = maxLat > s.position.latitude ? maxLat : s.position.latitude;
      minLng = minLng < s.position.longitude ? minLng : s.position.longitude;
      maxLng = maxLng > s.position.longitude ? maxLng : s.position.longitude;
    }
    await controller.animateCamera(
      CameraUpdate.newLatLngBounds(
        LatLngBounds(
          southwest: LatLng(minLat, minLng),
          northeast: LatLng(maxLat, maxLng),
        ),
        70,
      ),
    );
    await _updateOverlayPositions();
  }

  Future<void> _updateOverlayPositions() async {
    final controller = _mapController;
    if (controller == null || widget.stops.isEmpty || !mounted) return;
    final dpr = MediaQuery.of(context).devicePixelRatio;

    Future<Offset> toOffset(LatLng pos) async {
      final sc = await controller.getScreenCoordinate(pos);
      return Offset(sc.x / dpr, sc.y / dpr);
    }

    final end = !widget.inProgress && widget.stops.length > 1
        ? await toOffset(_pinPosition(widget.stops.last.position, isEnd: true))
        : null;
    if (!mounted) return;
    setState(() => _endLabelOffset = end);
  }

  void _toggleMapType(MapType type) {
    if (_mapType == type) return;
    setState(() => _mapType = type);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Column(
          children: [
            _buildHeader(context),
            _buildStatsBar(),
            Expanded(
              child: FadeTransition(
                opacity: _fade,
                child: Stack(
                  children: [
                    Positioned.fill(
                      child: _bitmapsReady
                          ? GoogleMap(
                              initialCameraPosition: CameraPosition(
                                target: widget.stops.first.position,
                                zoom: 11.5,
                              ),
                              mapType: _mapType,
                              markers: _buildMarkers(),
                              polylines: _buildPolylines(),
                              myLocationButtonEnabled: false,
                              zoomControlsEnabled: false,
                              compassEnabled: false,
                              onMapCreated: (controller) async {
                                _mapController = controller;
                                await _fitBounds();
                              },
                              onCameraIdle: _updateOverlayPositions,
                            )
                          : const Center(child: CircularProgressIndicator()),
                    ),
                    if (_endLabelOffset != null)
                      _floatingLabel(
                        _endLabelOffset!,
                        'End',
                        _slateGrey,
                        dx: 26,
                      ),
                    Positioned(top: 12.h, left: 12.w, child: _buildLegend()),
                    Positioned(
                      top: 12.h,
                      right: 12.w,
                      child: _buildMapTypeSegment(),
                    ),
                    Positioned(
                      right: 12.w,
                      top: 66.h,
                      child: _circleButton(
                        icon: Icons.my_location_rounded,
                        onTap: _fitBounds,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── Header ──────────────────────────────────────────────────────────────
  Widget _buildHeader(BuildContext context) {
    return Container(
      padding: EdgeInsets.fromLTRB(12.w, 10.h, 20.w, 12.h),
      color: Colors.white,
      child: Row(
        children: [
          IconButton(
            onPressed: () => Navigator.of(context).maybePop(),
            icon: Icon(Icons.arrow_back_rounded, color: _darkText, size: 22.sp),
          ),
          Container(
            width: 34.w,
            height: 34.w,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: _greenAccent.withOpacity(0.1),
              borderRadius: BorderRadius.circular(10.r),
            ),
            child: Icon(Icons.route_rounded, color: _greenAccent, size: 18.sp),
          ),
          SizedBox(width: 10.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Full Route on Map',
                  style: GoogleFonts.inter(
                    fontSize: 17.sp,
                    fontWeight: FontWeight.w700,
                    color: _darkText,
                  ),
                ),
                Text(
                  widget.dateLabel,
                  style: GoogleFonts.inter(fontSize: 11.sp, color: _muted),
                ),
              ],
            ),
          ),
          SizedBox(width: 8.w),
          Image.asset(
            'assets/icon/Sarvam_01.png',
            width: 100.w,
            height: 38.h,
            fit: BoxFit.contain,
            alignment: Alignment.centerRight,
          ),
        ],
      ),
    );
  }

  // ── Stats bar ───────────────────────────────────────────────────────────
  Widget _buildStatsBar() {
    return FadeTransition(
      opacity: _fade,
      child: Container(
        margin: EdgeInsets.fromLTRB(14.w, 0, 14.w, 10.h),
        padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 10.h),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14.r),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.06),
              blurRadius: 10,
              offset: const Offset(0, 3),
            ),
          ],
        ),
        child: Row(
          children: [
            Expanded(
              child: _statCell(
                Icons.location_on_rounded,
                _greenAccent,
                '$_visitedCount / ${widget.stops.length}',
                'Locations Visited',
              ),
            ),
            Expanded(
              child: _statCell(
                Icons.route_rounded,
                _greenAccent,
                '${widget.distanceKm} km',
                'Distance Travelled',
              ),
            ),
            Expanded(
              child: _statCell(
                Icons.access_time_filled_rounded,
                _greenAccent,
                widget.totalDuration,
                'Total Duration',
              ),
            ),
            Expanded(
              child: _statCell(
                Icons.flag_rounded,
                widget.inProgress ? _amber : _greenAccent,
                widget.inProgress ? 'In Progress' : 'Completed',
                'Route Status',
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _statCell(IconData icon, Color color, String value, String label) {
    return Column(
      children: [
        Icon(icon, color: color, size: 18.sp),
        SizedBox(height: 5.h),
        Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: GoogleFonts.inter(
            fontSize: 12.sp,
            fontWeight: FontWeight.w800,
            color: _darkText,
          ),
        ),
        Text(
          label,
          textAlign: TextAlign.center,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: GoogleFonts.inter(fontSize: 8.sp, color: _muted),
        ),
      ],
    );
  }

  // ── Legend ──────────────────────────────────────────────────────────────
  Widget _buildLegend() {
    return FadeTransition(
      opacity: _fade,
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 10.h),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12.r),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.12),
              blurRadius: 8,
              offset: const Offset(0, 3),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _legendRow('IN', _greenAccent, 'Punch-In'),
            SizedBox(height: 6.h),
            _legendRow('OUT', _outRed, 'Punch-Out'),
            if (milestoneStops(widget.stops).isNotEmpty) ...[
              SizedBox(height: 6.h),
              _legendRow('1', milestonePinColor, 'Visit / Centre'),
            ],
            SizedBox(height: 6.h),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 24.w,
                  height: 4.h,
                  decoration: BoxDecoration(
                    color: _routeBlue,
                    borderRadius: BorderRadius.circular(4.r),
                  ),
                ),
                SizedBox(width: 8.w),
                Text(
                  'Route Path',
                  style: GoogleFonts.inter(fontSize: 10.5.sp, color: _darkText),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _legendRow(String badge, Color color, String label) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 24.w,
          height: 24.w,
          alignment: Alignment.center,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          child: Text(
            badge,
            style: GoogleFonts.inter(
              fontSize: 7.5.sp,
              fontWeight: FontWeight.w800,
              color: Colors.white,
            ),
          ),
        ),
        SizedBox(width: 8.w),
        Text(label, style: GoogleFonts.inter(fontSize: 10.5.sp, color: _darkText)),
      ],
    );
  }

  // ── Map type segmented control ─────────────────────────────────────────
  Widget _buildMapTypeSegment() {
    final isNormal = _mapType == MapType.normal;
    return FadeTransition(
      opacity: _fade,
      child: Container(
        padding: EdgeInsets.all(3.w),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(30.r),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.12),
              blurRadius: 8,
              offset: const Offset(0, 3),
            ),
          ],
        ),
        child: Stack(
          children: [
            AnimatedAlign(
              duration: const Duration(milliseconds: 220),
              curve: Curves.easeOutCubic,
              alignment: isNormal ? Alignment.centerLeft : Alignment.centerRight,
              child: Container(
                width: 78.w,
                height: 30.h,
                decoration: BoxDecoration(
                  color: _greenAccent,
                  borderRadius: BorderRadius.circular(24.r),
                ),
              ),
            ),
            Row(
              children: [
                _segmentLabel('Map', isNormal, () => _toggleMapType(MapType.normal)),
                _segmentLabel(
                  'Satellite',
                  !isNormal,
                  () => _toggleMapType(MapType.satellite),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _segmentLabel(String label, bool selected, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 78.w,
        height: 30.h,
        alignment: Alignment.center,
        child: Text(
          label,
          style: GoogleFonts.inter(
            fontSize: 11.5.sp,
            fontWeight: FontWeight.w700,
            color: selected ? Colors.white : _darkText,
          ),
        ),
      ),
    );
  }

  Widget _circleButton({required IconData icon, required VoidCallback onTap}) {
    return Material(
      color: Colors.white,
      shape: const CircleBorder(),
      elevation: 3,
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: Padding(
          padding: EdgeInsets.all(10.w),
          child: Icon(icon, color: _greenAccent, size: 18.sp),
        ),
      ),
    );
  }

  // ── Floating labels + pulsing current-location ring ────────────────────
  Widget _floatingLabel(Offset anchor, String text, Color color, {double dx = 0}) {
    return Positioned(
      left: anchor.dx + dx,
      top: anchor.dy - 13.h,
      child: IgnorePointer(
        child: Container(
          padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 4.h),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(20.r),
            border: Border.all(color: color.withOpacity(0.4)),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.1),
                blurRadius: 4,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          child: Text(
            text,
            style: GoogleFonts.inter(
              fontSize: 10.sp,
              fontWeight: FontWeight.w700,
              color: color,
            ),
          ),
        ),
      ),
    );
  }

}
