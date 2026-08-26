import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/controller/disbursement_approval_controller.dart';
import 'package:sarvam/services/api_client.dart';
import 'package:sarvam/services/enrollment_api_service.dart';
import 'package:sarvam/services/member_individual_api_service.dart';
import 'package:sarvam/view/BM/group_assignment/widgets/id_dropdown.dart';
import 'package:sarvam/view/shared/highmark_report_sheet.dart';

const _green = Color(0xFF0D6842);
const _darkText = Color(0xFF172033);
const _muted = Color(0xFF64748B);

/// AM "Disbursement Approval" (Level 2) — mirrors the core flow of the web
/// app's `components/loan-module/DisbursementClient.tsx`: pick a branch (+
/// optional date range), review index batches of loans pending AM approval,
/// select batches, and Approve (→ ready for the BM's final disbursement) or
/// Reject.
class DisbursementApproval extends StatefulWidget {
  const DisbursementApproval({super.key});

  @override
  State<DisbursementApproval> createState() => _DisbursementApprovalState();
}

class _DisbursementApprovalState extends State<DisbursementApproval> {
  final DisbursementApprovalController controller =
      Get.isRegistered<DisbursementApprovalController>()
      ? Get.find<DisbursementApprovalController>()
      : Get.put(DisbursementApprovalController());

  final EnrollmentApiService _highmarkApi =
      Get.isRegistered<EnrollmentApiService>()
          ? Get.find<EnrollmentApiService>()
          : Get.put(
              EnrollmentApiService(
                Get.isRegistered<ApiClient>()
                    ? Get.find<ApiClient>()
                    : Get.put(ApiClient()),
              ),
            );

  final MemberIndividualApiService _memberService =
      Get.isRegistered<MemberIndividualApiService>()
          ? Get.find<MemberIndividualApiService>()
          : Get.put(
              MemberIndividualApiService(
                Get.isRegistered<ApiClient>()
                    ? Get.find<ApiClient>()
                    : Get.put(ApiClient()),
              ),
            );

  String _field(Map data, String key, [String fallback = 'N/A']) {
    final v = data[key];
    return v == null || v.toString().trim().isEmpty ? fallback : v.toString();
  }

  double _amount(Map data, String key) {
    final v = data[key];
    if (v is num) return v.toDouble();
    return double.tryParse('$v') ?? 0;
  }

  String _currency(double amount) => '₹${amount.toStringAsFixed(2)}';

  Future<void> _pickDate({
    required String initial,
    required ValueChanged<String> onPicked,
  }) async {
    DateTime parse(String s) {
      final parts = s.split('-');
      if (parts.length != 3) return DateTime.now();
      return DateTime(int.parse(parts[0]), int.parse(parts[1]), int.parse(parts[2]));
    }

    final picked = await showDatePicker(
      context: context,
      initialDate: initial.isNotEmpty ? parse(initial) : DateTime.now(),
      firstDate: DateTime(2020),
      lastDate: DateTime.now().add(const Duration(days: 1)),
    );
    if (picked != null) {
      onPicked(
        '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}',
      );
    }
  }

  String _formatDisplayDate(String ymd) {
    if (ymd.isEmpty) return '';
    final parts = ymd.split('-');
    if (parts.length != 3) return ymd;
    return '${parts[2]}-${parts[1]}-${parts[0]}';
  }

