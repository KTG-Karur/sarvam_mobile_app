import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:image_picker/image_picker.dart';
import 'package:sarvam/controller/client_enrollment/enrollment_options.dart';
import 'package:sarvam/controller/client_enrollment_controller.dart';
import 'package:sarvam/view/FDO/new_member_create/widgets/enrollment_field_widgets.dart';

const _clientDocLabels = {
  EnrollmentOptions.docClientPhoto: 'Member / Client Photo',
  EnrollmentOptions.docAadhaarFront: 'Aadhaar Front',
  EnrollmentOptions.docAadhaarBack: 'Aadhaar Back',
  EnrollmentOptions.docPanCard: 'PAN Card',
  EnrollmentOptions.docVoterId: 'Voter ID Front',
  EnrollmentOptions.docVoterIdBack: 'Voter ID Back',
  EnrollmentOptions.docBankPassbook: 'Bank Passbook',
  EnrollmentOptions.docSmartCardFront: 'Smart Card Front',
  EnrollmentOptions.docSmartCardBack: 'Smart Card Back',
};

const _coApplicantDocLabels = {
  EnrollmentOptions.docCoApplicantPhoto: 'Co-Applicant Photo',
  EnrollmentOptions.docCoApplicantAadhaarFront: 'Co-Applicant Aadhaar Front',
  EnrollmentOptions.docCoApplicantAadhaarBack: 'Co-Applicant Aadhaar Back',
  EnrollmentOptions.docCoApplicantPanCard: 'Co-Applicant PAN Card',
  EnrollmentOptions.docCoApplicantVoterId: 'Co-Applicant Voter ID Front',
  EnrollmentOptions.docCoApplicantVoterIdBack: 'Co-Applicant Voter ID Back',
  EnrollmentOptions.docCoApplicantOtherIdFront: 'Co-Applicant Other ID Front',
  EnrollmentOptions.docCoApplicantOtherIdBack: 'Co-Applicant Other ID Back',
};

const _residenceDocLabels = {
  EnrollmentOptions.docHouseImage1: 'House Image 1',
  EnrollmentOptions.docHouseImage2: 'House Image 2',
  EnrollmentOptions.docHouseImage3: 'House Image 3',
  EnrollmentOptions.docGasBill: 'NOC (Gas Bill)',
  EnrollmentOptions.docNocImage1: 'NOC Image 1',
  EnrollmentOptions.docNocImage2: 'NOC Image 2',
  EnrollmentOptions.docNocImage3: 'NOC Image 3',
};

class KycDetailsTab extends StatelessWidget {
  const KycDetailsTab({super.key, required this.controller});

  final ClientEnrollmentController controller;

