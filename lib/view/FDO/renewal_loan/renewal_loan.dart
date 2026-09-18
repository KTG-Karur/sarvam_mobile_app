import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:sarvam/controller/renewal_loan_controller.dart';
import 'package:sarvam/view/FDO/renewal_loan/steps/center_member_step.dart';
import 'package:sarvam/view/FDO/renewal_loan/steps/loan_product_step.dart';
import 'package:sarvam/view/FDO/renewal_loan/steps/purpose_charges_step.dart';
import 'package:sarvam/view/FDO/renewal_loan/steps/review_submit_step.dart';

const _green = Color(0xFF00843D);

/// Renewal Loan Application (FDO) — a 4-step wizard mirroring the web app's
/// `components/loan-module/ApplicationForm.tsx`: Center & Member, Loan
/// Product, Purpose & Charges, Review & Submit.
class RenewalLoan extends StatefulWidget {
  const RenewalLoan({super.key});

  @override
  State<RenewalLoan> createState() => _RenewalLoanState();
}

class _RenewalLoanState extends State<RenewalLoan> {
  final RenewalLoanController controller = Get.isRegistered<RenewalLoanController>()
      ? Get.find<RenewalLoanController>()
      : Get.put(RenewalLoanController());

  static const _steps = [
    ('Center & Member', Icons.groups_2_outlined),
    ('Loan Product', Icons.credit_card_outlined),
    ('Purpose & Charges', Icons.category_outlined),
    ('Review & Submit', Icons.fact_check_outlined),
  ];

  Worker? _ongoingLoanWorker;

  @override
  void initState() {
    super.initState();
    _ongoingLoanWorker = ever<bool>(controller.showOngoingLoanModal, (show) {
      if (show) _showOngoingLoanDialog();
    });
  }

  @override
  void dispose() {
    _ongoingLoanWorker?.dispose();
    if (Get.isRegistered<RenewalLoanController>()) {
      Get.delete<RenewalLoanController>();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xFFF4FBF6),
    body: SafeArea(
      child: Obx(() {
        if (controller.isLoadingData.value) {
          return Column(
            children: [
              _header(),
              const Expanded(
                child: Center(child: CircularProgressIndicator(color: _green)),
              ),
            ],
          );
        }
        return Column(
          children: [
            _header(),
            _stepsBar(),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
                child: _stepContent(),
              ),
            ),
          ],
        );
      }),
    ),
    bottomNavigationBar: Obx(() {
      if (controller.isLoadingData.value) return const SizedBox.shrink();
      return _actions();
    }),
  );

  Widget _stepContent() {
    switch (controller.currentStep.value) {
      case 1:
        return LoanProductStep(controller: controller);
      case 2:
        return PurposeChargesStep(controller: controller);
      case 3:
        return ReviewSubmitStep(controller: controller);
      default:
        return CenterMemberStep(controller: controller);
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
          child: const Icon(Icons.autorenew_rounded, color: Colors.white, size: 24),
        ),
        const SizedBox(width: 11),
        const Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Renewal Loan',
                style: TextStyle(fontSize: 19, fontWeight: FontWeight.w800, color: Color(0xFF064524)),
              ),
              SizedBox(height: 3),
              Text(
                'Create a renewal loan application for an existing member',
                style: TextStyle(fontSize: 10.5, color: Color(0xFF347151)),
              ),
            ],
          ),
        ),
        IconButton(
          onPressed: () => Navigator.maybePop(context),
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
          // Only let a tap jump backward, or forward if every step in
          // between is already satisfied — mirrors the Next button's gate.
          final canJump = index <= controller.currentStep.value ||
              List.generate(index, (i) => i).every(controller.canProceedFromStep);
          return Expanded(
            child: InkWell(
              onTap: canJump ? () => controller.currentStep.value = index : null,
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

  Widget _actions() => Obx(() {
    final step = controller.currentStep.value;
    final isLastStep = step == _steps.length - 1;
    final canProceed = controller.canProceedFromStep(step);
    return Container(
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
              onPressed: step == 0
                  ? () => Navigator.maybePop(context)
                  : () => controller.currentStep.value--,
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(44),
                foregroundColor: const Color(0xFF14713C),
                side: const BorderSide(color: Color(0xFF9BD5AF)),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              ),
              child: Text(
                step == 0 ? 'Cancel' : 'Previous',
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
              ),
            ),
          ),
          const SizedBox(width: 7),
          Expanded(
            child: OutlinedButton.icon(
              onPressed: controller.resetForm,
              icon: const Icon(Icons.refresh, size: 16),
              label: const Text('Reset', overflow: TextOverflow.ellipsis),
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
            flex: 2,
            child: FilledButton(
              onPressed: !canProceed
                  ? null
                  : isLastStep
                  ? _submit
                  : () => controller.currentStep.value++,
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(44),
                backgroundColor: _green,
                disabledBackgroundColor: const Color(0xFFA9D7B9),
                padding: const EdgeInsets.symmetric(horizontal: 5),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              ),
              child: controller.isSubmitting.value
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          isLastStep ? 'Save Application' : 'Next',
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(width: 3),
                        Icon(
                          isLastStep ? Icons.check_circle_outline : Icons.arrow_forward,
                          size: 16,
                        ),
                      ],
                    ),
            ),
          ),
        ],
      ),
    );
  });

  Future<void> _submit() async {
    final success = await controller.submit();
    if (success && mounted) {
      Navigator.of(context).pop(true);
    }
  }

  void _showOngoingLoanDialog() {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        title: const Row(
          children: [
            Icon(Icons.warning_amber_rounded, color: Color(0xFFB45309)),
            SizedBox(width: 8),
            Expanded(
              child: Text('Client Has Ongoing Loan(s)', style: TextStyle(fontSize: 16)),
            ),
          ],
        ),
        content: SizedBox(
          width: double.maxFinite,
          child: Obx(
            () => SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: controller.ongoingLoans.map((raw) {
                  final loan = raw as Map;
                  final outstanding = ((loan['outstandingPrincipal'] ?? 0) as num) +
                      ((loan['outstandingInterest'] ?? 0) as num);
                  final arrear = (loan['arrear'] ?? 0) as num;
                  return Container(
                    margin: const EdgeInsets.only(bottom: 10),
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFEF3C7),
                      borderRadius: BorderRadius.circular(8),
                      border: Border(
                        left: BorderSide(
                          color: arrear > 0 ? Colors.red : const Color(0xFFB45309),
                          width: 4,
                        ),
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('${loan['loanNumber'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
                        Text('Product: ${loan['productName'] ?? '—'}'),
                        Text('Disbursed: ${loan['disbursementDate'] ?? '—'}'),
                        Text('Outstanding: ₹$outstanding'),
                        if (arrear > 0)
                          Text(
                            'Arrear: ₹$arrear',
                            style: const TextStyle(color: Colors.red, fontWeight: FontWeight.w700),
                          ),
                      ],
                    ),
                  );
                }).toList(),
              ),
            ),
          ),
        ),
        actions: [
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: _green),
            onPressed: () {
              Navigator.pop(ctx);
              controller.acknowledgeOngoingLoans();
            },
            child: const Text('OK'),
          ),
        ],
      ),
    );
  }
}
