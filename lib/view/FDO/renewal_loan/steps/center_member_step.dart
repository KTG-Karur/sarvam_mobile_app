import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:sarvam/controller/renewal_loan_controller.dart';
import 'package:sarvam/view/FDO/new_member_create/widgets/enrollment_field_widgets.dart';

/// Wizard step 1 — pick the center, the renewal-eligible client, and an
/// optional co-applicant. Mirrors the "Basic Information" block of the web
/// app's `ApplicationForm.tsx` (center/client/co-applicant fields).
class CenterMemberStep extends StatelessWidget {
  const CenterMemberStep({super.key, required this.controller});

  final RenewalLoanController controller;

  List<String> get _centerOptions => controller.centers
      .whereType<Map>()
      .map((c) => c['id']?.toString())
      .whereType<String>()
      .toList();

  String _centerLabel(String id) {
    final match = controller.centers.firstWhere(
      (c) => c is Map && c['id']?.toString() == id,
      orElse: () => null,
    );
    if (match is! Map) return id;
    return '${match['code']} - ${match['name']}';
  }

  List<String> get _clientOptions => controller.eligibleClients
      .whereType<Map>()
      .map((c) => c['id']?.toString())
      .whereType<String>()
      .toList();

  String _clientLabel(String id) {
    final match = controller.eligibleClients.firstWhere(
      (c) => c is Map && c['id']?.toString() == id,
      orElse: () => null,
    );
    if (match is! Map) return id;
    final first = match['firstName']?.toString() ?? '';
    final last = match['lastName']?.toString() ?? '';
    final name = (first.isNotEmpty || last.isNotEmpty)
        ? '$first $last'.trim()
        : '${match['clientId']}';
    final hasGroup = match['hasGroup'] != false;
    return '${match['clientId']} - $name${hasGroup ? '' : '  ⚠ No group'}';
  }

  List<String> get _coApplicantOptions => controller.eligibleCoApplicants
      .whereType<Map>()
      .map((c) => c['id']?.toString())
      .whereType<String>()
      .toList();

  String _coApplicantLabel(String id) {
    final match = controller.eligibleCoApplicants.firstWhere(
      (c) => c is Map && c['id']?.toString() == id,
      orElse: () => null,
    );
    if (match is! Map) return id;
    final isPrimary = match['isPrimary'] == true;
    return '${match['name']} — ${match['relationWithClient']}${isPrimary ? '  ★ Primary' : ''}';
  }

  @override
  Widget build(BuildContext context) => Obx(() {
    final centerSelected = controller.centerId.value != null;
    final clientSelected = controller.clientId.value != null;
    final clients = controller.eligibleClients;
    final coApplicants = controller.eligibleCoApplicants;

    return Column(
      children: [
        EnrollmentSectionShell(
          title: 'Center & Member',
          subtitle: 'Select the center and the existing member renewing their loan.',
          icon: Icons.groups_2_outlined,
          children: [
            EnrollmentSelectField(
              label: 'Center',
              value: controller.centerId.value,
              options: _centerOptions,
              labelBuilder: _centerLabel,
              onChanged: (v) => controller.onCenterChanged(v),
              required: true,
            ),
            if (controller.isLoadingClients.value)
              _inlineLoader('Loading eligible members…')
            else ...[
              EnrollmentSelectField(
                label: 'Member / Client',
                value: controller.clientId.value,
                options: _clientOptions,
                labelBuilder: _clientLabel,
                onChanged: (v) => controller.onClientChanged(v),
                required: true,
                enabled: centerSelected,
              ),
              if (centerSelected)
                Padding(
                  padding: EdgeInsets.only(bottom: 13.h, top: -6.h),
                  child: Text(
                    clients.isEmpty
                        ? 'No members eligible for renewal. They must be verified, have at least one prior loan, and no loan still awaiting indexation.'
                        : '${clients.length} member${clients.length > 1 ? 's' : ''} eligible for renewal',
                    style: TextStyle(
                      fontSize: 10.5.sp,
                      color: clients.isEmpty
                          ? const Color(0xFFB45309)
                          : const Color(0xFF16803C),
                    ),
                  ),
                ),
            ],
            if (controller.isLoadingCoApplicants.value)
              _inlineLoader('Checking co-applicants & ongoing loans…')
            else ...[
              EnrollmentSelectField(
                label: 'Co-Applicant',
                value: controller.coApplicantId.value,
                options: _coApplicantOptions,
                labelBuilder: _coApplicantLabel,
                onChanged: (v) => controller.coApplicantId.value = v,
                helper: '(Optional)',
                enabled: clientSelected,
              ),
              if (clientSelected && coApplicants.isEmpty)
                Padding(
                  padding: EdgeInsets.only(bottom: 13.h, top: -6.h),
                  child: Text(
                    'This member has no approved co-applicants yet — the loan can still be created without one.',
                    style: TextStyle(fontSize: 10.5.sp, color: enrollmentHelperColor),
                  ),
                ),
            ],
            if (controller.ongoingLoans.isNotEmpty &&
                !controller.ongoingLoanAcknowledged.value)
              _ongoingLoanWarning(),
          ],
        ),
      ],
    );
  });

  Widget _inlineLoader(String label) => Padding(
    padding: EdgeInsets.only(bottom: 13.h),
    child: Row(
      children: [
        SizedBox(
          width: 14.w,
          height: 14.w,
          child: const CircularProgressIndicator(
            strokeWidth: 2,
            color: enrollmentGreen,
          ),
        ),
        SizedBox(width: 8.w),
        Text(label, style: TextStyle(fontSize: 11.5.sp, color: enrollmentHelperColor)),
      ],
    ),
  );

  Widget _ongoingLoanWarning() => Container(
    margin: EdgeInsets.only(bottom: 13.h),
    padding: EdgeInsets.all(12.w),
    decoration: BoxDecoration(
      color: const Color(0xFFFEF3C7),
      borderRadius: BorderRadius.circular(10.r),
      border: Border.all(color: const Color(0xFFFCE3B5)),
    ),
    child: Row(
      children: [
        const Icon(Icons.warning_amber_rounded, color: Color(0xFFB45309), size: 18),
        SizedBox(width: 8.w),
        Expanded(
          child: Text(
            'This client has ongoing loan(s). Review the details to continue.',
            style: TextStyle(fontSize: 11.5.sp, color: const Color(0xFF7A4A05)),
          ),
        ),
      ],
    ),
  );
}
