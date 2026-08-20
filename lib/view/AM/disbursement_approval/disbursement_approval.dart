import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:sarvam/controller/disbursement_approval_controller.dart';
import 'package:sarvam/view/BM/group_assignment/widgets/id_dropdown.dart';

const _green = Color(0xFF0D6842);
const _darkText = Color(0xFF172033);
const _muted = Color(0xFF64748B);

/// AM "Disbursement Approval" (Level 2) — mirrors the core flow of the web
/// app's `components/loan-module/DisbursementClient.tsx`: pick a branch (+
/// optional date range), review index batches of loans pending AM approval,
/// select batches, and Approve (→ ready for the BM's final disbursement) or
/// Reject. Product-edit, Highmark and the ongoing-loans review dialog stay
/// web-only for now.
class DisbursementApproval extends StatefulWidget {
  const DisbursementApproval({super.key});

  @override
  State<DisbursementApproval> createState() => _DisbursementApprovalState();
}

class _DisbursementApprovalState extends State<DisbursementApproval> {
  final DisbursementApprovalController controller =
      Get.isRegistered<DisbursementApprovalController>()
      ? Get.find<DisbursementApprovalController>()
      : Get.put(DisbursementApprovalController());

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

  Future<void> _pickDate({
    required String initial,
    required ValueChanged<String> onPicked,
  }) async {
    DateTime parse(String s) {
      final parts = s.split('-');
      if (parts.length != 3) return DateTime.now();
      return DateTime(int.parse(parts[0]), int.parse(parts[1]), int.parse(parts[2]));
    }

    final picked = await showDatePicker(
      context: context,
      initialDate: initial.isNotEmpty ? parse(initial) : DateTime.now(),
      firstDate: DateTime(2020),
      lastDate: DateTime.now().add(const Duration(days: 1)),
    );
    if (picked != null) {
      onPicked(
        '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}',
      );
    }
  }

