import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:image_picker/image_picker.dart';
import 'package:sarvam/controller/final_disbursement_controller.dart';
import 'package:sarvam/view/BM/group_assignment/widgets/id_dropdown.dart';

const _green = Color(0xFF0D6842);
const _darkText = Color(0xFF172033);
const _muted = Color(0xFF64748B);

/// BM "Final Disbursement" — mirrors the core flow and complete feature set of the
/// web app's `components/loan-module/FinalDisbursementClient.tsx`: select a funder,
/// pick an AM-approved index, verify Member-Individual statuses, set attendance &
/// admission fees per loan, capture gold pledge details/photos if applicable, and disburse.
class FinalDisbursement extends StatefulWidget {
  const FinalDisbursement({super.key});

  @override
  State<FinalDisbursement> createState() => _FinalDisbursementState();
}

class _FinalDisbursementState extends State<FinalDisbursement> {
  final FinalDisbursementController controller =
      Get.isRegistered<FinalDisbursementController>()
      ? Get.find<FinalDisbursementController>()
      : Get.put(FinalDisbursementController());

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

  String _funderLabel(List<dynamic> items, String id) {
    final match = items.firstWhere(
      (e) => e is Map && e['id']?.toString() == id,
      orElse: () => null,
    );
    if (match is! Map) return id;
    final code = match['funderId'] ?? '';
    final name = match['funderName'] ?? id;
    return code.toString().isEmpty ? '$name' : '$code — $name';
  }

