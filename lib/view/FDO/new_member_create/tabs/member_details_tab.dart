import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:get/get.dart';
import 'package:image_picker/image_picker.dart';
import 'package:sarvam/controller/client_enrollment/enrollment_options.dart';
import 'package:sarvam/controller/client_enrollment_controller.dart';
import 'package:sarvam/services/document_scanner_service.dart';
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
          suffixIcon: IconButton(
            tooltip: 'Scan Aadhaar Card',
            icon: const Icon(Icons.qr_code_scanner_rounded, color: enrollmentGreen),
            onPressed: () => _showScanDialog(
              context,
              'Aadhaar Card',
              controller.otherIdNoCtrl,
              scanType: DocumentScanType.aadhaar,
              isNumeric: true,
              maxLen: 12,
            ),
          ),
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
          suffixIcon: IconButton(
            tooltip: 'Scan PAN Card',
            icon: const Icon(Icons.qr_code_scanner_rounded, color: enrollmentGreen),
            onPressed: () => _showScanDialog(
              context,
              'PAN Card',
              controller.pancardNoCtrl,
              scanType: DocumentScanType.panCard,
              isNumeric: false,
              maxLen: 10,
            ),
          ),
        ),
        EnrollmentTextField(
          label: 'Voter ID Number',
          hint: 'ABC1234567',
          controller: controller.votersIdNoCtrl,
          focusNode: controller.votersIdNoFocus,
          required: controller.isRequired('votersIdNo'),
          maxLength: 30,
          errorText: controller.votersIdNoError.value,
          suffixIcon: IconButton(
            tooltip: 'Scan Voter ID',
            icon: const Icon(Icons.qr_code_scanner_rounded, color: enrollmentGreen),
            onPressed: () => _showScanDialog(
              context,
              'Voter ID',
              controller.votersIdNoCtrl,
              scanType: DocumentScanType.voterId,
              isNumeric: false,
              maxLen: 20,
            ),
          ),
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
            Text('Scan $docTitle', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: Color(0xFF063B20))),
          ],
        ),
        content: Column(
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
}
