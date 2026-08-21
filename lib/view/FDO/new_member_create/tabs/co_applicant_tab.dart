import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:sarvam/controller/client_enrollment/enrollment_lookups.dart';
import 'package:sarvam/controller/client_enrollment/enrollment_options.dart';
import 'package:sarvam/controller/client_enrollment_controller.dart';
import 'package:sarvam/view/FDO/new_member_create/widgets/enrollment_field_widgets.dart';

class CoApplicantTab extends StatelessWidget {
  const CoApplicantTab({super.key, required this.controller});

  final ClientEnrollmentController controller;

  @override
  Widget build(BuildContext context) => Obx(() {
    final locked = controller.coApplicantFieldsLockedFromSpouse.value;
    return EnrollmentSectionShell(
      title: 'Co-Applicant Details',
      subtitle: 'Enter co-applicant details for this enrollment.',
      icon: Icons.group_outlined,
      children: [
        if (locked)
          Container(
            width: double.infinity,
            margin: const EdgeInsets.only(bottom: 16),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFFF3FCF6),
              border: Border.all(color: const Color(0xFF9CD9B3)),
              borderRadius: BorderRadius.circular(9),
            ),
            child: const Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.info_outline, size: 17, color: enrollmentGreen),
                SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Auto-filled from Spouse details on the Other Details tab.',
                    style: TextStyle(fontSize: 12, color: Color(0xFF164A2E)),
                  ),
                ),
              ],
            ),
          ),
        EnrollmentSelectField(
          label: 'Relation With Member',
          value: controller.nomineeRelation.value,
          options: EnrollmentOptions.nomineeRelations,
          onChanged: controller.onNomineeRelationChanged,
          required: controller.isRequired('nomineeRelation'),
        ),
        EnrollmentTextField(
          label: 'Co-Applicant Name',
          hint: 'Enter co-applicant name',
          controller: controller.nomineeNameCtrl,
          required: controller.isRequired('nomineeName', defaultValue: true),
          readOnly: locked,
        ),
        EnrollmentTextField(
          label: 'Phone Number',
          hint: '10-digit mobile number',
          controller: controller.nomineePhoneNumberCtrl,
          focusNode: controller.nomineePhoneNumberFocus,
          required: controller.isRequired('nomineePhoneNumber'),
          icon: Icons.phone_outlined,
          keyboardType: TextInputType.phone,
          maxLength: 10,
          readOnly: locked,
          errorText: controller.nomineePhoneNumberError.value,
        ),
        EnrollmentSelectField(
          label: 'Gender',
          value: controller.nomineeGender.value,
          options: EnrollmentOptions.genders,
          onChanged: locked
              ? (_) {}
              : (v) => controller.nomineeGender.value = v,
          required: controller.isRequired('nomineeGender'),
          enabled: !locked,
        ),
        EnrollmentDateField(
          label: 'Date of Birth',
          controller: controller.nomineeDateOfBirthCtrl,
          required: controller.isRequired('nomineeDateOfBirth'),
          lastDate: DateTime.now(),
        ),
        EnrollmentTextField(
          label: 'Age',
          hint: 'Auto-calculated',
          controller: controller.nomineeAgeCtrl,
          readOnly: true,
        ),
        EnrollmentSelectField(
          label: 'Co-Applicant Economic Activity Type',
          value: controller.coApplicantEconomicActivityTypeId.value,
          options: enrollmentIdOptions(controller.economicActivityTypes),
          labelBuilder: enrollmentIdLabelBuilder(
            controller.economicActivityTypes,
          ),
          onChanged: locked
              ? (_) {}
              : (v) => controller.onEconomicActivityTypeChanged(
                  v,
                  scope: EaScope.coApplicant,
                ),
          required: controller.isRequired('coApplicantEconomicActivityTypeId'),
          enabled: !locked,
        ),
        EnrollmentSelectField(
          label: 'Co-Applicant Economic Activity',
          value: controller.coApplicantEconomicActivityId.value,
          options: enrollmentIdOptions(
            controller.coApplicantEconomicActivitiesForType,
          ),
          labelBuilder: enrollmentIdLabelBuilder(
            controller.coApplicantEconomicActivitiesForType,
          ),
          onChanged: locked
              ? (_) {}
              : (v) => controller.coApplicantEconomicActivityId.value = v,
          required: controller.isRequired('coApplicantEconomicActivityId'),
          enabled:
              !locked &&
              controller.coApplicantEconomicActivityTypeId.value != null,
        ),
        EnrollmentTextField(
          label: 'Co-Applicant PAN Card Number',
          hint: 'ABCDE1234F',
          controller: controller.caPancardNoCtrl,
          focusNode: controller.caPancardNoFocus,
          required: controller.isRequired('caPancardNo'),
          maxLength: 10,
          readOnly: locked,
          errorText: controller.caPancardNoError.value,
        ),
        EnrollmentTextField(
          label: 'Co-Applicant Voter ID Number',
          hint: 'ABC1234567',
          controller: controller.caVoterIdNoCtrl,
          focusNode: controller.caVoterIdNoFocus,
          required: controller.isRequired('caVoterIdNo'),
          maxLength: 30,
          readOnly: locked,
          errorText: controller.caVoterIdNoError.value,
        ),
        EnrollmentTextField(
          label: 'Co-Applicant Aadhaar Number',
          hint: '12-digit Aadhaar number',
          controller: controller.caOtherIdNoCtrl,
          focusNode: controller.caOtherIdNoFocus,
          required: controller.isRequired('caOtherIdNo'),
          keyboardType: TextInputType.number,
          maxLength: 12,
          readOnly: locked,
          errorText: controller.caOtherIdNoError.value,
        ),
      ],
    );
  });
}
