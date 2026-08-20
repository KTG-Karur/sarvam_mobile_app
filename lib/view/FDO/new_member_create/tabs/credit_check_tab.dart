import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:sarvam/controller/client_enrollment_controller.dart';
import 'package:sarvam/view/FDO/new_member_create/widgets/enrollment_field_widgets.dart';

class CreditCheckTab extends StatefulWidget {
  const CreditCheckTab({super.key, required this.controller});

  final ClientEnrollmentController controller;

  @override
  State<CreditCheckTab> createState() => _CreditCheckTabState();
}

class _CreditCheckTabState extends State<CreditCheckTab> {
  @override
  void initState() {
    super.initState();
    final aadhaar = widget.controller.otherIdNoCtrl.text.trim();
    if (aadhaar.length == 12) {
      widget.controller.loadLatestHighmarkIfAny();
    }
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    return Obx(
      () => EnrollmentSectionShell(
        title: 'Credit Check',
        subtitle:
            'Optional CRIF/Highmark bureau check for this client. Not required to save enrollment.',
        icon: Icons.verified_user_outlined,
        children: [
          _summaryRow('Name', '${controller.clientNameCtrl.text} ${controller.lastNameCtrl.text}'.trim()),
          _summaryRow('Aadhaar', controller.otherIdNoCtrl.text),
          _summaryRow('Mobile', controller.mobileNumberCtrl.text),
          const SizedBox(height: 7),
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            value: controller.highmarkConsent.value,
            onChanged: (v) => controller.highmarkConsent.value = v ?? false,
            controlAffinity: ListTileControlAffinity.leading,
            activeColor: enrollmentGreen,
            title: const Text(
              'The client has given explicit consent for a Highmark check to be run on their behalf.',
              style: TextStyle(fontSize: 12, color: Color(0xFF164A2E)),
            ),
          ),
          Align(
            alignment: Alignment.centerLeft,
            child: FilledButton.icon(
              onPressed: controller.isRunningCreditCheck.value
                  ? null
                  : controller.runCreditCheck,
              icon: controller.isRunningCreditCheck.value
                  ? const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Icon(Icons.verified_outlined, size: 17),
              label: const Text('Run Credit Check'),
              style: FilledButton.styleFrom(backgroundColor: const Color(0xFF7DBF96)),
            ),
          ),
          if (controller.highmarkReport.value != null) ...[
            const SizedBox(height: 16),
            const Divider(),
            const SizedBox(height: 8),
            _summaryRow('Status', '${controller.highmarkReport.value!['status'] ?? '—'}'),
            _summaryRow(
              'Credit Score',
              '${controller.highmarkReport.value!['creditScore'] ?? '—'}',
            ),
            _summaryRow('Provider', '${controller.highmarkReport.value!['provider'] ?? '—'}'),
          ],
        ],
      ),
    );
  }

  Widget _summaryRow(String label, String value) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: Row(
      children: [
        SizedBox(
          width: 105,
          child: Text(label, style: const TextStyle(fontSize: 12, color: Color(0xFF3F7C5A))),
        ),
        Expanded(
          child: Text(
            value.isEmpty ? '—' : value,
            style: const TextStyle(
              fontSize: 13,
              color: Color(0xFF073E23),
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ],
    ),
  );
}
