import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:sarvam/controller/loan_index_approval_controller.dart';
import 'package:sarvam/view/BM/group_assignment/widgets/id_dropdown.dart';

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

  Widget _buildLoansSection() {
    return Obx(() {
      final loans = controller.unindexedLoans;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
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
            if (!controller.firstDueDateValid)
              Padding(
                padding: EdgeInsets.only(top: 8.h),
                child: Text(
                  'First due date must be today or later.',
                  style: TextStyle(fontSize: 10.5.sp, color: Colors.red),
                ),
              ),
          ],
        ],
      );
    });
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
              children: [
                _tag(_field(loan, 'purpose')),
                _tag(_field(loan, 'product')),
                _tag(_field(loan, 'frequency')),
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
              ],
            ),
          ],
        ),
      );
    });
  }

  Widget _tag(String label) => Container(
    padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 3.h),
    decoration: BoxDecoration(
      color: const Color(0xFFF0FAF4),
      borderRadius: BorderRadius.circular(6.r),
    ),
    child: Text(
      label,
      style: TextStyle(fontSize: 9.5.sp, color: _green, fontWeight: FontWeight.w600),
    ),
  );

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
}