  Future<void> _pickGoldPhoto(String loanId, ImageSource source) async {
    final picked = await ImagePicker().pickImage(
      source: source,
      maxWidth: 1920,
      maxHeight: 1920,
      imageQuality: 80,
    );
    if (picked != null) {
      final bytes = await picked.readAsBytes();
      await controller.uploadGoldPhoto(loanId, bytes, picked.name);
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
            'Final Disbursement',
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
            if (controller.isLoading.value && controller.branch.value == null) {
              return const Center(child: CircularProgressIndicator(color: _green));
            }
            return RefreshIndicator(
              color: _green,
              onRefresh: controller.fetchApprovedIndexes,
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: EdgeInsets.all(16.w),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildFilterCard(),
                    SizedBox(height: 14.h),
                    _buildStatsRow(),
                    SizedBox(height: 14.h),
                    _buildDisbursementSection(),
                    SizedBox(height: 14.h),
                    _buildApprovedIndexesList(),
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
          Obx(() {
            final b = controller.branch.value;
            return Row(
              children: [
                Icon(Icons.store_rounded, size: 15.sp, color: _green),
                SizedBox(width: 6.w),
                Text(
                  b == null
                      ? 'Branch not assigned'
                      : '${_field(b, 'code')} — ${_field(b, 'name')}',
                  style: TextStyle(
                    fontSize: 12.5.sp,
                    fontWeight: FontWeight.w800,
                    color: _darkText,
                  ),
                ),
              ],
            );
          }),
          SizedBox(height: 12.h),
          Row(
            children: [
              Text(
                'Funder',
                style: TextStyle(
                  fontSize: 11.5.sp,
                  fontWeight: FontWeight.w700,
                  color: _darkText,
                ),
              ),
              Text(' *', style: TextStyle(fontSize: 11.5.sp, color: Colors.red)),
            ],
          ),
          SizedBox(height: 6.h),
          Obx(
            () => IdDropdown(
              label: 'Select Funder',
              value: controller.funderId.value,
              items: controller.funders,
              labelBuilder: _funderLabel,
              onChanged: (v) => controller.setBulkFunder(v),
            ),
          ),
          Obx(
            () => Padding(
              padding: EdgeInsets.only(top: 6.h),
              child: controller.funderId.value == null
                  ? Text(
                      'Funder must be selected before disbursing',
                      style: TextStyle(fontSize: 10.sp, color: Colors.red),
                    )
                  : Text(
                      'Funder selected',
                      style: TextStyle(fontSize: 10.sp, color: _green),
                    ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatsRow() {
    return Obx(() {
      final totalLoans = controller.stats['totalLoans'] ?? 0;
      final totalAmount = controller.stats['totalAmount'];
      final amountValue = (totalAmount is num) ? totalAmount.toDouble() : 0.0;
      return Row(
        children: [
          Expanded(
            child: _statCard(
              label: 'Approved Loans',
              value: controller.isLoadingIndexes.value ? '...' : '$totalLoans',
              icon: Icons.groups_rounded,
              iconColor: _green,
              iconBg: const Color(0xFFE6F5EC),
            ),
          ),
          SizedBox(width: 10.w),
          Expanded(
            child: _statCard(
              label: 'Total Value',
              value: controller.isLoadingIndexes.value
                  ? '...'
                  : _currency(amountValue),
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

  Widget _buildDisbursementSection() {
    return Obx(() {
      final idx = controller.selectedIndex.value;
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
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Text(
                    idx == null
                        ? 'Select an index from the list below.'
                        : 'Index #${_field(idx, 'indexNo')} · ${_field(idx, 'centerName')} · ${idx['totalLoans'] ?? 0} loan(s)',
                    style: TextStyle(
                      fontSize: 12.5.sp,
                      fontWeight: FontWeight.w800,
                      color: _darkText,
                    ),
                  ),
                ),
                if (idx != null)
                  TextButton.icon(
                    onPressed: controller.clearSelection,
                    icon: const Icon(Icons.close_rounded, size: 15),
                    label: const Text('Clear'),
                    style: TextButton.styleFrom(foregroundColor: _muted),
                  ),
              ],
            ),
            if (idx == null) ...[
              SizedBox(height: 16.h),
              Center(
                child: Column(
                  children: [
                    Icon(Icons.send_rounded, size: 32.sp, color: _muted),
                    SizedBox(height: 8.h),
                    Text(
                      'Select an AM-approved index below to view its details '
                      'and perform disbursement.',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 11.sp, color: _muted),
                    ),
                  ],
                ),
              ),
              SizedBox(height: 8.h),
            ] else
              ..._buildDisbursementDetails(idx),
          ],
        ),
      );
    });
  }

  List<Widget> _buildDisbursementDetails(Map<String, dynamic> idx) {
    return [
      SizedBox(height: 10.h),
      // Member Individual Verification Refresh Section
      Container(
        padding: EdgeInsets.all(10.w),
        decoration: BoxDecoration(
          color: const Color(0xFFF8FAFC),
          border: Border.all(color: const Color(0xFFE2E8F0)),
          borderRadius: BorderRadius.circular(10.r),
        ),
        child: Row(
          children: [
            Icon(Icons.verified_user_outlined, size: 16.sp, color: _green),
            SizedBox(width: 8.w),
            Expanded(
              child: Text(
                'Member Individual Verification Status',
                style: TextStyle(
                  fontSize: 11.sp,
                  fontWeight: FontWeight.w700,
                  color: _darkText,
                ),
              ),
            ),
            Obx(
              () => OutlinedButton.icon(
                onPressed: controller.isRefreshingMemberIndividual.value
                    ? null
                    : controller.refreshMemberIndividualStatuses,
                style: OutlinedButton.styleFrom(
                  foregroundColor: _green,
                  side: const BorderSide(color: _green),
                  padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 4.h),
                  minimumSize: Size.zero,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                icon: controller.isRefreshingMemberIndividual.value
                    ? SizedBox(
                        width: 12.sp,
                        height: 12.sp,
                        child: const CircularProgressIndicator(
                          strokeWidth: 2,
                          color: _green,
                        ),
                      )
                    : Icon(Icons.refresh_rounded, size: 14.sp),
                label: Text(
                  'Refresh',
                  style: TextStyle(fontSize: 10.5.sp, fontWeight: FontWeight.w700),
                ),
              ),
            ),
          ],
        ),
      ),
      SizedBox(height: 10.h),
      // Accounting Overview Card
      Container(
        padding: EdgeInsets.all(12.w),
        decoration: BoxDecoration(
          color: const Color(0xFFF0FAF4),
          border: Border.all(color: const Color(0xFFC6E7D2)),
          borderRadius: BorderRadius.circular(12.r),
        ),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'FIRST DUE DATE',
                      style: TextStyle(
                        fontSize: 8.5.sp,
                        color: _muted,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    SizedBox(height: 2.h),
                    Obx(() {
                      final due = controller.commonFirstDueDate;
                      return Text(
                        due ?? 'Not set — go to Loan Index Approval first',
                        style: TextStyle(
                          fontSize: due == null ? 10.sp : 11.5.sp,
                          fontWeight: FontWeight.w800,
                          color: due == null ? Colors.red : _green,
                        ),
                      );
                    }),
                  ],
                ),
                Obx(
                  () => Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        'TOTAL AMOUNT',
                        style: TextStyle(
                          fontSize: 8.5.sp,
                          color: _green,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      Text(
                        _currency(controller.totalLoanAmount),
                        style: TextStyle(
                          fontSize: 14.sp,
                          fontWeight: FontWeight.w800,
                          color: _green,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            Divider(height: 14.h, color: const Color(0xFFC6E7D2)),
            Obx(
              () => Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Total Loans: ${_currency(controller.totalLoanAmount)}',
                    style: TextStyle(
                      fontSize: 10.5.sp,
                      fontWeight: FontWeight.w600,
                      color: _darkText,
                    ),
                  ),
                  if (controller.totalAdmissionFee > 0)
                    Text(
                      'Admission Fees: ${_currency(controller.totalAdmissionFee)}',
                      style: TextStyle(
                        fontSize: 10.5.sp,
                        fontWeight: FontWeight.w700,
                        color: _green,
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
      SizedBox(height: 10.h),
      // Attendance Quick Action
      Row(
        children: [
          Expanded(
            child: OutlinedButton.icon(
              onPressed: () => controller.setAttendanceForAll('PRESENT'),
              style: OutlinedButton.styleFrom(
                foregroundColor: _green,
                side: const BorderSide(color: _green),
                padding: EdgeInsets.symmetric(vertical: 9.h),
              ),
              icon: const Icon(Icons.check_circle_outline_rounded, size: 15),
              label: const Text('All Present', style: TextStyle(fontSize: 11)),
            ),
          ),
          SizedBox(width: 8.w),
          Expanded(
            child: OutlinedButton.icon(
              onPressed: () => controller.setAttendanceForAll('ABSENT'),
              style: OutlinedButton.styleFrom(
                foregroundColor: const Color(0xFF92400E),
                side: const BorderSide(color: Color(0xFFF5DD9E)),
                padding: EdgeInsets.symmetric(vertical: 9.h),
              ),
              icon: const Icon(Icons.cancel_outlined, size: 15),
              label: const Text('All Absent', style: TextStyle(fontSize: 11)),
            ),
          ),
        ],
      ),
      SizedBox(height: 12.h),
      // Per Loan Cards
      ...((idx['loans'] as List? ?? []))
          .map((l) => _loanAttendanceRow(Map<String, dynamic>.from(l))),
      SizedBox(height: 10.h),
      // Validation Warnings Box
      Obx(() {
        if (controller.canConfirmDisburse) return const SizedBox.shrink();
        final hints = <String>[];
        if (!controller.firstDueDateValid) {
          hints.add(
            'All loans must have a First Due Date set on the Loan Index page.',
          );
        }
        if (!controller.allAttendanceSet) {
          hints.add(
            'Attendance must be set for all ${controller.selectedLoans.length} loan(s).',
          );
        }
        if (controller.funderId.value == null) {
          hints.add('Select a funder above.');
        }
        if (!controller.allMemberIndividualsCompleted) {
          final pending = controller.notCompletedMemberIndividualLoans;
          final names = pending
              .map((l) => l is Map ? (l['clientName'] ?? 'Member') : 'Member')
              .join(', ');
          hints.add(
            'Member Individual Verification pending for: $names. Ask FDO to complete.',
          );
        }
        if (!controller.allGoldFilled) {
          hints.add(
            'For Gold Loans, enter Karat Type, Grams, Taken Value, Cash Given, and upload at least one gold pledge photo.',
          );
        }

        return Container(
          width: double.infinity,
          padding: EdgeInsets.all(10.w),
          decoration: BoxDecoration(
            color: const Color(0xFFFFF8E1),
            borderRadius: BorderRadius.circular(10.r),
            border: Border.all(color: const Color(0xFFFDE68A)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(
                    Icons.warning_amber_rounded,
                    size: 16,
                    color: Color(0xFFD97706),
                  ),
                  SizedBox(width: 6.w),
                  Text(
                    'Before disbursing, please ensure:',
                    style: TextStyle(
                      fontSize: 10.5.sp,
                      fontWeight: FontWeight.w700,
                      color: const Color(0xFF9A6B00),
                    ),
                  ),
                ],
              ),
              SizedBox(height: 4.h),
              ...hints.map(
                (h) => Padding(
                  padding: EdgeInsets.only(top: 2.h),
                  child: Text(
                    '• $h',
                    style: TextStyle(
                      fontSize: 10.sp,
                      color: const Color(0xFF9A6B00),
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      }),
      SizedBox(height: 12.h),
      // Final Disburse Button
      Obx(
        () => SizedBox(
          width: double.infinity,
          child: ElevatedButton.icon(
            onPressed: controller.canConfirmDisburse
                ? () => _confirmAndDisburse()
                : null,
            style: ElevatedButton.styleFrom(
              backgroundColor: _green,
              foregroundColor: Colors.white,
              disabledBackgroundColor: const Color(0xFFA8D5BC),
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
            label: Text('Disburse ${controller.selectedLoans.length} Loan(s)'),
          ),
        ),
      ),
    ];
  }

  Widget _loanAttendanceRow(Map<String, dynamic> loan) {
    final loanId = loan['id'].toString();
    final isGoldLoan = loan['isGoldLoan'] == true;

    return Obx(() {
      final status = controller.attendanceMap[loanId];
      final fee = controller.admissionFeeMap[loanId] ?? 0.0;
      final isNewClient = controller.newClientsMap[loanId] == true;
      final isMIComplete = controller.memberIndividualMap[loanId] == true;

      final grossAmount = _amount(loan, 'amount');

      final goldData = controller.goldMap[loanId] ?? {};
      final goldPhotos = controller.goldPhotosMap[loanId] ?? [];
      final isUploadingGold = controller.uploadingGoldPhotoFor.value == loanId;

      return Container(
        margin: EdgeInsets.only(bottom: 10.h),
        padding: EdgeInsets.all(12.w),
        decoration: BoxDecoration(
          color: status == null ? const Color(0xFFFFF3F3) : Colors.white,
          border: Border.all(
            color: status == null
                ? Colors.red.withValues(alpha: 0.3)
                : const Color(0xFFE1EAE4),
          ),
          borderRadius: BorderRadius.circular(12.r),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Top Row: Member name + Net / Gross amount
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Flexible(
                            child: Text(
                              _field(loan, 'clientName'),
                              style: TextStyle(
                                fontSize: 12.sp,
                                fontWeight: FontWeight.w800,
                                color: _darkText,
                              ),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          if (isGoldLoan) ...[
                            SizedBox(width: 6.w),
                            Container(
                              padding: EdgeInsets.symmetric(
                                horizontal: 6.w,
                                vertical: 1.h,
                              ),
                              decoration: BoxDecoration(
                                color: const Color(0xFFFEF3C7),
                                borderRadius: BorderRadius.circular(4.r),
                              ),
                              child: Text(
                                'GOLD LOAN',
                                style: TextStyle(
                                  fontSize: 8.5.sp,
                                  fontWeight: FontWeight.w800,
                                  color: const Color(0xFFB45309),
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                      SizedBox(height: 2.h),
                      Text(
                        'ID: ${_field(loan, 'clientId')} · Loan: ${_field(loan, 'loanNumber')}',
                        style: TextStyle(fontSize: 10.sp, color: _muted),
                      ),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      _currency(grossAmount),
                      style: TextStyle(
                        fontSize: 12.5.sp,
                        fontWeight: FontWeight.w800,
                        color: _green,
                      ),
                    ),
                    Text(
                      'Amount',
                      style: TextStyle(fontSize: 9.5.sp, color: _muted),
                    ),
                  ],
                ),
              ],
            ),
            SizedBox(height: 8.h),
            // Member Individual Verification Badge
            Container(
              padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 4.h),
              decoration: BoxDecoration(
                color: isMIComplete
                    ? const Color(0xFFDCFCE7)
                    : const Color(0xFFFEE2E2),
                borderRadius: BorderRadius.circular(6.r),
                border: Border.all(
                  color: isMIComplete
                      ? const Color(0xFF86EFAC)
                      : const Color(0xFFFCA5A5),
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    isMIComplete
                        ? Icons.check_circle_rounded
                        : Icons.pending_actions_rounded,
                    size: 13.sp,
                    color: isMIComplete
                        ? const Color(0xFF15803D)
                        : const Color(0xFFDC2626),
                  ),
                  SizedBox(width: 4.w),
                  Text(
                    isMIComplete
                        ? 'Member Individual: Complete'
                        : 'Member Individual: Pending',
                    style: TextStyle(
                      fontSize: 10.sp,
                      fontWeight: FontWeight.w700,
                      color: isMIComplete
                          ? const Color(0xFF15803D)
                          : const Color(0xFFDC2626),
                    ),
                  ),
                ],
              ),
            ),
            SizedBox(height: 10.h),
            // Per Member Funder Override Dropdown
            Text(
              'Per-Member Funder Override',
              style: TextStyle(
                fontSize: 10.sp,
                fontWeight: FontWeight.w700,
                color: _muted,
              ),
            ),
            SizedBox(height: 4.h),
            IdDropdown(
              label: 'Select Funder',
              value: controller.memberFunderMap[loanId] ?? controller.funderId.value,
              items: controller.funders,
              labelBuilder: _funderLabel,
              onChanged: (v) {
                if (v != null) controller.setMemberFunder(loanId, v);
              },
            ),
            SizedBox(height: 10.h),
            // Admission Fee & Attendance Row
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Text(
                            'Admission Fee (₹)',
                            style: TextStyle(
                              fontSize: 10.sp,
                              fontWeight: FontWeight.w700,
                              color: _muted,
                            ),
                          ),
                          if (isNewClient)
                            Text(
                              ' (New)',
                              style: TextStyle(
                                fontSize: 9.5.sp,
                                fontWeight: FontWeight.w700,
                                color: _green,
                              ),
                            ),
                        ],
                      ),
                      SizedBox(height: 4.h),
                      if (isNewClient)
                        TextFormField(
                          key: ValueKey('admission_fee_${loanId}_${fee.toStringAsFixed(0)}'),
                          initialValue: fee > 0 ? fee.toStringAsFixed(0) : '50',
                          keyboardType: TextInputType.number,
                          style: TextStyle(
                            fontSize: 11.sp,
                            fontWeight: FontWeight.w700,
                          ),
                          decoration: InputDecoration(
                            isDense: true,
                            prefixText: '₹ ',
                            contentPadding: EdgeInsets.symmetric(
                              horizontal: 8.w,
                              vertical: 8.h,
                            ),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(6.r),
                              borderSide: const BorderSide(color: Color(0xFFCBD5E1)),
                            ),
                          ),
                          onChanged: (v) => controller.setAdmissionFee(
                            loanId,
                            double.tryParse(v) ?? 0.0,
                          ),
                        )
                      else
                        Container(
                          width: double.infinity,
                          padding: EdgeInsets.symmetric(
                            horizontal: 10.w,
                            vertical: 8.h,
                          ),
                          decoration: BoxDecoration(
                            color: const Color(0xFFF1F5F9),
                            borderRadius: BorderRadius.circular(6.r),
                            border: Border.all(color: const Color(0xFFE2E8F0)),
                          ),
                          child: Text(
                            'Existing (₹0)',
                            style: TextStyle(
                              fontSize: 11.sp,
                              fontWeight: FontWeight.w600,
                              color: _muted,
                              fontStyle: FontStyle.italic,
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                SizedBox(width: 8.w),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Attendance',
                      style: TextStyle(
                        fontSize: 10.sp,
                        fontWeight: FontWeight.w700,
                        color: _muted,
                      ),
                    ),
                    SizedBox(height: 4.h),
                    Row(
                      children: [
                        _attendanceChoiceChip(
                          loanId,
                          'PRESENT',
                          status == 'PRESENT',
                        ),
                        SizedBox(width: 4.w),
                        _attendanceChoiceChip(
                          loanId,
                          'ABSENT',
                          status == 'ABSENT',
                        ),
                      ],
                    ),
                  ],
                ),
              ],
            ),
            // Gold Loan Form & Photo Upload Section
            if (isGoldLoan) ...[
              SizedBox(height: 12.h),
              Container(
                padding: EdgeInsets.all(10.w),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFFBEB),
                  border: Border.all(color: const Color(0xFFFDE68A)),
                  borderRadius: BorderRadius.circular(10.r),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Gold Pledge Details',
                      style: TextStyle(
                        fontSize: 11.sp,
                        fontWeight: FontWeight.w800,
                        color: const Color(0xFFB45309),
                      ),
                    ),
                    SizedBox(height: 8.h),
                    Row(
                      children: [
                        Expanded(
                          child: DropdownButtonFormField<String>(
                            initialValue: goldData['karatType'] as String?,
                            hint: Text('Karat', style: TextStyle(fontSize: 11.sp)),
                            decoration: InputDecoration(
                              isDense: true,
                              contentPadding: EdgeInsets.symmetric(
                                horizontal: 8.w,
                                vertical: 8.h,
                              ),
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(6.r),
                              ),
                            ),
                            items: ['24K', '22K', '20K', '18K', '16K']
                                .map(
                                  (k) => DropdownMenuItem(
                                    value: k,
                                    child: Text(
                                      k,
                                      style: TextStyle(fontSize: 11.sp),
                                    ),
                                  ),
                                )
                                .toList(),
                            onChanged: (v) {
                              if (v != null) {
                                controller.updateGoldDetail(
                                  loanId,
                                  'karatType',
                                  v,
                                );
                              }
                            },
                          ),
                        ),
                        SizedBox(width: 8.w),
                        Expanded(
                          child: TextFormField(
                            initialValue: goldData['gramCount']?.toString() ?? '',
                            keyboardType: const TextInputType.numberWithOptions(
                              decimal: true,
                            ),
                            style: TextStyle(fontSize: 11.sp),
                            decoration: InputDecoration(
                              labelText: 'Grams',
                              isDense: true,
                              contentPadding: EdgeInsets.symmetric(
                                horizontal: 8.w,
                                vertical: 8.h,
                              ),
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(6.r),
                              ),
                            ),
                            onChanged: (v) => controller.updateGoldDetail(
                              loanId,
                              'gramCount',
                              double.tryParse(v) ?? 0,
                            ),
                          ),
                        ),
                      ],
                    ),
                    SizedBox(height: 8.h),
                    Row(
                      children: [
                        Expanded(
                          child: TextFormField(
                            initialValue:
                                goldData['goldTakenValue']?.toString() ?? '',
                            keyboardType: const TextInputType.numberWithOptions(
                              decimal: true,
                            ),
                            style: TextStyle(fontSize: 11.sp),
                            decoration: InputDecoration(
                              labelText: 'Taken Value (₹)',
                              isDense: true,
                              contentPadding: EdgeInsets.symmetric(
                                horizontal: 8.w,
                                vertical: 8.h,
                              ),
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(6.r),
                              ),
                            ),
                            onChanged: (v) => controller.updateGoldDetail(
                              loanId,
                              'goldTakenValue',
                              double.tryParse(v) ?? 0,
                              grossAmount,
                            ),
                          ),
                        ),
                        SizedBox(width: 8.w),
                        Expanded(
                          child: TextFormField(
                            initialValue: goldData['cashGiven']?.toString() ?? '',
                            keyboardType: const TextInputType.numberWithOptions(
                              decimal: true,
                            ),
                            style: TextStyle(fontSize: 11.sp),
                            decoration: InputDecoration(
                              labelText: 'Cash Given (₹)',
                              isDense: true,
                              contentPadding: EdgeInsets.symmetric(
                                horizontal: 8.w,
                                vertical: 8.h,
                              ),
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(6.r),
                              ),
                            ),
                            onChanged: (v) => controller.updateGoldDetail(
                              loanId,
                              'cashGiven',
                              double.tryParse(v) ?? 0,
                              grossAmount,
                            ),
                          ),
                        ),
                      ],
                    ),
                    SizedBox(height: 8.h),
                    TextFormField(
                      initialValue: goldData['itemDescription']?.toString() ?? '',
                      style: TextStyle(fontSize: 11.sp),
                      decoration: InputDecoration(
                        labelText: 'Item Description / Token No (optional)',
                        isDense: true,
                        contentPadding: EdgeInsets.symmetric(
                          horizontal: 8.w,
                          vertical: 8.h,
                        ),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(6.r),
                        ),
                      ),
                      onChanged: (v) => controller.updateGoldDetail(
                        loanId,
                        'itemDescription',
                        v,
                      ),
                    ),
                    SizedBox(height: 10.h),
                    // Gold Photos List & Attach Button
                    Text(
                      'Pledge Photos (${goldPhotos.length})',
                      style: TextStyle(
                        fontSize: 10.5.sp,
                        fontWeight: FontWeight.w700,
                        color: const Color(0xFFB45309),
                      ),
                    ),
                    SizedBox(height: 6.h),
                    if (goldPhotos.isNotEmpty)
                      SizedBox(
                        height: 55.h,
                        child: ListView.separated(
                          scrollDirection: Axis.horizontal,
                          itemCount: goldPhotos.length,
                          separatorBuilder: (_, __) => SizedBox(width: 6.w),
                          itemBuilder: (_, pIdx) {
                            final photo = goldPhotos[pIdx];
                            final pId = photo['id']?.toString() ?? '';
                            final url = photo['photoUrl']?.toString() ?? '';
                            return Stack(
                              children: [
                                ClipRRect(
                                  borderRadius: BorderRadius.circular(6.r),
                                  child: Image.network(
                                    url,
                                    width: 55.h,
                                    height: 55.h,
                                    fit: BoxFit.cover,
                                    errorBuilder: (_, __, ___) => Container(
                                      width: 55.h,
                                      height: 55.h,
                                      color: const Color(0xFFEFF3F1),
                                      child: Icon(
                                        Icons.broken_image_outlined,
                                        size: 18.sp,
                                        color: Colors.redAccent,
                                      ),
                                    ),
                                  ),
                                ),
                                Positioned(
                                  top: 1,
                                  right: 1,
                                  child: GestureDetector(
                                    onTap: () => controller.deleteGoldPhoto(
                                      loanId,
                                      pId,
                                    ),
                                    child: CircleAvatar(
                                      radius: 8.r,
                                      backgroundColor: Colors.black54,
                                      child: Icon(
                                        Icons.close,
                                        size: 10.sp,
                                        color: Colors.white,
                                      ),
                                    ),
                                  ),
                                ),
                              ],
                            );
                          },
                        ),
                      ),
                    SizedBox(height: 6.h),
                    Row(
                      children: [
                        OutlinedButton.icon(
                          onPressed: isUploadingGold
                              ? null
                              : () => _pickGoldPhoto(loanId, ImageSource.camera),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: const Color(0xFFB45309),
                            side: const BorderSide(color: Color(0xFFFDE68A)),
                            padding: EdgeInsets.symmetric(
                              horizontal: 8.w,
                              vertical: 4.h,
                            ),
                          ),
                          icon: isUploadingGold
                              ? SizedBox(
                                  width: 12.sp,
                                  height: 12.sp,
                                  child: const CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : Icon(Icons.camera_alt_outlined, size: 14.sp),
                          label: Text(
                            'Camera',
                            style: TextStyle(fontSize: 10.sp),
                          ),
                        ),
                        SizedBox(width: 6.w),
                        OutlinedButton.icon(
                          onPressed: isUploadingGold
                              ? null
                              : () => _pickGoldPhoto(
                                  loanId,
                                  ImageSource.gallery,
                                ),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: const Color(0xFFB45309),
                            side: const BorderSide(color: Color(0xFFFDE68A)),
                            padding: EdgeInsets.symmetric(
                              horizontal: 8.w,
                              vertical: 4.h,
                            ),
                          ),
                          icon: Icon(Icons.photo_library_outlined, size: 14.sp),
                          label: Text(
                            'Gallery',
                            style: TextStyle(fontSize: 10.sp),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      );
    });
  }

  Widget _attendanceChoiceChip(String loanId, String value, bool selected) {
    final isPresent = value == 'PRESENT';
    return InkWell(
      onTap: () => controller.setAttendance(loanId, value),
      borderRadius: BorderRadius.circular(6.r),
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 6.h),
        decoration: BoxDecoration(
          color: selected
              ? (isPresent
                  ? const Color(0xFFDCFCE7)
                  : const Color(0xFFFEF3C7))
              : Colors.white,
          border: Border.all(
            color: selected
                ? (isPresent
                    ? const Color(0xFF15803D)
                    : const Color(0xFFB45309))
                : const Color(0xFFCBD5E1),
            width: selected ? 1.5 : 1,
          ),
          borderRadius: BorderRadius.circular(6.r),
        ),
        child: Text(
          value,
          style: TextStyle(
            fontSize: 10.sp,
            fontWeight: FontWeight.w700,
            color: selected
                ? (isPresent
                    ? const Color(0xFF15803D)
                    : const Color(0xFFB45309))
                : _muted,
          ),
        ),
      ),
    );
  }

  Widget _buildApprovedIndexesList() {
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
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Approved Indexes',
                style: TextStyle(
                  fontSize: 13.sp,
                  fontWeight: FontWeight.w800,
                  color: _darkText,
                ),
              ),
              Obx(
                () => Text(
                  '${controller.approvedIndexes.length} available',
                  style: TextStyle(fontSize: 10.5.sp, color: _muted),
                ),
              ),
            ],
          ),
          SizedBox(height: 10.h),
          Obx(() {
            if (controller.isLoadingIndexes.value) {
              return const Padding(
                padding: EdgeInsets.all(24.0),
                child: Center(child: CircularProgressIndicator(color: _green)),
              );
            }
            if (controller.approvedIndexes.isEmpty) {
              return Padding(
                padding: EdgeInsets.all(20.w),
                child: Center(
                  child: Text(
                    'No Level-2 approved loan indexes found for this branch.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 11.5.sp, color: _muted),
                  ),
                ),
              );
            }
            return ListView.separated(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: controller.approvedIndexes.length,
              separatorBuilder: (_, __) => SizedBox(height: 8.h),
              itemBuilder: (_, index) {
                final idx = controller.approvedIndexes[index];
                if (idx is! Map) return const SizedBox.shrink();
                final idxMap = Map<String, dynamic>.from(idx);
                final isSelected =
                    controller.selectedIndex.value?['id'] == idxMap['id'];

                return InkWell(
                  onTap: () => controller.selectIndex(idxMap),
                  child: Container(
                    padding: EdgeInsets.all(12.w),
                    decoration: BoxDecoration(
                      color: isSelected
                          ? const Color(0xFFF0FAF4)
                          : Colors.white,
                      border: Border.all(
                        color: isSelected
                            ? _green
                            : const Color(0xFFE1EAE4),
                        width: isSelected ? 1.5 : 1,
                      ),
                      borderRadius: BorderRadius.circular(10.r),
                    ),
                    child: Row(
                      children: [
                        CircleAvatar(
                          radius: 16.r,
                          backgroundColor: isSelected
                              ? _green
                              : const Color(0xFFE6F5EC),
                          child: Icon(
                            Icons.receipt_long_rounded,
                            size: 16.sp,
                            color: isSelected ? Colors.white : _green,
                          ),
                        ),
                        SizedBox(width: 10.w),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Index #${_field(idxMap, 'indexNo')} · ${_field(idxMap, 'centerName')}',
                                style: TextStyle(
                                  fontSize: 12.sp,
                                  fontWeight: FontWeight.w800,
                                  color: _darkText,
                                ),
                              ),
                              SizedBox(height: 2.h),
                              Text(
                                '${idxMap['totalLoans'] ?? 0} loans · Date: ${_field(idxMap, 'indexDate')}',
                                style: TextStyle(
                                  fontSize: 10.5.sp,
                                  color: _muted,
                                ),
                              ),
                            ],
                          ),
                        ),
                        Text(
                          _currency(_amount(idxMap, 'totalAmount')),
                          style: TextStyle(
                            fontSize: 12.sp,
                            fontWeight: FontWeight.w800,
                            color: _green,
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              },
            );
          }),
        ],
      ),
    );
  }

  void _confirmAndDisburse() {
    Get.defaultDialog(
      title: 'Confirm Final Disbursement',
      titleStyle: TextStyle(fontSize: 14.sp, fontWeight: FontWeight.w800),
      content: Padding(
        padding: EdgeInsets.symmetric(horizontal: 10.w),
        child: Column(
          children: [
            Text(
              'Are you sure you want to disburse ${controller.selectedLoans.length} loan(s)?',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 11.5.sp),
            ),
            SizedBox(height: 6.h),
            Text(
              'Net Payable: ${_currency(controller.netDisbursementAmount)}\n'
              'First Due Date: ${controller.commonFirstDueDate ?? "N/A"}',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 11.sp,
                fontWeight: FontWeight.w700,
                color: _green,
              ),
            ),
          ],
        ),
      ),
      textConfirm: 'Disburse',
      textCancel: 'Cancel',
      confirmTextColor: Colors.white,
      buttonColor: _green,
      onConfirm: () async {
        Get.back();
        await controller.disburse();
      },
    );
  }
}
