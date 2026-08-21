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
            const SizedBox(height: 10),
            _buildReportCard(controller.highmarkReport.value!),
          ],
        ],
      ),
    );
  }

  Widget _buildReportCard(Map<String, dynamic> report) {
    final rawScore = report['creditScore'] ?? report['score'];
    final score = rawScore is num ? rawScore.toInt() : int.tryParse('$rawScore') ?? 0;
    final status = (report['status'] ?? report['reportStatus'] ?? 'COMPLETED').toString().toUpperCase();
    final provider = (report['provider'] ?? report['bureau'] ?? 'CRIF High Mark').toString();

    Color scoreColor = Colors.green;
    String riskLabel = 'Low Risk (Eligible)';
    if (score > 0 && score < 550) {
      scoreColor = Colors.red;
      riskLabel = 'High Risk (Review Required)';
    } else if (score >= 550 && score < 650) {
      scoreColor = Colors.amber.shade800;
      riskLabel = 'Moderate Risk';
    } else if (score == 0) {
      scoreColor = Colors.blueGrey;
      riskLabel = 'No Prior Credit History (NTC)';
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: scoreColor.withValues(alpha: 0.4)),
        boxShadow: const [
          BoxShadow(color: Color(0x0A000000), blurRadius: 8, offset: Offset(0, 2)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                provider,
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: Color(0xFF073E23)),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: scoreColor.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  status,
                  style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: scoreColor),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Container(
                width: 60,
                height: 60,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: scoreColor.withValues(alpha: 0.1),
                  border: Border.all(color: scoreColor, width: 2),
                ),
                child: Center(
                  child: Text(
                    score > 0 ? '$score' : 'N/A',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: scoreColor),
                  ),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      riskLabel,
                      style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: scoreColor),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Bureau Status: $status',
                      style: const TextStyle(fontSize: 11, color: Color(0xFF4E8A68)),
                    ),
                  ],
                ),
              ),
            ],
          ),
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
