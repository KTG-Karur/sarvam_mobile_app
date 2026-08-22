import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/controller/loan_index_approval_controller.dart';
import 'package:sarvam/services/api_client.dart';
import 'package:sarvam/services/enrollment_api_service.dart';
import 'package:sarvam/services/loan_api_service.dart';
import 'package:sarvam/view/BM/group_assignment/widgets/id_dropdown.dart';
import 'package:sarvam/view/shared/highmark_report_sheet.dart';

const _green = Color(0xFF0D6842);
const _darkText = Color(0xFF172033);
const _muted = Color(0xFF64748B);

/// BM "Loan Index Approval" — mirrors the core flow of the web app's
/// Loan Indexation page (`components/loan-module/LoanIndexationClient.tsx`):
/// select a center, review verified-but-unindexed loans, approve/reject
/// each, set a First Due Date, and submit. Submitting creates the loan
/// index and forwards approved loans straight to the Area Manager.
class LoanIndexApproval extends StatefulWidget {
  const LoanIndexApproval({super.key});

  @override
  State<LoanIndexApproval> createState() => _LoanIndexApprovalState();
}

class _LoanIndexApprovalState extends State<LoanIndexApproval> {
  final LoanIndexApprovalController controller =
      Get.isRegistered<LoanIndexApprovalController>()
      ? Get.find<LoanIndexApprovalController>()
      : Get.put(LoanIndexApprovalController());
  final EnrollmentApiService _highmarkApi = EnrollmentApiService(ApiClient());

  String _field(Map data, String key, [String fallback = 'N/A']) {
    final v = data[key];
    return v == null || v.toString().trim().isEmpty ? fallback : v.toString();
  }

  double _amount(Map data, String key) {
    final v = data[key];
    if (v is num) return v.toDouble();
    return double.tryParse('$v') ?? 0;
  }

  String _currency(double amount) => '₹${amount.toStringAsFixed(2)}';

  String _formatDisplayDate(String ymd) {
    if (ymd.isEmpty) return '';
    final parts = ymd.split('-');
    if (parts.length != 3) return ymd;
    return '${parts[2]}-${parts[1]}-${parts[0]}';
  }

