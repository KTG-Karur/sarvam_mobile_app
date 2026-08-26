import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:image_picker/image_picker.dart';
import 'package:sarvam/controller/client_enrollment/enrollment_lookups.dart';
import 'package:sarvam/controller/client_enrollment/enrollment_options.dart';
import 'package:sarvam/controller/client_enrollment_controller.dart';
import 'package:sarvam/services/document_scanner_service.dart';
import 'package:sarvam/view/FDO/new_member_create/widgets/enrollment_field_widgets.dart';

class CoApplicantTab extends StatelessWidget {
  const CoApplicantTab({super.key, required this.controller});

  final ClientEnrollmentController controller;

  @override
  Widget build(BuildContext context) => Obx(() {
    final locked = controller.coApplicantFieldsLockedFromSpouse.value;
    // Register Obx dependency on lookup lists so dropdowns update when loaded
    controller.economicActivityTypes.length;
    controller.coApplicantEconomicActivitiesForType.length;
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
          errorText: locked ? null : controller.nomineePhoneNumberError.value,
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
          errorText: controller.caPancardNoError.value,
          suffixIcon: IconButton(
            tooltip: 'Scan Co-Applicant PAN Card',
            icon: const Icon(Icons.qr_code_scanner_rounded, color: enrollmentGreen),
            onPressed: () => _showScanDialog(
              context,
              'Co-Applicant PAN Card',
              controller.caPancardNoCtrl,
              scanType: DocumentScanType.panCard,
              isNumeric: false,
              maxLen: 10,
            ),
          ),
        ),
        EnrollmentTextField(
          label: 'Co-Applicant Voter ID Number',
          hint: 'ABC1234567',
          controller: controller.caVoterIdNoCtrl,
          focusNode: controller.caVoterIdNoFocus,
          required: controller.isRequired('caVoterIdNo'),
          maxLength: 30,
          errorText: controller.caVoterIdNoError.value,
          suffixIcon: IconButton(
            tooltip: 'Scan Co-Applicant Voter ID',
            icon: const Icon(Icons.qr_code_scanner_rounded, color: enrollmentGreen),
            onPressed: () => _showScanDialog(
              context,
              'Co-Applicant Voter ID',
              controller.caVoterIdNoCtrl,
              scanType: DocumentScanType.voterId,
              isNumeric: false,
              maxLen: 20,
            ),
          ),
        ),
        EnrollmentTextField(
          label: 'Co-Applicant Aadhaar Number',
          hint: '12-digit Aadhaar number',
          controller: controller.caOtherIdNoCtrl,
          focusNode: controller.caOtherIdNoFocus,
          required: controller.isRequired('caOtherIdNo'),
          keyboardType: TextInputType.number,
          maxLength: 12,
          errorText: controller.caOtherIdNoError.value,
          suffixIcon: IconButton(
            tooltip: 'Scan Co-Applicant Aadhaar Card',
            icon: const Icon(Icons.qr_code_scanner_rounded, color: enrollmentGreen),
            onPressed: () => _showScanDialog(
              context,
              'Co-Applicant Aadhaar Card',
              controller.caOtherIdNoCtrl,
              scanType: DocumentScanType.aadhaar,
              isNumeric: true,
              maxLen: 12,
            ),
          ),
        ),
      ],
    );
  });
}

void _showScanDialog(
  BuildContext context,
  String docTitle,
  TextEditingController targetCtrl, {
  required DocumentScanType scanType,
  required bool isNumeric,
  required int maxLen,
}) {
  final tempCtrl = TextEditingController(text: targetCtrl.text);
  showDialog(
    context: context,
    builder: (ctx) => AlertDialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      title: Row(
        children: [
          const Icon(Icons.qr_code_scanner_rounded, color: enrollmentGreen),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'Scan $docTitle',
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: Color(0xFF063B20)),
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
      content: SingleChildScrollView(
        child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Scan document photo using Camera or Gallery:', style: TextStyle(fontSize: 12, color: Colors.grey[700])),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(backgroundColor: enrollmentGreen, foregroundColor: Colors.white, padding: const EdgeInsets.symmetric(vertical: 10)),
                  icon: const Icon(Icons.camera_alt_outlined, size: 18),
                  label: const Text('Camera'),
                  onPressed: () async {
                    final scanned = await DocumentScannerService.scanDocument(scanType: scanType, source: ImageSource.camera);
                    if (scanned != null && scanned.isNotEmpty) {
                      targetCtrl.text = scanned;
                      tempCtrl.text = scanned;
                      Get.snackbar('Auto-Detected', 'Scanned $docTitle: $scanned', backgroundColor: enrollmentGreen, colorText: Colors.white);
                    }
                  },
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(foregroundColor: enrollmentGreen, side: const BorderSide(color: enrollmentGreen), padding: const EdgeInsets.symmetric(vertical: 10)),
                  icon: const Icon(Icons.photo_library_outlined, size: 18),
                  label: const Text('Gallery'),
                  onPressed: () async {
                    final scanned = await DocumentScannerService.scanDocument(scanType: scanType, source: ImageSource.gallery);
                    if (scanned != null && scanned.isNotEmpty) {
                      targetCtrl.text = scanned;
                      tempCtrl.text = scanned;
                      Get.snackbar('Auto-Detected', 'Scanned $docTitle: $scanned', backgroundColor: enrollmentGreen, colorText: Colors.white);
                    }
                  },
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          TextField(
            controller: tempCtrl,
            maxLength: maxLen,
            keyboardType: isNumeric ? TextInputType.number : TextInputType.text,
            textCapitalization: TextCapitalization.characters,
            decoration: InputDecoration(
              hintText: 'Enter or auto-filled number',
              border: const OutlineInputBorder(),
              prefixIcon: Icon(isNumeric ? Icons.badge_outlined : Icons.credit_card_outlined),
            ),
          ),
        ],
      ),
    ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx),
          child: const Text('Cancel'),
        ),
        ElevatedButton.icon(
          style: ElevatedButton.styleFrom(backgroundColor: enrollmentGreen, foregroundColor: Colors.white),
          icon: const Icon(Icons.check_rounded, size: 18),
          label: const Text('Apply Field'),
          onPressed: () {
            final text = tempCtrl.text.trim();
            if (text.isNotEmpty) {
              targetCtrl.text = text;
            }
            Navigator.pop(ctx);
          },
        ),
      ],
    ),
  );
}