  @override
  Widget build(BuildContext context) => EnrollmentSectionShell(
    title: 'KYC Details',
    subtitle: 'Upload required documents for client and co-applicant verification.',
    icon: Icons.badge_outlined,
    children: [
      _uploadGroup('Client Documents', _clientDocLabels, owner: 'client'),
      SizedBox(height: 16.h),
      _uploadGroup('Co-Applicant Documents', _coApplicantDocLabels, owner: 'coApplicant'),
      SizedBox(height: 16.h),
      _uploadGroup('Residence Verification', _residenceDocLabels, owner: 'client'),
      SizedBox(height: 4.h),
      Obx(
        () => Column(
          children: [
            Row(
              children: [
                Expanded(
                  child: EnrollmentTextField(
                    label: 'Latitude',
                    hint: 'Auto-filled',
                    controller: TextEditingController(text: controller.latitude.value),
                    readOnly: true,
                  ),
                ),
                SizedBox(width: 10.w),
                Expanded(
                  child: EnrollmentTextField(
                    label: 'Longitude',
                    hint: 'Auto-filled',
                    controller: TextEditingController(text: controller.longitude.value),
                    readOnly: true,
                  ),
                ),
              ],
            ),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: controller.isLocating.value ? null : controller.fetchLocation,
                icon: controller.isLocating.value
                    ? const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : const Icon(Icons.my_location_outlined, size: 17),
                label: const Text('Use Current Location'),
                style: FilledButton.styleFrom(backgroundColor: enrollmentGreen),
              ),
            ),
            SizedBox(height: 12.h),
            if (controller.docState(EnrollmentOptions.docLocationQr)?.isUploaded == true)
              const Text(
                'Location QR generated and uploaded.',
                style: TextStyle(fontSize: 11, color: enrollmentGreen),
              ),
          ],
        ),
      ),
    ],
  );

  Widget _uploadGroup(
    String title,
    Map<String, String> docs, {
    required String owner,
  }) => Container(
    width: double.infinity,
    decoration: BoxDecoration(
      border: Border.all(color: const Color(0xFF8ED0A6)),
      borderRadius: BorderRadius.circular(9.r),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: double.infinity,
          padding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 10.h),
          decoration: BoxDecoration(
            color: enrollmentGreen,
            borderRadius: BorderRadius.vertical(top: Radius.circular(8.r)),
          ),
          child: Text(
            title,
            style: TextStyle(color: Colors.white, fontSize: 14.sp, fontWeight: FontWeight.w700),
          ),
        ),
        Padding(
          padding: EdgeInsets.all(12.w),
          child: Column(
            children: docs.entries
                .map((entry) => _docRow(entry.key, entry.value, owner: owner))
                .toList(),
          ),
        ),
      ],
    ),
  );

  void _showUploadSourceSheet(
    BuildContext context,
    String documentType,
    String label, {
    required String owner,
    required bool allowPdf,
  }) {
    showModalBottomSheet<void>(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (bottomContext) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 18),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Upload $label',
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: Color(0xFF063B20),
                ),
              ),
              const SizedBox(height: 14),
              ListTile(
                leading: const Icon(Icons.camera_alt_outlined, color: enrollmentGreen),
                title: const Text('Take Photo (Camera)', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                onTap: () {
                  Navigator.pop(bottomContext);
                  controller.pickAndUploadDocument(
                    documentType,
                    owner: owner,
                    source: ImageSource.camera,
                  );
                },
              ),
              const Divider(height: 1),
              ListTile(
                leading: const Icon(Icons.photo_library_outlined, color: enrollmentGreen),
                title: const Text('Choose from Photo Gallery', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                onTap: () {
                  Navigator.pop(bottomContext);
                  controller.pickAndUploadDocument(
                    documentType,
                    owner: owner,
                    source: ImageSource.gallery,
                  );
                },
              ),
              if (documentType.toLowerCase().contains('aadhaar') ||
                  documentType.toLowerCase().contains('pancard') ||
                  documentType.toLowerCase().contains('pan')) ...[
                const Divider(height: 1),
                ListTile(
                  leading: const Icon(Icons.qr_code_scanner_rounded, color: enrollmentGreen),
                  title: Text(
                    'Scan & Auto-Fill ${documentType.toLowerCase().contains('aadhaar') ? 'Aadhaar No' : 'PAN Card No'}',
                    style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: enrollmentGreen),
                  ),
                  onTap: () {
                    Navigator.pop(bottomContext);
                    _showScanIdModal(context, documentType, owner: owner);
                  },
                ),
              ],
              if (allowPdf) ...[
                const Divider(height: 1),
                ListTile(
                  leading: const Icon(Icons.picture_as_pdf_outlined, color: enrollmentGreen),
                  title: const Text('Choose PDF / Document File', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                  onTap: () {
                    Navigator.pop(bottomContext);
                    controller.pickAndUploadDocument(
                      documentType,
                      owner: owner,
                      allowPdf: true,
                    );
                  },
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  void _showScanIdModal(BuildContext context, String documentType, {required String owner}) {
    final isAadhaar = documentType.toLowerCase().contains('aadhaar');
    final title = isAadhaar ? 'Scan Aadhaar Card' : 'Scan PAN Card';
    final ctrl = TextEditingController();

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14.r)),
        title: Row(
          children: [
            const Icon(Icons.qr_code_scanner_rounded, color: enrollmentGreen),
            SizedBox(width: 8.w),
            Text(title, style: TextStyle(fontSize: 16.sp, fontWeight: FontWeight.w800, color: const Color(0xFF063B20))),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              isAadhaar
                  ? 'Enter or scan 12-digit Aadhaar Number:'
                  : 'Enter or scan 10-character PAN Card Number:',
              style: TextStyle(fontSize: 12.sp, color: Colors.grey[700]),
            ),
            SizedBox(height: 12.h),
            TextField(
              controller: ctrl,
              maxLength: isAadhaar ? 12 : 10,
              keyboardType: isAadhaar ? TextInputType.number : TextInputType.text,
              textCapitalization: TextCapitalization.characters,
              decoration: InputDecoration(
                hintText: isAadhaar ? '123456789012' : 'ABCDE1234F',
                border: const OutlineInputBorder(),
                prefixIcon: Icon(isAadhaar ? Icons.badge_outlined : Icons.credit_card_outlined),
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
            label: const Text('Auto-Fill Field'),
            onPressed: () {
              final val = ctrl.text.trim();
              if (val.isEmpty) {
                Get.snackbar('Input Required', 'Please enter a valid number.', backgroundColor: Colors.orange, colorText: Colors.white);
                return;
              }
              if (isAadhaar) {
                if (owner == 'client') {
                  controller.otherIdNoCtrl.text = val;
                } else {
                  controller.caOtherIdNoCtrl.text = val;
                }
              } else {
                if (owner == 'client') {
                  controller.pancardNoCtrl.text = val;
                } else {
                  controller.caPancardNoCtrl.text = val;
                }
              }
              Navigator.pop(ctx);
              Get.snackbar(
                'Auto-Filled',
                '${isAadhaar ? "Aadhaar Number" : "PAN Card Number"} updated successfully.',
                backgroundColor: enrollmentGreen,
                colorText: Colors.white,
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _docRow(String documentType, String label, {required String owner}) => Obx(() {
    final state = controller.docState(documentType);
    final allowPdf = EnrollmentOptions.pdfEligibleDocumentTypes.contains(documentType);
    return Padding(
      padding: EdgeInsets.only(bottom: 10.h),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(fontSize: 12.sp, color: const Color(0xFF164A2E)),
            ),
          ),
          if (state?.isUploading == true)
            const SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          else if (state?.isUploaded == true) ...[
            Icon(Icons.check_circle, color: enrollmentGreen, size: 18.sp),
            SizedBox(width: 6.w),
            Builder(
              builder: (ctx) => InkWell(
                onTap: () => _showUploadSourceSheet(
                  ctx,
                  documentType,
                  label,
                  owner: owner,
                  allowPdf: allowPdf,
                ),
                child: Text(
                  'Replace',
                  style: TextStyle(fontSize: 11.5.sp, color: enrollmentGreen),
                ),
              ),
            ),
          ] else
            Builder(
              builder: (ctx) => OutlinedButton.icon(
                onPressed: () => _showUploadSourceSheet(
                  ctx,
                  documentType,
                  label,
                  owner: owner,
                  allowPdf: allowPdf,
                ),
                icon: const Icon(Icons.attach_file, size: 16),
                label: const Text('Upload'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: enrollmentGreen,
                  minimumSize: const Size(90, 35),
                ),
              ),
            ),
        ],
      ),
    );
  });
}
