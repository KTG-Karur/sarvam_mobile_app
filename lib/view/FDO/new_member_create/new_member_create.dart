import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:sarvam/controller/client_enrollment_controller.dart';
import 'package:sarvam/view/FDO/new_member_create/tabs/co_applicant_tab.dart';
import 'package:sarvam/view/FDO/new_member_create/tabs/credit_check_tab.dart';
import 'package:sarvam/view/FDO/new_member_create/tabs/kyc_details_tab.dart';
import 'package:sarvam/view/FDO/new_member_create/tabs/loan_details_tab.dart';
import 'package:sarvam/view/FDO/new_member_create/tabs/member_details_tab.dart';
import 'package:sarvam/view/FDO/new_member_create/tabs/other_details_tab.dart';

const _green = Color(0xFF00843D);

class NewMemberCreate extends StatefulWidget {
  const NewMemberCreate({super.key});

  @override
  State<NewMemberCreate> createState() => _NewMemberCreateState();
}

class _NewMemberCreateState extends State<NewMemberCreate> {
  final ClientEnrollmentController controller =
      Get.isRegistered<ClientEnrollmentController>()
      ? Get.find<ClientEnrollmentController>()
      : Get.put(ClientEnrollmentController());

  static const _steps = [
    ('Member Details', Icons.shield_outlined),
    ('Credit Check', Icons.verified_user_outlined),
    ('Other Details', Icons.description_outlined),
    ('Co-Applicant', Icons.group_outlined),
    ('Loan Details', Icons.credit_card_outlined),
    ('KYC Details', Icons.badge_outlined),
  ];

