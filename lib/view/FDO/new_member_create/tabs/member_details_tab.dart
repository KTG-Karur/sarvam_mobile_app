import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:get/get.dart';
import 'package:sarvam/controller/client_enrollment/enrollment_options.dart';
import 'package:sarvam/controller/client_enrollment_controller.dart';
import 'package:sarvam/view/FDO/new_member_create/widgets/enrollment_field_widgets.dart';

class MemberDetailsTab extends StatelessWidget {
  const MemberDetailsTab({super.key, required this.controller});

  final ClientEnrollmentController controller;

  @override
  Widget build(BuildContext context) => Obx(
    () => EnrollmentSectionShell(
      title: 'Member Details',
      subtitle: 'Primary identity and contact details',
      icon: Icons.shield_outlined,
      children: [
        EnrollmentTextField(
          label: 'Phone Number',
          hint: 'Enter 10-digit mobile number',
          controller: controller.mobileNumberCtrl,
          focusNode: controller.mobileNumberFocus,
          required: controller.isRequired('mobileNumber', defaultValue: true),
          icon: Icons.phone_outlined,
          keyboardType: TextInputType.phone,
          maxLength: 10,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          errorText: controller.mobileNumberError.value,
        ),
        EnrollmentTextField(
          label: 'Aadhaar Number',
          hint: '12-digit Aadhaar number',
          controller: controller.otherIdNoCtrl,
          focusNode: controller.otherIdNoFocus,
          required: controller.isRequired('otherIdNo'),
          keyboardType: TextInputType.number,
          maxLength: 12,
        ),
        EnrollmentTextField(
          label: 'First Name',
          hint: 'Enter first name',
          controller: controller.clientNameCtrl,
          required: controller.isRequired('clientName', defaultValue: true),
        ),
        EnrollmentTextField(
          label: 'Last Name',
          hint: 'Enter last name',
          controller: controller.lastNameCtrl,
          required: controller.isRequired('lastName'),
        ),
        EnrollmentTextField(
          label: 'PAN Card Number',
          hint: 'ABCDE1234F',
          controller: controller.pancardNoCtrl,
          focusNode: controller.pancardNoFocus,
          required: controller.isRequired('pancardNo'),
          maxLength: 10,
          errorText: controller.pancardNoError.value,
        ),
        EnrollmentTextField(
          label: 'Voter ID Number',
          hint: 'ABC1234567',
          controller: controller.votersIdNoCtrl,
          focusNode: controller.votersIdNoFocus,
          required: controller.isRequired('votersIdNo'),
          maxLength: 30,
          errorText: controller.votersIdNoError.value,
        ),
        EnrollmentDateField(
          label: 'Date of Birth',
          controller: controller.dobCtrl,
          required: controller.isRequired('dateOfBirth'),
          lastDate: DateTime.now(),
        ),
        EnrollmentTextField(
          label: "Father Name",
          hint: "Enter father's name",
          controller: controller.fatherNameCtrl,
          required: controller.isRequired('fatherName'),
        ),
        EnrollmentSelectField(
          label: 'Gender',
          value: controller.gender.value,
          options: EnrollmentOptions.genders,
          onChanged: (v) => controller.gender.value = v,
          required: controller.isRequired('gender'),
        ),
        EnrollmentTextField(
          label: 'Permanent Address',
          hint: 'Enter permanent address',
          controller: controller.permanentAddressCtrl,
          required: controller.isRequired('permanentAddress'),
          icon: Icons.location_on_outlined,
        ),
        Obx(
          () => Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              EnrollmentTextField(
                label: 'Pincode',
                hint: '6-digit pincode',
                controller: controller.pincodeCtrl,
                required: controller.isRequired('pincode'),
                keyboardType: TextInputType.number,
                maxLength: 6,
              ),
              if (controller.isFetchingPincode.value)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Row(
                    children: const [
                      SizedBox(
                        width: 12,
                        height: 12,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                      SizedBox(width: 6),
                      Text(
                        'Fetching location...',
                        style: TextStyle(fontSize: 11, color: enrollmentGreen),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
        EnrollmentTextField(
          label: 'Post Office',
          hint: 'Enter post office',
          controller: controller.postOfficeCtrl,
          required: controller.isRequired('postOffice'),
        ),
        EnrollmentTextField(
          label: 'State',
          hint: 'Enter state',
          controller: controller.stateCtrl,
          required: controller.isRequired('state'),
        ),
        EnrollmentTextField(
          label: 'City',
          hint: 'Enter city',
          controller: controller.districtCtrl,
          required: controller.isRequired('district'),
        ),
        EnrollmentTextField(
          label: 'Country',
          hint: 'India',
          controller: controller.countryCtrl,
          required: controller.isRequired('country'),
        ),
      ],
    ),
  );
}
