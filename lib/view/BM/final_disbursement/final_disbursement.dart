import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:sarvam/controller/final_disbursement_controller.dart';
import 'package:sarvam/view/BM/group_assignment/widgets/id_dropdown.dart';

const _green = Color(0xFF0D6842);
const _darkText = Color(0xFF172033);
const _muted = Color(0xFF64748B);

/// BM "Final Disbursement" — mirrors the core flow of the web app's
/// `components/loan-module/FinalDisbursementClient.tsx`: select a funder,
/// pick an AM-approved index, set attendance per loan, and disburse.
/// Gold-loan detail capture, admission-fee editing and the Member-Individual
/// refresh-status button stay web-only for now.
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
                style: TextStyle(fontSize: 11.5.sp, fontWeight: FontWeight.w700, color: _darkText),
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
              value: controller.isLoadingIndexes.value ? '...' : _currency(amountValue),
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
                      style: TextStyle(fontSize: 8.5.sp, color: _muted, fontWeight: FontWeight.w700),
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
                Obx(() => Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      'NET PAYABLE',
                      style: TextStyle(fontSize: 8.5.sp, color: _green, fontWeight: FontWeight.w800),
                    ),
                    Text(
                      _currency(controller.netDisbursementAmount),
                      style: TextStyle(
                        fontSize: 14.sp,
                        fontWeight: FontWeight.w800,
                        color: _green,
                      ),
                    ),
                  ],
                )),
              ],
            ),
            Divider(height: 14.h, color: const Color(0xFFC6E7D2)),
            Obx(() => Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Gross Loans: ${_currency(controller.totalLoanAmount)}',
                  style: TextStyle(fontSize: 10.5.sp, fontWeight: FontWeight.w600, color: _darkText),
                ),
                Text(
                  'Admission Fees: -${_currency(controller.totalAdmissionFee)}',
                  style: TextStyle(fontSize: 10.5.sp, fontWeight: FontWeight.w700, color: const Color(0xFFB91C1C)),
                ),
              ],
            )),
          ],
        ),
      ),
      SizedBox(height: 10.h),
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
      ...((idx['loans'] as List? ?? []))
          .map((l) => _loanAttendanceRow(Map<String, dynamic>.from(l)))
          ,
      SizedBox(height: 10.h),
      Obx(() {
        if (controller.canConfirmDisburse) return const SizedBox.shrink();
        final hints = <String>[];
        if (!controller.firstDueDateValid) {
          hints.add('All loans must have a First Due Date set on the Loan Index page.');
        }
        if (!controller.allAttendanceSet) {
          hints.add('Attendance must be set for all ${controller.selectedLoans.length} loan(s).');
        }
        if (controller.funderId.value == null) {
          hints.add('Select a funder above.');
        }
        return Container(
          width: double.infinity,
          padding: EdgeInsets.all(10.w),
          decoration: BoxDecoration(
            color: const Color(0xFFFFF8E1),
            borderRadius: BorderRadius.circular(10.r),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Before disbursing, please ensure:',
                style: TextStyle(
                  fontSize: 10.5.sp,
                  fontWeight: FontWeight.w700,
                  color: const Color(0xFF9A6B00),
                ),
              ),
              SizedBox(height: 4.h),
              ...hints.map(
                (h) => Padding(
                  padding: EdgeInsets.only(top: 2.h),
                  child: Text(
                    '• $h',
                    style: TextStyle(fontSize: 10.sp, color: const Color(0xFF9A6B00)),
                  ),
                ),
              ),
            ],
          ),
        );
      }),
      SizedBox(height: 12.h),
      Obx(
        () => SizedBox(
          width: double.infinity,
          child: ElevatedButton.icon(
            onPressed: controller.canConfirmDisburse ? () => _confirmAndDisburse() : null,
            style: ElevatedButton.styleFrom(
              backgroundColor: _green,
              foregroundColor: Colors.white,
              disabledBackgroundColor: const Color(0xFFA8D5BC),
              padding: EdgeInsets.symmetric(vertical: 13.h),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10.r)),
            ),
            icon: controller.isSubmitting.value
                ? SizedBox(
                    width: 16.sp,
                    height: 16.sp,
                    child: const CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
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
    return Obx(() {
      final status = controller.attendanceMap[loanId];
      final fee = controller.admissionFeeMap[loanId] ?? 0.0;
      final selectedFunder = controller.memberFunderMap[loanId] ?? controller.funderId.value;
      final isCustomFunder = controller.funderOverrides.contains(loanId);

      final grossAmount = _amount(loan, 'amount');
      final netAmount = (grossAmount - fee) < 0 ? 0.0 : (grossAmount - fee);

      return Container(
        margin: EdgeInsets.only(bottom: 8.h),
        padding: EdgeInsets.all(10.w),
        decoration: BoxDecoration(
          color: status == null ? const Color(0xFFFFF3F3) : Colors.white,
          border: Border.all(
            color: status == null ? Colors.red.withValues(alpha: 0.3) : const Color(0xFFE1EAE4),
          ),
          borderRadius: BorderRadius.circular(10.r),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
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
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      'Net: ${_currency(netAmount)}',
                      style: TextStyle(fontSize: 12.sp, fontWeight: FontWeight.w800, color: _green),
                    ),
                    Text(
                      'Gross: ${_currency(grossAmount)}',
                      style: TextStyle(fontSize: 9.5.sp, color: _muted),
                    ),
                  ],
                ),
              ],
            ),
            SizedBox(height: 8.h),
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Admission Fee (₹)',
                        style: TextStyle(fontSize: 10.sp, fontWeight: FontWeight.w700, color: _muted),
                      ),
                      SizedBox(height: 4.h),
                      TextFormField(
                        initialValue: fee > 0 ? fee.toStringAsFixed(0) : '0',
                        keyboardType: TextInputType.number,
                        style: TextStyle(fontSize: 11.sp, fontWeight: FontWeight.w700),
                        decoration: InputDecoration(
                          isDense: true,
                          prefixText: '₹ ',
                          contentPadding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 8.h),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(6.r),
                            borderSide: const BorderSide(color: Color(0xFFCBD5E1)),
                          ),
                        ),
                        onChanged: (v) => controller.setAdmissionFee(loanId, double.tryParse(v) ?? 0.0),
                      ),
                    ],
                  ),
                ),
                SizedBox(width: 8.w),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            'Fund Allocation',
                            style: TextStyle(fontSize: 10.sp, fontWeight: FontWeight.w700, color: _muted),
                          ),
                          if (isCustomFunder)
                            Container(
                              padding: EdgeInsets.symmetric(horizontal: 4.w, vertical: 1.h),
                              decoration: BoxDecoration(
                                color: const Color(0xFFF3E8FF),
                                borderRadius: BorderRadius.circular(3.r),
                              ),
                              child: Text(
                                'Custom',
                                style: TextStyle(fontSize: 8.sp, fontWeight: FontWeight.w800, color: const Color(0xFF7E22CE)),
                              ),
                            ),
                        ],
                      ),
                      SizedBox(height: 4.h),
                      IdDropdown(
                        label: 'Fund Allocation',
                        value: selectedFunder,
                        items: controller.funders,
                        labelBuilder: _funderLabel,
                        onChanged: (v) {
                          if (v != null) controller.setMemberFunder(loanId, v);
                        },
                      ),
                    ],
                  ),
                ),
              ],
            ),
            SizedBox(height: 10.h),
            Row(
              children: [
                Expanded(
                  child: _attendanceChip(
                    label: 'Present',
                    icon: Icons.check_circle_rounded,
                    color: _green,
                    selected: status == 'PRESENT',
                    onTap: () => controller.setAttendance(loanId, 'PRESENT'),
                  ),
                ),
                SizedBox(width: 8.w),
                Expanded(
                  child: _attendanceChip(
                    label: 'Absent',
                    icon: Icons.cancel_rounded,
                    color: const Color(0xFF92400E),
                    selected: status == 'ABSENT',
                    onTap: () => controller.setAttendance(loanId, 'ABSENT'),
                  ),
                ),
              ],
            ),
          ],
        ),
      );
    });
  }

  Widget _attendanceChip({
    required String label,
    required IconData icon,
    required Color color,
    required bool selected,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8.r),
      child: Container(
        padding: EdgeInsets.symmetric(vertical: 8.h),
        decoration: BoxDecoration(
          color: selected ? color : Colors.white,
          border: Border.all(color: color),
          borderRadius: BorderRadius.circular(8.r),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 14.sp, color: selected ? Colors.white : color),
            SizedBox(width: 4.w),
            Text(
              label,
              style: TextStyle(
                fontSize: 11.sp,
                fontWeight: FontWeight.w700,
                color: selected ? Colors.white : color,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildApprovedIndexesList() {
    return Obx(() {
      final indexes = controller.approvedIndexes;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Approved Indexes',
                style: TextStyle(fontSize: 14.sp, fontWeight: FontWeight.w800, color: _darkText),
              ),
              if (indexes.isNotEmpty)
                Container(
                  padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 3.h),
                  decoration: BoxDecoration(
                    color: const Color(0xFFE6F5EC),
                    borderRadius: BorderRadius.circular(20.r),
                  ),
                  child: Text(
                    '${indexes.length} Index(es)',
                    style: TextStyle(fontSize: 9.5.sp, fontWeight: FontWeight.w700, color: _green),
                  ),
                ),
            ],
          ),
          SizedBox(height: 10.h),
          if (controller.isLoadingIndexes.value)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Center(child: CircularProgressIndicator(color: _green)),
            )
          else if (indexes.isEmpty)
            _emptyState('No loans are awaiting final disbursement for this branch.')
          else
            ListView.separated(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: indexes.length,
              separatorBuilder: (_, __) => SizedBox(height: 8.h),
              itemBuilder: (_, i) => _indexRow(Map<String, dynamic>.from(indexes[i])),
            ),
        ],
      );
    });
  }

  Widget _indexRow(Map<String, dynamic> idx) {
    return Obx(() {
      final isSelected = controller.selectedIndex.value?['id'] == idx['id'];
      final hasFunder = controller.funderId.value != null;
      return Container(
        padding: EdgeInsets.all(12.w),
        decoration: BoxDecoration(
          color: isSelected ? const Color(0xFFE8F7EE) : Colors.white,
          border: Border.all(
            color: isSelected ? _green.withValues(alpha: 0.4) : const Color(0xFFE1EAE4),
          ),
          borderRadius: BorderRadius.circular(12.r),
        ),
        child: Row(
          children: [
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
            SizedBox(width: 8.w),
            OutlinedButton.icon(
              onPressed: (!hasFunder || isSelected) ? null : () => controller.selectIndex(idx),
              style: OutlinedButton.styleFrom(
                foregroundColor: isSelected ? _green : Colors.white,
                backgroundColor: isSelected ? Colors.white : _green,
                side: BorderSide(color: _green),
                padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 8.h),
              ),
              icon: Icon(
                isSelected ? Icons.check_circle_rounded : Icons.send_rounded,
                size: 14.sp,
              ),
              label: Text(
                isSelected ? 'Selected' : 'Select',
                style: TextStyle(fontSize: 10.5.sp),
              ),
            ),
          ],
        ),
      );
    });
  }

  Future<void> _confirmAndDisburse() async {
    final count = controller.selectedLoans.length;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Disburse Loans'),
        content: Text(
          'You are disbursing $count loan(s). This generates repayment schedules '
          'and posts GL entries — this cannot be undone from here.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: _green),
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Disburse'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await controller.disburse();
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