  @override
  Widget build(BuildContext context) => PopScope(
    onPopInvokedWithResult: (didPop, result) {
      if (didPop) {
        controller.saveDraft(silent: true);
      }
    },
    child: Scaffold(
      backgroundColor: const Color(0xFFF4FBF6),
      body: SafeArea(
        child: Column(
          children: [
            _header(),
            _stepsBar(),
            Expanded(
              child: Obx(
                () => SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
                  child: _stepContent(),
                ),
              ),
            ),
          ],
        ),
      ),
      bottomNavigationBar: _actions(),
    ),
  );

  Widget _stepContent() {
    switch (controller.currentStep.value) {
      case 1:
        return CreditCheckTab(controller: controller);
      case 2:
        return OtherDetailsTab(controller: controller);
      case 3:
        return CoApplicantTab(controller: controller);
      case 4:
        return LoanDetailsTab(controller: controller);
      case 5:
        return KycDetailsTab(controller: controller);
      default:
        return MemberDetailsTab(controller: controller);
    }
  }

  Widget _header() => Container(
    padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
    decoration: const BoxDecoration(
      color: Color(0xFFF8FFFA),
      border: Border(top: BorderSide(color: _green, width: 4)),
    ),
    child: Row(
      children: [
        Container(
          width: 43,
          height: 43,
          decoration: BoxDecoration(
            color: _green,
            borderRadius: BorderRadius.circular(12),
            boxShadow: const [
              BoxShadow(color: Color(0x3300843D), blurRadius: 8, offset: Offset(0, 3)),
            ],
          ),
          child: const Icon(Icons.person_add_alt_1_rounded, color: Colors.white, size: 24),
        ),
        const SizedBox(width: 11),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Member Enrollment',
                style: TextStyle(fontSize: 19, fontWeight: FontWeight.w800, color: Color(0xFF064524)),
              ),
              const SizedBox(height: 3),
              Obx(() {
                if (controller.isAutoSaving.value) {
                  return const Row(
                    children: [
                      SizedBox(
                        width: 10,
                        height: 10,
                        child: CircularProgressIndicator(strokeWidth: 1.5, color: _green),
                      ),
                      SizedBox(width: 5),
                      Text(
                        'Auto-saving draft...',
                        style: TextStyle(fontSize: 10.5, color: _green, fontWeight: FontWeight.w600),
                      ),
                    ],
                  );
                }
                final savedAt = controller.lastAutoSavedAt.value;
                if (savedAt != null) {
                  final timeStr =
                      "${savedAt.hour.toString().padLeft(2, '0')}:${savedAt.minute.toString().padLeft(2, '0')}";
                  return Row(
                    children: [
                      const Icon(Icons.cloud_done_outlined, size: 12, color: _green),
                      const SizedBox(width: 4),
                      Text(
                        'Auto-saved at $timeStr',
                        style: const TextStyle(
                          fontSize: 10.5,
                          color: Color(0xFF347151),
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  );
                }
                return const Text(
                  'Create new member enrollment with KYC verification',
                  style: TextStyle(fontSize: 10.5, color: Color(0xFF347151)),
                );
              }),
            ],
          ),
        ),
        IconButton(
          onPressed: () {
            controller.saveDraft(silent: true);
            Navigator.maybePop(context);
          },
          icon: const Icon(Icons.close, size: 19, color: Color(0xFF286044)),
        ),
      ],
    ),
  );

  Widget _stepsBar() => Obx(
    () => Container(
      height: 76,
      padding: const EdgeInsets.fromLTRB(8, 10, 8, 7),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(bottom: BorderSide(color: Color(0xFFC8E5D2))),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: List.generate(_steps.length, (index) {
          final isActive = index == controller.currentStep.value;
          final isComplete = index < controller.currentStep.value;
          return Expanded(
            child: InkWell(
              onTap: () {
                controller.saveDraft(silent: true);
                controller.currentStep.value = index;
              },
              borderRadius: BorderRadius.circular(10),
              child: Column(
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Container(
                          height: 2,
                          color: index == 0
                              ? Colors.transparent
                              : isComplete || isActive
                              ? _green
                              : const Color(0xFFC8E5D2),
                        ),
                      ),
                      Container(
                        width: 26,
                        height: 26,
                        decoration: BoxDecoration(
                          color: isActive || isComplete ? _green : const Color(0xFFF0FAF4),
                          shape: BoxShape.circle,
                          border: Border.all(
                            color: isActive || isComplete ? _green : const Color(0xFFA9D7B9),
                          ),
                        ),
                        child: Icon(
                          isComplete ? Icons.check_rounded : _steps[index].$2,
                          size: 13,
                          color: isActive || isComplete ? Colors.white : const Color(0xFF39845A),
                        ),
                      ),
                      Expanded(
                        child: Container(
                          height: 2,
                          color: index == _steps.length - 1
                              ? Colors.transparent
                              : isComplete
                              ? _green
                              : const Color(0xFFC8E5D2),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 5),
                  Text(
                    _steps[index].$1,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 8.5,
                      color: isActive ? _green : const Color(0xFF5A8069),
                      fontWeight: isActive ? FontWeight.w800 : FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),
          );
        }),
      ),
    ),
  );

  Widget _actions() => Obx(
    () => Container(
      height: 76,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: Color(0xFFBFE5CC))),
      ),
      child: Row(
        children: [
          Expanded(
            child: OutlinedButton(
              onPressed: controller.currentStep.value == 0
                  ? () => Navigator.maybePop(context)
                  : () => controller.currentStep.value--,
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(44),
                foregroundColor: const Color(0xFF14713C),
                side: const BorderSide(color: Color(0xFF9BD5AF)),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              ),
              child: Text(
                controller.currentStep.value == 0 ? 'Cancel' : 'Previous',
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
              ),
            ),
          ),
          const SizedBox(width: 7),
          Expanded(
            flex: 2,
            child: OutlinedButton.icon(
              onPressed: controller.saveDraft,
              icon: const Icon(Icons.save_outlined, size: 16),
              label: const Text('Save Draft', overflow: TextOverflow.ellipsis),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(44),
                foregroundColor: const Color(0xFFB87500),
                side: const BorderSide(color: Color(0xFFFFCE5A)),
                textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              ),
            ),
          ),
          const SizedBox(width: 7),
          Expanded(
            child: FilledButton(
              onPressed: controller.isLoading.value ? null : _next,
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(44),
                backgroundColor: _green,
                padding: const EdgeInsets.symmetric(horizontal: 5),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              ),
              child: controller.isLoading.value
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          controller.currentStep.value == _steps.length - 1 ? 'Submit' : 'Next',
                          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(width: 3),
                        Icon(
                          controller.currentStep.value == _steps.length - 1
                              ? Icons.check_circle_outline
                              : Icons.arrow_forward,
                          size: 16,
                        ),
                      ],
                    ),
            ),
          ),
        ],
      ),
    ),
  );

  Future<void> _next() async {
    controller.saveDraft(silent: true);
    if (controller.currentStep.value < _steps.length - 1) {
      controller.currentStep.value++;
      return;
    }
    final success = await controller.submitEnrollment();
    if (success && mounted) {
      Navigator.of(context).pop(true);
    }
  }
}
