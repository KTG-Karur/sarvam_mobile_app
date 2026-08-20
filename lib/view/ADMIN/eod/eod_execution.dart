import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:get/get.dart';
import 'package:sarvam/controller/admin/admin_eod_controller.dart';

class EodExecution extends StatefulWidget {
  const EodExecution({super.key});

  @override
  State<EodExecution> createState() => _EodExecutionState();
}

class _EodExecutionState extends State<EodExecution> {
  final AdminEodController _controller = Get.put(AdminEodController());

  static const _primaryGreen = Color(0xFF0D6842);
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);
  static const _lightBg = Color(0xFFF8FAFC);

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
          'EOD Execution & Day Close',
          style: GoogleFonts.inter(
            fontSize: 18.sp,
            fontWeight: FontWeight.w700,
            color: _darkText,
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded, color: _primaryGreen),
            onPressed: () => _controller.checkEodStatus(),
          ),
        ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: EdgeInsets.all(16.w),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildStatusCard(),
              SizedBox(height: 20.h),
              _buildChecklistSection(),
              SizedBox(height: 24.h),
              _buildExecuteButton(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildStatusCard() {
    return Obx(() {
      final status = _controller.dayStatus.value;
      final isOpen = status.toUpperCase() == 'OPEN';

      return Container(
        padding: EdgeInsets.all(18.w),
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: isOpen
                ? [const Color(0xFF0D6842), const Color(0xFF1A8A5A)]
                : [const Color(0xFF1E3A8A), const Color(0xFF3B5FBF)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: BorderRadius.circular(20.r),
          boxShadow: [
            BoxShadow(
              color: (isOpen ? _primaryGreen : const Color(0xFF1E3A8A)).withOpacity(0.3),
              blurRadius: 16,
              offset: const Offset(0, 6),
            ),
          ],
        ),
        child: Row(
          children: [
            Container(
              padding: EdgeInsets.all(12.w),
              decoration: BoxDecoration(
                color: Colors.white.withOpacity(0.2),
                shape: BoxShape.circle,
              ),
              child: Icon(
                isOpen ? Icons.lock_open_rounded : Icons.lock_rounded,
                color: Colors.white,
                size: 28.sp,
              ),
            ),
            SizedBox(width: 14.w),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'BUSINESS DAY STATUS',
                    style: GoogleFonts.inter(
                      fontSize: 10.sp,
                      color: Colors.white.withOpacity(0.8),
                      fontWeight: FontWeight.w700,
                      letterSpacing: 0.8,
                    ),
                  ),
                  SizedBox(height: 2.h),
                  Text(
                    isOpen ? 'Business Day Open' : 'Day Closed (EOD Completed)',
                    style: GoogleFonts.inter(
                      fontSize: 16.sp,
                      color: Colors.white,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      );
    });
  }

  Widget _buildChecklistSection() {
    return Obx(() {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'EOD PRE-EXECUTION CHECKLIST',
            style: GoogleFonts.inter(
              fontSize: 11.sp,
              fontWeight: FontWeight.w700,
              color: _muted,
              letterSpacing: 0.8,
            ),
          ),
          SizedBox(height: 10.h),
          _buildCheckItem(
            title: 'Pending Center Collections',
            value: '${_controller.pendingCollectionsCount.value} Pending',
            isDone: _controller.pendingCollectionsCount.value == 0,
          ),
          SizedBox(height: 8.h),
          _buildCheckItem(
            title: 'Pending Disbursements',
            value: '${_controller.pendingDisbursementsCount.value} Pending',
            isDone: _controller.pendingDisbursementsCount.value == 0,
          ),
          SizedBox(height: 8.h),
          _buildCheckItem(
            title: 'FDO Field Force Attendance',
            value: 'Verified Today',
            isDone: true,
          ),
        ],
      );
    });
  }

  Widget _buildCheckItem({required String title, required String value, required bool isDone}) {
    return Container(
      padding: EdgeInsets.all(14.w),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14.r),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.03),
            blurRadius: 8,
          ),
        ],
      ),
      child: Row(
        children: [
          Icon(
            isDone ? Icons.check_circle_rounded : Icons.warning_amber_rounded,
            color: isDone ? const Color(0xFF166534) : const Color(0xFFD97706),
            size: 22.sp,
          ),
          SizedBox(width: 12.w),
          Expanded(
            child: Text(
              title,
              style: GoogleFonts.inter(
                fontSize: 13.sp,
                fontWeight: FontWeight.w600,
                color: _darkText,
              ),
            ),
          ),
          Text(
            value,
            style: GoogleFonts.inter(
              fontSize: 12.sp,
              fontWeight: FontWeight.w700,
              color: isDone ? const Color(0xFF166534) : const Color(0xFFD97706),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildExecuteButton() {
    return Obx(() {
      return SizedBox(
        width: double.infinity,
        height: 50.h,
        child: ElevatedButton(
          onPressed: _controller.isExecuting.value
              ? null
              : () async {
                  final error = await _controller.executeEodBatch();
                  if (error == null) {
                    Get.snackbar(
                      'EOD Success',
                      'End-Of-Day batch process executed successfully!',
                      snackPosition: SnackPosition.BOTTOM,
                      backgroundColor: _primaryGreen,
                      colorText: Colors.white,
                    );
                  } else {
                    Get.snackbar(
                      'EOD Execution',
                      error,
                      snackPosition: SnackPosition.BOTTOM,
                      backgroundColor: Colors.redAccent,
                      colorText: Colors.white,
                    );
                  }
                },
          style: ElevatedButton.styleFrom(
            backgroundColor: _primaryGreen,
            elevation: 4,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14.r)),
          ),
          child: _controller.isExecuting.value
              ? const CircularProgressIndicator(color: Colors.white)
              : Text(
                  'RUN END-OF-DAY (EOD) BATCH',
                  style: GoogleFonts.inter(
                    fontSize: 14.sp,
                    fontWeight: FontWeight.w700,
                    color: Colors.white,
                    letterSpacing: 0.5,
                  ),
                ),
        ),
      );
    });
  }
}
