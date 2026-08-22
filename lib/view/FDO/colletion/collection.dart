import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:sarvam/controller/live_collection_controller.dart';
import 'package:sarvam/services/offline_collection_service.dart';
import 'package:sarvam/view/FDO/colletion/arrear_collection_details.dart';
import 'package:sarvam/view/FDO/colletion/demand_collection.dart';
import 'package:sarvam/view/FDO/colletion/single_collection_details_bulk_center_collection.dart';

class Collection extends StatefulWidget {
  const Collection({super.key});

  @override
  State<Collection> createState() => _CollectionState();
}

class _CollectionState extends State<Collection> {
  late DateTime _selectedDate;

  @override
  void initState() {
    super.initState();
    _selectedDate = DateTime.now();
    _loadEodWorkingDate();
  }

  Future<void> _loadEodWorkingDate() async {
    final liveCtrl = Get.isRegistered<LiveCollectionController>()
        ? Get.find<LiveCollectionController>()
        : Get.put(LiveCollectionController());
    final date = await liveCtrl.fetchEodWorkingDate();
    if (date != null && mounted) {
      setState(() {
        _selectedDate = date;
      });
    }
  }

  String get _monthYearText {
    final months = [
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
    ];
    return '${months[_selectedDate.month - 1]} ${_selectedDate.year}';
  }

