import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:sarvam/controller/renewal_loan_controller.dart';
import 'package:sarvam/view/FDO/new_member_create/widgets/enrollment_field_widgets.dart';

/// Wizard step 4 — read-only summary of every prior step, plus the center's
/// unindexed loans (with delete) so an FDO can clear a stuck application
/// before submitting a renewal — mirrors the web app's "Unindexed Loans"
/// table in `ApplicationForm.tsx`.
class ReviewSubmitStep extends StatelessWidget {
  const ReviewSubmitStep({super.key, required this.controller});

  final RenewalLoanController controller;

  String? _lookupName(List<dynamic> list, String? id, {String field = 'name'}) {
    if (id == null) return null;
    final match = list.firstWhere(
      (e) => e is Map && '${e['id']}' == id,
      orElse: () => null,
    );
    return match is Map ? match[field]?.toString() : null;
  }

  @override
  Widget build(BuildContext context) => Obx(() {
    final center = controller.centers.firstWhere(
      (c) => c is Map && '${c['id']}' == controller.centerId.value,
      orElse: () => null,
    );
    final client = controller.eligibleClients.firstWhere(
      (c) => c is Map && '${c['id']}' == controller.clientId.value,
      orElse: () => null,
    );
    final clientName = client is Map
        ? [client['firstName'], client['lastName']]
              .where((n) => n != null && '$n'.isNotEmpty)
              .join(' ')
        : null;
    final coApplicantName = _lookupName(
      controller.eligibleCoApplicants,
      controller.coApplicantId.value,
    );
    final productTypeName = _lookupName(
      controller.loanProductTypes,
      controller.productTypeId.value,
    );
    final productName = _lookupName(
      controller.filteredProducts,
      controller.productId.value,
      field: 'productName',
    );
    final purposeTypeName = _lookupName(
      controller.purposeTypes,
      controller.purposeTypeId.value,
    );
    final purposeName = _lookupName(
      controller.purposesForType,
      controller.purposeId.value,
    );

    return Column(
      children: [
        EnrollmentSectionShell(
          title: 'Review & Submit',
          subtitle: 'Confirm the details before creating the renewal loan application.',
          icon: Icons.fact_check_outlined,
          children: [
            _row('Center', center is Map ? '${center['code']} - ${center['name']}' : '—'),
            _row(
              'Member',
              client is Map ? '${client['clientId']} - ${clientName?.isNotEmpty == true ? clientName : client['clientId']}' : '—',
            ),
            if (coApplicantName != null) _row('Co-Applicant', coApplicantName),
            _divider(),
            _row('Product Type', productTypeName ?? '—'),
            _row('Loan Product', productName ?? '—'),
            _row('Frequency', 'Weekly'),
            _row('Loan Amount', '₹${controller.amountCtrl.text}'),
            _row('Interest Rate', '${controller.interestRateCtrl.text}%'),
            _row('Tenure', '${controller.tenureCtrl.text} months'),
            _divider(),
            _row('Purpose Type', purposeTypeName ?? '—'),
            _row('Loan Purpose', purposeName ?? '—'),
            _row('Document Charges', '₹${controller.documentChargesCtrl.text}'),
            _row('Insurance Fee', '₹${controller.insuranceFeeCtrl.text}'),
          ],
        ),
        if (controller.unindexedLoans.isNotEmpty) ...[
          SizedBox(height: 16.h),
          EnrollmentSectionShell(
            title: 'Unindexed Loans (${controller.unindexedLoans.length})',
            subtitle: 'Existing loans in this center still awaiting indexation.',
            icon: Icons.warning_amber_rounded,
            children: [
              if (controller.isLoadingLoans.value)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 12),
                  child: Center(child: CircularProgressIndicator(color: enrollmentGreen)),
                )
              else
                ...controller.unindexedLoans.map((raw) => _unindexedLoanCard(context, raw)),
            ],
          ),
        ],
      ],
    );
  });

  Widget _row(String label, String value) => Padding(
    padding: EdgeInsets.only(bottom: 10.h),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 130.w,
          child: Text(
            label,
            style: TextStyle(fontSize: 11.5.sp, color: enrollmentHelperColor),
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: TextStyle(
              fontSize: 12.5.sp,
              fontWeight: FontWeight.w700,
              color: enrollmentDarkText,
            ),
          ),
        ),
      ],
    ),
  );

  Widget _divider() => Padding(
    padding: EdgeInsets.symmetric(vertical: 4.h),
    child: const Divider(color: Color(0xFFDCEEE2), height: 1),
  );

  Widget _unindexedLoanCard(BuildContext context, dynamic raw) {
    final loan = raw as Map;
    final loanId = '${loan['id']}';
    final isApproved = loan['disbursementStatus'] == 'APPROVED_LEVEL1';
    return Obx(() {
      final deleting = controller.isDeletingLoanId.value == loanId;
      return Container(
        margin: EdgeInsets.only(bottom: 10.h),
        padding: EdgeInsets.all(12.w),
        decoration: BoxDecoration(
          color: const Color(0xFFFFFBF2),
          borderRadius: BorderRadius.circular(10.r),
          border: Border.all(color: const Color(0xFFFCE3B5)),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          '${loan['loanNumber'] ?? ''}',
                          style: TextStyle(
                            fontSize: 12.5.sp,
                            fontWeight: FontWeight.w700,
                            color: enrollmentDarkText,
                          ),
                        ),
                      ),
                      Container(
                        padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 3.h),
                        decoration: BoxDecoration(
                          color: isApproved ? const Color(0xFFDCF3E4) : const Color(0xFFFEF3C7),
                          borderRadius: BorderRadius.circular(20.r),
                        ),
                        child: Text(
                          isApproved ? 'Approved' : 'Pending',
                          style: TextStyle(
                            fontSize: 9.5.sp,
                            fontWeight: FontWeight.w700,
                            color: isApproved ? const Color(0xFF16803C) : const Color(0xFFB45309),
                          ),
                        ),
                      ),
                    ],
                  ),
                  SizedBox(height: 4.h),
                  Text(
                    '${loan['clientName'] ?? ''}  •  ₹${loan['amount'] ?? 0}  •  ${loan['tenureMonths'] ?? 0} months',
                    style: TextStyle(fontSize: 10.5.sp, color: enrollmentHelperColor),
                  ),
                ],
              ),
            ),
            SizedBox(
              width: 34.w,
              height: 34.w,
              child: deleting
                  ? const Padding(
                      padding: EdgeInsets.all(8),
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.redAccent),
                    )
                  : IconButton(
                      onPressed: () => _confirmDelete(context, loanId, '${loan['loanNumber'] ?? ''}'),
                      icon: const Icon(Icons.delete_outline, color: Colors.redAccent, size: 20),
                      tooltip: 'Delete this unindexed loan',
                    ),
            ),
          ],
        ),
      );
    });
  }

  void _confirmDelete(BuildContext context, String loanId, String loanNumber) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Are you sure?'),
        content: Text(
          'This will permanently delete loan $loanNumber. This action cannot be undone.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.redAccent),
            onPressed: () {
              Navigator.pop(ctx);
              controller.deleteUnindexedLoan(loanId);
            },
            child: const Text('Delete'),
          ),
        ],
      ),
    );
  }
}
