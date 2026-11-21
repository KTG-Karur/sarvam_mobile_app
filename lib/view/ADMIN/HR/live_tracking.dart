// ignore_for_file: deprecated_member_use

import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/services/hr_api_service.dart';

import 'route_details.dart';

/// LiveTracking — HR module screen showing a field officer's day-by-day
/// route/attendance history (punch-in, route status, locations visited,
/// distance travelled) for the selected month. Reached from HrHome's
/// "Live Tracking" quick-action tile.
class LiveTracking extends StatefulWidget {
  const LiveTracking({super.key});

  @override
  State<LiveTracking> createState() => _LiveTrackingState();
}

class _LiveTrackingState extends State<LiveTracking>
    with SingleTickerProviderStateMixin {
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);
  static const _greenAccent = Color(0xFF0D6842);
  static const _greenDark = Color(0xFF0A5636);
  static const _amber = Color(0xFFF59E0B);
  static const _borderColor = Color(0xFFE2E8F0);
  static const _todayBg = Color(0xFFEAF7EE);
  static const _grey = Color(0xFF94A3B8);

  late final AnimationController _ctrl;
  late final Animation<double> _fade;
  late final Animation<Offset> _slide;

  // Date filter: the days shown, inclusive and date-only. Starts on today.
  late DateTime _from;
  late DateTime _to;
  static const _maxRangeDays = 31;
  int _loadGeneration = 0; // a newer filter choice makes older responses stale
  List<_DayLog> _logs = const [];
  var _isLoading = true;
  String? _loadError;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 700),
    );
    _fade = CurvedAnimation(parent: _ctrl, curve: Curves.easeOut);
    _slide = Tween<Offset>(
      begin: const Offset(0, 0.06),
      end: Offset.zero,
    ).animate(CurvedAnimation(parent: _ctrl, curve: Curves.easeOutCubic));
    _ctrl.forward();
    _from = _to = _today;
    _loadTracking();
  }

  Future<void> _loadTracking() async {
    final generation = ++_loadGeneration;
    setState(() {
      _isLoading = true;
      _loadError = null;
    });
    try {
      final prefs = await SharedPreferences.getInstance();
      final id = prefs.getString('userId') ?? '';
      if (id.isEmpty) throw const HrApiException('Employee session is unavailable. Please sign in again.');
      final today = _today;

      // Newest day first.
      final days = <DateTime>[];
      for (var d = _to; !d.isBefore(_from); d = DateTime(d.year, d.month, d.day - 1)) {
        days.add(d);
      }

      final logs = <_DayLog>[];
      Object? firstError;
      var failed = 0;
      // The API answers one day per request: fetch a few days at a time.
      for (var i = 0; i < days.length; i += 4) {
        final results = await Future.wait(
          days.skip(i).take(4).map((day) async {
            try {
              final detail = await HrApiService.trackingDetail(employeeId: id, date: day);
              return _logFromDetail(id, day, detail, today);
            } catch (e) {
              failed++;
              firstError ??= e;
              return null;
            }
          }),
        );
        if (!mounted || generation != _loadGeneration) return;
        logs.addAll(results.whereType<_DayLog>());
      }
      if (failed == days.length && firstError != null) throw firstError!;
      setState(() => _logs = logs);
    } catch (error) {
      if (mounted && generation == _loadGeneration) setState(() => _loadError = error.toString());
    } finally {
      if (mounted && generation == _loadGeneration) setState(() => _isLoading = false);
    }
  }

  /// One day card from the server's detail. Days with nothing at all (no punch,
  /// no route, no km, no visits) are left out, except today.
  _DayLog? _logFromDetail(String id, DateTime day, Map<String, dynamic> detail, DateTime today) {
    final route = detail['routeHistory'] is List ? detail['routeHistory'] as List : const [];
    final punchIn = _parseApiDateTime(detail['punchIn']);
    // The attendance row is the source of truth, but a punch-out that left
    // its route event (PUNCH_OUT) while the summary field is still empty must
    // not read as "still active".
    final punchOut = _parseApiDateTime(detail['punchOut']) ?? _latestPunchOutEvent(route);
    final currentStatus = detail['currentStatus']?.toString() ?? 'OFFLINE';
    final km = (detail['travelledKm'] as num?)?.toDouble() ?? 0;
    final visited = _visitedCount(detail, route);
    final isToday = _same(day, today);
    if (!isToday && punchIn == null && route.isEmpty && km == 0 && visited == 0) return null;
    return _DayLog(
      employeeId: id,
      date: day,
      day: day.day,
      month: _monthAbbr(day.month).toUpperCase(),
      year: day.year,
      isToday: isToday,
      punchIn: punchIn == null ? '--:--' : _time(punchIn),
      routeLabel: punchOut != null ? 'Punch-Out' : currentStatus.replaceAll('_', ' '),
      routeTime: punchOut == null ? '--:--' : _time(punchOut),
      locationsVisited: visited,
      distanceKm: km,
      status: punchOut == null ? _RouteStatus.inProgress : _RouteStatus.completed,
      routeHistory: route.whereType<Map>().map((point) => Map<String, dynamic>.from(point)).toList(),
      punchInAt: punchIn,
      punchOutAt: punchOut,
      // Server decision: FULL = map allowed; LIMITED = role has no mobile Live
      // Tracking permission; LOCATION_OFF = phone location was off, so there
      // is no route. Missing (older server) = FULL.
      trackingAccess: detail['trackingAccess']?.toString() ?? 'FULL',
    );
  }

  /// "Locations" on a day card = places actually worked: client visits +
  /// centres collected from + centres created + members enrolled. Never the
  /// number of GPS pings. Uses the server's totals, which are also sent when
  /// the map itself is not allowed; falls back to counting those events in the
  /// route points for an older server that does not send the totals.
  int _visitedCount(Map<String, dynamic> detail, List route) {
    const totalKeys = [
      'clientVisitsManual',
      'centersVisitedViaCollection',
      'centersCreatedCount',
      'membersEnrolledCount',
    ];
    if (totalKeys.any(detail.containsKey)) {
      return totalKeys.fold<int>(
        0,
        (sum, key) => sum + ((detail[key] as num?)?.toInt() ?? 0),
      );
    }
    const workTypes = {'CLIENT_VISIT', 'COLLECTION', 'CENTER_CREATED', 'MEMBER_ENROLLED'};
    return route
        .whereType<Map>()
        .where((p) => workTypes.contains(p['activityType']?.toString()))
        .length;
  }

  /// Formats in the device's local time. The API sends UTC ISO strings, so
  /// reading `.hour` directly would show UTC (5h30m behind IST).
  String _time(DateTime value) {
    final local = value.toLocal();
    final hour = local.hour % 12 == 0 ? 12 : local.hour % 12;
    return '${hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')} ${local.hour >= 12 ? 'PM' : 'AM'}';
  }

  DateTime? _latestPunchOutEvent(List<dynamic> route) {
    DateTime? latest;
    for (final point in route) {
      if (point is! Map || point['activityType']?.toString() != 'PUNCH_OUT') {
        continue;
      }
      final at = _parseApiDateTime(point['capturedAt']);
      if (at != null && (latest == null || at.isAfter(latest))) latest = at;
    }
    return latest;
  }

  /// Tracking fields are optional and occasionally arrive in a non-ISO
  /// format. A malformed value must be treated as unavailable, never crash
  /// the tracking screen.
  DateTime? _parseApiDateTime(dynamic value) {
    if (value is DateTime) return value;
    if (value is! String) return null;
    final raw = value.trim();
    if (raw.isEmpty) return null;
    try {
      return DateTime.tryParse(raw);
    } on FormatException {
      return null;
    }
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  DateTime get _today {
    final n = DateTime.now();
    return DateTime(n.year, n.month, n.day);
  }

  bool _same(DateTime a, DateTime b) => a.year == b.year && a.month == b.month && a.day == b.day;

  String _fmt(DateTime d) => '${d.day.toString().padLeft(2, '0')} ${_monthAbbr(d.month)} ${d.year}';

  /// Name of the current selection, derived from the dates.
  String get _rangeLabel {
    final today = _today;
    if (_same(_from, _to)) return _same(_from, today) ? 'Today' : 'Pick a Date';
    if (_same(_to, today) && today.difference(_from).inDays == 6) return 'Last 7 Days';
    if (_same(_from, DateTime(today.year, today.month, 1)) && _same(_to, today)) return 'This Month';
    if (_same(_from, DateTime(today.year, today.month - 1, 1)) && _same(_to, DateTime(today.year, today.month, 0))) {
      return 'Last Month';
    }
    return 'Custom Range';
  }

  String get _rangeTitle => _same(_from, _to) ? _fmt(_from) : '${_fmt(_from)} – ${_fmt(_to)}';

  String get _rangeSub {
    final days = _to.difference(_from).inDays + 1;
    return '$days day${days == 1 ? '' : 's'} · $_rangeLabel';
  }

  String _monthAbbr(int m) => const [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ][m - 1];

  /// Applies a new date filter and reloads. Future days are cut off at today.
  void _setRange(DateTime from, DateTime to) {
    final today = _today;
    var f = DateTime(from.year, from.month, from.day);
    var t = DateTime(to.year, to.month, to.day);
    if (t.isAfter(today)) t = today;
    if (f.isAfter(t)) f = t;
    if (t.difference(f).inDays + 1 > _maxRangeDays) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Please select at most $_maxRangeDays days at a time.'),
          backgroundColor: const Color(0xFFDC2626),
          behavior: SnackBarBehavior.floating,
        ),
      );
      return;
    }
    setState(() {
      _from = f;
      _to = t;
    });
    _ctrl.forward(from: 0);
    _loadTracking();
  }

  /// The arrows move the filter by its own length: a day, a week, or a month.
  void _shiftRange(int dir) {
    final today = _today;
    final sameMonth = _from.year == _to.year && _from.month == _to.month;
    final monthly = sameMonth &&
        _from.day == 1 &&
        (_to.day == DateTime(_to.year, _to.month + 1, 0).day || _same(_to, today));
    if (monthly) {
      final first = DateTime(_from.year, _from.month + dir, 1);
      if (first.isAfter(today)) return;
      _setRange(first, DateTime(first.year, first.month + 1, 0));
      return;
    }
    final len = _to.difference(_from).inDays + 1;
    final first = DateTime(_from.year, _from.month, _from.day + dir * len);
    if (first.isAfter(today)) return;
    _setRange(first, DateTime(first.year, first.month, first.day + len - 1));
  }

  List<RouteStop> _stopsForLog(_DayLog log) {
    final inProgress = log.status == _RouteStatus.inProgress;
    final points = log.routeHistory
        .map(_routePoint)
        .whereType<_TrackingPoint>()
        .where(_isReliableRoutePoint)
        .toList()
      ..sort((a, b) => a.timestamp.compareTo(b.timestamp));

    // Only background GPS breadcrumbs are de-duplicated by coordinates. A
    // discrete event (collection, visit, centre, enrolment, punch) is never
    // dropped: several collections at one centre share the centre's
    // coordinates, and an event with a wrong location is stored at the phone's
    // last ping location, so coordinate-matching would hide real entries (the
    // web lists every one of them).
    const breadcrumbs = {'EN_ROUTE', 'IDLE_PING'};
    final seen = <String>{};
    final unique = points.where((point) {
      if (!breadcrumbs.contains(point.activityType)) return true;
      return seen.add(
        '${point.latitude.toStringAsFixed(6)},${point.longitude.toStringAsFixed(6)}',
      );
    }).toList();

    return unique.asMap().entries.map((entry) {
      final index = entry.key;
      final point = entry.value;
      final isFirst = index == 0;
      final isLast = !inProgress && unique.length > 1 && index == unique.length - 1;
      return RouteStop(
        label: isFirst ? 'Start' : (isLast ? 'End' : '$index'),
        time: _time(point.timestamp),
        title: isFirst
            ? 'Punch-In'
            : (isLast
                ? 'Punch-Out'
                // Same text the web timeline shows ("Collection at <centre>"),
                // falling back to the generic type name when there is no label.
                : (point.label != null && point.label!.trim().isNotEmpty
                    ? point.label!.trim()
                    : _activityLabel(point.activityType))),
        address: '${point.latitude.toStringAsFixed(6)}, ${point.longitude.toStringAsFixed(6)}',
        status: isFirst ? VisitStatus.completed : VisitStatus.visited,
        position: LatLng(point.latitude, point.longitude),
        timestamp: point.timestamp,
      );
    }).toList();
  }

  _TrackingPoint? _routePoint(Map<String, dynamic> raw) {
    final latitude = (raw['latitude'] as num?)?.toDouble();
    final longitude = (raw['longitude'] as num?)?.toDouble();
    final timestamp = _parseApiDateTime(raw['capturedAt']);
    if (latitude == null || longitude == null || timestamp == null ||
        latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 ||
        (latitude == 0 && longitude == 0)) {
      return null;
    }
    return _TrackingPoint(
      latitude,
      longitude,
      timestamp,
      raw['activityType']?.toString() ?? '',
      (raw['accuracyMeters'] as num?)?.toDouble(),
      raw['label']?.toString(),
    );
  }

  /// Fixes with a large error radius (indoors / between buildings, or a
  /// cell-tower location) land streets away from where the employee really
  /// was.
  static const _maxRouteAccuracyMeters = 30.0;

  bool _isReliableRoutePoint(_TrackingPoint point) {
    // Only background breadcrumbs are filtered; every discrete event (punch,
    // visit, collection, centre created, enrolment) is a deliberate action
    // that must still get its pin.
    const breadcrumbs = {'EN_ROUTE', 'IDLE_PING'};
    if (!breadcrumbs.contains(point.activityType)) return true;
    final accuracy = point.accuracyMeters;
    return accuracy == null || accuracy <= _maxRouteAccuracyMeters;
  }

  String _activityLabel(String activityType) => switch (activityType) {
    'PUNCH_IN' => 'Punch-In',
    'PUNCH_OUT' => 'Punch-Out',
    'CLIENT_VISIT' => 'Client Visit',
    'COLLECTION' => 'Collection',
    'CENTER_CREATED' => 'Center Created',
    'MEMBER_ENROLLED' => 'Member Enrolled',
    'IDLE_PING' => 'Location Update',
    _ => 'Location Update',
  };

  void _openRouteDetails(_DayLog log) {
    final inProgress = log.status == _RouteStatus.inProgress;
    Navigator.of(context).push(
      PageRouteBuilder(
        transitionDuration: const Duration(milliseconds: 350),
        pageBuilder: (_, animation, __) => RouteDetails(
          dateLabel: '${log.day} ${_fullMonthName(log.month)} ${log.year}',
          isToday: log.isToday,
          inProgress: inProgress,
          punchInTime: log.punchIn,
          distanceKm: log.distanceKm,
          totalDuration: inProgress ? 'In progress' : _durationBetween(log),
          stops: _stopsForLog(log),
          employeeId: log.employeeId,
          date: log.date,
          trackingAccess: log.trackingAccess,
          locationsVisited: log.locationsVisited,
        ),
        transitionsBuilder: (_, animation, __, child) {
          return FadeTransition(
            opacity: animation,
            child: SlideTransition(
              position: Tween<Offset>(
                begin: const Offset(0.05, 0),
                end: Offset.zero,
              ).animate(CurvedAnimation(parent: animation, curve: Curves.easeOutCubic)),
              child: child,
            ),
          );
        },
      ),
    );
  }

  String _fullMonthName(String abbr) {
    const map = {
      'JAN': 'January',
      'FEB': 'February',
      'MAR': 'March',
      'APR': 'April',
      'MAY': 'May',
      'JUN': 'June',
      'JUL': 'July',
      'AUG': 'August',
      'SEP': 'September',
      'OCT': 'October',
      'NOV': 'November',
      'DEC': 'December',
    };
    return map[abbr] ?? abbr;
  }

  String _durationBetween(_DayLog log) {
    final start = log.punchInAt;
    final end = log.punchOutAt;
    if (start == null || end == null || end.isBefore(start)) return '--';
    final duration = end.difference(start);
    return '${duration.inHours}h ${duration.inMinutes.remainder(60)}m';
  }

  Future<void> _pickRange() async {
    const options = ['Today', 'Last 7 Days', 'This Month', 'Last Month', 'Pick a Date', 'Custom Range'];
    final current = _rangeLabel;
    final selected = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20.r)),
      ),
      builder: (context) {
        return SafeArea(
          child: Padding(
            padding: EdgeInsets.symmetric(vertical: 8.h),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: options
                  .map(
                    (o) => ListTile(
                      title: Text(
                        o,
                        style: GoogleFonts.inter(
                          fontWeight: o == current ? FontWeight.w700 : FontWeight.w500,
                          color: o == current ? _greenAccent : _darkText,
                        ),
                      ),
                      trailing: o == current ? Icon(Icons.check_rounded, color: _greenAccent) : null,
                      onTap: () => Navigator.pop(context, o),
                    ),
                  )
                  .toList(),
            ),
          ),
        );
      },
    );
    if (selected == null || !mounted) return;

    final today = _today;
    final earliest = DateTime(today.year - 1, today.month, today.day);
    switch (selected) {
      case 'Today':
        _setRange(today, today);
      case 'Last 7 Days':
        _setRange(DateTime(today.year, today.month, today.day - 6), today);
      case 'This Month':
        _setRange(DateTime(today.year, today.month, 1), today);
      case 'Last Month':
        _setRange(DateTime(today.year, today.month - 1, 1), DateTime(today.year, today.month, 0));
      case 'Pick a Date':
        final picked = await showDatePicker(
          context: context,
          initialDate: _from,
          firstDate: earliest,
          lastDate: today,
          helpText: 'Select a date',
        );
        if (picked != null) _setRange(picked, picked);
      case 'Custom Range':
        final picked = await showDateRangePicker(
          context: context,
          firstDate: earliest,
          lastDate: today,
          initialDateRange: DateTimeRange(start: _from, end: _to),
          helpText: 'Select dates (up to $_maxRangeDays days)',
        );
        if (picked != null) _setRange(picked.start, picked.end);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
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
                    padding: EdgeInsets.symmetric(horizontal: 20.w),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SizedBox(height: 4.h),
                        _buildHeroBanner(),
                        SizedBox(height: 16.h),
                        _buildRangeSelector(),
                        SizedBox(height: 12.h),
                        _buildMonthNav(),
                        SizedBox(height: 14.h),
                        if (_isLoading)
                          const Padding(padding: EdgeInsets.all(28), child: Center(child: CircularProgressIndicator()))
                        else if (_loadError != null)
                          Padding(padding: const EdgeInsets.all(20), child: Center(child: Column(children: [Text(_loadError!, textAlign: TextAlign.center), TextButton(onPressed: _loadTracking, child: const Text('Retry'))])))
                        else if (_logs.isEmpty)
                          const Padding(padding: EdgeInsets.all(28), child: Center(child: Text('No tracking data for the selected dates.')))
                        else ..._logs.asMap().entries.map(
                          (e) => Padding(
                            padding: EdgeInsets.only(bottom: 12.h),
                            child: _StaggeredEntry(
                              index: e.key,
                              controller: _ctrl,
                              child: _buildDayCard(e.value),
                            ),
                          ),
                        ),
                        SizedBox(height: 8.h),
                        _buildFooterBanner(),
                        SizedBox(height: 16.h),
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
            icon: Icon(Icons.arrow_back_rounded, color: _darkText, size: 22.sp),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Live Tracking',
                  style: GoogleFonts.inter(
                    fontSize: 17.sp,
                    fontWeight: FontWeight.w700,
                    color: _darkText,
                  ),
                ),
                Text(
                  'Track Your Journey',
                  style: GoogleFonts.inter(fontSize: 11.sp, color: _muted),
                ),
              ],
            ),
          ),
          Image.asset(
            'assets/icon/Sarvam_01.png',
            width: 110.w,
            height: 40.h,
            fit: BoxFit.contain,
            alignment: Alignment.centerRight,
          ),
        ],
      ),
    );
  }

  // ── Hero Banner ─────────────────────────────────────────────────────────
  Widget _buildHeroBanner() {
    return ClipRRect(
      borderRadius: BorderRadius.circular(18.r),
      child: AspectRatio(
        aspectRatio: 2048 / 768,
        child: Image.asset(
          'assets/images/live_tracking_banner.png',
          fit: BoxFit.contain,
          filterQuality: FilterQuality.high,
        ),
      ),
    );
  }

  // ── Range Dropdown ──────────────────────────────────────────────────────
  Widget _buildRangeSelector() {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(14.r),
      child: InkWell(
        borderRadius: BorderRadius.circular(14.r),
        onTap: _pickRange,
        child: Container(
          padding: EdgeInsets.symmetric(horizontal: 14.w, vertical: 12.h),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14.r),
            border: Border.all(color: _borderColor),
          ),
          child: Row(
            children: [
              Container(
                width: 32.w,
                height: 32.w,
                decoration: BoxDecoration(
                  color: _todayBg,
                  borderRadius: BorderRadius.circular(10.r),
                ),
                child: Icon(
                  Icons.calendar_month_rounded,
                  color: _greenAccent,
                  size: 18.sp,
                ),
              ),
              SizedBox(width: 10.w),
              Expanded(
                child: Text(
                  _rangeLabel,
                  style: GoogleFonts.inter(
                    fontSize: 13.sp,
                    fontWeight: FontWeight.w600,
                    color: _darkText,
                  ),
                ),
              ),
              Icon(Icons.keyboard_arrow_down_rounded, color: _muted),
            ],
          ),
        ),
      ),
    );
  }

  // ── Month navigator ─────────────────────────────────────────────────────
  Widget _buildMonthNav() {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 6.w, vertical: 12.h),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14.r),
        border: Border.all(color: _borderColor),
      ),
      child: Row(
        children: [
          _navArrow(Icons.chevron_left_rounded, () => _shiftRange(-1)),
          Expanded(
            child: AnimatedSwitcher(
              duration: const Duration(milliseconds: 250),
              child: Column(
                key: ValueKey(_rangeTitle),
                children: [
                  Text(
                    _rangeTitle,
                    style: GoogleFonts.inter(
                      fontSize: 15.sp,
                      fontWeight: FontWeight.w700,
                      color: _greenAccent,
                    ),
                  ),
                  SizedBox(height: 3.h),
                  Text(
                    _rangeSub,
                    style: GoogleFonts.inter(fontSize: 10.5.sp, color: _muted),
                  ),
                ],
              ),
            ),
          ),
          _navArrow(Icons.chevron_right_rounded, () => _shiftRange(1)),
        ],
      ),
    );
  }

  Widget _navArrow(IconData icon, VoidCallback onTap) {
    return Material(
      color: const Color(0xFFF1F5F9),
      shape: const CircleBorder(),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: Padding(
          padding: EdgeInsets.all(6.w),
          child: Icon(icon, size: 22.sp, color: _darkText),
        ),
      ),
    );
  }

  // ── Day card ────────────────────────────────────────────────────────────
  Widget _buildDayCard(_DayLog log) {
    final isToday = log.isToday;
    final inProgress = log.status == _RouteStatus.inProgress;

    return Container(
      padding: EdgeInsets.all(14.w),
      decoration: BoxDecoration(
        color: isToday ? _todayBg : Colors.white,
        borderRadius: BorderRadius.circular(16.r),
        border: Border.all(
          color: isToday ? _greenAccent.withOpacity(0.25) : _borderColor,
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Date block
          Container(
            width: 58.w,
            padding: EdgeInsets.symmetric(vertical: 10.h),
            decoration: BoxDecoration(
              color: isToday ? Colors.white : const Color(0xFFF1F5F9),
              borderRadius: BorderRadius.circular(12.r),
            ),
            child: Column(
              children: [
                Text(
                  log.day.toString().padLeft(2, '0'),
                  style: GoogleFonts.inter(
                    fontSize: 20.sp,
                    fontWeight: FontWeight.w800,
                    color: _greenDark,
                  ),
                ),
                Text(
                  log.month,
                  style: GoogleFonts.inter(
                    fontSize: 9.sp,
                    fontWeight: FontWeight.w600,
                    color: _muted,
                  ),
                ),
                Text(
                  log.year.toString(),
                  style: GoogleFonts.inter(fontSize: 9.sp, color: _muted),
                ),
                if (isToday) ...[
                  SizedBox(height: 6.h),
                  Container(
                    padding: EdgeInsets.symmetric(
                      horizontal: 8.w,
                      vertical: 2.h,
                    ),
                    decoration: BoxDecoration(
                      color: _greenAccent,
                      borderRadius: BorderRadius.circular(20.r),
                    ),
                    child: Text(
                      'Today',
                      style: GoogleFonts.inter(
                        fontSize: 8.5.sp,
                        fontWeight: FontWeight.w600,
                        color: Colors.white,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
          SizedBox(width: 12.w),
          // Timeline
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _timelineRow(
                  icon: Icons.check_rounded,
                  color: _greenAccent,
                  title: 'Punch-In',
                  subtitle: log.punchIn,
                ),
                _timelineConnector(),
                _timelineRow(
                  icon: inProgress
                      ? Icons.navigation_rounded
                      : Icons.check_rounded,
                  color: _greenAccent,
                  title: log.routeLabel,
                  subtitle: log.routeTime,
                ),
                _timelineConnector(),
                _timelineRow(
                  icon: Icons.location_on_rounded,
                  color: _amber,
                  title: 'Locations Visited',
                  subtitleWidget: Text(
                    '${log.locationsVisited} Locations',
                    style: GoogleFonts.inter(
                      fontSize: 11.sp,
                      fontWeight: FontWeight.w700,
                      color: _greenAccent,
                    ),
                  ),
                ),
                if (inProgress) ...[
                  _timelineConnector(),
                  _timelineRow(
                    icon: Icons.cloud_outlined,
                    color: _grey,
                    title: 'Route Status',
                    subtitleWidget: Text(
                      'In Progress',
                      style: GoogleFonts.inter(
                        fontSize: 11.sp,
                        fontWeight: FontWeight.w700,
                        color: _amber,
                      ),
                    ),
                    isLast: true,
                  ),
                ],
              ],
            ),
          ),
          SizedBox(width: 10.w),
          // Right column: distance + view route
          SizedBox(
            width: 96.w,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Material(
                  color: const Color(0xFFF1F5F9),
                  borderRadius: BorderRadius.circular(10.r),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(10.r),
                    onTap: () => _openRouteDetails(log),
                    child: Padding(
                      padding: EdgeInsets.symmetric(
                        horizontal: 8.w,
                        vertical: 8.h,
                      ),
                      child: Row(
                        children: [
                          Icon(
                            Icons.location_on_rounded,
                            color: _greenAccent,
                            size: 14.sp,
                          ),
                          SizedBox(width: 4.w),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Distance',
                                  style: GoogleFonts.inter(
                                    fontSize: 8.5.sp,
                                    color: _muted,
                                  ),
                                ),
                                Text(
                                  '${log.distanceKm} km',
                                  style: GoogleFonts.inter(
                                    fontSize: 11.sp,
                                    fontWeight: FontWeight.w700,
                                    color: _darkText,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          Icon(
                            Icons.chevron_right_rounded,
                            size: 15.sp,
                            color: _muted,
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                SizedBox(height: 10.h),
                Material(
                  color: inProgress ? _greenAccent : Colors.white,
                  borderRadius: BorderRadius.circular(10.r),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(10.r),
                    onTap: () => _openRouteDetails(log),
                    child: Container(
                      padding: EdgeInsets.symmetric(vertical: 9.h),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(10.r),
                        border: inProgress
                            ? null
                            : Border.all(color: _greenAccent),
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(
                            Icons.map_rounded,
                            size: 13.sp,
                            color: inProgress ? Colors.white : _greenAccent,
                          ),
                          SizedBox(width: 5.w),
                          Flexible(
                            child: Text(
                              'View Route',
                              overflow: TextOverflow.ellipsis,
                              style: GoogleFonts.inter(
                                fontSize: 10.5.sp,
                                fontWeight: FontWeight.w700,
                                color: inProgress
                                    ? Colors.white
                                    : _greenAccent,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _timelineRow({
    required IconData icon,
    required Color color,
    required String title,
    String? subtitle,
    Widget? subtitleWidget,
    bool isLast = false,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 20.w,
          height: 20.w,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          child: Icon(icon, size: 12.sp, color: Colors.white),
        ),
        SizedBox(width: 10.w),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: GoogleFonts.inter(
                  fontSize: 11.5.sp,
                  fontWeight: FontWeight.w600,
                  color: _darkText,
                ),
              ),
              if (subtitle != null)
                Text(
                  subtitle,
                  style: GoogleFonts.inter(fontSize: 10.5.sp, color: _muted),
                ),
              if (subtitleWidget != null) subtitleWidget,
            ],
          ),
        ),
      ],
    );
  }

  Widget _timelineConnector() {
    return Padding(
      padding: EdgeInsets.only(left: 9.5.w),
      child: Container(width: 1, height: 16.h, color: _borderColor),
    );
  }

  // ── Footer Banner ───────────────────────────────────────────────────────
  Widget _buildFooterBanner() {
    return ClipRRect(
      borderRadius: BorderRadius.circular(16.r),
      child: AspectRatio(
        aspectRatio: 2048 / 768,
        child: Image.asset(
          'assets/images/live_tracking_bottom_image.png',
          fit: BoxFit.cover,
          alignment: Alignment.bottomCenter,
          filterQuality: FilterQuality.high,
        ),
      ),
    );
  }
}

enum _RouteStatus { completed, inProgress }

class _DayLog {
  /// Which employee and which day, so the route screens can ask the server for
  /// the same road-snapped path the web shows.
  final String employeeId;
  final DateTime date;
  final int day;
  final String month;
  final int year;
  final bool isToday;
  final String punchIn;
  final String routeLabel;
  final String routeTime;
  final int locationsVisited;
  final double distanceKm;
  final _RouteStatus status;
  final List<Map<String, dynamic>> routeHistory;
  final DateTime? punchInAt;
  final DateTime? punchOutAt;
  /// FULL | LIMITED | LOCATION_OFF — see _logFromDetail.
  final String trackingAccess;

  _DayLog({
    required this.employeeId,
    required this.date,
    required this.day,
    required this.month,
    required this.year,
    this.isToday = false,
    required this.punchIn,
    required this.routeLabel,
    required this.routeTime,
    required this.locationsVisited,
    required this.distanceKm,
    required this.status,
    required this.routeHistory,
    this.punchInAt,
    this.punchOutAt,
    this.trackingAccess = 'FULL',
  });
}

class _TrackingPoint {
  const _TrackingPoint(
    this.latitude,
    this.longitude,
    this.timestamp,
    this.activityType, [
    this.accuracyMeters,
    this.label,
  ]);
  final double latitude;
  final double longitude;
  final DateTime timestamp;
  final String activityType;

  /// Description saved with an event on the server (e.g. "Collection at
  /// SATHYA NAGAR"); null for GPS pings and for older servers.
  final String? label;

  /// Reported GPS error radius; null for older rows that never stored it.
  final double? accuracyMeters;
}

/// Staggers each day-card's entrance — later cards start fading/sliding in
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
    final start = (0.15 + index * 0.1).clamp(0.0, 0.7);
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
