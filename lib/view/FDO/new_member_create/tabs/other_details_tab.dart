import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:image_picker/image_picker.dart';
import 'package:sarvam/controller/client_enrollment/enrollment_lookups.dart';
import 'package:sarvam/controller/client_enrollment/enrollment_options.dart';
import 'package:sarvam/controller/client_enrollment_controller.dart';
import 'package:sarvam/services/document_scanner_service.dart';
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
              suffixIcon: IconButton(
                tooltip: 'Scan Bank Passbook / Cheque for IFSC',
                icon: const Icon(Icons.qr_code_scanner_rounded, color: enrollmentGreen),
                onPressed: () => _showScanDialog(
                  context,
                  'IFSC Code',
                  controller.ifscCodeCtrl,
                  scanType: DocumentScanType.ifscCode,
                  isNumeric: false,
                  maxLen: 11,
                ),
              ),
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
          suffixIcon: IconButton(
            tooltip: 'Scan Bank Passbook for Account Number',
            icon: const Icon(Icons.qr_code_scanner_rounded, color: enrollmentGreen),
            onPressed: () => _showScanDialog(
              context,
              'Bank Account Number',
              controller.bankAcNoCtrl,
              retypeCtrl: controller.retypeBankAcNoCtrl,
              scanType: DocumentScanType.bankAccount,
              isNumeric: true,
              maxLen: 18,
            ),
          ),
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
          suffixIcon: IconButton(
            tooltip: 'Scan Smart Card / Ration Card',
            icon: const Icon(Icons.qr_code_scanner_rounded, color: enrollmentGreen),
            onPressed: () => _showScanDialog(
              context,
              'Smart Card Number',
              controller.smartCardNoCtrl,
              scanType: DocumentScanType.smartCard,
              isNumeric: false,
              maxLen: 20,
            ),
          ),
        ),
      ],
    ),
  );

  void _showScanDialog(
    BuildContext context,
    String docTitle,
    TextEditingController targetCtrl, {
    TextEditingController? retypeCtrl,
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
                        if (retypeCtrl != null) retypeCtrl.text = scanned;
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
                        if (retypeCtrl != null) retypeCtrl.text = scanned;
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
                hintText: 'Enter or auto-filled value',
                border: const OutlineInputBorder(),
                prefixIcon: Icon(isNumeric ? Icons.account_balance_wallet_outlined : Icons.badge_outlined),
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
                if (retypeCtrl != null) retypeCtrl.text = text;
              }
              Navigator.pop(ctx);
            },
          ),
        ],
      ),
    );
  }
}