  String _formatDisplayDate(String ymd) {
    if (ymd.isEmpty) return '';
    final parts = ymd.split('-');
    if (parts.length != 3) return ymd;
    return '${parts[2]}-${parts[1]}-${parts[0]}';
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
            'Disbursement Approval',
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
            if (controller.isLoadingBranches.value && controller.branches.isEmpty) {
              return const Center(child: CircularProgressIndicator(color: _green));
            }
            return RefreshIndicator(
              color: _green,
              onRefresh: controller.fetchPending,
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: EdgeInsets.all(16.w),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildFilterCard(),
                    SizedBox(height: 14.h),
                    if (controller.branchId.value != null) _buildStatsRow(),
                    SizedBox(height: 14.h),
                    if (controller.branchId.value != null) _buildBatches(),
                  ],
                ),
              ),
            );
          }),
        ),
      ),
    );
  }

  Widget _buildFilterCard() {
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
            'Verification Queue',
            style: TextStyle(
              fontSize: 14.sp,
              fontWeight: FontWeight.w800,
              color: _darkText,
            ),
          ),
          SizedBox(height: 3.h),
          Text(
            'Filter by branch and date range to view loans pending AM approval.',
            style: TextStyle(fontSize: 11.sp, color: _muted),
          ),
          SizedBox(height: 12.h),
          Obx(
            () => IdDropdown(
              label: 'Branch',
              value: controller.branchId.value,
              items: controller.branches,
              labelBuilder: centerLabel,
              onChanged: controller.onBranchChanged,
            ),
          ),
          SizedBox(height: 10.h),
          Row(
            children: [
              Expanded(
                child: Obx(
                  () => _dateField(
                    label: 'From Date',
                    value: controller.fromDate.value,
                    onTap: () => _pickDate(
                      initial: controller.fromDate.value,
                      onPicked: controller.onFromDateChanged,
                    ),
                  ),
                ),
              ),
              SizedBox(width: 10.w),
              Expanded(
                child: Obx(
                  () => _dateField(
                    label: 'To Date',
                    value: controller.toDate.value,
                    onTap: () => _pickDate(
                      initial: controller.toDate.value,
                      onPicked: controller.onToDateChanged,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _dateField({
    required String label,
    required String value,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10.r),
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 10.h),
        decoration: BoxDecoration(
          border: Border.all(color: const Color(0xFFCBD5E1)),
          borderRadius: BorderRadius.circular(10.r),
          color: Colors.white,
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label, style: TextStyle(fontSize: 9.5.sp, color: _muted)),
                  SizedBox(height: 2.h),
                  Text(
                    value.isEmpty ? 'Any' : _formatDisplayDate(value),
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

  Widget _buildStatsRow() {
    return Obx(() {
      final totalClients = controller.stats['totalClients'] ?? 0;
      final totalAmount = controller.stats['totalAmount'];
      final amountValue = (totalAmount is num) ? totalAmount.toDouble() : 0.0;
      return Row(
        children: [
          Expanded(
            child: _statCard(
              label: 'Total Loans',
              value: controller.isFetchingPending.value ? '...' : '$totalClients',
              icon: Icons.groups_rounded,
              iconColor: _green,
              iconBg: const Color(0xFFE6F5EC),
            ),
          ),
          SizedBox(width: 10.w),
          Expanded(
            child: _statCard(
              label: 'Total Value',
              value: controller.isFetchingPending.value ? '...' : _currency(amountValue),
              icon: Icons.account_balance_wallet_rounded,
              iconColor: const Color(0xFF059669),
              iconBg: const Color(0xFFD1FAE5),
            ),
          ),
        ],
      );
    });
  }

  Widget _statCard({
    required String label,
    required String value,
    required IconData icon,
    required Color iconColor,
    required Color iconBg,
  }) {
    return Container(
      padding: EdgeInsets.all(12.w),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: const Color(0xFFE1EAE4)),
        borderRadius: BorderRadius.circular(14.r),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                label.toUpperCase(),
                style: TextStyle(
                  fontSize: 8.5.sp,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.4,
                  color: _muted,
                ),
              ),
              Container(
                padding: EdgeInsets.all(5.w),
                decoration: BoxDecoration(
                  color: iconBg,
                  borderRadius: BorderRadius.circular(8.r),
                ),
                child: Icon(icon, size: 13.sp, color: iconColor),
              ),
            ],
          ),
          SizedBox(height: 6.h),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 16.sp,
              fontWeight: FontWeight.w800,
              color: _darkText,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBatches() {
    return Obx(() {
      final indexes = controller.pendingIndexes;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Index Batches',
                style: TextStyle(
                  fontSize: 14.sp,
                  fontWeight: FontWeight.w800,
                  color: _darkText,
                ),
              ),
              if (indexes.isNotEmpty)
                Container(
                  padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 3.h),
                  decoration: BoxDecoration(
                    color: const Color(0xFFE6F5EC),
                    borderRadius: BorderRadius.circular(20.r),
                  ),
                  child: Text(
                    '${indexes.length} Pending',
                    style: TextStyle(
                      fontSize: 9.5.sp,
                      fontWeight: FontWeight.w700,
                      color: _green,
                    ),
                  ),
                ),
            ],
          ),
          SizedBox(height: 10.h),
          if (controller.isFetchingPending.value)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Center(child: CircularProgressIndicator(color: _green)),
            )
          else if (indexes.isEmpty)
            _emptyState('No loans pending AM approval for this branch and date range.')
          else ...[
            _selectAllRow(),
            SizedBox(height: 8.h),
            ListView.separated(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: indexes.length,
              separatorBuilder: (_, __) => SizedBox(height: 8.h),
              itemBuilder: (_, i) => _indexCard(Map<String, dynamic>.from(indexes[i])),
            ),
            SizedBox(height: 16.h),
            _actionFooter(),
          ],
        ],
      );
    });
  }

  Widget _selectAllRow() {
    return Obx(
      () => Container(
        padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 8.h),
        decoration: BoxDecoration(
          color: const Color(0xFFF1F5F4),
          borderRadius: BorderRadius.circular(10.r),
        ),
        child: Row(
          children: [
            Checkbox(
              value: controller.isAllSelected,
              activeColor: _green,
              onChanged: (v) => controller.toggleSelectAll(v ?? false),
            ),
            Text(
              'Select all',
              style: TextStyle(fontSize: 11.5.sp, fontWeight: FontWeight.w700, color: _darkText),
            ),
            SizedBox(width: 6.w),
            Text(
              '(${controller.selectedIndexIds.length} selected)',
              style: TextStyle(fontSize: 10.sp, color: _muted),
            ),
          ],
        ),
      ),
    );
  }

  Widget _indexCard(Map<String, dynamic> idx) {
    final indexId = idx['id'].toString();
    final loans = idx['loans'] is List ? idx['loans'] as List : const [];
    return Obx(() {
      final selected = controller.selectedIndexIds.contains(indexId);
      final expanded = controller.expandedIndexId.value == indexId;
      return Container(
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(
            color: selected ? _green.withValues(alpha: 0.4) : const Color(0xFFE1EAE4),
          ),
          borderRadius: BorderRadius.circular(12.r),
        ),
        child: Column(
          children: [
            InkWell(
              onTap: () => controller.toggleExpand(indexId),
              borderRadius: BorderRadius.circular(12.r),
              child: Padding(
                padding: EdgeInsets.all(12.w),
                child: Row(
                  children: [
                    Checkbox(
                      value: selected,
                      activeColor: _green,
                      onChanged: (_) => controller.toggleSelectIndex(indexId),
                    ),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Index #${_field(idx, 'indexNo')}',
                            style: TextStyle(
                              fontSize: 12.5.sp,
                              fontWeight: FontWeight.w800,
                              color: _darkText,
                            ),
                          ),
                          SizedBox(height: 2.h),
                          Text(
                            '${_field(idx, 'centerName')} • ${idx['totalLoans'] ?? 0} loan(s) • ${_currency(_amount(idx, 'totalAmount'))}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(fontSize: 10.sp, color: _muted),
                          ),
                        ],
                      ),
                    ),
                    Icon(
                      expanded ? Icons.expand_less_rounded : Icons.expand_more_rounded,
                      color: _muted,
                    ),
                  ],
                ),
              ),
            ),
            if (expanded)
              Container(
                decoration: const BoxDecoration(
                  border: Border(top: BorderSide(color: Color(0xFFE1EAE4))),
                ),
                padding: EdgeInsets.all(10.w),
                child: Column(
                  children: loans
                      .map((l) => _loanRow(Map<String, dynamic>.from(l), _field(idx, 'centerName')))
                      .toList(),
                ),
              ),
          ],
        ),
      );
    });
  }

  Widget _loanRow(Map<String, dynamic> loan, String centerName) {
    final verified = loan['isVerified'] == true;
    return Container(
      margin: EdgeInsets.only(bottom: 6.h),
      padding: EdgeInsets.all(10.w),
      decoration: BoxDecoration(
        color: const Color(0xFFF0FAF4),
        borderRadius: BorderRadius.circular(10.r),
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
                      _field(loan, 'clientId'),
                      style: TextStyle(
                        fontSize: 11.5.sp,
                        fontWeight: FontWeight.w800,
                        color: _darkText,
                      ),
                    ),
                    Text(
                      _field(loan, 'clientName'),
                      style: TextStyle(fontSize: 10.sp, color: _muted),
                    ),
                  ],
                ),
              ),
              Text(
                _currency(_amount(loan, 'amount')),
                style: TextStyle(
                  fontSize: 12.sp,
                  fontWeight: FontWeight.w800,
                  color: _green,
                ),
              ),
            ],
          ),
          SizedBox(height: 6.h),
          Row(
            children: [
              _tag(_field(loan, 'purpose')),
              SizedBox(width: 6.w),
              _tag(_field(loan, 'frequency')),
              const Spacer(),
              Container(
                padding: EdgeInsets.symmetric(horizontal: 7.w, vertical: 3.h),
                decoration: BoxDecoration(
                  color: verified ? const Color(0xFFD1FAE5) : const Color(0xFFFEF3C7),
                  borderRadius: BorderRadius.circular(20.r),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      verified ? Icons.check_circle_rounded : Icons.warning_amber_rounded,
                      size: 11.sp,
                      color: verified ? const Color(0xFF065F46) : const Color(0xFF92400E),
                    ),
                    SizedBox(width: 3.w),
                    Text(
                      verified ? 'Verified' : 'Incomplete',
                      style: TextStyle(
                        fontSize: 9.sp,
                        fontWeight: FontWeight.w700,
                        color: verified ? const Color(0xFF065F46) : const Color(0xFF92400E),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _tag(String label) => Container(
    padding: EdgeInsets.symmetric(horizontal: 7.w, vertical: 3.h),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(6.r),
    ),
    child: Text(
      label,
      style: TextStyle(fontSize: 9.sp, color: _green, fontWeight: FontWeight.w600),
    ),
  );

  Widget _actionFooter() {
    return Obx(
      () => Row(
        children: [
          Expanded(
            child: OutlinedButton.icon(
              onPressed:
                  controller.selectedIndexIds.isEmpty || controller.isSubmitting.value
                  ? null
                  : () => _confirmAndSubmit('REJECT'),
              style: OutlinedButton.styleFrom(
                foregroundColor: Colors.red,
                side: const BorderSide(color: Colors.red),
                padding: EdgeInsets.symmetric(vertical: 13.h),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10.r),
                ),
              ),
              icon: const Icon(Icons.gpp_bad_rounded, size: 18),
              label: const Text('Reject'),
            ),
          ),
          SizedBox(width: 10.w),
          Expanded(
            flex: 2,
            child: ElevatedButton.icon(
              onPressed:
                  controller.selectedIndexIds.isEmpty || controller.isSubmitting.value
                  ? null
                  : () => _confirmAndSubmit('APPROVE'),
              style: ElevatedButton.styleFrom(
                backgroundColor: _green,
                foregroundColor: Colors.white,
                padding: EdgeInsets.symmetric(vertical: 13.h),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10.r),
                ),
              ),
              icon: controller.isSubmitting.value
                  ? SizedBox(
                      width: 16.sp,
                      height: 16.sp,
                      child: const CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.check_circle_rounded, size: 18),
              label: const Text('Approve for Disbursement'),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _confirmAndSubmit(String action) async {
    if (action == 'APPROVE') {
      final unverified = controller.unverifiedClientNamesInSelection;
      if (unverified.isNotEmpty) {
        Get.snackbar(
          'Complete Member Individual & GRT first',
          'Cannot approve — pending for: ${unverified.join(', ')}.',
          backgroundColor: Colors.redAccent,
          colorText: Colors.white,
          duration: const Duration(seconds: 5),
        );
        return;
      }
    }

    final count = controller.selectedIndexIds.length;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(action == 'REJECT' ? 'Reject Loans' : 'Approve for Disbursement'),
        content: Text(
          action == 'APPROVE'
              ? 'You are approving $count index batch(es) for disbursement. The Branch '
                    'Manager will then perform the final disbursal.'
              : 'You are about to reject $count index batch(es). All loans in those '
                    'batches will be marked as rejected.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: action == 'REJECT' ? Colors.red : _green,
            ),
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text(action == 'REJECT' ? 'Reject' : 'Approve for Disbursement'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await controller.submitAction(action);
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
