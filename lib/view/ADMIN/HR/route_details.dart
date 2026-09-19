// ignore_for_file: deprecated_member_use

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:sarvam/services/hr_api_service.dart';

import 'full_route_map.dart';

enum VisitStatus { completed, visited, pending }

class RouteStop {
  final String label; // 'Start', '1', '2' ...
  final String time; // '09:05 AM' or '--:--'
  final String title;
  final String address;
  final VisitStatus status;
  final LatLng position;
  final DateTime? timestamp;

  const RouteStop({
    required this.label,
    required this.time,
    required this.title,
    required this.address,
    required this.status,
    required this.position,
    this.timestamp,
  });
}

/// Sanitizes the tracking path before it reaches either map. The server sends
/// timestamps, but sorting here as well prevents an out-of-order response from
/// producing cross-map/spaghetti segments. Exact duplicate GPS readings and
/// invalid coordinates are never rendered as route vertices.
List<RouteStop> orderedVisitedRouteStops(List<RouteStop> stops) {
  final indexed = stops
      .asMap()
      .entries
      .where((entry) {
        final point = entry.value.position;
        return entry.value.status != VisitStatus.pending &&
            point.latitude >= -90 && point.latitude <= 90 &&
            point.longitude >= -180 && point.longitude <= 180 &&
            !(point.latitude == 0 && point.longitude == 0);
      })
      .toList()
    ..sort((a, b) {
      final aTime = a.value.timestamp;
      final bTime = b.value.timestamp;
      if (aTime == null && bTime == null) return a.key.compareTo(b.key);
      if (aTime == null) return 1;
      if (bTime == null) return -1;
      final comparison = aTime.compareTo(bTime);
      return comparison == 0 ? a.key.compareTo(b.key) : comparison;
    });
  final seen = <String>{};
  return indexed
      .map((entry) => entry.value)
      .where((stop) => seen.add(
            '${stop.position.latitude.toStringAsFixed(6)},'
            '${stop.position.longitude.toStringAsFixed(6)}',
          ))
      .toList();
}

/// RouteDetails — shows a single day's field-visit route on a Google Map
/// (start marker, numbered visited/pending stops, polyline path) plus a
/// location-by-location breakdown. Reached by tapping "View Route" on a
/// LiveTracking day card.
class RouteDetails extends StatefulWidget {
  const RouteDetails({
    super.key,
    required this.dateLabel,
    required this.isToday,
    required this.inProgress,
    required this.punchInTime,
    required this.distanceKm,
    required this.totalDuration,
    required this.stops,
  });

  final String dateLabel;
  final bool isToday;
  final bool inProgress;
  final String punchInTime;
  final double distanceKm;
  final String totalDuration;
  final List<RouteStop> stops;

  @override
  State<RouteDetails> createState() => _RouteDetailsState();
}

