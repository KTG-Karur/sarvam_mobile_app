import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:sarvam/controller/renewal_loan_controller.dart';
import 'package:sarvam/view/FDO/new_member_create/widgets/enrollment_field_widgets.dart';

/// Wizard step 3 — loan purpose (type → purpose cascade) plus a read-only
/// summary of the document charges / insurance fee computed in step 2.
class PurposeChargesStep extends StatelessWidget {
  const PurposeChargesStep({super.key, required this.controller});

  final RenewalLoanController controller;

  List<String> get _purposeTypeOptions => controller.purposeTypes
      .whereType<Map>()
      .map((t) => t['id']?.toString())
      .whereType<String>()
      .toList();

  String _purposeTypeLabel(String id) {
    final match = controller.purposeTypes.firstWhere(
      (t) => t is Map && t['id']?.toString() == id,
      orElse: () => null,
    );
    return match is Map ? '${match['name']}' : id;
  }

  List<String> get _purposeOptions => controller.purposesForType
      .whereType<Map>()
      .map((p) => p['id']?.toString())
      .whereType<String>()
      .toList();

  String _purposeLabel(String id) {
    final match = controller.purposesForType.firstWhere(
      (p) => p is Map && p['id']?.toString() == id,
      orElse: () => null,
    );
    return match is Map ? '${match['name']}' : id;
  }

  @override
  Widget build(BuildContext context) => Obx(() {
    final typeSelected = controller.purposeTypeId.value != null;
    final purposes = controller.purposesForType;

    return Column(
      children: [
        EnrollmentSectionShell(
          title: 'Loan Purpose',
          subtitle: 'Why this member is renewing their loan.',
          icon: Icons.category_outlined,
          children: [
            EnrollmentSelectField(
              label: 'Purpose Type',
              value: controller.purposeTypeId.value,
              options: _purposeTypeOptions,
              labelBuilder: _purposeTypeLabel,
              onChanged: (v) => controller.onPurposeTypeChanged(v),
              required: true,
            ),
            EnrollmentSelectField(
              label: 'Loan Purpose',
              value: controller.purposeId.value,
              options: _purposeOptions,
              labelBuilder: _purposeLabel,
              onChanged: (v) => controller.purposeId.value = v,
              required: true,
              enabled: typeSelected,
            ),
            if (typeSelected && purposes.isEmpty)
              Padding(
                padding: EdgeInsets.only(bottom: 13.h, top: -6.h),
                child: Text(
                  'No purposes available for the selected type.',
                  style: TextStyle(fontSize: 10.5.sp, color: const Color(0xFFB45309)),
                ),
              ),
          ],
        ),
        SizedBox(height: 16.h),
        EnrollmentSectionShell(
          title: 'Charges',
          subtitle: 'Auto-calculated from the selected product and amount.',
          icon: Icons.receipt_long_outlined,
          children: [
            Row(
              children: [
                Expanded(
                  child: EnrollmentTextField(
                    label: 'Document Charges (1%)',
                    hint: 'Auto-calculated',
                    controller: controller.documentChargesCtrl,
                    readOnly: true,
                    icon: Icons.currency_rupee,
                  ),
                ),
                SizedBox(width: 10.w),
                Expanded(
                  child: EnrollmentTextField(
                    label: 'Insurance Fee',
                    hint: 'From product',
                    controller: controller.insuranceFeeCtrl,
                    readOnly: true,
                    icon: Icons.currency_rupee,
                  ),
                ),
              ],
            ),
          ],
        ),
      ],
    );
  });
}
