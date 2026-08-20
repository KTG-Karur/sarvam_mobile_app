import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:sarvam/controller/renewal_loan_controller.dart';
import 'package:sarvam/view/FDO/new_member_create/widgets/enrollment_field_widgets.dart';

/// Wizard step 2 — product type, frequency, and loan product. Selecting a
/// product auto-fills amount/interest/tenure/insurance fee (see
/// `RenewalLoanController.onProductSelected`), mirrored here read-only.
class LoanProductStep extends StatelessWidget {
  const LoanProductStep({super.key, required this.controller});

  final RenewalLoanController controller;

  List<String> get _productTypeOptions => controller.loanProductTypes
      .whereType<Map>()
      .map((t) => t['id']?.toString())
      .whereType<String>()
      .toList();

  String _productTypeLabel(String id) {
    final match = controller.loanProductTypes.firstWhere(
      (t) => t is Map && t['id']?.toString() == id,
      orElse: () => null,
    );
    return match is Map ? '${match['name']}' : id;
  }

  List<String> get _productOptions => controller.filteredProducts
      .whereType<Map>()
      .map((p) => p['id']?.toString())
      .whereType<String>()
      .toList();

  String _productLabel(String id) {
    final match = controller.filteredProducts.firstWhere(
      (p) => p is Map && p['id']?.toString() == id,
      orElse: () => null,
    );
    if (match is! Map) return id;
    return '${match['productName']} (₹${match['loanAmount']})';
  }

  @override
  Widget build(BuildContext context) => Obx(() {
    final typeSelected = controller.productTypeId.value != null;
    final products = controller.filteredProducts;
    final product = controller.selectedProduct.value;

    return Column(
      children: [
        EnrollmentSectionShell(
          title: 'Loan Product',
          subtitle: 'Requested renewal loan product for this member.',
          icon: Icons.credit_card_outlined,
          children: [
            EnrollmentSelectField(
              label: 'Product Type',
              value: controller.productTypeId.value,
              options: _productTypeOptions,
              labelBuilder: _productTypeLabel,
              onChanged: (v) => controller.onProductTypeChanged(v),
              required: true,
            ),
            EnrollmentSelectField(
              label: 'Frequency',
              value: controller.frequency.value,
              options: const ['weekly'],
              labelBuilder: (v) => 'Weekly',
              onChanged: (v) => controller.onFrequencyChanged(v),
              required: true,
              enabled: typeSelected,
            ),
            if (controller.isLoadingProducts.value)
              _inlineLoader('Loading products…')
            else ...[
              EnrollmentSelectField(
                label: 'Loan Product',
                value: controller.productId.value,
                options: _productOptions,
                labelBuilder: _productLabel,
                onChanged: (v) => controller.onProductSelected(v),
                required: true,
                enabled: typeSelected,
              ),
              if (typeSelected && products.isEmpty)
                Padding(
                  padding: EdgeInsets.only(bottom: 13.h, top: -6.h),
                  child: Text(
                    'No products available for the selected type and frequency.',
                    style: TextStyle(fontSize: 10.5.sp, color: const Color(0xFFB45309)),
                  ),
                ),
            ],
            EnrollmentTextField(
              label: 'Loan Amount',
              hint: 'Auto-filled from product',
              controller: controller.amountCtrl,
              readOnly: true,
              icon: Icons.currency_rupee,
            ),
            Row(
              children: [
                Expanded(
                  child: EnrollmentTextField(
                    label: 'Interest Rate (%)',
                    hint: 'Auto-filled',
                    controller: controller.interestRateCtrl,
                    readOnly: true,
                  ),
                ),
                SizedBox(width: 10.w),
                Expanded(
                  child: EnrollmentTextField(
                    label: 'Tenure (Months)',
                    hint: 'Auto-filled',
                    controller: controller.tenureCtrl,
                    readOnly: true,
                  ),
                ),
              ],
            ),
            if (product != null) _productDetailsCard(product),
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
          child: const CircularProgressIndicator(strokeWidth: 2, color: enrollmentGreen),
        ),
        SizedBox(width: 8.w),
        Text(label, style: TextStyle(fontSize: 11.5.sp, color: enrollmentHelperColor)),
      ],
    ),
  );

  Widget _productDetailsCard(Map<String, dynamic> product) => Container(
    padding: EdgeInsets.all(14.w),
    decoration: BoxDecoration(
      color: const Color(0xFFEFFAF3),
      borderRadius: BorderRadius.circular(10.r),
      border: Border.all(color: const Color(0xFFC3E5CE)),
    ),
    child: Wrap(
      spacing: 18.w,
      runSpacing: 10.h,
      children: [
        _detail('Total Dues', '${product['totalDues'] ?? 0} ${controller.frequency.value}'),
        _detail('Total Interest', '₹${product['interest'] ?? 0}'),
        _detail('Advance / Installment', '₹${product['advanceSavingsAmount'] ?? 0}'),
      ],
    ),
  );

  Widget _detail(String label, String value) => SizedBox(
    width: 150.w,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: TextStyle(fontSize: 10.5.sp, color: enrollmentHelperColor)),
        SizedBox(height: 2.h),
        Text(
          value,
          style: TextStyle(fontSize: 13.sp, fontWeight: FontWeight.w700, color: const Color(0xFF0B3C24)),
        ),
      ],
    ),
  );
}
