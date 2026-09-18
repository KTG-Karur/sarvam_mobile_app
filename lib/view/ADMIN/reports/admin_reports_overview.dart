import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:get/get.dart';
import 'package:sarvam/controller/admin/admin_dashboard_controller.dart';

class AdminReportsOverview extends StatefulWidget {
  const AdminReportsOverview({super.key});

  @override
  State<AdminReportsOverview> createState() => _AdminReportsOverviewState();
}

class _AdminReportsOverviewState extends State<AdminReportsOverview> {
  final AdminDashboardController _controller = Get.put(AdminDashboardController());

  static const _primaryGreen = Color(0xFF0D6842);
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);
  static const _lightBg = Color(0xFFF8FAFC);

  final List<Map<String, dynamic>> _reportCategories = [
    {
      'title': 'Demand vs Collection Report',
      'subtitle': 'Daily & monthly repayment collection analysis',
      'icon': Icons.pie_chart_rounded,
      'color': const Color(0xFF0D6842),
    },
    {
      'title': 'Portfolio Quality & PAR Report',
      'subtitle': 'Arrears, overdue buckets and risk classification',
      'icon': Icons.analytics_rounded,
      'color': const Color(0xFF7C3AED),
    },
    {
      'title': 'Disbursement & Fund Utilization',
      'subtitle': 'Product-wise and funder-wise disbursement logs',
      'icon': Icons.payments_rounded,
      'color': const Color(0xFF1E3A8A),
    },
    {
      'title': 'EOD Execution & Audit Trail',
      'subtitle': 'End-Of-Day batch closing & system user audit',
      'icon': Icons.history_toggle_off_rounded,
      'color': const Color(0xFFB45309),
    },
    {
      'title': 'Employee & FDO Attendance MIS',
      'subtitle': 'Field force attendance, center visits and tasks',
      'icon': Icons.badge_rounded,
      'color': const Color(0xFF0D9488),
    },
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _lightBg,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: _darkText, size: 20),
          onPressed: () => Get.back(),
        ),
        title: Text(
          'MIS & Executive Reports',
          style: GoogleFonts.inter(
            fontSize: 18.sp,
            fontWeight: FontWeight.w700,
            color: _darkText,
          ),
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: EdgeInsets.all(16.w),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildSummaryHeader(),
              SizedBox(height: 20.h),
              Text(
                'AVAILABLE MIS REPORTS',
                style: GoogleFonts.inter(
                  fontSize: 11.sp,
                  fontWeight: FontWeight.w700,
                  color: _muted,
                  letterSpacing: 0.8,
                ),
              ),
              SizedBox(height: 10.h),
              ..._reportCategories.map((report) => _buildReportTile(report)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSummaryHeader() {
    return Obx(() {
      return Container(
        padding: EdgeInsets.all(18.w),
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            colors: [_primaryGreen, Color(0xFF1A8A5A)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: BorderRadius.circular(20.r),
          boxShadow: [
            BoxShadow(
              color: _primaryGreen.withOpacity(0.3),
              blurRadius: 16,
              offset: const Offset(0, 6),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Organization Efficiency',
                  style: GoogleFonts.inter(
                    fontSize: 13.sp,
                    color: Colors.white.withOpacity(0.85),
                    fontWeight: FontWeight.w500,
                  ),
                ),
                Container(
                  padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 4.h),
                  decoration: BoxDecoration(
                    color: Colors.white.withOpacity(0.2),
                    borderRadius: BorderRadius.circular(20.r),
                  ),
                  child: Text(
                    '${_controller.collectionPercentage.toStringAsFixed(1)}% Collection Rate',
                    style: GoogleFonts.inter(
                      fontSize: 11.sp,
                      color: Colors.white,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
            SizedBox(height: 12.h),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                _buildHeaderMetric('Total Disbursed', '₹${(_controller.totalDisbursedAmount.value / 100000).toStringAsFixed(2)} L'),
                _buildHeaderMetric('Demand', '₹${(_controller.totalDemandAmount.value / 100000).toStringAsFixed(2)} L'),
                _buildHeaderMetric('Collected', '₹${(_controller.totalCollectedAmount.value / 100000).toStringAsFixed(2)} L'),
              ],
            ),
          ],
        ),
      );
    });
  }

  Widget _buildHeaderMetric(String label, String value) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: GoogleFonts.inter(
            fontSize: 10.sp,
            color: Colors.white.withOpacity(0.75),
            fontWeight: FontWeight.w500,
          ),
        ),
        SizedBox(height: 2.h),
        Text(
          value,
          style: GoogleFonts.inter(
            fontSize: 16.sp,
            color: Colors.white,
            fontWeight: FontWeight.w800,
          ),
        ),
      ],
    );
  }

  Widget _buildReportTile(Map<String, dynamic> report) {
    final Color color = report['color'];
    return Container(
      margin: EdgeInsets.only(bottom: 12.h),
      padding: EdgeInsets.all(16.w),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16.r),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.04),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            padding: EdgeInsets.all(12.w),
            decoration: BoxDecoration(
              color: color.withOpacity(0.1),
              borderRadius: BorderRadius.circular(14.r),
            ),
            child: Icon(report['icon'], color: color, size: 22.sp),
          ),
          SizedBox(width: 14.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  report['title'],
                  style: GoogleFonts.inter(
                    fontSize: 14.sp,
                    fontWeight: FontWeight.w700,
                    color: _darkText,
                  ),
                ),
                SizedBox(height: 2.h),
                Text(
                  report['subtitle'],
                  style: GoogleFonts.inter(
                    fontSize: 11.sp,
                    color: _muted,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
          ElevatedButton(
            onPressed: () {
              Get.snackbar(
                'Report Generated',
                'Downloading ${report['title']} in background...',
                snackPosition: SnackPosition.BOTTOM,
                backgroundColor: _primaryGreen,
                colorText: Colors.white,
              );
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: _lightBg,
              elevation: 0,
              padding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 8.h),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10.r)),
            ),
            child: Text(
              'Export',
              style: GoogleFonts.inter(
                fontSize: 11.sp,
                fontWeight: FontWeight.w700,
                color: _darkText,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