  List<Widget> _buildCalendarRows() {
    final year = _selectedDate.year;
    final month = _selectedDate.month;
    final firstDayOfMonth = DateTime(year, month, 1);
    final daysInMonth = DateTime(year, month + 1, 0).day;

    // Weekday of the first day (1 = Monday, 7 = Sunday)
    // We want Sunday to be index 0
    final startOffset = firstDayOfMonth.weekday % 7;

    final List<Widget> dayWidgets = [];

    // Add empty spacer cells for the offset
    for (int i = 0; i < startOffset; i++) {
      dayWidgets.add(
        Container(
          width: 10.w,
          height: 10.w,
          margin: EdgeInsets.symmetric(horizontal: 1.w),
        ),
      );
    }

    // Add actual days
    for (int day = 1; day <= daysInMonth; day++) {
      dayWidgets.add(_buildCalendarDay(day));
    }

    // Group into rows of 7
    final List<Widget> rows = [];
    for (int i = 0; i < dayWidgets.length; i += 7) {
      final rowChildren = dayWidgets.sublist(
        i,
        (i + 7 > dayWidgets.length) ? dayWidgets.length : i + 7,
      );
      // Pad last row if it has fewer than 7 items
      while (rowChildren.length < 7) {
        rowChildren.add(
          Container(
            width: 14.w,
            height: 10.w,
            margin: EdgeInsets.symmetric(horizontal: 1.w),
          ),
        );
      }
      rows.add(
        Padding(
          padding: EdgeInsets.symmetric(vertical: 1.h),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: rowChildren,
          ),
        ),
      );
    }
    return rows;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
    appBar: AppBar(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        title: const Text('Collection Relationship'),
      ),
      body: SafeArea(
        
        child: Stack(
          children: [
            // Bottom Wave Decoration
            Positioned(
              bottom: 0,
              left: 0,
              right: 0,
              child: CustomPaint(
                size: Size(double.infinity, 120.h),
                painter: BottomWavePainter(),
              ),
            ),
            // Main Content
            Padding(
              padding: EdgeInsets.symmetric(horizontal: 20.w),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(height: 16.h),
                  // Header
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      Row(
                        children: [
                          Stack(
                            clipBehavior: Clip.none,
                            children: [
                              Icon(
                                Icons.shopping_bag_rounded,
                                color: const Color(0xFFF2B006),
                                size: 32.sp,
                              ),
                              Positioned(
                                right: -2.w,
                                bottom: -2.h,
                                child: Container(
                                  padding: EdgeInsets.all(1.w),
                                  decoration: const BoxDecoration(
                                    color: Colors.white,
                                    shape: BoxShape.circle,
                                  ),
                                  child: Icon(
                                    Icons.check,
                                    color: const Color(0xFF084E33),
                                    size: 14.sp,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          SizedBox(width: 8.w),
                          Text(
                            'Collection Relationship',
                            style: TextStyle(
                              fontSize: 13.sp,
                              fontWeight: FontWeight.w900,
                              color: const Color(0xFF084E33),
                              letterSpacing: -0.5,
                            ),
                          ),
                        ],
                      ),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Padding(
                            padding: EdgeInsets.only(right: 4.w),
                            child: Text(
                              _monthYearText,
                              style: TextStyle(
                                fontSize: 11.sp,
                                fontWeight: FontWeight.bold,
                                color: const Color(0xFF084E33),
                              ),
                            ),
                          ),
                          SizedBox(height: 4.h),
                          Container(
                            padding: EdgeInsets.symmetric(
                              horizontal: 6.w,
                              vertical: 6.h,
                            ),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(10.r),
                              border: Border.all(
                                color: const Color(0xFF084E33),
                                width: 1,
                              ),
                            ),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                GestureDetector(
                                  onTap: () async {
                                    final DateTime?
                                    picked = await showDatePicker(
                                      context: context,
                                      initialDate: _selectedDate,
                                      firstDate: DateTime(2024, 1, 1),
                                      lastDate: DateTime(2030, 12, 31),
                                      builder: (context, child) {
                                        return Theme(
                                          data: Theme.of(context).copyWith(
                                            colorScheme:
                                                const ColorScheme.light(
                                                  primary: Color(0xFF084E33),
                                                  onPrimary: Colors.white,
                                                  onSurface: Color(0xFF084E33),
                                                ),
                                            textButtonTheme:
                                                TextButtonThemeData(
                                                  style: TextButton.styleFrom(
                                                    foregroundColor:
                                                        const Color(0xFF084E33),
                                                  ),
                                                ),
                                          ),
                                          child: child!,
                                        );
                                      },
                                    );
                                    if (picked != null) {
                                      setState(() {
                                        _selectedDate = picked;
                                      });
                                    }
                                  },
                                  child: Padding(
                                    padding: EdgeInsets.only(top: 2.h),
                                    child: Icon(
                                      Icons.calendar_month_outlined,
                                      size: 20.sp,
                                      color: const Color(0xFF084E33),
                                    ),
                                  ),
                                ),
                                SizedBox(width: 4.w),
                                Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    // Weekday labels
                                    Row(
                                      mainAxisAlignment:
                                          MainAxisAlignment.center,
                                      children:
                                          [
                                            'S',
                                            'M',
                                            'T',
                                            'W',
                                            'T',
                                            'F',
                                            'S',
                                          ].map((label) {
                                            return Container(
                                              width: 14.w,
                                              alignment: Alignment.center,
                                              margin: EdgeInsets.symmetric(
                                                horizontal: 1.w,
                                              ),
                                              child: Text(
                                                label,
                                                style: TextStyle(
                                                  fontSize: 7.sp,
                                                  fontWeight: FontWeight.bold,
                                                  color: const Color(
                                                    0xFF64748B,
                                                  ),
                                                ),
                                              ),
                                            );
                                          }).toList(),
                                    ),
                                    SizedBox(height: 2.h),
                                    // Days rows
                                    ..._buildCalendarRows(),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                  SizedBox(height: 12.h),
                  const Divider(
                    color: Color(0xFF084E33),
                    thickness: 1.2,
                    height: 1,
                  ),
                  SizedBox(height: 24.h),
                  // Search
                  TextField(
                    decoration: InputDecoration(
                      contentPadding: EdgeInsets.symmetric(
                        vertical: 12.h,
                        horizontal: 16.w,
                      ),
                      hintText: 'Search collection...',
                      hintStyle: TextStyle(
                        fontSize: 12.sp,
                        color: const Color(0xFF94A3B8),
                      ),
                      suffixIcon: Icon(
                        Icons.search,
                        color: const Color(0xFF084E33),
                        size: 22.sp,
                      ),
                      filled: true,
                      fillColor: Colors.white,
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10.r),
                        borderSide: const BorderSide(
                          color: Color(0xFF084E33),
                          width: 1,
                        ),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10.r),
                        borderSide: const BorderSide(
                          color: Color(0xFF084E33),
                          width: 1.5,
                        ),
                      ),
                    ),
                  ),
                  SizedBox(height: 24.h),
                  // Offline Collections Sync Banner
                  Obx(() {
                    final offlineService = Get.isRegistered<OfflineCollectionService>()
                        ? Get.find<OfflineCollectionService>()
                        : Get.put(OfflineCollectionService());
                    final count = offlineService.pendingCount.value;
                    if (count == 0) return const SizedBox.shrink();

                    return Container(
                      margin: EdgeInsets.only(bottom: 16.h),
                      padding: EdgeInsets.symmetric(horizontal: 14.w, vertical: 12.h),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFFF3E0),
                        borderRadius: BorderRadius.circular(10.r),
                        border: Border.all(color: const Color(0xFFFF9800), width: 1),
                      ),
                      child: Row(
                        children: [
                          Icon(Icons.wifi_off_rounded, color: const Color(0xFFE65100), size: 24.sp),
                          SizedBox(width: 10.w),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '$count Offline Collection${count > 1 ? 's' : ''} Pending',
                                  style: TextStyle(
                                    fontSize: 13.sp,
                                    fontWeight: FontWeight.bold,
                                    color: const Color(0xFFE65100),
                                  ),
                                ),
                                Text(
                                  'Tap sync when internet is connected',
                                  style: TextStyle(
                                    fontSize: 11.sp,
                                    color: const Color(0xFFBF360C),
                                  ),
                                ),
                              ],
                            ),
                          ),
                          ElevatedButton.icon(
                            onPressed: offlineService.isSyncing.value
                                ? null
                                : () => offlineService.syncAllPendingCollections(),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: const Color(0xFF008A3D),
                              foregroundColor: Colors.white,
                              padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 6.h),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(8.r),
                              ),
                            ),
                            icon: offlineService.isSyncing.value
                                ? SizedBox(
                                    width: 12.w,
                                    height: 12.w,
                                    child: const CircularProgressIndicator(
                                      strokeWidth: 2,
                                      color: Colors.white,
                                    ),
                                  )
                                : Icon(Icons.sync, size: 16.sp),
                            label: Text(
                              offlineService.isSyncing.value ? 'Syncing...' : 'Sync Now',
                              style: TextStyle(fontSize: 11.sp, fontWeight: FontWeight.bold),
                            ),
                          ),
                        ],
                      ),
                    );
                  }),
                  // Categories List
                  Expanded(
                    child: ListView(
                      physics: const BouncingScrollPhysics(),
                      children: [
                        _CollectionOption(
                          title: 'Live Collection',
                          subtitle:
                              'View and manage live collections in real-time.',
                          icon: _buildCardIcon('Live Collection'),
                          onTap: () =>
                              _openDetails(context, CollectionType.current),
                        ),
                        _CollectionOption(
                          title: 'Arrear Collection',
                          subtitle: 'Manage pending or overdue collections.',
                          icon: _buildCardIcon('Arrear Collection'),
                          onTap: () =>
                              _openDetails(context, CollectionType.arrear),
                        ),
                        _CollectionOption(
                          title: 'Advance Collection',
                          subtitle: 'Record and manage advance payments.',
                          icon: _buildCardIcon('Advance Collection'),
                          onTap: () =>
                              _openDetails(context, CollectionType.advance),
                        ),
                        SizedBox(
                          height: 120.h,
                        ), // Space for bottom wave decoration
                      ],
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

  Widget _buildCalendarDay(int day) {
    final dayDate = DateTime(_selectedDate.year, _selectedDate.month, day);
    final isSelected =
        dayDate.day == _selectedDate.day &&
        dayDate.month == _selectedDate.month &&
        dayDate.year == _selectedDate.year;

    return GestureDetector(
      onTap: () {
        setState(() {
          _selectedDate = dayDate;
        });
      },
      child: Container(
        width: 14.w,
        height: 14.w,
        alignment: Alignment.center,
        margin: EdgeInsets.symmetric(horizontal: 1.w),
        decoration: isSelected
            ? BoxDecoration(
                border: Border.all(color: const Color(0xFFF2B006), width: 1.2),
                borderRadius: BorderRadius.circular(3.r),
              )
            : null,
        child: Text(
          '$day',
          style: TextStyle(
            fontSize: 9.sp,
            fontWeight: isSelected ? FontWeight.bold : FontWeight.w500,
            color: const Color(0xFF084E33),
          ),
        ),
      ),
    );
  }

  Widget _buildCardIcon(String type) {
    switch (type) {
      case 'Live Collection':
        return Stack(
          alignment: Alignment.center,
          children: [
            Icon(Icons.wifi, color: const Color(0xFF084E33), size: 26.sp),
            Positioned(
              child: Container(
                width: 6.w,
                height: 6.w,
                decoration: const BoxDecoration(
                  color: Color(0xFFF2B006),
                  shape: BoxShape.circle,
                ),
              ),
            ),
          ],
        );
      case 'Arrear Collection':
        return Stack(
          alignment: Alignment.center,
          children: [
            Icon(
              Icons.shopping_cart_outlined,
              color: const Color(0xFF084E33),
              size: 26.sp,
            ),
            Positioned(
              top: 19.w,
              left: 21.w,
              child: Container(
                width: 10.w,
                height: 8.w,
                decoration: BoxDecoration(
                  color: const Color(0xFFF2B006),
                  borderRadius: BorderRadius.circular(1.r),
                ),
              ),
            ),
          ],
        );
      case 'Advance Collection':
        return Stack(
          alignment: Alignment.center,
          children: [
            Positioned(
              bottom: 14.w,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Container(
                    width: 5.w,
                    height: 10.w,
                    decoration: BoxDecoration(
                      color: const Color(0xFF084E33),
                      borderRadius: BorderRadius.circular(1.r),
                    ),
                  ),
                  SizedBox(width: 2.w),
                  Container(
                    width: 5.w,
                    height: 16.w,
                    decoration: BoxDecoration(
                      color: const Color(0xFF084E33),
                      borderRadius: BorderRadius.circular(1.r),
                    ),
                  ),
                  SizedBox(width: 2.w),
                  Container(
                    width: 5.w,
                    height: 22.w,
                    decoration: BoxDecoration(
                      color: const Color(0xFF084E33),
                      borderRadius: BorderRadius.circular(1.r),
                    ),
                  ),
                ],
              ),
            ),
            Positioned(
              top: 10.w,
              right: 10.w,
              child: Icon(
                Icons.trending_up,
                color: const Color(0xFFF2B006),
                size: 20.sp,
              ),
            ),
          ],
        );
      default:
        return const SizedBox.shrink();
    }
  }

  void _openDetails(BuildContext context, CollectionType type) {
    switch (type) {
      case CollectionType.current:
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => DemandCollection(initialDate: _selectedDate),
          ),
        );
        break;
      case CollectionType.advance:
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => const SingleCollectionDetailsBulkCenterCollection(),
          ),
        );
        break;
      case CollectionType.arrear:
      case CollectionType.os:
        Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => CollectionDetails(type: type)),
        );
        break;
    }
  }
}

