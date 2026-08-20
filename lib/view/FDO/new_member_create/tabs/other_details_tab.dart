import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:sarvam/controller/client_enrollment/enrollment_lookups.dart';
import 'package:sarvam/controller/client_enrollment/enrollment_options.dart';
import 'package:sarvam/controller/client_enrollment_controller.dart';
import 'package:sarvam/view/FDO/new_member_create/widgets/enrollment_field_widgets.dart';

class OtherDetailsTab extends StatelessWidget {
  const OtherDetailsTab({super.key, required this.controller});

  final ClientEnrollmentController controller;

  @override
  Widget build(BuildContext context) => Obx(
    () => EnrollmentSectionShell(
      title: 'Member Other Details',
      subtitle: 'Additional personal, financial and bank information.',
      icon: Icons.description_outlined,
      children: [
        EnrollmentTextField(
          label: 'Email',
          hint: 'Enter email',
          controller: controller.emailCtrl,
          required: controller.isRequired('email'),
          keyboardType: TextInputType.emailAddress,
        ),
        EnrollmentTextField(
          label: 'Age',
          hint: 'Auto-calculated from DOB',
          controller: controller.ageCtrl,
          required: controller.isRequired('age'),
          readOnly: true,
        ),
        EnrollmentSelectField(
          label: 'Caste',
          value: controller.caste.value,
          options: EnrollmentOptions.castes,
          onChanged: (v) => controller.caste.value = v,
          required: controller.isRequired('caste'),
        ),
        EnrollmentSelectField(
          label: 'Community',
          value: controller.community.value,
          options: EnrollmentOptions.communities,
          onChanged: (v) => controller.community.value = v,
          required: controller.isRequired('community'),
        ),
        EnrollmentSelectField(
          label: 'Economic Activity Type',
          value: controller.economicActivityTypeId.value,
          options: enrollmentIdOptions(controller.economicActivityTypes),
          labelBuilder: enrollmentIdLabelBuilder(
            controller.economicActivityTypes,
          ),
          onChanged: (v) => controller.onEconomicActivityTypeChanged(
            v,
            scope: EaScope.client,
          ),
          required: controller.isRequired('economicActivityTypeId'),
        ),
        EnrollmentSelectField(
          label: 'Economic Activity',
          value: controller.economicActivityId.value,
          options: enrollmentIdOptions(controller.economicActivitiesForType),
          labelBuilder: enrollmentIdLabelBuilder(
            controller.economicActivitiesForType,
          ),
          onChanged: (v) => controller.economicActivityId.value = v,
          required: controller.isRequired('economicActivityId'),
          enabled: controller.economicActivityTypeId.value != null,
        ),
        EnrollmentSelectField(
          label: 'Religion',
          value: controller.religion.value,
          options: EnrollmentOptions.religions,
          onChanged: (v) => controller.religion.value = v,
          required: controller.isRequired('religion'),
        ),
        EnrollmentSelectField(
          label: 'Qualification',
          value:
              EnrollmentOptions.qualifications
                  .map((q) => q['value']!)
                  .contains(controller.qualification.value)
              ? EnrollmentOptions.qualifications.firstWhere(
                  (q) => q['value'] == controller.qualification.value,
                )['label']
              : null,
          options: EnrollmentOptions.qualifications
              .map((q) => q['label']!)
              .toList(),
          onChanged: (v) {
            final match = EnrollmentOptions.qualifications.where(
              (q) => q['label'] == v,
            );
            controller.qualification.value = match.isEmpty
                ? null
                : match.first['value'];
          },
          required: controller.isRequired('qualification'),
        ),
        EnrollmentSelectField(
          label: 'Marital Status',
          value: controller.maritalStatus.value,
          options: EnrollmentOptions.maritalStatuses,
          onChanged: (v) => controller.maritalStatus.value = v,
          required: controller.isRequired('maritalStatus'),
        ),
        EnrollmentTextField(
          label: 'Spouse Name',
          hint: 'Enter spouse name',
          controller: controller.spouseNameCtrl,
          required: controller.isRequired('spouseName'),
        ),
        EnrollmentDateField(
          label: 'Spouse Date of Birth',
          controller: controller.spouseDobCtrl,
          required: controller.isRequired('spouseDob'),
          lastDate: DateTime.now(),
        ),
        EnrollmentTextField(
          label: 'Spouse Mobile Number',
          hint: 'Enter spouse mobile number',
          controller: controller.spouseMobileNumberCtrl,
          required: controller.isRequired('spouseMobileNumber'),
          keyboardType: TextInputType.phone,
          maxLength: 10,
        ),
        EnrollmentSelectField(
          label: 'Spouse Gender',
          value: controller.spouseGender.value,
          options: EnrollmentOptions.genders,
          onChanged: (v) => controller.spouseGender.value = v,
          required: controller.isRequired('spouseGender'),
        ),
        EnrollmentSelectField(
          label: 'Spouse Economic Activity Type',
          value: controller.spouseEconomicActivityTypeId.value,
          options: enrollmentIdOptions(controller.economicActivityTypes),
          labelBuilder: enrollmentIdLabelBuilder(
            controller.economicActivityTypes,
          ),
          onChanged: (v) => controller.onEconomicActivityTypeChanged(
            v,
            scope: EaScope.spouse,
          ),
          required: controller.isRequired('spouseEconomicActivityTypeId'),
        ),
        EnrollmentSelectField(
          label: 'Spouse Economic Activity',
          value: controller.spouseEconomicActivityId.value,
          options: enrollmentIdOptions(
            controller.spouseEconomicActivitiesForType,
          ),
          labelBuilder: enrollmentIdLabelBuilder(
            controller.spouseEconomicActivitiesForType,
          ),
          onChanged: (v) => controller.spouseEconomicActivityId.value = v,
          required: controller.isRequired('spouseEconomicActivityId'),
          enabled: controller.spouseEconomicActivityTypeId.value != null,
        ),
        EnrollmentTextField(
          label: 'No. of Children',
          hint: 'Enter number of children',
          controller: controller.noOfChildrenCtrl,
          required: controller.isRequired('noOfChildren'),
          keyboardType: TextInputType.number,
        ),
        EnrollmentTextField(
          label: 'Monthly Family Income',
          hint: 'Enter amount',
          controller: controller.monthlyFamilyIncomeCtrl,
          required: controller.isRequired('monthlyFamilyIncome'),
          keyboardType: TextInputType.number,
        ),
        EnrollmentTextField(
          label: 'Monthly Family Expense',
          hint: 'Enter amount',
          controller: controller.monthlyFamilyExpenseCtrl,
          required: controller.isRequired('monthlyFamilyExpense'),
          keyboardType: TextInputType.number,
        ),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            EnrollmentTextField(
              label: 'IFSC Code',
              hint: 'SBIN0001234',
              controller: controller.ifscCodeCtrl,
              required: controller.isRequired('ifscCode'),
              maxLength: 11,
              errorText: controller.ifscCodeError.value,
            ),
            if (controller.isFetchingIfsc.value)
              const Padding(
                padding: EdgeInsets.only(bottom: 8),
                child: Text(
                  'Fetching bank details...',
                  style: TextStyle(fontSize: 11, color: enrollmentGreen),
                ),
              ),
            if (!controller.isFetchingIfsc.value &&
                controller.ifscLookupAddress.value.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  'Bank Address: ${controller.ifscLookupAddress.value}',
                  style: const TextStyle(fontSize: 11, color: enrollmentGreen),
                ),
              ),
          ],
        ),
        EnrollmentTextField(
          label: 'Bank A/c No',
          hint: 'Enter account number',
          controller: controller.bankAcNoCtrl,
          focusNode: controller.bankAcNoFocus,
          required: controller.isRequired('bankAcNo'),
          keyboardType: TextInputType.number,
          obscureText: true,
          enableCopyPaste: false,
          errorText: controller.bankAcNoError.value,
        ),
        EnrollmentTextField(
          label: 'Retype Bank A/c No',
          hint: 'Re-enter account number',
          controller: controller.retypeBankAcNoCtrl,
          required: controller.isRequired('bankAcNo'),
          keyboardType: TextInputType.number,
          obscureText: true,
          enableCopyPaste: false,
          errorText: controller.retypeBankAcNoError.value,
        ),
        EnrollmentTextField(
          label: 'Bank Name',
          hint: 'Enter bank name',
          controller: controller.bankNameCtrl,
          required: controller.isRequired('bankName'),
          readOnly: controller.ifscLocked.value,
        ),
        EnrollmentTextField(
          label: 'Bank Branch',
          hint: 'Enter branch name',
          controller: controller.bankBranchCtrl,
          required: controller.isRequired('bankBranch'),
          readOnly: controller.ifscLocked.value,
        ),
        EnrollmentSelectField(
          label: 'Bank Account Type',
          value: controller.bankAccountType.value,
          options: EnrollmentOptions.bankAccountTypes,
          onChanged: (v) => controller.bankAccountType.value = v,
          required: controller.isRequired('bankAccountType'),
        ),
        EnrollmentSelectField(
          label: 'House Status',
          value: controller.houseStatus.value,
          options: EnrollmentOptions.houseStatuses,
          onChanged: (v) => controller.houseStatus.value = v,
          required: controller.isRequired('houseStatus'),
        ),
        EnrollmentTextField(
          label: 'Mother Name',
          hint: "Enter mother's name",
          controller: controller.motherNameCtrl,
          required: controller.isRequired('motherName'),
        ),
        EnrollmentTextField(
          label: 'Smart Card Number',
          hint: 'Enter smart card number',
          controller: controller.smartCardNoCtrl,
          required: controller.isRequired('smartCardNo'),
        ),
      ],
    ),
  );
}