  @override
  Widget build(BuildContext context) {
    return Theme(
      data: Theme.of(context).copyWith(
        textTheme: GoogleFonts.poppinsTextTheme(Theme.of(context).textTheme),
      ),
      child: Scaffold(
        backgroundColor: const Color(0xFFF7FBF8),
        appBar: AppBar(
          elevation: 0,
          scrolledUnderElevation: 0,
          backgroundColor: Colors.white,
          leading: IconButton(
            onPressed: () => Navigator.maybePop(context),
            icon: const Icon(Icons.arrow_back, color: _green),
          ),
          title: Text(
            'Disbursement Approval',
            style: TextStyle(
              fontSize: 17.sp,
              fontWeight: FontWeight.w800,
              color: const Color(0xFF10472A),
            ),
          ),
        ),
        body: SafeArea(
          top: false,
          child: Obx(() {
            if (controller.isLoadingBranches.value && controller.branches.isEmpty) {
              return const Center(child: CircularProgressIndicator(color: _green));
            }
            return RefreshIndicator(
              color: _green,
              onRefresh: controller.fetchPending,
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: EdgeInsets.all(16.w),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildFilterCard(),
                    SizedBox(height: 14.h),
                    _buildStatsRow(),
                    SizedBox(height: 14.h),
                    _buildBatches(),
                  ],
                ),
              ),
            );
          }),
        ),
      ),
    );
  }

  Widget _buildFilterCard() {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(14.w),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: const Color(0xFFE1EAE4)),
        borderRadius: BorderRadius.circular(14.r),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Verification Queue',
            style: TextStyle(
              fontSize: 14.sp,
              fontWeight: FontWeight.w800,
              color: _darkText,
            ),
          ),
          SizedBox(height: 3.h),
          Text(
            'Filter by branch and date range to view loans pending AM approval.',
            style: TextStyle(fontSize: 11.sp, color: _muted),
          ),
          SizedBox(height: 12.h),
          Obx(
            () => IdDropdown(
              label: 'Branch',
              value: controller.branchId.value,
              items: controller.branches,
              labelBuilder: centerLabel,
              onChanged: controller.onBranchChanged,
            ),
          ),
          SizedBox(height: 10.h),
          Row(
            children: [
              Expanded(
                child: Obx(
                  () => _dateField(
                    label: 'From Date',
                    value: controller.fromDate.value,
                    onTap: () => _pickDate(
                      initial: controller.fromDate.value,
                      onPicked: controller.onFromDateChanged,
                    ),
                  ),
                ),
              ),
              SizedBox(width: 10.w),
              Expanded(
                child: Obx(
                  () => _dateField(
                    label: 'To Date',
                    value: controller.toDate.value,
                    onTap: () => _pickDate(
                      initial: controller.toDate.value,
                      onPicked: controller.onToDateChanged,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _dateField({
    required String label,
    required String value,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10.r),
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 10.h),
        decoration: BoxDecoration(
          border: Border.all(color: const Color(0xFFCBD5E1)),
          borderRadius: BorderRadius.circular(10.r),
          color: Colors.white,
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label, style: TextStyle(fontSize: 9.5.sp, color: _muted)),
                  SizedBox(height: 2.h),
                  Text(
                    value.isEmpty ? 'Any' : _formatDisplayDate(value),
                    style: TextStyle(
                      fontSize: 12.sp,
                      fontWeight: FontWeight.w700,
                      color: value.isEmpty ? _muted : _darkText,
                    ),
                  ),
                ],
              ),
            ),
            Icon(Icons.calendar_today_rounded, size: 15.sp, color: _muted),
          ],
        ),
      ),
    );
  }

  Widget _buildStatsRow() {
    return Obx(() {
      final totalClients = controller.stats['totalClients'] ?? 0;
      final totalAmount = controller.stats['totalAmount'];
      final amountValue = (totalAmount is num) ? totalAmount.toDouble() : 0.0;
      return Row(
        children: [
          Expanded(
            child: _statCard(
              label: 'Total Loans',
              value: controller.isFetchingPending.value ? '...' : '$totalClients',
              icon: Icons.groups_rounded,
              iconColor: _green,
              iconBg: const Color(0xFFE6F5EC),
            ),
          ),
          SizedBox(width: 10.w),
          Expanded(
            child: _statCard(
              label: 'Total Value',
              value: controller.isFetchingPending.value ? '...' : _currency(amountValue),
              icon: Icons.account_balance_wallet_rounded,
              iconColor: const Color(0xFF059669),
              iconBg: const Color(0xFFD1FAE5),
            ),
          ),
        ],
      );
    });
  }

  Widget _statCard({
    required String label,
    required String value,
    required IconData icon,
    required Color iconColor,
    required Color iconBg,
  }) {
    return Container(
      padding: EdgeInsets.all(12.w),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: const Color(0xFFE1EAE4)),
        borderRadius: BorderRadius.circular(14.r),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                label.toUpperCase(),
                style: TextStyle(
                  fontSize: 8.5.sp,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.4,
                  color: _muted,
                ),
              ),
              Container(
                padding: EdgeInsets.all(5.w),
                decoration: BoxDecoration(
                  color: iconBg,
                  borderRadius: BorderRadius.circular(8.r),
                ),
                child: Icon(icon, size: 13.sp, color: iconColor),
              ),
            ],
          ),
          SizedBox(height: 6.h),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 16.sp,
              fontWeight: FontWeight.w800,
              color: _darkText,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBatches() {
    return Obx(() {
      final indexes = controller.pendingIndexes;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Index Batches',
                style: TextStyle(
                  fontSize: 14.sp,
                  fontWeight: FontWeight.w800,
                  color: _darkText,
                ),
              ),
              if (indexes.isNotEmpty)
                Container(
                  padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 3.h),
                  decoration: BoxDecoration(
                    color: const Color(0xFFE6F5EC),
                    borderRadius: BorderRadius.circular(20.r),
                  ),
                  child: Text(
                    '${indexes.length} Pending',
                    style: TextStyle(
                      fontSize: 9.5.sp,
                      fontWeight: FontWeight.w700,
                      color: _green,
                    ),
                  ),
                ),
            ],
          ),
          SizedBox(height: 10.h),
          if (controller.isFetchingPending.value)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Center(child: CircularProgressIndicator(color: _green)),
            )
          else if (indexes.isEmpty)
            _emptyState('No loans pending AM approval for this branch and date range.')
          else ...[
            _selectAllRow(),
            SizedBox(height: 8.h),
            ListView.separated(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: indexes.length,
              separatorBuilder: (_, __) => SizedBox(height: 8.h),
              itemBuilder: (_, i) => _indexCard(Map<String, dynamic>.from(indexes[i])),
            ),
            SizedBox(height: 16.h),
            _actionFooter(),
          ],
        ],
      );
    });
  }

  Widget _selectAllRow() {
    return Obx(
      () => Container(
        padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 8.h),
        decoration: BoxDecoration(
          color: const Color(0xFFF1F5F4),
          borderRadius: BorderRadius.circular(10.r),
        ),
        child: Row(
          children: [
            Checkbox(
              value: controller.isAllSelected,
              activeColor: _green,
              onChanged: (v) => controller.toggleSelectAll(v ?? false),
            ),
            Text(
              'Select all',
              style: TextStyle(fontSize: 11.5.sp, fontWeight: FontWeight.w700, color: _darkText),
            ),
            SizedBox(width: 6.w),
            Text(
              '(${controller.selectedIndexIds.length} selected)',
              style: TextStyle(fontSize: 10.sp, color: _muted),
            ),
          ],
        ),
      ),
    );
  }

  Widget _indexCard(Map<String, dynamic> idx) {
    final indexId = idx['id'].toString();
    final loans = idx['loans'] is List ? idx['loans'] as List : const [];
    return Obx(() {
      final selected = controller.selectedIndexIds.contains(indexId);
      final expanded = controller.expandedIndexId.value == indexId;
      return Container(
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(
            color: selected ? _green.withValues(alpha: 0.4) : const Color(0xFFE1EAE4),
          ),
          borderRadius: BorderRadius.circular(12.r),
        ),
        child: Column(
          children: [
            InkWell(
              onTap: () => controller.toggleExpand(indexId),
              borderRadius: BorderRadius.circular(12.r),
              child: Padding(
                padding: EdgeInsets.all(12.w),
                child: Row(
                  children: [
                    Checkbox(
                      value: selected,
                      activeColor: _green,
                      onChanged: (_) => controller.toggleSelectIndex(indexId),
                    ),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Index #${_field(idx, 'indexNo')}',
                            style: TextStyle(
                              fontSize: 12.5.sp,
                              fontWeight: FontWeight.w800,
                              color: _darkText,
                            ),
                          ),
                          SizedBox(height: 2.h),
                          Text(
                            '${_field(idx, 'centerName')} • ${idx['totalLoans'] ?? 0} loan(s) • ${_currency(_amount(idx, 'totalAmount'))}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(fontSize: 10.sp, color: _muted),
                          ),
                        ],
                      ),
                    ),
                    Icon(
                      expanded ? Icons.expand_less_rounded : Icons.expand_more_rounded,
                      color: _muted,
                    ),
                  ],
                ),
              ),
            ),
            if (expanded)
              Container(
                decoration: const BoxDecoration(
                  border: Border(top: BorderSide(color: Color(0xFFE1EAE4))),
                ),
                padding: EdgeInsets.all(10.w),
                child: Column(
                  children: loans
                      .map((l) => _loanRow(Map<String, dynamic>.from(l), _field(idx, 'centerName')))
                      .toList(),
                ),
              ),
          ],
        ),
      );
    });
  }

  void _showMemberVerificationBottomSheet(
    BuildContext context,
    String loanId,
    String clientName,
    String clientId,
  ) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _MemberVerificationBottomSheet(
        loanId: loanId,
        clientName: clientName,
        clientId: clientId,
      ),
    );
  }

  Future<void> _showEditProductSheet(Map<String, dynamic> loan) async {
    final loanId = loan['id']?.toString() ?? '';
    if (loanId.isEmpty) return;

    final currentProductId = loan['loanProductId']?.toString() ?? '';
    final branchId = controller.branchId.value ?? loan['branchId']?.toString() ?? '';

    final selectedTypeId = RxnString();
    final selectedFrequency = RxnString();
    final selectedProductId = RxnString(
      currentProductId.isEmpty ? null : currentProductId,
    );

    final isLoading = true.obs;
    final isSaving = false.obs;
    final productTypes = <dynamic>[].obs;
    final allProducts = <dynamic>[].obs;
    bool initialized = false;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20.r)),
      ),
      builder: (ctx) {
        if (isLoading.value && productTypes.isEmpty && allProducts.isEmpty) {
          Future.microtask(() async {
            try {
              final types = await _memberService.getLoanProductTypes();
              final prods = await _memberService.getProductsForBranch(branchId);
              productTypes.assignAll(types);
              allProducts.assignAll(prods);
            } catch (e) {
              Get.snackbar(
                'Error',
                'Failed to load products: $e',
                backgroundColor: Colors.redAccent,
                colorText: Colors.white,
              );
            } finally {
              isLoading.value = false;
            }
          });
        }

        return Padding(
          padding: EdgeInsets.fromLTRB(
            16.w,
            16.h,
            16.w,
            24.h + MediaQuery.of(ctx).viewInsets.bottom,
          ),
          child: Obx(() {
            if (isLoading.value) {
              return Container(
                height: 250.h,
                alignment: Alignment.center,
                child: const CircularProgressIndicator(color: _green),
              );
            }

            final types = productTypes;
            final products = allProducts;

            if (!initialized && products.isNotEmpty) {
              initialized = true;
              final curr = products.cast<Map<String, dynamic>?>().firstWhere(
                (p) => p?['id']?.toString() == currentProductId,
                orElse: () => null,
              );
              if (curr != null) {
                selectedTypeId.value = curr['loanProductTypeId']?.toString();
                selectedFrequency.value = curr['frequency']?.toString().toLowerCase();
                selectedProductId.value = curr['id']?.toString();
              }
            }

            final maxAmount = (loan['maxAllowedAmount'] is num)
                ? (loan['maxAllowedAmount'] as num).toDouble()
                : double.tryParse(loan['maxAllowedAmount']?.toString() ?? '') ??
                    ((loan['amount'] is num)
                        ? (loan['amount'] as num).toDouble()
                        : double.tryParse(loan['amount']?.toString() ?? '') ?? double.infinity);

            var typeProducts = products.where((p) {
              if (p is! Map) return false;
              final pAmount = _amount(p, 'loanAmount');
              if (maxAmount > 0 && maxAmount < double.infinity && pAmount > maxAmount) return false;
              if (selectedTypeId.value == null || selectedTypeId.value!.isEmpty) return true;
              return p['loanProductTypeId']?.toString() == selectedTypeId.value;
            }).toList();

            if (typeProducts.isEmpty && products.isNotEmpty) {
              typeProducts = products.where((p) {
                if (p is! Map) return false;
                if (selectedTypeId.value == null || selectedTypeId.value!.isEmpty) return true;
                return p['loanProductTypeId']?.toString() == selectedTypeId.value;
              }).toList();
            }

            final availableFreqs = typeProducts
                .map((p) => p['frequency']?.toString().toLowerCase() ?? '')
                .where((f) => f.isNotEmpty)
                .toSet()
                .toList();

            final filteredProducts = typeProducts.where((p) {
              if (selectedFrequency.value == null || selectedFrequency.value!.isEmpty) return true;
              return p['frequency']?.toString().toLowerCase() == selectedFrequency.value;
            }).toList();

            final selectedProduct = filteredProducts.cast<Map<String, dynamic>?>().firstWhere(
              (p) => p?['id']?.toString() == selectedProductId.value,
              orElse: () => null,
            );

            return Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      'Edit Loan Product',
                      style: TextStyle(
                        fontSize: 16.sp,
                        fontWeight: FontWeight.w800,
                        color: _darkText,
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.pop(ctx),
                      icon: const Icon(Icons.close_rounded, color: _muted),
                    ),
                  ],
                ),
                SizedBox(height: 12.h),

                Text(
                  'Loan Product Type',
                  style: TextStyle(fontSize: 11.sp, fontWeight: FontWeight.w700, color: _darkText),
                ),
                SizedBox(height: 6.h),
                IdDropdown(
                  label: 'Product Type',
                  value: selectedTypeId.value,
                  items: types,
                  labelBuilder: (_, id) {
                    final t = types.cast<Map<String, dynamic>?>().firstWhere(
                      (e) => e?['id']?.toString() == id,
                      orElse: () => null,
                    );
                    return t != null ? '${t['name']}' : id;
                  },
                  onChanged: (val) {
                    selectedTypeId.value = val;
                    selectedFrequency.value = null;
                    selectedProductId.value = null;
                  },
                ),
                SizedBox(height: 12.h),

                Text(
                  'Frequency',
                  style: TextStyle(fontSize: 11.sp, fontWeight: FontWeight.w700, color: _darkText),
                ),
                SizedBox(height: 6.h),
                DropdownButtonFormField<String>(
                  initialValue: selectedFrequency.value,
                  decoration: InputDecoration(
                    contentPadding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 10.h),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(10.r)),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10.r),
                      borderSide: const BorderSide(color: _green, width: 1.4),
                    ),
                  ),
                  hint: const Text('Select Frequency'),
                  items: availableFreqs.map<DropdownMenuItem<String>>((f) {
                    final label = f.isEmpty ? f : '${f[0].toUpperCase()}${f.substring(1)}';
                    return DropdownMenuItem<String>(
                      value: f,
                      child: Text(label, style: TextStyle(fontSize: 12.5.sp)),
                    );
                  }).toList(),
                  onChanged: (val) {
                    selectedFrequency.value = val;
                    selectedProductId.value = null;
                  },
                ),
                SizedBox(height: 12.h),

                Text(
                  'Loan Product',
                  style: TextStyle(fontSize: 11.sp, fontWeight: FontWeight.w700, color: _darkText),
                ),
                SizedBox(height: 6.h),
                IdDropdown(
                  label: 'Loan Product',
                  value: selectedProductId.value,
                  items: filteredProducts,
                  labelBuilder: (_, id) {
                    final p = filteredProducts.cast<Map<String, dynamic>?>().firstWhere(
                      (e) => e?['id']?.toString() == id,
                      orElse: () => null,
                    );
                    if (p == null) return id;
                    final amount = _currency(_amount(p, 'loanAmount'));
                    return '${p['productName']} ($amount)';
                  },
                  onChanged: (val) {
                    selectedProductId.value = val;
                  },
                ),
                SizedBox(height: 16.h),

                if (selectedProduct != null)
                  Container(
                    padding: EdgeInsets.all(12.w),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF0FAF4),
                      borderRadius: BorderRadius.circular(10.r),
                      border: Border.all(color: const Color(0xFFE1EAE4)),
                    ),
                    child: Column(
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text('New Amount:', style: TextStyle(fontSize: 11.sp, color: _muted)),
                            Text(_currency(_amount(selectedProduct, 'loanAmount')), style: TextStyle(fontSize: 12.sp, fontWeight: FontWeight.w800, color: _green)),
                          ],
                        ),
                        SizedBox(height: 4.h),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text('Interest Rate:', style: TextStyle(fontSize: 11.sp, color: _muted)),
                            Text('${_amount(selectedProduct, 'interestRate')}%', style: TextStyle(fontSize: 12.sp, fontWeight: FontWeight.w700, color: _darkText)),
                          ],
                        ),
                        SizedBox(height: 4.h),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text('Dues / Tenure:', style: TextStyle(fontSize: 11.sp, color: _muted)),
                            Text('${selectedProduct['numberOfDues']} dues', style: TextStyle(fontSize: 12.sp, fontWeight: FontWeight.w700, color: _darkText)),
                          ],
                        ),
                      ],
                    ),
                  ),

                SizedBox(height: 18.h),

                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: selectedProductId.value == null || isSaving.value
                        ? null
                        : () async {
                            isSaving.value = true;
                            try {
                              await _memberService.updateLoanProduct(
                                loanId,
                                loanProductId: selectedProductId.value!,
                                isIndexed: true,
                                stage: 'DISBURSEMENT',
                              );
                              Get.snackbar(
                                'Success',
                                'Loan product updated successfully.',
                                backgroundColor: const Color(0xFF00843D),
                                colorText: Colors.white,
                              );
                              if (ctx.mounted) Navigator.pop(ctx);
                              controller.fetchPending();
                            } catch (e) {
                              Get.snackbar(
                                'Error',
                                'Failed to update loan product: $e',
                                backgroundColor: Colors.redAccent,
                                colorText: Colors.white,
                              );
                            } finally {
                              isSaving.value = false;
                            }
                          },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: _green,
                      foregroundColor: Colors.white,
                      padding: EdgeInsets.symmetric(vertical: 13.h),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10.r)),
                    ),
                    child: isSaving.value
                        ? SizedBox(
                            width: 16.sp,
                            height: 16.sp,
                            child: const CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Text('Save Changes', style: TextStyle(fontWeight: FontWeight.bold)),
                  ),
                ),
              ],
            );
          }),
        );
      },
    );
  }

  Widget _loanRow(Map<String, dynamic> loan, String centerName) {
    final verified = loan['isVerified'] == true;
    final loanId = loan['id']?.toString() ?? '';
    final clientName = _field(loan, 'clientName');
    final clientId = _field(loan, 'clientId');
    final clientDbId = loan['clientDbId']?.toString() ??
        loan['clientId']?.toString() ??
        loan['client']?['id']?.toString() ??
        '';

    return Container(
      margin: EdgeInsets.only(bottom: 6.h),
      padding: EdgeInsets.all(10.w),
      decoration: BoxDecoration(
        color: const Color(0xFFF0FAF4),
        borderRadius: BorderRadius.circular(10.r),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(
                          clientId,
                          style: TextStyle(
                            fontSize: 11.5.sp,
                            fontWeight: FontWeight.w800,
                            color: _darkText,
                          ),
                        ),
                        SizedBox(width: 6.w),
                        InkWell(
                          onTap: () {
                            if (clientDbId.isEmpty) {
                              Get.snackbar(
                                'Highmark',
                                'No client ID on file to fetch Highmark report.',
                                backgroundColor: Colors.orange,
                                colorText: Colors.white,
                              );
                              return;
                            }
                            showHighmarkReport(
                              context,
                              api: _highmarkApi,
                              clientDbId: clientDbId,
                              clientName: clientName,
                            );
                          },
                          borderRadius: BorderRadius.circular(6.r),
                          child: Container(
                            padding: EdgeInsets.symmetric(horizontal: 6.w, vertical: 2.h),
                            decoration: BoxDecoration(
                              color: const Color(0xFFF3E8FF),
                              borderRadius: BorderRadius.circular(6.r),
                              border: Border.all(color: const Color(0xFFD8B4FE)),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Icon(Icons.shield_outlined, size: 12, color: Color(0xFF7C3AED)),
                                SizedBox(width: 3.w),
                                Text(
                                  'Highmark',
                                  style: TextStyle(
                                    fontSize: 9.5.sp,
                                    fontWeight: FontWeight.w700,
                                    color: const Color(0xFF7C3AED),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                    Text(
                      clientName,
                      style: TextStyle(fontSize: 10.sp, color: _muted),
                    ),
                  ],
                ),
              ),
              Text(
                _currency(_amount(loan, 'amount')),
                style: TextStyle(
                  fontSize: 12.sp,
                  fontWeight: FontWeight.w800,
                  color: _green,
                ),
              ),
            ],
          ),
          SizedBox(height: 6.h),
          Row(
            children: [
              _tag(_field(loan, 'purpose')),
              SizedBox(width: 6.w),
              _tag(_field(loan, 'frequency')),
              const Spacer(),
              Container(
                padding: EdgeInsets.symmetric(horizontal: 7.w, vertical: 3.h),
                decoration: BoxDecoration(
                  color: verified ? const Color(0xFFD1FAE5) : const Color(0xFFFEF3C7),
                  borderRadius: BorderRadius.circular(20.r),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      verified ? Icons.check_circle_rounded : Icons.warning_amber_rounded,
                      size: 11.sp,
                      color: verified ? const Color(0xFF065F46) : const Color(0xFF92400E),
                    ),
                    SizedBox(width: 3.w),
                    Text(
                      verified ? 'Verified' : 'Incomplete',
                      style: TextStyle(
                        fontSize: 9.sp,
                        fontWeight: FontWeight.w700,
                        color: verified ? const Color(0xFF065F46) : const Color(0xFF92400E),
                      ),
                    ),
                  ],
                ),
              ),
              SizedBox(width: 6.w),
              InkWell(
                onTap: () => _showEditProductSheet(loan),
                borderRadius: BorderRadius.circular(6.r),
                child: Container(
                  padding: EdgeInsets.symmetric(horizontal: 7.w, vertical: 3.h),
                  decoration: BoxDecoration(
                    color: const Color(0xFFE8F5E9),
                    borderRadius: BorderRadius.circular(6.r),
                    border: Border.all(color: const Color(0xFFA7F3D0)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.edit_outlined, size: 12.sp, color: _green),
                      SizedBox(width: 3.w),
                      Text(
                        'Edit',
                        style: TextStyle(
                          fontSize: 9.5.sp,
                          fontWeight: FontWeight.w700,
                          color: _green,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          SizedBox(height: 8.h),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () => _showMemberVerificationBottomSheet(
                context,
                loanId,
                clientName,
                clientId,
              ),
              style: OutlinedButton.styleFrom(
                foregroundColor: _green,
                side: const BorderSide(color: _green),
                padding: EdgeInsets.symmetric(vertical: 6.h),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8.r),
                ),
              ),
              icon: Icon(Icons.photo_library_outlined, size: 14.sp),
              label: Text(
                'View Photos & Verification',
                style: TextStyle(fontSize: 10.5.sp, fontWeight: FontWeight.w700),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _tag(String label) => Container(
    padding: EdgeInsets.symmetric(horizontal: 7.w, vertical: 3.h),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(6.r),
    ),
    child: Text(
      label,
      style: TextStyle(fontSize: 9.sp, color: _green, fontWeight: FontWeight.w600),
    ),
  );

  Widget _actionFooter() {
    return Obx(
      () => Row(
        children: [
          Expanded(
            child: OutlinedButton.icon(
              onPressed:
                  controller.selectedIndexIds.isEmpty || controller.isSubmitting.value
                  ? null
                  : () => _confirmAndSubmit('REJECT'),
              style: OutlinedButton.styleFrom(
                foregroundColor: Colors.red,
                side: const BorderSide(color: Colors.red),
                padding: EdgeInsets.symmetric(vertical: 13.h),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10.r),
                ),
              ),
              icon: const Icon(Icons.gpp_bad_rounded, size: 18),
              label: const Text('Reject'),
            ),
          ),
          SizedBox(width: 10.w),
          Expanded(
            flex: 2,
            child: ElevatedButton.icon(
              onPressed:
                  controller.selectedIndexIds.isEmpty || controller.isSubmitting.value
                  ? null
                  : () => _confirmAndSubmit('APPROVE'),
              style: ElevatedButton.styleFrom(
                backgroundColor: _green,
                foregroundColor: Colors.white,
                padding: EdgeInsets.symmetric(vertical: 13.h),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10.r),
                ),
              ),
              icon: controller.isSubmitting.value
                  ? SizedBox(
                      width: 16.sp,
                      height: 16.sp,
                      child: const CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.check_circle_rounded, size: 18),
              label: const Text('Approve for Disbursement'),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _confirmAndSubmit(String action) async {
    if (action == 'APPROVE') {
      final unverified = controller.unverifiedClientNamesInSelection;
      if (unverified.isNotEmpty) {
        Get.snackbar(
          'Complete Member Individual & GRT first',
          'Cannot approve — pending for: ${unverified.join(', ')}.',
          backgroundColor: Colors.redAccent,
          colorText: Colors.white,
          duration: const Duration(seconds: 5),
        );
        return;
      }
    }

    final count = controller.selectedIndexIds.length;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(action == 'REJECT' ? 'Reject Loans' : 'Approve for Disbursement'),
        content: Text(
          action == 'APPROVE'
              ? 'You are approving $count index batch(es) for disbursement. The Branch '
                    'Manager will then perform the final disbursal.'
              : 'You are about to reject $count index batch(es). All loans in those '
                    'batches will be marked as rejected.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: action == 'REJECT' ? Colors.red : _green,
            ),
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text(action == 'REJECT' ? 'Reject' : 'Approve for Disbursement'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await controller.submitAction(action);
    }
  }

  Widget _emptyState(String message) => Container(
    width: double.infinity,
    padding: EdgeInsets.symmetric(vertical: 28.h),
    decoration: BoxDecoration(
      border: Border.all(color: const Color(0xFFE1EAE4)),
      borderRadius: BorderRadius.circular(12.r),
    ),
    child: Column(
      children: [
        Icon(Icons.folder_open_rounded, size: 34.sp, color: _muted),
        SizedBox(height: 8.h),
        Text(
          message,
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 11.sp, color: _muted),
        ),
      ],
    ),
  );
}

class _MemberVerificationBottomSheet extends StatefulWidget {
  const _MemberVerificationBottomSheet({
    required this.loanId,
    required this.clientName,
    required this.clientId,
  });

  final String loanId;
  final String clientName;
  final String clientId;

  @override
  State<_MemberVerificationBottomSheet> createState() =>
      _MemberVerificationBottomSheetState();
}

class _MemberVerificationBottomSheetState
    extends State<_MemberVerificationBottomSheet> {
  bool _isLoading = true;
  String? _errorMessage;
  Map<String, dynamic>? _data;
  final Map<String, String> _signedUrlCache = {};
  final Set<String> _resolvingKeys = {};

  @override
  void initState() {
    super.initState();
    _fetchDetails();
  }

  Future<void> _fetchDetails() async {
    try {
      final api = MemberIndividualApiService(Get.find<ApiClient>());
      final result = await api.getMemberIndividual(widget.loanId);
      if (mounted) {
        setState(() {
          _data = result;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = e.toString();
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _resolveSignedUrl(String rawKey) async {
    final key = rawKey.trim();
    if (key.isEmpty ||
        key.startsWith('http://') ||
        key.startsWith('https://') ||
        key.startsWith('data:')) {
      return;
    }
    if (key.startsWith('/')) {
      _signedUrlCache[key] = '${Api.baseUrl}$key';
      return;
    }
    if (_signedUrlCache.containsKey(key) || _resolvingKeys.contains(key)) {
      return;
    }

    _resolvingKeys.add(key);
    try {
      final api = MemberIndividualApiService(Get.find<ApiClient>());
      final rawUrl = await api.getSignedUrl(key);
      if (rawUrl != null && rawUrl.isNotEmpty) {
        String finalUrl = rawUrl;
        if (finalUrl.startsWith('/')) {
          finalUrl = '${Api.baseUrl}$finalUrl';
        }
        if (mounted) {
          setState(() {
            _signedUrlCache[key] = finalUrl;
          });
        }
      }
    } catch (e) {
      debugPrint('Failed to resolve signed URL for key $key: $e');
    } finally {
      _resolvingKeys.remove(key);
    }
  }

  String _getResolvedUrl(String rawKey) {
    final key = rawKey.trim();
    if (key.isEmpty) return '';
    if (key.startsWith('http://') ||
        key.startsWith('https://') ||
        key.startsWith('data:')) {
      return key;
    }
    if (key.startsWith('/')) {
      return '${Api.baseUrl}$key';
    }
    if (_signedUrlCache.containsKey(key)) {
      return _signedUrlCache[key]!;
    }
    _resolveSignedUrl(key);
    return '';
  }

  void _showFullImage(String url, String title, String uploader, String date) {
    String fullUrl = _getResolvedUrl(url);
    if (fullUrl.isEmpty) {
      fullUrl = url.isNotEmpty && !url.startsWith('http')
          ? (url.startsWith('/') ? '${Api.baseUrl}$url' : '${Api.baseUrl}/$url')
          : url;
    }
    showDialog(
      context: context,
      builder: (ctx) => Dialog(
        backgroundColor: Colors.black,
        insetPadding: EdgeInsets.all(12.w),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            AppBar(
              backgroundColor: Colors.transparent,
              elevation: 0,
              title: Text(title, style: TextStyle(fontSize: 14.sp, color: Colors.white)),
              leading: IconButton(
                icon: const Icon(Icons.close, color: Colors.white),
                onPressed: () => Navigator.of(ctx).pop(),
              ),
            ),
            Flexible(
              child: ClipRRect(
                borderRadius: BorderRadius.circular(8.r),
                child: Image.network(
                  fullUrl,
                  fit: BoxFit.contain,
                  errorBuilder: (_, __, ___) => const Center(
                    child: Text('Failed to load image', style: TextStyle(color: Colors.white70)),
                  ),
                ),
              ),
            ),
            if (uploader.isNotEmpty) ...[
              Padding(
                padding: EdgeInsets.all(12.w),
                child: Text(
                  'Uploaded by: $uploader ${date.isNotEmpty ? '• $date' : ''}',
                  style: TextStyle(fontSize: 11.sp, color: Colors.white70),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _distanceBadge(String label, dynamic distanceMeters, {double? radius}) {
    if (distanceMeters == null) return const SizedBox.shrink();
    final meters = (distanceMeters is num)
        ? distanceMeters.toDouble()
        : (double.tryParse('$distanceMeters') ?? 0.0);
    final isKm = meters >= 1000;
    final displayDist = isKm
        ? '${(meters / 1000).toStringAsFixed(2)} km'
        : '${meters.round()} m';

    final outOfRange = radius != null && meters > radius;
    final bgColor = outOfRange ? const Color(0xFFFEE2E2) : const Color(0xFFE6F5EC);
    final textColor = outOfRange ? const Color(0xFF991B1B) : const Color(0xFF065F46);

    return Container(
      padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 4.h),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(6.r),
        border: Border.all(color: outOfRange ? const Color(0xFFFCA5A5) : const Color(0xFFA7F3D0)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            outOfRange ? Icons.warning_amber_rounded : Icons.location_on_rounded,
            size: 11.sp,
            color: textColor,
          ),
          SizedBox(width: 4.w),
          Text(
            '$label: $displayDist${radius != null ? (outOfRange ? ' (Out of ${radius.round()}m range)' : ' ✓') : ''}',
            style: TextStyle(
              fontSize: 10.sp,
              fontWeight: FontWeight.w700,
              color: textColor,
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      height: MediaQuery.of(context).size.height * 0.85,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(20.r)),
      ),
      child: Column(
        children: [
          Container(
            margin: EdgeInsets.only(top: 8.h, bottom: 4.h),
            width: 40.w,
            height: 4.h,
            decoration: BoxDecoration(
              color: const Color(0xFFCBD5E1),
              borderRadius: BorderRadius.circular(2.r),
            ),
          ),
          Padding(
            padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 8.h),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Client Photos & Verification',
                        style: TextStyle(
                          fontSize: 15.sp,
                          fontWeight: FontWeight.w800,
                          color: _darkText,
                        ),
                      ),
                      Text(
                        '${widget.clientId} • ${widget.clientName}',
                        style: TextStyle(fontSize: 11.sp, color: _muted),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close_rounded),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator(color: _green))
                : _errorMessage != null
                    ? Center(
                        child: Text(
                          _errorMessage!,
                          style: TextStyle(color: Colors.red, fontSize: 12.sp),
                        ),
                      )
                    : _buildContent(),
          ),
        ],
      ),
    );
  }

  Widget _buildStatusPill(String label, bool isDone) {
    final color = isDone ? const Color(0xFF00843D) : const Color(0xFFD97706);
    final bg = isDone ? const Color(0xFFE8F7EE) : const Color(0xFFFEF3C7);
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 5.h),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(20.r),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            isDone ? Icons.check_circle_rounded : Icons.radio_button_unchecked_rounded,
            size: 13.sp,
            color: color,
          ),
          SizedBox(width: 4.w),
          Text(
            label,
            style: TextStyle(
              fontSize: 10.5.sp,
              fontWeight: FontWeight.w700,
              color: color,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLoanInfoCard(Map loan) {
    if (loan.isEmpty) return const SizedBox.shrink();
    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(12.w),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: const Color(0xFFE2E8F0)),
        borderRadius: BorderRadius.circular(12.r),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.03),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Loan Details',
                style: TextStyle(
                  fontSize: 13.sp,
                  fontWeight: FontWeight.w800,
                  color: _darkText,
                ),
              ),
              if (loan['loanNumber'] != null)
                Container(
                  padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 3.h),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF1F5F9),
                    borderRadius: BorderRadius.circular(6.r),
                  ),
                  child: Text(
                    loan['loanNumber'].toString(),
                    style: TextStyle(
                      fontSize: 10.5.sp,
                      fontWeight: FontWeight.w700,
                      color: const Color(0xFF475569),
                    ),
                  ),
                ),
            ],
          ),
          SizedBox(height: 10.h),
          Wrap(
            spacing: 16.w,
            runSpacing: 8.h,
            children: [
              if (loan['amount'] != null)
                _infoStat('Loan Amount', '₹${loan['amount']}'),
              if (loan['productName'] != null)
                _infoStat('Product', loan['productName'].toString()),
              if (loan['tenureMonths'] != null)
                _infoStat('Tenure', '${loan['tenureMonths']} Months'),
              if (loan['frequency'] != null)
                _infoStat('Frequency', loan['frequency'].toString()),
              if (loan['interestRate'] != null)
                _infoStat('Interest Rate', '${loan['interestRate']}%'),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildCashFlowCard(Map cashFlow) {
    final monthlyExp = cashFlow['monthlyExpense'];
    final food = cashFlow['foodExpense'];
    final medical = cashFlow['medicalExpense'];
    final cooking = cashFlow['cookingFuelExpense'];
    final elec = cashFlow['electricityExpense'];
    final transport = cashFlow['transportExpense'];
    final water = cashFlow['waterExpense'];
    final edu = cashFlow['educationalExpense'];

    final hasExpenses = monthlyExp != null || food != null || medical != null;
    if (!hasExpenses) return const SizedBox.shrink();

    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(12.w),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        border: Border.all(color: const Color(0xFFE2E8F0)),
        borderRadius: BorderRadius.circular(12.r),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Cash Flow Assessment',
                style: TextStyle(
                  fontSize: 12.5.sp,
                  fontWeight: FontWeight.w800,
                  color: _darkText,
                ),
              ),
              if (monthlyExp != null)
                Text(
                  'Total: ₹$monthlyExp / mo',
                  style: TextStyle(
                    fontSize: 11.sp,
                    fontWeight: FontWeight.w800,
                    color: _green,
                  ),
                ),
            ],
          ),
          SizedBox(height: 8.h),
          Wrap(
            spacing: 12.w,
            runSpacing: 6.h,
            children: [
              if (food != null) _infoStat('Food', '₹$food'),
              if (medical != null) _infoStat('Medical', '₹$medical'),
              if (cooking != null) _infoStat('Cooking Fuel', '₹$cooking'),
              if (elec != null) _infoStat('Electricity', '₹$elec'),
              if (transport != null) _infoStat('Transport', '₹$transport'),
              if (water != null) _infoStat('Water', '₹$water'),
              if (edu != null) _infoStat('Education', '₹$edu'),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildGrtQuestionsList(List grtQuestions) {
    if (grtQuestions.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'GRT Questionnaire Answers',
          style: TextStyle(
            fontSize: 12.sp,
            fontWeight: FontWeight.w800,
            color: _darkText,
          ),
        ),
        SizedBox(height: 8.h),
        ListView.separated(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: grtQuestions.length,
          separatorBuilder: (_, __) => SizedBox(height: 6.h),
          itemBuilder: (_, index) {
            final q = Map<String, dynamic>.from(grtQuestions[index] as Map);
            final questionText = q['question']?.toString() ?? '';
            final qType = q['questionType']?.toString() ?? '';
            final photos = q['photos'] is List ? (q['photos'] as List) : [];

            String answerDisplay = '—';
            if (qType == 'TEXT') {
              answerDisplay = q['answerText']?.toString() ?? '—';
            } else if (qType == 'YES_OR_NO') {
              final boolVal = q['answerBool'];
              answerDisplay = boolVal == null ? '—' : (boolVal == true ? 'Yes' : 'No');
            } else if (qType == 'SINGLE_CHOICE' || qType == 'MULTIPLE_CHOICE') {
              final choices = q['choices'] is List ? (q['choices'] as List) : [];
              final ansChoiceIds = q['answerChoiceIds'] is List
                  ? (q['answerChoiceIds'] as List).map((id) => id.toString()).toSet()
                  : <String>{};
              final selectedLabels = choices
                  .where((c) => ansChoiceIds.contains(c['id']?.toString()))
                  .map((c) => c['choice']?.toString() ?? '')
                  .where((l) => l.isNotEmpty)
                  .toList();
              answerDisplay = selectedLabels.isNotEmpty ? selectedLabels.join(', ') : '—';
            }

            return Container(
              padding: EdgeInsets.all(10.w),
              decoration: BoxDecoration(
                color: Colors.white,
                border: Border.all(color: const Color(0xFFE2E8F0)),
                borderRadius: BorderRadius.circular(8.r),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${index + 1}. $questionText',
                    style: TextStyle(
                      fontSize: 11.sp,
                      fontWeight: FontWeight.w700,
                      color: _darkText,
                    ),
                  ),
                  SizedBox(height: 4.h),
                  Text(
                    'Answer: $answerDisplay',
                    style: TextStyle(
                      fontSize: 11.sp,
                      fontWeight: FontWeight.w600,
                      color: const Color(0xFF0284C7),
                    ),
                  ),
                  if (photos.isNotEmpty) ...[
                    SizedBox(height: 6.h),
                    Wrap(
                      spacing: 6.w,
                      runSpacing: 6.h,
                      children: photos.map((p) {
                        final photoMap = Map<String, dynamic>.from(p);
                        return _photoTile(
                          url: photoMap['photoUrl'].toString(),
                          title: questionText,
                          uploadedBy: photoMap['uploadedByName']?.toString() ?? '',
                          createdAt: photoMap['createdAt']?.toString() ?? '',
                          isThumbnail: true,
                        );
                      }).toList(),
                    ),
                  ],
                ],
              ),
            );
          },
        ),
      ],
    );
  }

  Widget _infoStat(String label, String value) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(fontSize: 10.sp, color: _muted),
        ),
        SizedBox(height: 2.h),
        Text(
          value,
          style: TextStyle(
            fontSize: 12.sp,
            fontWeight: FontWeight.w700,
            color: _darkText,
          ),
        ),
      ],
    );
  }

  Widget _buildContent() {
    final d = _data!;
    final loan = d['loan'] is Map ? Map<String, dynamic>.from(d['loan']) : {};
    final center = d['center'] is Map ? Map<String, dynamic>.from(d['center']) : {};
    final cashFlow = d['cashFlow'] is Map ? Map<String, dynamic>.from(d['cashFlow']) : {};
    final loanAppraisal = d['loanAppraisal'] is Map ? Map<String, dynamic>.from(d['loanAppraisal']) : {};
    final houseHoldVisit = d['houseHoldVisit'] is Map ? Map<String, dynamic>.from(d['houseHoldVisit']) : {};
    final fdoHouseImage = houseHoldVisit['fdoHouseImage'] is Map ? Map<String, dynamic>.from(houseHoldVisit['fdoHouseImage']) : null;
    final photos = houseHoldVisit['photos'] is List ? (houseHoldVisit['photos'] as List) : [];
    final grt = d['grt'] is Map ? Map<String, dynamic>.from(d['grt']) : {};
    final grtQuestions = grt['questions'] is List ? (grt['questions'] as List) : [];
    final grtSessionPhotos = grt['sessionPhotos'] is List ? (grt['sessionPhotos'] as List) : [];
    final client = d['client'] is Map ? Map<String, dynamic>.from(d['client']) : {};
    final isComplete = d['isComplete'] == true;

    final mandatoryPhoto = photos.firstWhereOrNull((p) => p['isMandatory'] == true);
    final optionalPhotos = photos.where((p) => p['isMandatory'] != true).toList();

    final isCashFlowDone = cashFlow['completedAt'] != null;
    final isAppraisalDone = loanAppraisal['reviewedAt'] != null;
    final isHouseVisitDone = houseHoldVisit['completedAt'] != null;
    final isGrtDone = grt['completedAt'] != null;

    return SingleChildScrollView(
      padding: EdgeInsets.all(16.w),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 1. Verification Progress Status Badges
          Wrap(
            spacing: 6.w,
            runSpacing: 6.h,
            children: [
              _buildStatusPill('Cash Flow', isCashFlowDone),
              _buildStatusPill('Loan Appraisal', isAppraisalDone),
              _buildStatusPill('House Visit', isHouseVisitDone),
              _buildStatusPill('GRT', isGrtDone),
            ],
          ),
          SizedBox(height: 10.h),

          if (!isComplete) ...[
            Container(
              width: double.infinity,
              padding: EdgeInsets.all(10.w),
              decoration: BoxDecoration(
                color: const Color(0xFFFFFBEB),
                border: Border.all(color: const Color(0xFFFCD34D)),
                borderRadius: BorderRadius.circular(8.r),
              ),
              child: Row(
                children: [
                  Icon(Icons.warning_amber_rounded, size: 16.sp, color: const Color(0xFFD97706)),
                  SizedBox(width: 8.w),
                  Expanded(
                    child: Text(
                      'Member Individual / GRT not complete — cannot approve for disbursement until all steps above are completed.',
                      style: TextStyle(fontSize: 10.5.sp, color: const Color(0xFFB45309), fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
              ),
            ),
            SizedBox(height: 12.h),
          ],

          // 2. Center Info Card
          if (center['name'] != null) ...[
            Container(
              width: double.infinity,
              padding: EdgeInsets.all(10.w),
              decoration: BoxDecoration(
                color: const Color(0xFFF1F5F4),
                borderRadius: BorderRadius.circular(10.r),
              ),
              child: Row(
                children: [
                  Icon(Icons.storefront_rounded, size: 16.sp, color: _green),
                  SizedBox(width: 8.w),
                  Text(
                    'Center: ${center['name']}${center['code'] != null ? ' (${center['code']})' : ''}',
                    style: TextStyle(
                      fontSize: 12.sp,
                      fontWeight: FontWeight.w700,
                      color: _darkText,
                    ),
                  ),
                ],
              ),
            ),
            SizedBox(height: 12.h),
          ],

          // 3. Loan Application Overview Card
          _buildLoanInfoCard(loan),
          SizedBox(height: 12.h),

          // 4. Cash Flow Assessment Card
          _buildCashFlowCard(cashFlow),
          if (cashFlow.isNotEmpty) SizedBox(height: 14.h),

          const Divider(),
          SizedBox(height: 8.h),

          // 5. FDO Enrollment House Image & Location
          _sectionHeader('FDO Enrollment House Image', Icons.home_rounded),
          SizedBox(height: 8.h),
          if (fdoHouseImage != null && fdoHouseImage['photoUrl'] != null) ...[
            _photoTile(
              url: fdoHouseImage['photoUrl'].toString(),
              title: 'FDO House Image',
              uploadedBy: fdoHouseImage['uploadedByName']?.toString() ?? 'FDO',
              createdAt: fdoHouseImage['createdAt']?.toString() ?? '',
            ),
          ] else ...[
            _noPhotoCard('No house photo uploaded by FDO during enrollment.'),
          ],
          if (client['latitude'] != null && client['longitude'] != null) ...[
            SizedBox(height: 6.h),
            Row(
              children: [
                Icon(Icons.pin_drop_rounded, size: 13.sp, color: _muted),
                SizedBox(width: 4.w),
                Text(
                  'FDO GPS: ${client['latitude']}, ${client['longitude']}',
                  style: TextStyle(fontSize: 10.5.sp, color: _muted),
                ),
              ],
            ),
          ],

          SizedBox(height: 16.h),
          const Divider(),
          SizedBox(height: 8.h),

          // 6. BM Verification Photos (House Assessment)
          _sectionHeader('BM Verification Photos (House Assessment)', Icons.verified_user_rounded),
          SizedBox(height: 8.h),
          if (mandatoryPhoto != null) ...[
            _photoTile(
              url: mandatoryPhoto['photoUrl'].toString(),
              title: 'BM Mandatory Photo',
              uploadedBy: mandatoryPhoto['uploadedByName']?.toString() ?? 'BM',
              createdAt: mandatoryPhoto['createdAt']?.toString() ?? '',
              badges: [
                if (mandatoryPhoto['distanceFromBranchMeters'] != null)
                  _distanceBadge('Branch', mandatoryPhoto['distanceFromBranchMeters']),
                if (mandatoryPhoto['distanceMeters'] != null)
                  _distanceBadge('Center', mandatoryPhoto['distanceMeters'], radius: 500),
                if (mandatoryPhoto['distanceFromClientMeters'] != null)
                  _distanceBadge('FDO', mandatoryPhoto['distanceFromClientMeters'], radius: 100),
              ],
            ),
          ] else ...[
            _noPhotoCard('No BM mandatory verification photo captured yet.'),
          ],
          if (optionalPhotos.isNotEmpty) ...[
            SizedBox(height: 10.h),
            Text(
              'Additional House Photos:',
              style: TextStyle(fontSize: 11.sp, fontWeight: FontWeight.w700, color: _muted),
            ),
            SizedBox(height: 6.h),
            Wrap(
              spacing: 8.w,
              runSpacing: 8.h,
              children: optionalPhotos.map((p) {
                final photoMap = Map<String, dynamic>.from(p);
                return _photoTile(
                  url: photoMap['photoUrl'].toString(),
                  title: 'Additional Photo',
                  uploadedBy: photoMap['uploadedByName']?.toString() ?? '',
                  createdAt: photoMap['createdAt']?.toString() ?? '',
                  isThumbnail: true,
                );
              }).toList(),
            ),
          ],

          SizedBox(height: 16.h),
          const Divider(),
          SizedBox(height: 8.h),

          // 7. GRT Questionnaire & Session Details
          _sectionHeader('GRT Verification & Questionnaire', Icons.fact_check_rounded),
          SizedBox(height: 8.h),
          if (grt['completedSessionId'] != null) ...[
            Text(
              'Session ID: ${grt['completedSessionId']}${grt['questionnaireTitle'] != null ? ' — ${grt['questionnaireTitle']}' : ''}',
              style: TextStyle(fontSize: 11.sp, fontWeight: FontWeight.w700, color: _green),
            ),
            SizedBox(height: 10.h),
          ],

          // GRT Questions & Answers
          _buildGrtQuestionsList(grtQuestions),
          if (grtQuestions.isNotEmpty) SizedBox(height: 12.h),

          if (grtSessionPhotos.isNotEmpty) ...[
            Text(
              'Center Session Photos:',
              style: TextStyle(fontSize: 11.sp, fontWeight: FontWeight.w700, color: _muted),
            ),
            SizedBox(height: 6.h),
            Wrap(
              spacing: 8.w,
              runSpacing: 8.h,
              children: grtSessionPhotos.map((p) {
                final pMap = Map<String, dynamic>.from(p);
                return _photoTile(
                  url: pMap['photoUrl'].toString(),
                  title: 'GRT Session Photo',
                  uploadedBy: pMap['uploadedByName']?.toString() ?? '',
                  createdAt: pMap['createdAt']?.toString() ?? '',
                  isThumbnail: true,
                );
              }).toList(),
            ),
          ] else if (grtQuestions.isEmpty && !grtQuestions.any((q) => q['photos'] is List && (q['photos'] as List).isNotEmpty)) ...[
            _noPhotoCard('No GRT session photos uploaded.'),
          ],
        ],
      ),
    );
  }

  Widget _sectionHeader(String title, IconData icon) {
    return Row(
      children: [
        Icon(icon, size: 16.sp, color: _green),
        SizedBox(width: 6.w),
        Text(
          title,
          style: TextStyle(
            fontSize: 13.sp,
            fontWeight: FontWeight.w800,
            color: _darkText,
          ),
        ),
      ],
    );
  }

  Widget _noPhotoCard(String message) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(10.w),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        border: Border.all(color: const Color(0xFFE2E8F0)),
        borderRadius: BorderRadius.circular(8.r),
      ),
      child: Text(
        message,
        style: TextStyle(fontSize: 11.sp, color: _muted),
      ),
    );
  }

  Widget _photoTile({
    required String url,
    required String title,
    required String uploadedBy,
    required String createdAt,
    List<Widget>? badges,
    bool isThumbnail = false,
  }) {
    final resolvedUrl = _getResolvedUrl(url);
    final isResolving = url.trim().isNotEmpty &&
        !url.startsWith('http://') &&
        !url.startsWith('https://') &&
        !url.startsWith('/') &&
        resolvedUrl.isEmpty;

    Widget imageWidget;
    if (isResolving) {
      imageWidget = Container(
        width: isThumbnail ? 70.w : 90.w,
        height: isThumbnail ? 70.w : 70.h,
        color: const Color(0xFFEFF3F1),
        alignment: Alignment.center,
        child: SizedBox(
          width: 16.sp,
          height: 16.sp,
          child: const CircularProgressIndicator(strokeWidth: 2, color: _green),
        ),
      );
    } else {
      final displayUrl = resolvedUrl.isNotEmpty ? resolvedUrl : (
        url.isNotEmpty && !url.startsWith('http')
            ? (url.startsWith('/') ? '${Api.baseUrl}$url' : '${Api.baseUrl}/$url')
            : url
      );

      imageWidget = Image.network(
        displayUrl,
        width: isThumbnail ? 70.w : 90.w,
        height: isThumbnail ? 70.w : 70.h,
        fit: BoxFit.cover,
        errorBuilder: (_, __, ___) => Container(
          width: isThumbnail ? 70.w : 90.w,
          height: isThumbnail ? 70.w : 70.h,
          color: const Color(0xFFEFF3F1),
          child: Icon(Icons.image_outlined, size: isThumbnail ? 20.sp : 24.sp, color: _muted),
        ),
      );
    }

    if (isThumbnail) {
      return GestureDetector(
        onTap: () => _showFullImage(url, title, uploadedBy, createdAt),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(8.r),
          child: imageWidget,
        ),
      );
    }

    return GestureDetector(
      onTap: () => _showFullImage(url, title, uploadedBy, createdAt),
      child: Container(
        padding: EdgeInsets.all(10.w),
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(color: const Color(0xFFE1EAE4)),
          borderRadius: BorderRadius.circular(10.r),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(8.r),
                  child: imageWidget,
                ),
                SizedBox(width: 12.w),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: TextStyle(
                          fontSize: 11.5.sp,
                          fontWeight: FontWeight.w700,
                          color: _darkText,
                        ),
                      ),
                      if (uploadedBy.isNotEmpty) ...[
                        SizedBox(height: 3.h),
                        Text(
                          'Uploaded by: $uploadedBy',
                          style: TextStyle(fontSize: 10.sp, color: _muted),
                        ),
                      ],
                      if (badges != null && badges.isNotEmpty) ...[
                        SizedBox(height: 6.h),
                        Wrap(
                          spacing: 4.w,
                          runSpacing: 4.h,
                          children: badges,
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