class _CollectionOption extends StatelessWidget {
  const _CollectionOption({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.onTap,
  });

  final String title, subtitle;
  final Widget icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: EdgeInsets.only(bottom: 16.h),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16.r),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.04),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
        border: Border.all(color: const Color(0xFFF1F5F9)),
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(16.r),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(16.r),
          child: Padding(
            padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 16.h),
            child: Row(
              children: [
                Container(
                  width: 56.w,
                  height: 56.w,
                  decoration: const BoxDecoration(
                    color: Color(0xFFE8F5E9),
                    shape: BoxShape.circle,
                  ),
                  child: icon,
                ),
                SizedBox(width: 16.w),
                Container(
                  width: 1,
                  height: 36.h,
                  color: const Color(0xFFE2E8F0),
                ),
                SizedBox(width: 16.w),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: TextStyle(
                          fontSize: 16.sp,
                          fontWeight: FontWeight.bold,
                          color: const Color(0xFF084E33),
                        ),
                      ),
                      SizedBox(height: 4.h),
                      Text(
                        subtitle,
                        style: TextStyle(
                          fontSize: 12.sp,
                          color: const Color(0xFF64748B),
                          height: 1.2,
                        ),
                      ),
                    ],
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

enum CollectionType { current, arrear, advance, os }