  Future<void> _pickDate({
    required String initial,
    required String minDate,
    required ValueChanged<String> onPicked,
  }) async {
    DateTime parse(String s) {
      final parts = s.split('-');
      if (parts.length != 3) return DateTime.now();
      return DateTime(
        int.parse(parts[0]),
        int.parse(parts[1]),
        int.parse(parts[2]),
      );
    }

    final min = parse(minDate);
    final init = initial.isNotEmpty ? parse(initial) : min;
    final picked = await showDatePicker(
      context: context,
      initialDate: init.isBefore(min) ? min : init,
      firstDate: min,
      lastDate: DateTime(min.year + 2),
    );
    if (picked != null) {
      onPicked(
        '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}',
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Theme(
      data: Theme.of(context).copyWith(
        textTheme: GoogleFonts.poppinsTextTheme(Theme.of(context).textTheme),
      ),
      child: Scaffold(
        backgroundColor: const Color(0xFFF7FBF8),
        appBar: AppBar(
          elevation: 0,
          scrolledUnderElevation: 0,
          backgroundColor: Colors.white,
          leading: IconButton(
            onPressed: () => Navigator.maybePop(context),
            icon: const Icon(Icons.arrow_back, color: _green),
          ),
          title: Text(
            'Loan Index Approval',
            style: TextStyle(
              fontSize: 17.sp,
              fontWeight: FontWeight.w800,
              color: const Color(0xFF10472A),
            ),
          ),
        ),
        body: SafeArea(
          top: false,
          child: Obx(() {
            if (controller.isLoadingCenters.value && controller.centers.isEmpty) {
              return const Center(child: CircularProgressIndicator(color: _green));
            }
            return RefreshIndicator(
              color: _green,
              onRefresh: () => controller.onCenterChanged(controller.centerId.value),
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: EdgeInsets.all(16.w),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildSelectionCard(),
                    SizedBox(height: 18.h),
                    if (controller.centerId.value != null) _buildLoansSection(),
                    SizedBox(height: 18.h),
                    _buildRecordsSection(),
                  ],
                ),
              ),
            );
          }),
        ),
      ),
    );
  }

  Widget _buildSelectionCard() {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(14.w),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: const Color(0xFFE1EAE4)),
        borderRadius: BorderRadius.circular(14.r),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Loan Index Details',
            style: TextStyle(
              fontSize: 14.sp,
              fontWeight: FontWeight.w800,
              color: _darkText,
            ),
          ),
          SizedBox(height: 3.h),
          Text(
            'Select a center to view its verified, unindexed loans.',
            style: TextStyle(fontSize: 11.sp, color: _muted),
          ),
          SizedBox(height: 14.h),
          Obx(
            () => IdDropdown(
              label: 'Center',
              value: controller.centerId.value,
              items: controller.centers,
              labelBuilder: centerLabel,
              onChanged: controller.onCenterChanged,
            ),
          ),
          SizedBox(height: 12.h),
          Row(
            children: [
              Expanded(
                child: Obx(
                  () => _dateField(
                    label: 'Index Date',
                    value: controller.indexDate.value,
                    onTap: () => _pickDate(
                      initial: controller.indexDate.value,
                      minDate: controller.todayStr,
                      onPicked: (v) {
                        controller.indexDate.value = v;
                        controller.fetchLoanIndexes();
                      },
                    ),
                  ),
                ),
              ),
              SizedBox(width: 10.w),
              Expanded(
                child: Obx(
                  () => _dateField(
                    label: 'First Due Date',
                    value: controller.firstDueDate.value,
                    enabled: controller.centerId.value != null,
                    onTap: () => _pickDate(
                      initial: controller.firstDueDate.value,
                      minDate: controller.todayStr,
                      onPicked: (v) => controller.firstDueDate.value = v,
                    ),
                  ),
                ),
              ),
            ],
          ),
          Obx(() {
            if (controller.nextIndexNo.value.isEmpty) return const SizedBox.shrink();
            return Padding(
              padding: EdgeInsets.only(top: 10.h),
              child: Text(
                'Next Index No: ${controller.nextIndexNo.value}',
                style: TextStyle(
                  fontSize: 11.sp,
                  fontWeight: FontWeight.w700,
                  color: _green,
                ),
              ),
            );
          }),
          Obx(() {
            final mismatch = controller.meetingDayMismatch;
            if (mismatch == null) return const SizedBox.shrink();
            return Padding(
              padding: EdgeInsets.only(top: 8.h),
              child: Container(
                padding: EdgeInsets.all(8.w),
                decoration: BoxDecoration(
                  color: const Color(0xFFFEE2E2),
                  borderRadius: BorderRadius.circular(8.r),
                  border: Border.all(color: const Color(0xFFFCA5A5)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.warning_amber_rounded, size: 16, color: Color(0xFF991B1B)),
                    SizedBox(width: 6.w),
                    Expanded(
                      child: Text(
                        mismatch,
                        style: TextStyle(
                          fontSize: 10.5.sp,
                          fontWeight: FontWeight.w600,
                          color: const Color(0xFF991B1B),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            );
          }),
        ],
      ),
    );
  }

  Widget _dateField({
    required String label,
    required String value,
    required VoidCallback onTap,
    bool enabled = true,
  }) {
    return InkWell(
      onTap: enabled ? onTap : null,
      borderRadius: BorderRadius.circular(10.r),
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 10.h),
        decoration: BoxDecoration(
          border: Border.all(
            color: enabled ? const Color(0xFFCBD5E1) : const Color(0xFFE2E8F0),
          ),
          borderRadius: BorderRadius.circular(10.r),
          color: enabled ? Colors.white : const Color(0xFFF1F5F9),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: TextStyle(fontSize: 9.5.sp, color: _muted),
                  ),
                  SizedBox(height: 2.h),
                  Text(
                    value.isEmpty ? '-- Select --' : _formatDisplayDate(value),
                    style: TextStyle(
                      fontSize: 12.sp,
                      fontWeight: FontWeight.w700,
                      color: value.isEmpty ? _muted : _darkText,
                    ),
                  ),
                ],
              ),
            ),
            Icon(Icons.calendar_today_rounded, size: 15.sp, color: _muted),
          ],
        ),
      ),
    );
  }

  Widget _buildCenterInfoCard() {
    final center = controller.selectedCenter;
    if (center == null) return const SizedBox.shrink();

    final centerName = center['name']?.toString() ?? '—';
    final centerCode = center['code']?.toString() ?? '—';
    final meetingDay = center['meetingDay']?.toString() ?? 'N/A';
    final meetingPlace = center['meetingPlace']?.toString() ?? center['meetingTime']?.toString() ?? 'N/A';
    final totalLoans = controller.unindexedLoans.length;
    final totalAmount = controller.unindexedLoans.fold<double>(
      0.0,
      (sum, l) => sum + _amount(l is Map ? Map<String, dynamic>.from(l) : {}, 'amount'),
    );

    return Container(
      width: double.infinity,
      margin: EdgeInsets.only(bottom: 12.h),
      padding: EdgeInsets.all(12.w),
      decoration: BoxDecoration(
        color: const Color(0xFFF0FDF4),
        border: Border.all(color: const Color(0xFFBBF7D0)),
        borderRadius: BorderRadius.circular(12.r),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.location_city_rounded, size: 16, color: _green),
              SizedBox(width: 6.w),
              Expanded(
                child: Text(
                  '$centerName ($centerCode)',
                  style: TextStyle(
                    fontSize: 13.sp,
                    fontWeight: FontWeight.w800,
                    color: const Color(0xFF166534),
                  ),
                ),
              ),
              Container(
                padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 3.h),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(12.r),
                  border: Border.all(color: const Color(0xFF86EFAC)),
                ),
                child: Text(
                  '$totalLoans Loans · ${_currency(totalAmount)}',
                  style: TextStyle(
                    fontSize: 10.sp,
                    fontWeight: FontWeight.w700,
                    color: _green,
                  ),
                ),
              ),
            ],
          ),
          SizedBox(height: 6.h),
          Row(
            children: [
              Icon(Icons.calendar_month_outlined, size: 13.sp, color: _muted),
              SizedBox(width: 4.w),
              Text(
                'Meeting Day: ',
                style: TextStyle(fontSize: 10.5.sp, color: _muted),
              ),
              Text(
                meetingDay,
                style: TextStyle(
                  fontSize: 10.5.sp,
                  fontWeight: FontWeight.w700,
                  color: _darkText,
                ),
              ),
              SizedBox(width: 14.w),
              Icon(Icons.place_outlined, size: 13.sp, color: _muted),
              SizedBox(width: 4.w),
              Expanded(
                child: Text(
                  'Place: $meetingPlace',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 10.5.sp, color: _muted),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildLoansSection() {
    return Obx(() {
      final loans = controller.unindexedLoans;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildCenterInfoCard(),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Unindexed Loans',
                style: TextStyle(
                  fontSize: 14.sp,
                  fontWeight: FontWeight.w800,
                  color: _darkText,
                ),
              ),
              if (controller.selectedLoanIds.isNotEmpty ||
                  controller.rejectedLoanIds.isNotEmpty)
                Text(
                  '${controller.selectedLoanIds.length} selected, ${controller.rejectedLoanIds.length} rejected',
                  style: TextStyle(fontSize: 10.5.sp, color: _muted),
                ),
            ],
          ),
          SizedBox(height: 10.h),
          if (controller.isLoadingLoans.value)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Center(child: CircularProgressIndicator(color: _green)),
            )
          else if (loans.isEmpty)
            _emptyState('No unindexed loans found for this center.')
          else ...[
            Row(
              children: [
                Expanded(
                  child: _bulkSwitch(
                    label: 'Approve All',
                    checked:
                        loans.isNotEmpty &&
                        loans.every(
                          (l) => controller.selectedLoanIds.contains(l['id'].toString()),
                        ),
                    color: _green,
                    onChanged: controller.selectAll,
                  ),
                ),
                SizedBox(width: 8.w),
                Expanded(
                  child: _bulkSwitch(
                    label: 'Reject All',
                    checked:
                        loans.isNotEmpty &&
                        loans.every(
                          (l) => controller.rejectedLoanIds.contains(l['id'].toString()),
                        ),
                    color: Colors.red,
                    onChanged: controller.rejectAll,
                  ),
                ),
              ],
            ),
            SizedBox(height: 10.h),
            ListView.separated(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: loans.length,
              separatorBuilder: (_, __) => SizedBox(height: 8.h),
              itemBuilder: (_, index) =>
                  _loanCard(Map<String, dynamic>.from(loans[index])),
            ),
            SizedBox(height: 14.h),
            Row(
              children: [
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: controller.canSubmit
                        ? () => controller.submit()
                        : null,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: _green,
                      foregroundColor: Colors.white,
                      padding: EdgeInsets.symmetric(vertical: 13.h),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10.r),
                      ),
                    ),
                    icon: controller.isSaving.value
                        ? SizedBox(
                            width: 16.sp,
                            height: 16.sp,
                            child: const CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Icon(Icons.save_rounded, size: 18),
                    label: Text(controller.isSaving.value ? 'Saving...' : 'Save'),
                  ),
                ),
                SizedBox(width: 10.w),
                OutlinedButton.icon(
                  onPressed: controller.isSaving.value
                      ? null
                      : controller.resetSelections,
                  style: OutlinedButton.styleFrom(
                    padding: EdgeInsets.symmetric(
                      horizontal: 14.w,
                      vertical: 13.h,
                    ),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10.r),
                    ),
                  ),
                  icon: const Icon(Icons.restart_alt_rounded, size: 18),
                  label: const Text('Reset'),
                ),
              ],
            ),
            if (controller.submitBlockedReason != null)
              Padding(
                padding: EdgeInsets.only(top: 8.h),
                child: Text(
                  controller.submitBlockedReason!,
                  style: TextStyle(fontSize: 10.5.sp, color: Colors.red),
                ),
              ),
          ],
        ],
      );
    });
  }

  Widget _buildHighmarkTag(Map<String, dynamic> loan) {
    final hmScoreRaw = loan['highmarkScore'] ?? loan['highMarkScore'] ?? loan['creditScore'];
    final hmStatusRaw = loan['highmarkStatus'] ?? loan['highMarkStatus'] ?? loan['status'];

    String label = 'HM: N/A';
    Color bg = const Color(0xFFF1F5F9);
    Color fg = const Color(0xFF64748B);

    if (hmScoreRaw != null &&
        hmScoreRaw.toString().trim().isNotEmpty &&
        hmScoreRaw.toString() != 'null') {
      final scoreNum = int.tryParse('$hmScoreRaw');
      if (scoreNum != null && scoreNum > 0) {
        label = 'HM: $scoreNum';
        if (scoreNum >= 650) {
          bg = const Color(0xFFDCFCE7);
          fg = const Color(0xFF166534);
        } else if (scoreNum >= 550) {
          bg = const Color(0xFFFEF3C7);
          fg = const Color(0xFFB45309);
        } else {
          bg = const Color(0xFFFEE2E2);
          fg = const Color(0xFF991B1B);
        }
      } else {
        label = 'HM: $hmScoreRaw';
      }
    } else if (hmStatusRaw != null &&
        hmStatusRaw.toString().trim().isNotEmpty &&
        hmStatusRaw.toString() != 'null' &&
        hmStatusRaw.toString() != 'N/A') {
      final st = hmStatusRaw.toString().trim();
      label = 'HM: $st';
      final upper = st.toUpperCase();
      if (upper.contains('PASS') || upper.contains('OK') || upper.contains('EXCELLENT') || upper.contains('APPROVED')) {
        bg = const Color(0xFFDCFCE7);
        fg = const Color(0xFF166534);
      } else if (upper.contains('FLAG') || upper.contains('REJECT') || upper.contains('LOW') || upper.contains('FAIL')) {
        bg = const Color(0xFFFEE2E2);
        fg = const Color(0xFF991B1B);
      } else {
        bg = const Color(0xFFFEF3C7);
        fg = const Color(0xFFB45309);
      }
    }

    return _tag(label, bg, fg);
  }

  Widget _bulkSwitch({
    required String label,
    required bool checked,
    required Color color,
    required ValueChanged<bool> onChanged,
  }) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 6.h),
      decoration: BoxDecoration(
        border: Border.all(color: const Color(0xFFE1EAE4)),
        borderRadius: BorderRadius.circular(10.r),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: TextStyle(
              fontSize: 10.5.sp,
              fontWeight: FontWeight.w700,
              color: _darkText,
            ),
          ),
          Switch(
            value: checked,
            activeThumbColor: color,
            onChanged: onChanged,
          ),
        ],
      ),
    );
  }

  Widget _loanCard(Map<String, dynamic> loan) {
    final loanId = loan['id'].toString();
    return Obx(() {
      final isSelected = controller.selectedLoanIds.contains(loanId);
      final isRejected = controller.rejectedLoanIds.contains(loanId);
      return Container(
        padding: EdgeInsets.all(12.w),
        decoration: BoxDecoration(
          color: isSelected
              ? const Color(0xFFE8F7EE)
              : isRejected
              ? const Color(0xFFFDECEC)
              : Colors.white,
          border: Border.all(
            color: isSelected
                ? _green.withValues(alpha: 0.4)
                : isRejected
                ? Colors.red.withValues(alpha: 0.35)
                : const Color(0xFFE1EAE4),
          ),
          borderRadius: BorderRadius.circular(12.r),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _field(loan, 'clientDisplayId'),
                        style: TextStyle(
                          fontSize: 12.5.sp,
                          fontWeight: FontWeight.w800,
                          color: _darkText,
                        ),
                      ),
                      Text(
                        _field(loan, 'clientName'),
                        style: TextStyle(fontSize: 10.5.sp, color: _muted),
                      ),
                    ],
                  ),
                ),
                InkWell(
                  onTap: () {
                    final clientDbId = loan['clientId']?.toString() ?? '';
                    if (clientDbId.isEmpty) return;
                    showHighmarkReport(
                      context,
                      api: _highmarkApi,
                      clientDbId: clientDbId,
                      clientName: _field(loan, 'clientName'),
                    );
                  },
                  borderRadius: BorderRadius.circular(20.r),
                  child: Container(
                    padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 4.h),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF3E8FF),
                      borderRadius: BorderRadius.circular(20.r),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.shield_outlined, size: 13, color: Color(0xFF7C3AED)),
                        SizedBox(width: 3.w),
                        Text(
                          'Highmark',
                          style: TextStyle(
                            fontSize: 9.5.sp,
                            fontWeight: FontWeight.w700,
                            color: const Color(0xFF7C3AED),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                SizedBox(width: 8.w),
                Text(
                  _currency(_amount(loan, 'amount')),
                  style: TextStyle(
                    fontSize: 13.sp,
                    fontWeight: FontWeight.w800,
                    color: _green,
                  ),
                ),
              ],
            ),
            SizedBox(height: 8.h),
            Wrap(
              spacing: 6.w,
              runSpacing: 6.h,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                _buildHighmarkTag(loan),
                _tag(_field(loan, 'purpose')),
                _tag(_field(loan, 'product')),
                _tag(_field(loan, 'frequency')),
                InkWell(
                  onTap: () => _showEditProductSheet(loan),
                  borderRadius: BorderRadius.circular(20.r),
                  child: Container(
                    padding: EdgeInsets.all(4.w),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF0FAF4),
                      shape: BoxShape.circle,
                      border: Border.all(color: const Color(0xFFBBE5CE)),
                    ),
                    child: Icon(Icons.edit_outlined, size: 12.sp, color: _green),
                  ),
                ),
              ],
            ),
            SizedBox(height: 10.h),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => controller.toggleSelect(loanId),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: isSelected ? Colors.white : _green,
                      backgroundColor: isSelected ? _green : Colors.white,
                      side: BorderSide(color: _green),
                      padding: EdgeInsets.symmetric(vertical: 8.h),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8.r),
                      ),
                    ),
                    icon: const Icon(Icons.check_circle_rounded, size: 16),
                    label: const Text('Approve'),
                  ),
                ),
                SizedBox(width: 8.w),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => controller.toggleReject(loanId),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: isRejected ? Colors.white : Colors.red,
                      backgroundColor: isRejected ? Colors.red : Colors.white,
                      side: const BorderSide(color: Colors.red),
                      padding: EdgeInsets.symmetric(vertical: 8.h),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8.r),
                      ),
                    ),
                    icon: const Icon(Icons.cancel_rounded, size: 16),
                    label: const Text('Reject'),
                  ),
                ),
                SizedBox(width: 8.w),
                OutlinedButton.icon(
                  onPressed: () => _showPassbookBottomSheet(loanId),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: const Color(0xFF0284C7),
                    side: const BorderSide(color: Color(0xFF0284C7)),
                    padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 8.h),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8.r),
                    ),
                  ),
                  icon: const Icon(Icons.menu_book_rounded, size: 16),
                  label: const Text('Passbook'),
                ),
              ],
            ),
          ],
        ),
      );
    });
  }

  Widget _tag(String label, [Color? bgColor, Color? textColor]) => Container(
    padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 3.h),
    decoration: BoxDecoration(
      color: bgColor ?? const Color(0xFFF0FAF4),
      borderRadius: BorderRadius.circular(6.r),
    ),
    child: Text(
      label,
      style: TextStyle(
        fontSize: 9.5.sp,
        color: textColor ?? _green,
        fontWeight: FontWeight.w600,
      ),
    ),
  );

  /// "Edit Loan Product" — Product Type → Frequency → Product, filtered to
  /// this loan's applied amount, matching the web app's
  /// `LoanProductEditModal` (`role="BM"` case). Only valid pre-index (every
  /// loan on this screen qualifies, per `PATCH /api/loans/{id}/update-product`'s
  /// own server-side check), so — unlike `member_individual_detail.dart`'s
  /// AM-side copy of this sheet — no `stage`/`isIndexed` is ever sent.
  Future<void> _showEditProductSheet(Map<String, dynamic> loan) async {
    final loanId = loan['id']?.toString() ?? '';
    if (loanId.isEmpty) return;

    final prefs = await SharedPreferences.getInstance();
    final branchId = prefs.getString('branchId') ?? '';
    if (!mounted) return;
    if (branchId.isEmpty) {
      Get.snackbar(
        'Error',
        'No branch found for this account. Please sign in again.',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return;
    }

    final currentProductId = loan['loanProductId']?.toString() ?? '';
    final maxAmount = _amount(loan, 'appliedAmount') > 0
        ? _amount(loan, 'appliedAmount')
        : _amount(loan, 'amount');

    final selectedTypeId = RxnString();
    final selectedFrequency = RxnString();
    final selectedProductId = RxnString(
      currentProductId.isEmpty ? null : currentProductId,
    );
    final isLoading = true.obs;
    final isSaving = false.obs;
    final productTypes = <dynamic>[].obs;
    final allProducts = <dynamic>[].obs;
    bool initialized = false;

    Future<void> load() async {
      isLoading.value = true;
      try {
        final types = await controller.api.getLoanProductTypes();
        final prods = await controller.api.getProducts(branchId);
        productTypes.assignAll(types);
        allProducts.assignAll(prods);
      } catch (e) {
        Get.snackbar(
          'Error',
          'Failed to load loan products: $e',
          backgroundColor: Colors.redAccent,
          colorText: Colors.white,
        );
      } finally {
        isLoading.value = false;
      }
    }

    unawaited(load());

    if (!mounted) return;
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20.r)),
      ),
      builder: (ctx) {
        return Padding(
          padding: EdgeInsets.fromLTRB(
            16.w,
            16.h,
            16.w,
            24.h + MediaQuery.of(ctx).viewInsets.bottom,
          ),
          child: Obx(() {
            if (isLoading.value) {
              return Container(
                height: 250.h,
                alignment: Alignment.center,
                child: const CircularProgressIndicator(color: _green),
              );
            }

            final types = productTypes;
            // Web mirrors the backend's own hard check
            // (`product.loanAmount > appliedAmount` → 400) by filtering the
            // Loan Product dropdown to amounts within what the client
            // applied for — do the same here instead of only discovering
            // the mismatch after a failed save.
            final eligibleProducts = allProducts.where((p) {
              if (p is! Map) return false;
              if (maxAmount <= 0) return true;
              return _amount(Map<String, dynamic>.from(p), 'loanAmount') <=
                  maxAmount;
            }).toList();

            if (!initialized && eligibleProducts.isNotEmpty) {
              initialized = true;
              final curr = eligibleProducts.cast<Map?>().firstWhere(
                (p) => p?['id']?.toString() == currentProductId,
                orElse: () => null,
              );
              if (curr != null) {
                selectedTypeId.value = curr['loanProductTypeId']?.toString();
                selectedFrequency.value = curr['frequency']
                    ?.toString()
                    .toLowerCase();
              }
            }

            final typeProducts = eligibleProducts.where((p) {
              if (p is! Map) return false;
              if (selectedTypeId.value == null ||
                  selectedTypeId.value!.isEmpty) {
                return true;
              }
              return p['loanProductTypeId']?.toString() ==
                  selectedTypeId.value;
            }).toList();

            final availableFreqs = typeProducts
                .map((p) => (p as Map)['frequency']?.toString().toLowerCase() ?? '')
                .where((f) => f.isNotEmpty)
                .toSet()
                .toList();

            final filteredProducts = typeProducts.where((p) {
              if (selectedFrequency.value == null ||
                  selectedFrequency.value!.isEmpty) {
                return true;
              }
              return (p as Map)['frequency']?.toString().toLowerCase() ==
                  selectedFrequency.value;
            }).toList();

            final selectedProduct = filteredProducts.cast<Map?>().firstWhere(
              (p) => p?['id']?.toString() == selectedProductId.value,
              orElse: () => null,
            );

            return Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      'Edit Loan Product',
                      style: TextStyle(
                        fontSize: 16.sp,
                        fontWeight: FontWeight.w800,
                        color: _darkText,
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.pop(ctx),
                      icon: const Icon(Icons.close_rounded, color: _muted),
                    ),
                  ],
                ),
                Text(
                  'Max amount: ${_currency(maxAmount)} (this client\'s applied amount)',
                  style: TextStyle(fontSize: 10.5.sp, color: _muted),
                ),
                SizedBox(height: 12.h),

                Text(
                  'Loan Product Type',
                  style: TextStyle(
                    fontSize: 11.sp,
                    fontWeight: FontWeight.w700,
                    color: _darkText,
                  ),
                ),
                SizedBox(height: 6.h),
                DropdownButtonFormField<String>(
                  initialValue: selectedTypeId.value,
                  decoration: InputDecoration(
                    contentPadding: EdgeInsets.symmetric(
                      horizontal: 12.w,
                      vertical: 10.h,
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10.r),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10.r),
                      borderSide: const BorderSide(color: _green, width: 1.4),
                    ),
                  ),
                  hint: const Text('Select Product Type'),
                  items: types.map<DropdownMenuItem<String>>((t) {
                    return DropdownMenuItem<String>(
                      value: (t as Map)['id']?.toString(),
                      child: Text(
                        '${t['name']}',
                        style: TextStyle(fontSize: 12.5.sp),
                      ),
                    );
                  }).toList(),
                  onChanged: (val) {
                    selectedTypeId.value = val;
                    selectedFrequency.value = null;
                    selectedProductId.value = null;
                  },
                ),
                SizedBox(height: 12.h),

                Text(
                  'Frequency',
                  style: TextStyle(
                    fontSize: 11.sp,
                    fontWeight: FontWeight.w700,
                    color: _darkText,
                  ),
                ),
                SizedBox(height: 6.h),
                DropdownButtonFormField<String>(
                  initialValue: selectedFrequency.value,
                  decoration: InputDecoration(
                    contentPadding: EdgeInsets.symmetric(
                      horizontal: 12.w,
                      vertical: 10.h,
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10.r),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10.r),
                      borderSide: const BorderSide(color: _green, width: 1.4),
                    ),
                  ),
                  hint: const Text('Select Frequency'),
                  items: availableFreqs.map<DropdownMenuItem<String>>((f) {
                    final label = f.isEmpty
                        ? f
                        : '${f[0].toUpperCase()}${f.substring(1)}';
                    return DropdownMenuItem<String>(
                      value: f,
                      child: Text(label, style: TextStyle(fontSize: 12.5.sp)),
                    );
                  }).toList(),
                  onChanged: (val) {
                    selectedFrequency.value = val;
                    selectedProductId.value = null;
                  },
                ),
                SizedBox(height: 12.h),

                Text(
                  'Loan Product',
                  style: TextStyle(
                    fontSize: 11.sp,
                    fontWeight: FontWeight.w700,
                    color: _darkText,
                  ),
                ),
                SizedBox(height: 6.h),
                DropdownButtonFormField<String>(
                  initialValue: selectedProductId.value,
                  decoration: InputDecoration(
                    contentPadding: EdgeInsets.symmetric(
                      horizontal: 12.w,
                      vertical: 10.h,
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10.r),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10.r),
                      borderSide: const BorderSide(color: _green, width: 1.4),
                    ),
                  ),
                  hint: const Text('Select Loan Product'),
                  items: filteredProducts.map<DropdownMenuItem<String>>((p) {
                    final map = p as Map;
                    final amount = _currency(
                      _amount(Map<String, dynamic>.from(map), 'loanAmount'),
                    );
                    return DropdownMenuItem<String>(
                      value: map['id']?.toString(),
                      child: Text(
                        '${map['productName']} ($amount)',
                        style: TextStyle(fontSize: 12.5.sp),
                      ),
                    );
                  }).toList(),
                  onChanged: (val) => selectedProductId.value = val,
                ),
                SizedBox(height: 16.h),

                if (selectedProduct != null)
                  Container(
                    padding: EdgeInsets.all(12.w),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF0FAF4),
                      borderRadius: BorderRadius.circular(10.r),
                      border: Border.all(color: const Color(0xFFE1EAE4)),
                    ),
                    child: Column(
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              'New Amount:',
                              style: TextStyle(fontSize: 11.sp, color: _muted),
                            ),
                            Text(
                              _currency(
                                _amount(
                                  Map<String, dynamic>.from(selectedProduct),
                                  'loanAmount',
                                ),
                              ),
                              style: TextStyle(
                                fontSize: 12.sp,
                                fontWeight: FontWeight.w800,
                                color: _green,
                              ),
                            ),
                          ],
                        ),
                        SizedBox(height: 4.h),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              'Interest Rate:',
                              style: TextStyle(fontSize: 11.sp, color: _muted),
                            ),
                            Text(
                              '${_amount(Map<String, dynamic>.from(selectedProduct), 'interestRate')}%',
                              style: TextStyle(
                                fontSize: 12.sp,
                                fontWeight: FontWeight.w700,
                                color: _darkText,
                              ),
                            ),
                          ],
                        ),
                        SizedBox(height: 4.h),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              'Dues / Tenure:',
                              style: TextStyle(fontSize: 11.sp, color: _muted),
                            ),
                            Text(
                              '${selectedProduct['numberOfDues']} dues',
                              style: TextStyle(
                                fontSize: 12.sp,
                                fontWeight: FontWeight.w700,
                                color: _darkText,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),

                SizedBox(height: 18.h),

                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed:
                        selectedProductId.value == null || isSaving.value
                        ? null
                        : () async {
                            isSaving.value = true;
                            try {
                              final updated = await controller.api
                                  .updateLoanProduct(
                                    loanId,
                                    selectedProductId.value!,
                                  );
                              final idx = controller.unindexedLoans.indexWhere(
                                (l) => l is Map && l['id']?.toString() == loanId,
                              );
                              if (idx != -1) {
                                final merged = Map<String, dynamic>.from(
                                  controller.unindexedLoans[idx] as Map,
                                )..addAll(updated);
                                controller.unindexedLoans[idx] = merged;
                              }
                              Get.snackbar(
                                'Product Updated',
                                'Loan product updated successfully.',
                                backgroundColor: const Color(0xFF00843D),
                                colorText: Colors.white,
                              );
                              if (ctx.mounted) Navigator.pop(ctx);
                            } catch (e) {
                              Get.snackbar(
                                'Error',
                                'Failed to update loan product: $e',
                                backgroundColor: Colors.redAccent,
                                colorText: Colors.white,
                              );
                            } finally {
                              isSaving.value = false;
                            }
                          },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: _green,
                      foregroundColor: Colors.white,
                      padding: EdgeInsets.symmetric(vertical: 13.h),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10.r),
                      ),
                    ),
                    child: isSaving.value
                        ? SizedBox(
                            width: 16.sp,
                            height: 16.sp,
                            child: const CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : Text(
                            'Update Product',
                            style: TextStyle(
                              fontSize: 13.sp,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                  ),
                ),
              ],
            );
          }),
        );
      },
    );
  }

  Widget _buildRecordsSection() {
    return Obx(() {
      final records = controller.loanIndexes;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Loan Index Records',
            style: TextStyle(
              fontSize: 14.sp,
              fontWeight: FontWeight.w800,
              color: _darkText,
            ),
          ),
          SizedBox(height: 3.h),
          Text(
            'Created loan index batches for the selected date.',
            style: TextStyle(fontSize: 11.sp, color: _muted),
          ),
          SizedBox(height: 10.h),
          if (controller.isLoadingIndexes.value)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Center(child: CircularProgressIndicator(color: _green)),
            )
          else if (records.isEmpty)
            _emptyState('No loan indexes found for the selected criteria.')
          else
            ListView.separated(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: records.length,
              separatorBuilder: (_, __) => SizedBox(height: 8.h),
              itemBuilder: (_, index) =>
                  _recordCard(Map<String, dynamic>.from(records[index])),
            ),
        ],
      );
    });
  }

  Widget _recordCard(Map<String, dynamic> record) {
    final status = _field(record, 'status', 'PENDING');
    final statusMeta = _statusMeta(status);
    return Container(
      padding: EdgeInsets.all(12.w),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: const Color(0xFFE1EAE4)),
        borderRadius: BorderRadius.circular(12.r),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                _field(record, 'indexNo'),
                style: TextStyle(
                  fontSize: 12.5.sp,
                  fontWeight: FontWeight.w800,
                  color: _darkText,
                ),
              ),
              Container(
                padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 3.h),
                decoration: BoxDecoration(
                  color: statusMeta.$1,
                  borderRadius: BorderRadius.circular(20.r),
                ),
                child: Text(
                  statusMeta.$2,
                  style: TextStyle(
                    fontSize: 9.5.sp,
                    fontWeight: FontWeight.w700,
                    color: statusMeta.$3,
                  ),
                ),
              ),
            ],
          ),
          SizedBox(height: 6.h),
          Text(
            '${_field(record, 'centerCode')} - ${_field(record, 'centerName')}',
            style: TextStyle(fontSize: 11.sp, color: _muted),
          ),
          SizedBox(height: 8.h),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                '${_field(record, 'totalApps', '0')} loan(s)',
                style: TextStyle(fontSize: 11.sp, color: _muted),
              ),
              Text(
                _currency(_amount(record, 'totalAmount')),
                style: TextStyle(
                  fontSize: 12.5.sp,
                  fontWeight: FontWeight.w800,
                  color: _green,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  /// (background, label, textColor) — mirrors the web's `getStatusBadge`.
  (Color, String, Color) _statusMeta(String status) {
    switch (status) {
      case 'DISBURSED':
        return (const Color(0xFFDCFCE7), 'Disbursed', const Color(0xFF166534));
      case 'AM_APPROVED':
        return (
          const Color(0xFFD1FAE5),
          'Ready to Disburse',
          const Color(0xFF065F46),
        );
      case 'BM_APPROVED':
        return (const Color(0xFFE6F5EC), 'Sent to AM', const Color(0xFF025C27));
      case 'PARTIALLY_APPROVED':
        return (const Color(0xFFFFEDD5), 'Partial', const Color(0xFF9A3412));
      default:
        return (const Color(0xFFE6F5EC), 'Pending', const Color(0xFF025C27));
    }
  }

  Widget _emptyState(String message) => Container(
    width: double.infinity,
    padding: EdgeInsets.symmetric(vertical: 28.h),
    decoration: BoxDecoration(
      border: Border.all(color: const Color(0xFFE1EAE4)),
      borderRadius: BorderRadius.circular(12.r),
    ),
    child: Column(
      children: [
        Icon(Icons.folder_open_rounded, size: 34.sp, color: _muted),
        SizedBox(height: 8.h),
        Text(
          message,
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 11.sp, color: _muted),
        ),
      ],
    ),
  );

  /// Builds the exact `{memberDetails, installments}` shape the backend's
  /// `PassbookSchema` requires (`loanAmount` as a string, installment
  /// amounts as numbers) — mirrors `LoanPassbookDialog.tsx`'s
  /// `handleDownloadPDF` payload construction on the web app.
  Future<void> _downloadPassbookPdf(
    Map<String, dynamic> memberDetails,
    List<Map> installments,
  ) async {
    final memberName = memberDetails['memberName']?.toString() ?? 'member';
    try {
      final payload = <String, dynamic>{
        'loanAmount': memberDetails['loanAmount']?.toString() ?? '0',
        'upiNumber': memberDetails['upiNumber']?.toString() ?? '',
        'accountNumber': memberDetails['accountNumber']?.toString() ?? '',
        'branchCode': memberDetails['branchCode']?.toString() ?? '',
        'branchName': memberDetails['branchName']?.toString() ?? '',
        'memberName': memberName,
        'disbursementDate': memberDetails['disbursementDate']?.toString() ?? '',
        'loanPurpose': memberDetails['loanPurpose']?.toString() ?? '',
        'centerCode': memberDetails['centerCode']?.toString() ?? '',
        'centerName': memberDetails['centerName']?.toString() ?? '',
        'centerMemberNo': memberDetails['centerMemberNo']?.toString() ?? '',
        'husbandName': memberDetails['husbandName']?.toString() ?? '',
        'loanType': memberDetails['loanType']?.toString() ?? '',
        'firstInstallmentDate': memberDetails['firstInstallmentDate']?.toString() ?? '',
        'memberPhone': memberDetails['memberPhone']?.toString() ?? '',
        'clientPhotoUrl': memberDetails['clientPhotoUrl']?.toString(),
      };
      final installmentPayload = installments
          .map(
            (inst) => {
              'no': int.tryParse('${inst['no']}') ?? 0,
              'date': inst['date']?.toString() ?? '',
              'principal': double.tryParse('${inst['principal']}') ?? 0,
              'interest': double.tryParse('${inst['interest']}') ?? 0,
              'balance': double.tryParse('${inst['balance']}') ?? 0,
            },
          )
          .toList();

      final bytes = await controller.api.generatePassbookPdf(
        memberDetails: payload,
        installments: installmentPayload,
      );

      final safeName = memberName.replaceAll(RegExp(r'[^\w]'), '_');
      Directory? targetDir;
      if (Platform.isAndroid) {
        final publicDownload = Directory('/storage/emulated/0/Download');
        targetDir = await publicDownload.exists()
            ? publicDownload
            : await getExternalStorageDirectory();
      }
      targetDir ??= await getApplicationDocumentsDirectory();
      final filePath = '${targetDir.path}/passbook_$safeName.pdf';
      await File(filePath).writeAsBytes(bytes);

      Get.snackbar(
        'Passbook Downloaded',
        'Saved passbook_$safeName.pdf to Download folder.',
        backgroundColor: _green,
        colorText: Colors.white,
        duration: const Duration(seconds: 6),
        mainButton: TextButton(
          onPressed: () => OpenFilex.open(filePath),
          child: const Text('OPEN', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        ),
      );
    } on LoanApiException catch (e) {
      Get.snackbar(
        'Download Failed',
        e.message,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
    } catch (e) {
      Get.snackbar(
        'Download Failed',
        'Unable to generate passbook PDF: $e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
    }
  }

  Future<void> _showPassbookBottomSheet(String loanId) async {
    final isGeneratingPdf = false.obs;
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20.r)),
      ),
      builder: (ctx) {
        return FutureBuilder<Map<String, dynamic>?>(
          future: controller.fetchPassbook(loanId),
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return Container(
                height: 300,
                alignment: Alignment.center,
                child: const CircularProgressIndicator(color: _green),
              );
            }

            final data = snapshot.data;
            if (data == null) {
              return Container(
                height: 250,
                padding: const EdgeInsets.all(20),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.error_outline_rounded, size: 40, color: Colors.red),
                    const SizedBox(height: 12),
                    const Text(
                      'Failed to load passbook data.',
                      style: TextStyle(fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 16),
                    ElevatedButton(
                      onPressed: () => Navigator.pop(ctx),
                      child: const Text('Close'),
                    ),
                  ],
                ),
              );
            }

            final memberDetails = data['memberDetails'] is Map
                ? Map<String, dynamic>.from(data['memberDetails'] as Map)
                : <String, dynamic>{};
            final installments = data['installments'] is List
                ? (data['installments'] as List).whereType<Map>().toList()
                : <Map>[];

            final memberName = memberDetails['memberName']?.toString() ?? '—';
            final spouseName = memberDetails['husbandName']?.toString() ?? '—';
            final accountNo = memberDetails['accountNumber']?.toString() ?? '—';
            final loanAmount = memberDetails['loanAmount']?.toString() ?? '—';
            final branch = '${memberDetails['branchCode'] ?? ''} ${memberDetails['branchName'] ?? ''}'.trim();
            final center = '${memberDetails['centerCode'] ?? ''} ${memberDetails['centerName'] ?? ''}'.trim();

            return DraggableScrollableSheet(
              expand: false,
              initialChildSize: 0.85,
              maxChildSize: 0.95,
              minChildSize: 0.5,
              builder: (_, scrollController) {
                return Padding(
                  padding: const EdgeInsets.all(16),
                  child: ListView(
                    controller: scrollController,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Row(
                            children: [
                              const Icon(Icons.menu_book_rounded, color: _green, size: 22),
                              const SizedBox(width: 8),
                              Text(
                                'Passbook Schedule',
                                style: TextStyle(
                                  fontSize: 16.sp,
                                  fontWeight: FontWeight.bold,
                                  color: _darkText,
                                ),
                              ),
                            ],
                          ),
                          IconButton(
                            onPressed: () => Navigator.pop(ctx),
                            icon: const Icon(Icons.close),
                          ),
                        ],
                      ),
                      const Divider(),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF0FAF4),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: const Color(0xFFBBF7D0)),
                        ),
                        child: Column(
                          children: [
                            _passbookRow('Member Name', memberName),
                            _passbookRow('Spouse / Father', spouseName),
                            _passbookRow('Account No', accountNo),
                            _passbookRow('Branch', branch.isEmpty ? '—' : branch),
                            _passbookRow('Center', center.isEmpty ? '—' : center),
                            _passbookRow('Loan Amount', '₹$loanAmount'),
                            _passbookRow('First Installment', memberDetails['firstInstallmentDate']?.toString() ?? '—'),
                            _passbookRow('Loan Purpose', memberDetails['loanPurpose']?.toString() ?? '—'),
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),
                      Text(
                        'Repayment Installments (${installments.length})',
                        style: TextStyle(
                          fontSize: 13.sp,
                          fontWeight: FontWeight.bold,
                          color: _darkText,
                        ),
                      ),
                      const SizedBox(height: 8),
                      if (installments.isEmpty)
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 20),
                          child: Text('No installment schedule available.'),
                        )
                      else
                        SingleChildScrollView(
                          scrollDirection: Axis.horizontal,
                          child: DataTable(
                            headingRowHeight: 36,
                            dataRowMinHeight: 32,
                            dataRowMaxHeight: 36,
                            columnSpacing: 14,
                            columns: const [
                              DataColumn(label: Text('#', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 11))),
                              DataColumn(label: Text('Due Date', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 11))),
                              DataColumn(label: Text('EMI (₹)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 11))),
                              DataColumn(label: Text('Principal', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 11))),
                              DataColumn(label: Text('Interest', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 11))),
                              DataColumn(label: Text('Balance', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 11))),
                            ],
                            rows: installments.map((inst) {
                              final principal = double.tryParse('${inst['principal']}') ?? 0;
                              final interest = double.tryParse('${inst['interest']}') ?? 0;
                              final emi = principal + interest;
                              return DataRow(cells: [
                                DataCell(Text('${inst['no'] ?? '—'}', style: const TextStyle(fontSize: 11))),
                                DataCell(Text('${inst['date'] ?? '—'}', style: const TextStyle(fontSize: 11))),
                                DataCell(Text('₹${emi.toStringAsFixed(2)}', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: _green))),
                                DataCell(Text('₹${inst['principal'] ?? 0}', style: const TextStyle(fontSize: 11))),
                                DataCell(Text('₹${inst['interest'] ?? 0}', style: const TextStyle(fontSize: 11))),
                                DataCell(Text('₹${inst['balance'] ?? 0}', style: const TextStyle(fontSize: 11))),
                              ]);
                            }).toList(),
                          ),
                        ),
                      const SizedBox(height: 16),
                      Obx(
                        () => SizedBox(
                          width: double.infinity,
                          child: ElevatedButton.icon(
                            onPressed: installments.isEmpty || isGeneratingPdf.value
                                ? null
                                : () async {
                                    isGeneratingPdf.value = true;
                                    await _downloadPassbookPdf(
                                      memberDetails,
                                      installments,
                                    );
                                    isGeneratingPdf.value = false;
                                  },
                            style: ElevatedButton.styleFrom(
                              backgroundColor: _green,
                              foregroundColor: Colors.white,
                              padding: const EdgeInsets.symmetric(vertical: 12),
                            ),
                            icon: isGeneratingPdf.value
                                ? const SizedBox(
                                    width: 16,
                                    height: 16,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                      color: Colors.white,
                                    ),
                                  )
                                : const Icon(Icons.download_rounded, size: 18),
                            label: Text(
                              isGeneratingPdf.value
                                  ? 'Generating…'
                                  : 'Download Passbook PDF',
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                );
              },
            );
          },
        );
      },
    );
  }

  Widget _passbookRow(String label, String val) => Padding(
        padding: const EdgeInsets.only(bottom: 4),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(label, style: const TextStyle(fontSize: 11, color: _muted)),
            Text(val, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: _darkText)),
          ],
        ),
      );
}