class _RouteDetailsState extends State<RouteDetails>
    with SingleTickerProviderStateMixin {
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);
  static const _greenAccent = Color(0xFF0D6842);
  static const _greenLight = Color(0xFFE8F5E9);
  static const _amber = Color(0xFFF59E0B);
  static const _amberLight = Color(0xFFFEF3C7);
  static const _borderColor = Color(0xFFE2E8F0);
  static const _slateGrey = Color(0xFF64748B);

  late final AnimationController _ctrl;
  late final Animation<double> _fade;
  late final Animation<Offset> _slide;

  GoogleMapController? _mapController;
  MapType _mapType = MapType.normal;
  List<LatLng> _roadVisitedPoints = const [];

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 750),
    );
    _fade = CurvedAnimation(parent: _ctrl, curve: Curves.easeOut);
    _slide = Tween<Offset>(
      begin: const Offset(0, 0.06),
      end: Offset.zero,
    ).animate(CurvedAnimation(parent: _ctrl, curve: Curves.easeOutCubic));
    _ctrl.forward();
    // Auto-tracking points immediately form the visible route line so there
    // is no delay while the road-snapping API responds.
    _roadVisitedPoints = orderedVisitedRouteStops(widget.stops)
        .map((s) => s.position)
        .toList();
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
    _ctrl.dispose();
    _mapController?.dispose();
    super.dispose();
  }

  int get _visitedCount =>
      widget.stops.where((s) => s.status != VisitStatus.pending).length;

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
    await Future.delayed(const Duration(milliseconds: 250));
    if (!mounted) return;
    await controller.animateCamera(
      CameraUpdate.newLatLngBounds(
        LatLngBounds(
          southwest: LatLng(minLat, minLng),
          northeast: LatLng(maxLat, maxLng),
        ),
        60,
      ),
    );
  }

  BitmapDescriptor _iconFor(VisitStatus status, {bool isPunchOut = false}) {
    if (isPunchOut) {
      return BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueRed);
    }
    return BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueGreen);
  }

  Set<Marker> _buildMarkers() {
    final markers = <Marker>{};
    if (widget.stops.isEmpty) return markers;

    // Auto-tracking points form the route line ONLY and are never rendered as pins.
    // Only punch-in and punch-out are displayed with map icons.
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
        position: punchIn.position,
        icon: _iconFor(punchIn.status),
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
          position: punchOut.position,
          icon: _iconFor(punchOut.status, isPunchOut: true),
          infoWindow: InfoWindow(title: 'Punch-Out', snippet: punchOut.address),
        ),
      );
    }
    return markers;
  }

  Set<Polyline> _buildPolylines() {
    final points = _roadVisitedPoints.isNotEmpty
        ? _roadVisitedPoints
        : orderedVisitedRouteStops(widget.stops)
            .map((s) => s.position)
            .toList();
    return {
      if (points.length > 1)
        Polyline(
          polylineId: const PolylineId('visited'),
          points: points,
          color: _greenAccent,
          width: 4,
          geodesic: false,
        ),
    };
  }

  void _openFullRouteMap() {
    Navigator.of(context).push(
      PageRouteBuilder(
        transitionDuration: const Duration(milliseconds: 350),
        pageBuilder: (_, animation, __) => FullRouteMap(
          dateLabel: widget.dateLabel,
          inProgress: widget.inProgress,
          distanceKm: widget.distanceKm,
          totalDuration: widget.totalDuration,
          stops: widget.stops,
        ),
        transitionsBuilder: (_, animation, __, child) {
          return FadeTransition(
            opacity: animation,
            child: SlideTransition(
              position: Tween<Offset>(
                begin: const Offset(0, 0.05),
                end: Offset.zero,
              ).animate(
                CurvedAnimation(parent: animation, curve: Curves.easeOutCubic),
              ),
              child: child,
            ),
          );
        },
      ),
    );
  }

  void _toggleMapType() {
    setState(() {
      _mapType = _mapType == MapType.normal ? MapType.satellite : MapType.normal;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      body: SafeArea(
        child: Column(
          children: [
            _buildHeader(context),
            Expanded(
              child: FadeTransition(
                opacity: _fade,
                child: SlideTransition(
                  position: _slide,
                  child: SingleChildScrollView(
                    padding: EdgeInsets.symmetric(horizontal: 16.w),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SizedBox(height: 4.h),
                        _buildDateBar(),
                        SizedBox(height: 12.h),
                        _buildStatsRow(),
                        SizedBox(height: 14.h),
                        _buildMapCard(),
                        SizedBox(height: 20.h),
                        _buildLocationDetails(),
                        SizedBox(height: 14.h),
                        _buildSummaryBar(),
                        SizedBox(height: 16.h),
                        _buildViewFullRouteButton(),
                        SizedBox(height: 20.h),
                      ],
                    ),
                  ),
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
      padding: EdgeInsets.fromLTRB(12.w, 10.h, 20.w, 14.h),
      color: Colors.white,
      child: Row(
        children: [
          IconButton(
            onPressed: () => Navigator.of(context).maybePop(),
            icon: Icon(Icons.arrow_back_rounded, color: _darkText, size: 20.sp),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Route Details',
                  style: GoogleFonts.inter(
                    fontSize: 17.sp,
                    fontWeight: FontWeight.w700,
                    color: _darkText,
                  ),
                ),
                Text(
                  'View your travel route and visited locations',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: GoogleFonts.inter(fontSize: 9.5.sp, color: _muted),
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

  // ── Date + status bar ───────────────────────────────────────────────────
  Widget _buildDateBar() {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 14.w, vertical: 12.h),
      decoration: BoxDecoration(
        color: _greenLight,
        borderRadius: BorderRadius.circular(14.r),
      ),
      child: Row(
        children: [
          Icon(Icons.calendar_month_rounded, color: _greenAccent, size: 20.sp),
          SizedBox(width: 10.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  widget.dateLabel,
                  style: GoogleFonts.inter(
                    fontSize: 14.sp,
                    fontWeight: FontWeight.w700,
                    color: _darkText,
                  ),
                ),
                if (widget.isToday)
                  Text(
                    'Today',
                    style: GoogleFonts.inter(fontSize: 10.5.sp, color: _muted),
                  ),
              ],
            ),
          ),
          _StatusPill(
            label: widget.inProgress ? 'In Progress' : 'Completed',
            color: widget.inProgress ? _amber : _greenAccent,
            bg: widget.inProgress ? _amberLight : Colors.white,
            animate: widget.inProgress,
          ),
        ],
      ),
    );
  }

  // ── Stat mini-cards ─────────────────────────────────────────────────────
  Widget _buildStatsRow() {
    final items = [
      _StatItem(
        Icons.location_on_rounded,
        _greenAccent,
        '$_visitedCount / ${widget.stops.length}',
        'Locations Visited',
      ),
      _StatItem(
        Icons.route_rounded,
        _greenAccent,
        '${widget.distanceKm} km',
        'Distance Travelled',
      ),
      _StatItem(
        Icons.access_time_filled_rounded,
        _greenAccent,
        widget.punchInTime,
        'Punch-In Time',
      ),
      _StatItem(
        Icons.flag_rounded,
        widget.inProgress ? _amber : _greenAccent,
        widget.inProgress ? 'In Progress' : 'Completed',
        'Route Status',
      ),
    ];
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: items.length,
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        mainAxisSpacing: 10.h,
        crossAxisSpacing: 10.w,
        childAspectRatio: 2.0,
      ),
      itemBuilder: (context, index) {
        final item = items[index];
        return _StaggeredEntry(
          index: index,
          controller: _ctrl,
          child: Container(
            padding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 8.h),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12.r),
              border: Border.all(color: _borderColor),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Icon(item.icon, color: item.color, size: 14.sp),
                SizedBox(width: 8.w),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.center,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        item.value,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: GoogleFonts.inter(
                          fontSize: 13.sp,
                          fontWeight: FontWeight.w800,
                          color: _darkText,
                          height: 1.1,
                        ),
                      ),
                      Text(
                        item.label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: GoogleFonts.inter(
                          fontSize: 9.sp,
                          color: _muted,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  // ── Map card ────────────────────────────────────────────────────────────
  Widget _buildMapCard() {
    return ClipRRect(
      borderRadius: BorderRadius.circular(16.r),
      child: SizedBox(
        height: 340.h,
        child: Stack(
          children: [
            Positioned.fill(
              child: GoogleMap(
                initialCameraPosition: CameraPosition(
                  target: widget.stops.isNotEmpty
                      ? widget.stops.first.position
                      : const LatLng(11.0168, 76.9558),
                  zoom: 12.5,
                ),
                mapType: _mapType,
                onMapCreated: (controller) {
                  _mapController = controller;
                  _fitBounds();
                },
                markers: _buildMarkers(),
                polylines: _buildPolylines(),
                myLocationButtonEnabled: false,
                zoomControlsEnabled: false,
                compassEnabled: false,
              ),
            ),
            Positioned(
              top: 10.h,
              left: 10.w,
              child: _buildMapTypeToggle(),
            ),
            Positioned(top: 10.h, right: 10.w, child: _buildLegend()),
            Positioned(
              bottom: 12.h,
              right: 12.w,
              child: Column(
                children: [
                  Material(
                    color: Colors.white,
                    shape: const CircleBorder(),
                    elevation: 3,
                    child: InkWell(
                      customBorder: const CircleBorder(),
                      onTap: _openFullRouteMap,
                      child: Padding(
                        padding: EdgeInsets.all(9.w),
                        child: Icon(
                          Icons.open_in_full_rounded,
                          color: _greenAccent,
                          size: 16.sp,
                        ),
                      ),
                    ),
                  ),
                  SizedBox(height: 8.h),
                  Material(
                    color: Colors.white,
                    shape: const CircleBorder(),
                    elevation: 3,
                    child: InkWell(
                      customBorder: const CircleBorder(),
                      onTap: _fitBounds,
                      child: Padding(
                        padding: EdgeInsets.all(9.w),
                        child: Icon(
                          Icons.my_location_rounded,
                          color: _greenAccent,
                          size: 18.sp,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildMapTypeToggle() {
    return Container(
      padding: EdgeInsets.all(3.w),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10.r),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.12),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        children: [
          _toggleChip(
            icon: Icons.map_rounded,
            label: 'Map View',
            selected: _mapType == MapType.normal,
            onTap: () {
              if (_mapType != MapType.normal) _toggleMapType();
            },
          ),
          _toggleChip(
            icon: Icons.satellite_alt_rounded,
            label: 'Satellite',
            selected: _mapType == MapType.satellite,
            onTap: () {
              if (_mapType != MapType.satellite) _toggleMapType();
            },
          ),
        ],
      ),
    );
  }

  Widget _toggleChip({
    required IconData icon,
    required String label,
    required bool selected,
    required VoidCallback onTap,
  }) {
    return Material(
      color: selected ? _greenAccent : Colors.transparent,
      borderRadius: BorderRadius.circular(8.r),
      child: InkWell(
        borderRadius: BorderRadius.circular(8.r),
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 7.h),
          child: Row(
            children: [
              Icon(
                icon,
                size: 14.sp,
                color: selected ? Colors.white : _darkText,
              ),
              SizedBox(width: 5.w),
              Text(
                label,
                style: GoogleFonts.inter(
                  fontSize: 11.sp,
                  fontWeight: FontWeight.w600,
                  color: selected ? Colors.white : _darkText,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildLegend() {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 8.h),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10.r),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.12),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _legendRow(_greenAccent, 'Punch-In'),
          SizedBox(height: 4.h),
          _legendRow(const Color(0xFFEF4444), 'Punch-Out'),
          SizedBox(height: 4.h),
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 12.w,
                height: 3.h,
                decoration: BoxDecoration(
                  color: _greenAccent,
                  borderRadius: BorderRadius.circular(2.r),
                ),
              ),
              SizedBox(width: 6.w),
              Text(
                'Route',
                style: GoogleFonts.inter(fontSize: 10.5.sp, color: _darkText),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _legendRow(Color color, String label) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 9.w,
          height: 9.w,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        SizedBox(width: 6.w),
        Text(
          label,
          style: GoogleFonts.inter(fontSize: 10.5.sp, color: _darkText),
        ),
      ],
    );
  }

  // ── Location Details list ───────────────────────────────────────────────
  Widget _buildLocationDetails() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text(
              'Location Details',
              style: GoogleFonts.inter(
                fontSize: 15.sp,
                fontWeight: FontWeight.w700,
                color: _darkText,
              ),
            ),
            const Spacer(),
            Text(
              '$_visitedCount of ${widget.stops.length} completed',
              style: GoogleFonts.inter(
                fontSize: 11.5.sp,
                fontWeight: FontWeight.w700,
                color: _greenAccent,
              ),
            ),
          ],
        ),
        SizedBox(height: 10.h),
        ...widget.stops.asMap().entries.map((e) {
          final index = e.key;
          final stop = e.value;
          final isLast = index == widget.stops.length - 1;
          return _StaggeredEntry(
            index: index,
            controller: _ctrl,
            child: _buildStopRow(stop, isLast: isLast),
          );
        }),
      ],
    );
  }

  Widget _buildStopRow(RouteStop stop, {required bool isLast}) {
    final isPending = stop.status == VisitStatus.pending;
    final circleColor = isPending ? _slateGrey : _greenAccent;
    return Container(
      margin: EdgeInsets.only(bottom: 4.h),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Column(
            children: [
              Container(
                width: 30.w,
                height: 30.w,
                decoration: BoxDecoration(
                  color: circleColor,
                  shape: BoxShape.circle,
                ),
                alignment: Alignment.center,
                child: Text(
                  stop.label,
                  style: GoogleFonts.inter(
                    fontSize: stop.label == 'Start' ? 8.5.sp : 12.sp,
                    fontWeight: FontWeight.w700,
                    color: Colors.white,
                  ),
                ),
              ),
              if (!isLast)
                Container(width: 2, height: 46.h, color: _borderColor),
            ],
          ),
          SizedBox(width: 12.w),
          Expanded(
            child: Container(
              margin: EdgeInsets.only(bottom: 14.h),
              padding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 10.h),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12.r),
                border: Border.all(color: _borderColor),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          stop.time,
                          style: GoogleFonts.inter(
                            fontSize: 10.sp,
                            fontWeight: FontWeight.w600,
                            color: _muted,
                          ),
                        ),
                        SizedBox(height: 2.h),
                        Text(
                          stop.title,
                          style: GoogleFonts.inter(
                            fontSize: 13.sp,
                            fontWeight: FontWeight.w700,
                            color: _darkText,
                          ),
                        ),
                        SizedBox(height: 2.h),
                        Row(
                          children: [
                            Icon(
                              Icons.location_on_rounded,
                              size: 10.sp,
                              color: _muted,
                            ),
                            SizedBox(width: 3.w),
                            Expanded(
                              child: Text(
                                stop.address,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: GoogleFonts.inter(
                                  fontSize: 10.5.sp,
                                  color: _muted,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  SizedBox(width: 8.w),
                  _statusChip(stop.status),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _statusChip(VisitStatus status) {
    final isPending = status == VisitStatus.pending;
    final label = status == VisitStatus.completed
        ? 'Completed'
        : (isPending ? 'Pending' : 'Visited');
    final color = isPending ? _amber : _greenAccent;
    final bg = isPending ? _amberLight : _greenLight;
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 9.w, vertical: 5.h),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(20.r),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            isPending ? Icons.access_time_rounded : Icons.check_rounded,
            size: 10.sp,
            color: color,
          ),
          SizedBox(width: 4.w),
          Text(
            label,
            style: GoogleFonts.inter(
              fontSize: 10.sp,
              fontWeight: FontWeight.w700,
              color: color,
            ),
          ),
        ],
      ),
    );
  }

  // ── Summary bar ─────────────────────────────────────────────────────────
  Widget _buildSummaryBar() {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 14.h),
      decoration: BoxDecoration(
        color: _greenLight,
        borderRadius: BorderRadius.circular(14.r),
      ),
      child: Row(
        children: [
          Expanded(
            child: _summaryItem(
              Icons.route_rounded,
              '${widget.distanceKm} km',
              'Distance Travelled',
            ),
          ),
          Expanded(
            child: _summaryItem(
              Icons.access_time_filled_rounded,
              widget.totalDuration,
              'Total Duration',
            ),
          ),
          Expanded(
            child: _summaryItem(
              Icons.location_on_rounded,
              '$_visitedCount / ${widget.stops.length}',
              'Locations Visited',
            ),
          ),
        ],
      ),
    );
  }

  Widget _summaryItem(IconData icon, String value, String label) {
    return Column(
      children: [
        Icon(icon, color: _greenAccent, size: 16.sp),
        SizedBox(height: 4.h),
        Text(
          value,
          style: GoogleFonts.inter(
            fontSize: 13.sp,
            fontWeight: FontWeight.w800,
            color: _darkText,
          ),
        ),
        Text(
          label,
          textAlign: TextAlign.center,
          style: GoogleFonts.inter(fontSize: 9.sp, color: _muted),
        ),
      ],
    );
  }

  // ── View full route CTA ─────────────────────────────────────────────────
  Widget _buildViewFullRouteButton() {
    return SizedBox(
      width: double.infinity,
      child: Material(
        color: _greenAccent,
        borderRadius: BorderRadius.circular(14.r),
        child: InkWell(
          borderRadius: BorderRadius.circular(14.r),
          onTap: _openFullRouteMap,
          child: Padding(
            padding: EdgeInsets.symmetric(vertical: 14.h),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.map_rounded, color: Colors.white, size: 18.sp),
                SizedBox(width: 8.w),
                Text(
                  'View Full Route on Map',
                  style: GoogleFonts.inter(
                    fontSize: 13.5.sp,
                    fontWeight: FontWeight.w700,
                    color: Colors.white,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _StatItem {
  final IconData icon;
  final Color color;
  final String value;
  final String label;
  const _StatItem(this.icon, this.color, this.value, this.label);
}

class _StatusPill extends StatefulWidget {
  const _StatusPill({
    required this.label,
    required this.color,
    required this.bg,
    required this.animate,
  });

  final String label;
  final Color color;
  final Color bg;
  final bool animate;

  @override
  State<_StatusPill> createState() => _StatusPillState();
}

class _StatusPillState extends State<_StatusPill>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulseCtrl;

  @override
  void initState() {
    super.initState();
    _pulseCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1000),
    );
    if (widget.animate) _pulseCtrl.repeat(reverse: true);
  }

  @override
  void dispose() {
    _pulseCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 8.h),
      decoration: BoxDecoration(
        color: widget.bg,
        borderRadius: BorderRadius.circular(20.r),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (widget.animate)
            FadeTransition(
              opacity: Tween<double>(
                begin: 0.4,
                end: 1,
              ).animate(_pulseCtrl),
              child: Icon(
                Icons.access_time_filled_rounded,
                size: 12.sp,
                color: widget.color,
              ),
            )
          else
            Icon(Icons.check_circle_rounded, size: 12.sp, color: widget.color),
          SizedBox(width: 5.w),
          Text(
            widget.label,
            style: GoogleFonts.inter(
              fontSize: 11.5.sp,
              fontWeight: FontWeight.w700,
              color: widget.color,
            ),
          ),
        ],
      ),
    );
  }
}

/// Staggers each row/card's entrance — later items start fading/sliding in
/// slightly after earlier ones.
class _StaggeredEntry extends StatelessWidget {
  const _StaggeredEntry({
    required this.index,
    required this.controller,
    required this.child,
  });

  final int index;
  final AnimationController controller;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final start = (0.1 + index * 0.08).clamp(0.0, 0.7);
    final end = (start + 0.4).clamp(0.0, 1.0);
    final curved = CurvedAnimation(
      parent: controller,
      curve: Interval(start, end, curve: Curves.easeOutCubic),
    );
    return FadeTransition(
      opacity: curved,
      child: SlideTransition(
        position: Tween<Offset>(
          begin: const Offset(0, 0.08),
          end: Offset.zero,
        ).animate(curved),
        child: child,
      ),
    );
  }
}