class CollectionDetails extends StatelessWidget {
  const CollectionDetails({super.key, required this.type});

  final CollectionType type;

  @override
  Widget build(BuildContext context) {
    if (type == CollectionType.arrear) {
      return const ArrearCollectionDetails();
    }
    final details = switch (type) {
      CollectionType.current => (
        'Live Collection',
        '₹ 15,750',
        const Color(0xFF084E33),
        'Today’s due repayments',
      ),
      CollectionType.arrear => (
        'Arrear Collection',
        '₹ 8,600',
        const Color(0xFFC2412D),
        'Overdue repayments',
      ),
      CollectionType.advance => (
        'Advance Collection',
        '₹ 5,250',
        const Color(0xFFB45309),
        'Upcoming repayments',
      ),
      CollectionType.os => (
        'OD Collection',
        '₹ 10,400',
        const Color(0xFF084E33),
        'Outstanding collections',
      ),
    };
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        title: Text(details.$1),
      ),
      body: Padding(
        padding: EdgeInsets.all(16.w),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: double.infinity,
              padding: EdgeInsets.all(18.w),
              decoration: BoxDecoration(
                color: details.$3,
                borderRadius: BorderRadius.circular(14.r),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    details.$4,
                    style: TextStyle(color: Colors.white70, fontSize: 11.sp),
                  ),
                  SizedBox(height: 7.h),
                  Text(
                    details.$2,
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 27.sp,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ),
            ),
            SizedBox(height: 20.h),
            Text(
              'CLIENT LIST',
              style: TextStyle(
                fontSize: 11.sp,
                color: details.$3,
                fontWeight: FontWeight.w800,
                letterSpacing: .6,
              ),
            ),
            SizedBox(height: 10.h),
            Expanded(
              child: Center(
                child: Text(
                  'Collection client list will appear here.',
                  style: TextStyle(
                    color: const Color(0xFF64748B),
                    fontSize: 12.sp,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class BottomWavePainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final width = size.width;
    final height = size.height;

    // Draw yellow wave (background wave)
    final yellowPaint = Paint()
      ..color = const Color(0xFFF2B006)
      ..style = PaintingStyle.fill;

    final yellowPath = Path();
    yellowPath.moveTo(0, height * 0.45);
    yellowPath.cubicTo(
      width * 0.35,
      height * 0.75,
      width * 0.7,
      height * 0.05,
      width,
      height * 0.25,
    );
    yellowPath.lineTo(width, height);
    yellowPath.lineTo(0, height);
    yellowPath.close();
    canvas.drawPath(yellowPath, yellowPaint);

    // Draw green wave (foreground wave)
    final greenPaint = Paint()
      ..color = const Color(0xFF084E33)
      ..style = PaintingStyle.fill;

    final greenPath = Path();
    greenPath.moveTo(0, height * 0.5);
    greenPath.cubicTo(
      width * 0.35,
      height * 0.8,
      width * 0.7,
      height * 0.12,
      width,
      height * 0.32,
    );
    greenPath.lineTo(width, height);
    greenPath.lineTo(0, height);
    greenPath.close();
    canvas.drawPath(greenPath, greenPaint);

    // Highlight lines inside the green wave
    final highlightPaint = Paint()
      ..color = Colors.white.withValues(alpha: 0.15)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.w;

    final highlightPath1 = Path();
    highlightPath1.moveTo(0, height * 0.65);
    highlightPath1.cubicTo(
      width * 0.35,
      height * 0.95,
      width * 0.7,
      height * 0.35,
      width,
      height * 0.52,
    );
    canvas.drawPath(highlightPath1, highlightPaint);

    final highlightPath2 = Path();
    highlightPath2.moveTo(0, height * 0.75);
    highlightPath2.cubicTo(
      width * 0.35,
      height * 1.05,
      width * 0.7,
      height * 0.45,
      width,
      height * 0.62,
    );
    canvas.drawPath(highlightPath2, highlightPaint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
