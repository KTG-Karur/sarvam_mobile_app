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

  DateTime _month = DateTime.now();
  String _rangeLabel = 'This Month';
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
    _loadTodayTracking();
  }

  Future<void> _loadTodayTracking() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final id = prefs.getString('userId') ?? '';
      if (id.isEmpty) throw const HrApiException('Employee session is unavailable. Please sign in again.');
      final now = DateTime.now();
      final selectedDate = _month.year == now.year && _month.month == now.month
          ? now
          : DateTime(_month.year, _month.month, 1);
      final detail = await HrApiService.trackingDetail(
        employeeId: id,
        date: selectedDate,
      );
      if (!mounted) return;
      final route = detail['routeHistory'] is List ? detail['routeHistory'] as List : const [];
      final punchIn = DateTime.tryParse(detail['punchIn']?.toString() ?? '');
      final punchOut = DateTime.tryParse(detail['punchOut']?.toString() ?? '');
      final currentStatus = detail['currentStatus']?.toString() ?? 'OFFLINE';
      setState(() {
        _logs = [
          _DayLog(
            day: selectedDate.day,
            month: _monthAbbr(selectedDate.month).toUpperCase(),
            year: selectedDate.year,
            isToday: selectedDate.year == now.year &&
                selectedDate.month == now.month,
            punchIn: punchIn == null ? '--:--' : _time(punchIn),
            routeLabel: punchOut != null ? 'Route Completed' : currentStatus.replaceAll('_', ' '),
            routeTime: punchOut == null ? '--:--' : _time(punchOut),
            locationsVisited: route.length,
            distanceKm: (detail['travelledKm'] as num?)?.toDouble() ?? 0,
            status: punchOut == null ? _RouteStatus.inProgress : _RouteStatus.completed,
          ),
        ];
      });
    } catch (error) {
      if (mounted) setState(() => _loadError = error.toString());
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  String _time(DateTime value) {
    final hour = value.hour % 12 == 0 ? 12 : value.hour % 12;
    return '${hour.toString().padLeft(2, '0')}:${value.minute.toString().padLeft(2, '0')} ${value.hour >= 12 ? 'PM' : 'AM'}';
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  static const _monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  String get _monthYearLabel => '${_monthNames[_month.month - 1]} ${_month.year}';

  String get _monthRangeSub {
    final now = DateTime.now();
    final isCurrentMonth = _month.year == now.year && _month.month == now.month;
    final lastDay = DateTime(_month.year, _month.month + 1, 0).day;
    final endDay = isCurrentMonth ? now.day : lastDay;
    final suffix = isCurrentMonth ? ' (Till Today)' : '';
    return '01 ${_monthAbbr(_month.month)} ${_month.year} - ${endDay.toString().padLeft(2, '0')} ${_monthAbbr(_month.month)} ${_month.year}$suffix';
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

  void _changeMonth(int delta) {
    setState(() {
      _month = DateTime(_month.year, _month.month + delta);
      _isLoading = true;
      _loadError = null;
    });
    _ctrl.forward(from: 0);
    _loadTodayTracking();
  }

  static const _stopNames = [
    'ABC Traders',
    'Sri Ganesh Stores',
    'Kumar Agencies',
    'Muthu Enterprises',
    'Velan Traders',
    'Raja Textiles',
    'Amman Store',
  ];
  static const _stopAddresses = [
    '100 Feet Road, Coimbatore',
    'Avinashi Road, Coimbatore',
    'Peelamedu, Coimbatore',
    'Singanallur, Coimbatore',
    'Saravanampatti, Coimbatore',
    'Ukkadam, Coimbatore',
    'Gandhipuram, Coimbatore',
  ];
  static const _baseLat = 11.0018;
  static const _baseLng = 76.9558;

  String _visitTime(int stopIndex) {
    final totalMinutes = 9 * 60 + 40 + stopIndex * 95;
    final hour24 = (totalMinutes ~/ 60) % 24;
    final minute = totalMinutes % 60;
    final period = hour24 >= 12 ? 'PM' : 'AM';
    final hour12 = hour24 % 12 == 0 ? 12 : hour24 % 12;
    return '${hour12.toString().padLeft(2, '0')}:${minute.toString().padLeft(2, '0')} $period';
  }

  List<RouteStop> _stopsForLog(_DayLog log) {
    final inProgress = log.status == _RouteStatus.inProgress;
    final pendingCount = inProgress ? 2 : 0;
    final total = log.locationsVisited + pendingCount;
    final stops = <RouteStop>[
      RouteStop(
        label: 'Start',
        time: log.punchIn,
        title: 'Punch-In',
        address: 'Coimbatore (Office)',
        status: VisitStatus.completed,
        position: LatLng(_baseLat, _baseLng),
      ),
    ];
    for (var i = 0; i < total; i++) {
      final isPending = i >= log.locationsVisited;
      stops.add(
        RouteStop(
          label: '${i + 1}',
          time: isPending ? '--:--' : _visitTime(i),
          title: _stopNames[i % _stopNames.length],
          address: _stopAddresses[i % _stopAddresses.length],
          status: isPending ? VisitStatus.pending : VisitStatus.visited,
          position: LatLng(
            _baseLat + (i + 1) * 0.012 * (i.isEven ? 1 : 0.6),
            _baseLng + (i + 1) * 0.02,
          ),
        ),
      );
    }
    return stops;
  }

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
          totalDuration: inProgress ? '5h 28m' : _durationBetween(log),
          stops: _stopsForLog(log),
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
    TimeOfDay parse(String t) {
      final parts = t.split(RegExp(r'[: ]'));
      var hour = int.parse(parts[0]) % 12;
      final minute = int.parse(parts[1]);
      if (parts[2] == 'PM') hour += 12;
      return TimeOfDay(hour: hour, minute: minute);
    }

    final start = parse(log.punchIn);
    final end = parse(log.routeTime);
    var minutes = (end.hour * 60 + end.minute) - (start.hour * 60 + start.minute);
    if (minutes < 0) minutes += 24 * 60;
    return '${minutes ~/ 60}h ${minutes % 60}m';
  }

  void _comingSoon(String label) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('$label — coming soon'),
        backgroundColor: _greenAccent,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(10.r),
        ),
        duration: const Duration(seconds: 1),
      ),
    );
  }

  Future<void> _pickRange() async {
    final options = ['This Month', 'Last Month', 'Last 7 Days', 'Custom Range'];
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
                          fontWeight: o == _rangeLabel
                              ? FontWeight.w700
                              : FontWeight.w500,
                          color: o == _rangeLabel ? _greenAccent : _darkText,
                        ),
                      ),
                      trailing: o == _rangeLabel
                          ? Icon(Icons.check_rounded, color: _greenAccent)
                          : null,
                      onTap: () => Navigator.pop(context, o),
                    ),
                  )
                  .toList(),
            ),
          ),
        );
      },
    );
    if (selected != null && selected != _rangeLabel) {
      setState(() => _rangeLabel = selected);
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
                          Padding(padding: const EdgeInsets.all(20), child: Center(child: Column(children: [Text(_loadError!, textAlign: TextAlign.center), TextButton(onPressed: _loadTodayTracking, child: const Text('Retry'))])))
                        else if (_logs.isEmpty)
                          const Padding(padding: EdgeInsets.all(28), child: Center(child: Text('No tracking data for today.')))
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
          _navArrow(Icons.chevron_left_rounded, () => _changeMonth(-1)),
          Expanded(
            child: AnimatedSwitcher(
              duration: const Duration(milliseconds: 250),
              child: Column(
                key: ValueKey(_monthYearLabel),
                children: [
                  Text(
                    _monthYearLabel,
                    style: GoogleFonts.inter(
                      fontSize: 15.sp,
                      fontWeight: FontWeight.w700,
                      color: _greenAccent,
                    ),
                  ),
                  SizedBox(height: 3.h),
                  Text(
                    _monthRangeSub,
                    style: GoogleFonts.inter(fontSize: 10.5.sp, color: _muted),
                  ),
                ],
              ),
            ),
          ),
          _navArrow(Icons.chevron_right_rounded, () => _changeMonth(1)),
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
                    onTap: () => _comingSoon('Distance detail'),
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

  _DayLog({
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
  });
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
