import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:sarvam/controller/client_enrollment/enrollment_options.dart';
import 'package:sarvam/controller/client_enrollment_controller.dart';
import 'package:sarvam/view/FDO/new_member_create/widgets/enrollment_field_widgets.dart';

class LoanDetailsTab extends StatelessWidget {
  const LoanDetailsTab({super.key, required this.controller});

  final ClientEnrollmentController controller;

  @override
  Widget build(BuildContext context) => Obx(() {
    final product = controller.selectedProduct.value;
    final numberOfDues = product?['numberOfDues'] is int ? product!['numberOfDues'] as int : null;
    final tenure = numberOfDues != null
        ? controller.computeTenureMonths(numberOfDues, controller.requestedLoanFrequency.value)
        : null;

    return Column(
      children: [
        EnrollmentSectionShell(
          title: 'Member Group Status',
          subtitle: 'Where this member will be enrolled.',
          icon: Icons.groups_2_outlined,
          children: [
            EnrollmentSelectField(
              label: 'Group Status',
              value: controller.memberGroupStatus.value,
              options: EnrollmentOptions.memberGroupStatuses,
              onChanged: controller.onMemberGroupStatusChanged,
              required: true,
              labelBuilder: (v) => v == 'NEW_CENTER_NEW_MEMBER'
                  ? 'New Center, New Member'
                  : 'Existing Center, New Member',
            ),
            EnrollmentSelectField(
              label: 'Center',
              value: controller.requestedCenterId.value,
              options: enrollmentIdOptions(controller.filteredCenters),
              labelBuilder: enrollmentIdLabelBuilder(controller.filteredCenters),
              onChanged: controller.onCenterChanged,
              required: true,
              enabled: controller.memberGroupStatus.value != null,
            ),
            EnrollmentSelectField(
              label: 'Requested Group',
              value: controller.requestedGroupId.value,
              options: enrollmentIdOptions(controller.filteredGroups),
              labelBuilder: enrollmentIdLabelBuilder(controller.filteredGroups),
              onChanged: (v) => controller.requestedGroupId.value = v,
              required: true,
              enabled: controller.requestedCenterId.value != null,
            ),
          ],
        ),
        SizedBox(height: 16.h),
        EnrollmentSectionShell(
          title: 'Loan Details',
          subtitle: 'Requested loan product for this member.',
          icon: Icons.credit_card_outlined,
          children: [
            EnrollmentSelectField(
              label: 'Product Type',
              value: controller.requestedLoanProductTypeId.value,
              options: enrollmentIdOptions(controller.loanProductTypes),
              labelBuilder: enrollmentIdLabelBuilder(controller.loanProductTypes),
              onChanged: controller.onLoanProductTypeChanged,
              required: controller.isRequired('requestedLoanProductTypeId'),
            ),
            EnrollmentSelectField(
              label: 'Frequency',
              value: controller.requestedLoanFrequency.value,
              options: EnrollmentOptions.loanFrequencies,
              onChanged: (v) => controller.requestedLoanFrequency.value = v ?? 'weekly',
              required: true,
              labelBuilder: (v) => v[0].toUpperCase() + v.substring(1),
            ),
            EnrollmentSelectField(
              label: 'Loan Product',
              value: controller.requestedLoanProductId.value,
              options: enrollmentIdOptions(controller.filteredProducts),
              labelBuilder: enrollmentIdLabelBuilder(controller.filteredProducts),
              onChanged: controller.onLoanProductSelected,
              required: controller.isRequired('requestedLoanProductId'),
              enabled: controller.requestedLoanProductTypeId.value != null,
            ),
            EnrollmentTextField(
              label: 'Loan Amount',
              hint: 'Auto-filled from product',
              controller: TextEditingController(
                text: product?['loanAmount'] != null ? '₹ ${product!['loanAmount']}' : '',
              ),
              readOnly: true,
            ),
            EnrollmentSelectField(
              label: 'Purpose Type',
              value: controller.requestedLoanPurposeTypeId.value,
              options: enrollmentIdOptions(controller.loanPurposeTypes),
              labelBuilder: enrollmentIdLabelBuilder(controller.loanPurposeTypes),
              onChanged: controller.onLoanPurposeTypeChanged,
              required: controller.isRequired('requestedLoanPurposeTypeId'),
            ),
            EnrollmentSelectField(
              label: 'Loan Purpose',
              value: controller.requestedLoanPurposeId.value,
              options: enrollmentIdOptions(controller.loanPurposesForType),
              labelBuilder: enrollmentIdLabelBuilder(controller.loanPurposesForType),
              onChanged: (v) => controller.requestedLoanPurposeId.value = v,
              required: controller.isRequired('requestedLoanPurposeId'),
              enabled: controller.requestedLoanPurposeTypeId.value != null,
            ),
            Row(
              children: [
                Expanded(
                  child: EnrollmentTextField(
                    label: 'Insurance Rate',
                    hint: '',
                    controller: TextEditingController(text: '2%'),
                    readOnly: true,
                  ),
                ),
                SizedBox(width: 10.w),
                Expanded(
                  child: EnrollmentTextField(
                    label: 'Insurance Fee',
                    hint: 'Auto-filled from product',
                    controller: TextEditingController(
                      text: product?['insuranceFees'] != null
                          ? '₹ ${product!['insuranceFees']}'
                          : '',
                    ),
                    readOnly: true,
                  ),
                ),
              ],
            ),
            Row(
              children: [
                Expanded(
                  child: EnrollmentTextField(
                    label: 'Tenure',
                    hint: 'Auto-filled from product',
                    controller: TextEditingController(
                      text: numberOfDues != null ? '$numberOfDues dues ($tenure mo)' : '',
                    ),
                    readOnly: true,
                  ),
                ),
                SizedBox(width: 10.w),
                Expanded(
                  child: EnrollmentTextField(
                    label: 'Document Charge',
                    hint: 'Auto-filled from product',
                    controller: TextEditingController(
                      text: product?['documentCharges'] != null
                          ? '₹ ${product!['documentCharges']}'
                          : '',
                    ),
                    readOnly: true,
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
