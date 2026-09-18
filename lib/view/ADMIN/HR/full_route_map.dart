// ignore_for_file: deprecated_member_use

import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import 'route_details.dart';

/// FullRouteMap — a full-screen, edge-to-edge map view of a day's route with
/// numbered start/visited/pending/end markers, a route polyline, a legend,
/// a Map/Satellite segmented toggle, and a pulsing "current location" marker.
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
  static const _blue = Color(0xFF2563EB);

  late final AnimationController _entranceCtrl;
  late final Animation<double> _fade;
  late final AnimationController _pulseCtrl;

  GoogleMapController? _mapController;
  MapType _mapType = MapType.normal;

  final Map<String, BitmapDescriptor> _bitmapCache = {};
  bool _bitmapsReady = false;

  Offset? _currentMarkerOffset;
  Offset? _startLabelOffset;
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
    _pulseCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1400),
    )..repeat();
    _prepareBitmaps();
  }

  @override
  void dispose() {
    _entranceCtrl.dispose();
    _pulseCtrl.dispose();
    _mapController?.dispose();
    super.dispose();
  }

  int get _visitedCount =>
      widget.stops.where((s) => s.status != VisitStatus.pending).length;

  RouteStop? get _currentStop {
    if (!widget.inProgress || widget.stops.isEmpty) return null;
    return widget.stops.lastWhere(
      (s) => s.status != VisitStatus.pending,
      orElse: () => widget.stops.first,
    );
  }

  // ── Custom marker bitmap generation ────────────────────────────────────
  Future<BitmapDescriptor> _numberedPin({
    required String label,
    required Color color,
    bool isEnd = false,
  }) async {
    const double w = 110;
    const double h = 140;
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder, const Rect.fromLTWH(0, 0, w, h));

    final center = const Offset(w / 2, w / 2 - 4);
    final radius = w / 2 - 10;

    // pin tail
    final tailPaint = Paint()..color = color;
    final tail = Path()
      ..moveTo(center.dx - 16, center.dy + radius - 8)
      ..lineTo(center.dx + 16, center.dy + radius - 8)
      ..lineTo(center.dx, center.dy + radius + 26)
      ..close();
    canvas.drawPath(tail, tailPaint);

    // white halo ring
    canvas.drawCircle(center, radius + 5, Paint()..color = Colors.white);
    // colored circle
    canvas.drawCircle(center, radius, Paint()..color = color);

    // number text
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

    if (isEnd) {
      // small flag glyph above the pin
      final poleTop = Offset(center.dx + radius - 6, center.dy - radius - 30);
      final poleBottom = Offset(center.dx + radius - 6, center.dy - radius + 6);
      canvas.drawLine(
        poleTop,
        poleBottom,
        Paint()
          ..color = _darkText
          ..strokeWidth = 3,
      );
      final flagPath = Path()
        ..moveTo(poleTop.dx, poleTop.dy)
        ..lineTo(poleTop.dx + 22, poleTop.dy + 6)
        ..lineTo(poleTop.dx, poleTop.dy + 12)
        ..close();
      canvas.drawPath(flagPath, Paint()..color = _darkText);
    }

    final picture = recorder.endRecording();
    final image = await picture.toImage(w.toInt(), h.toInt());
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    return BitmapDescriptor.fromBytes(data!.buffer.asUint8List());
  }

  Future<BitmapDescriptor> _currentLocationPin() async {
    const double size = 90;
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder, const Rect.fromLTWH(0, 0, size, size));
    final center = const Offset(size / 2, size / 2);
    canvas.drawCircle(center, size / 2 - 6, Paint()..color = _blue.withOpacity(0.18));
    canvas.drawCircle(center, size / 2 - 22, Paint()..color = Colors.white);
    canvas.drawCircle(center, size / 2 - 28, Paint()..color = _blue);
    final picture = recorder.endRecording();
    final image = await picture.toImage(size.toInt(), size.toInt());
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    return BitmapDescriptor.fromBytes(data!.buffer.asUint8List());
  }

  Future<void> _prepareBitmaps() async {
    for (var i = 0; i < widget.stops.length; i++) {
      final stop = widget.stops[i];
      final isEnd = i == widget.stops.length - 1;
      Color color;
      switch (stop.status) {
        case VisitStatus.completed:
        case VisitStatus.visited:
          color = isEnd ? _slateGrey : _greenAccent;
          break;
        case VisitStatus.pending:
          color = isEnd ? _slateGrey : _amber;
          break;
      }
      final key = '${stop.label}_${isEnd}_${color.value}';
      _bitmapCache[key] = await _numberedPin(
        label: stop.label == 'Start' ? '1' : stop.label,
        color: color,
        isEnd: isEnd,
      );
    }
    _bitmapCache['current'] = await _currentLocationPin();
    if (mounted) setState(() => _bitmapsReady = true);
  }

  BitmapDescriptor _bitmapFor(RouteStop stop, bool isEnd) {
    Color color;
    switch (stop.status) {
      case VisitStatus.completed:
      case VisitStatus.visited:
        color = isEnd ? _slateGrey : _greenAccent;
        break;
      case VisitStatus.pending:
        color = isEnd ? _slateGrey : _amber;
        break;
    }
    final key = '${stop.label}_${isEnd}_${color.value}';
    return _bitmapCache[key] ?? BitmapDescriptor.defaultMarker;
  }

  Set<Marker> _buildMarkers() {
    final markers = <Marker>{};
    for (var i = 0; i < widget.stops.length; i++) {
      final stop = widget.stops[i];
      final isEnd = i == widget.stops.length - 1;
      markers.add(
        Marker(
          markerId: MarkerId('stop_$i'),
          position: stop.position,
          icon: _bitmapFor(stop, isEnd),
          anchor: const Offset(0.5, 0.82),
          infoWindow: InfoWindow(title: stop.title, snippet: stop.address),
        ),
      );
    }
    final current = _currentStop;
    if (current != null) {
      markers.add(
        Marker(
          markerId: const MarkerId('current'),
          position: current.position,
          icon: _bitmapCache['current'] ?? BitmapDescriptor.defaultMarker,
          zIndex: 3,
          anchor: const Offset(0.5, 0.5),
        ),
      );
    }
    return markers;
  }

  Set<Polyline> _buildPolylines() {
    final visitedPoints = <LatLng>[];
    final pendingPoints = <LatLng>[];
    bool reachedPending = false;
    for (final stop in widget.stops) {
      if (stop.status == VisitStatus.pending) {
        if (!reachedPending && visitedPoints.isNotEmpty) {
          pendingPoints.add(visitedPoints.last);
        }
        reachedPending = true;
        pendingPoints.add(stop.position);
      } else {
        visitedPoints.add(stop.position);
      }
    }
    return {
      if (visitedPoints.length > 1)
        Polyline(
          polylineId: const PolylineId('visited'),
          points: visitedPoints,
          color: _greenAccent,
          width: 5,
          geodesic: true,
        ),
      if (pendingPoints.length > 1)
        Polyline(
          polylineId: const PolylineId('pending'),
          points: pendingPoints,
          color: _amber,
          width: 5,
          geodesic: true,
          patterns: [PatternItem.dash(20), PatternItem.gap(10)],
        ),
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

    final start = await toOffset(widget.stops.first.position);
    final end = await toOffset(widget.stops.last.position);
    Offset? current;
    final cur = _currentStop;
    if (cur != null) current = await toOffset(cur.position);
    if (!mounted) return;
    setState(() {
      _startLabelOffset = start;
      _endLabelOffset = end;
      _currentMarkerOffset = current;
    });
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
                    if (_startLabelOffset != null)
                      _floatingLabel(
                        _startLabelOffset!,
                        'Start',
                        _greenAccent,
                        dx: 26,
                      ),
                    if (_endLabelOffset != null)
                      _floatingLabel(
                        _endLabelOffset!,
                        'End',
                        _slateGrey,
                        dx: 26,
                      ),
                    if (_currentMarkerOffset != null)
                      _pulsingRing(_currentMarkerOffset!),
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
            _legendRow(Icons.location_on_rounded, _greenAccent, 'Visited Location'),
            SizedBox(height: 6.h),
            _legendRow(Icons.location_on_rounded, _amber, 'Pending Location'),
            SizedBox(height: 6.h),
            _legendRow(Icons.my_location_rounded, _blue, 'Current Location'),
            SizedBox(height: 6.h),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(width: 16.w, height: 3.h, color: _greenAccent),
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

  Widget _legendRow(IconData icon, Color color, String label) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 15.sp, color: color),
        SizedBox(width: 6.w),
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
      top: anchor.dy - 34,
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

  Widget _pulsingRing(Offset center) {
    return Positioned(
      left: center.dx - 28,
      top: center.dy - 28,
      child: IgnorePointer(
        child: AnimatedBuilder(
          animation: _pulseCtrl,
          builder: (context, child) {
            final t = _pulseCtrl.value;
            return Opacity(
              opacity: (1 - t).clamp(0.0, 1.0),
              child: Transform.scale(
                scale: 0.4 + t * 1.3,
                child: Container(
                  width: 56,
                  height: 56,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: _blue.withOpacity(0.35),
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}
