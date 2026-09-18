import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:sarvam/controller/member_individual_detail_controller.dart';
import 'package:sarvam/services/api_client.dart';
import 'package:sarvam/services/enrollment_api_service.dart';
import 'package:sarvam/view/BM/group_assignment/widgets/id_dropdown.dart';
import 'package:sarvam/view/shared/highmark_report_sheet.dart';

const _green = Color(0xFF0D6842);
const _darkText = Color(0xFF172033);
const _muted = Color(0xFF64748B);

/// One loan's Member Individual fill-in — mirrors the Cash Flow / Loan
/// Appraisal / House Hold Visit tabs of the web app's
/// `MemberIndividualDetailPage.tsx` (GRT stays web-only). Product change on
/// Loan Appraisal is a web-only action for now — this tab just reviews and
/// marks complete.
class MemberIndividualDetail extends StatefulWidget {
  const MemberIndividualDetail({super.key, required this.loanId});

  final String loanId;

  @override
  State<MemberIndividualDetail> createState() => _MemberIndividualDetailState();
}

class _MemberIndividualDetailState extends State<MemberIndividualDetail>
    with SingleTickerProviderStateMixin {
  late final MemberIndividualDetailController controller =
      MemberIndividualDetailController(widget.loanId);

  // Owned directly instead of via DefaultTabController — the "Save &
  // Continue" / "Mark Reviewed" buttons need to programmatically switch
  // tabs from a callback whose BuildContext is this State's own context,
  // which sits *above* DefaultTabController in the tree (it's created
  // inside build()), so DefaultTabController.of(context) can't find it.
  late final TabController _tabController = TabController(
    length: 3,
    vsync: this,
  );

  @override
  void initState() {
    super.initState();
    controller.loadRecord();
  }

  @override
  void dispose() {
    _tabController.dispose();
    controller.disposeControllers();
    super.dispose();
  }

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

  String _formatDateTime(dynamic value) {
    if (value == null) return '';
    final dt = DateTime.tryParse(value.toString());
    if (dt == null) return '';
    final local = dt.toLocal();
    return '${local.day.toString().padLeft(2, '0')}-${local.month.toString().padLeft(2, '0')}-${local.year} '
        '${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
  }

  String _initials(String name) {
    final parts = name.split(' ').where((w) => w.trim().isNotEmpty).take(2);
    final letters = parts.map((w) => w[0].toUpperCase()).join();
    return letters.isEmpty ? '?' : letters;
  }

  @override
  Widget build(BuildContext context) {
    return Theme(
      data: Theme.of(context).copyWith(
        textTheme: GoogleFonts.poppinsTextTheme(Theme.of(context).textTheme),
      ),
      child: Scaffold(
        backgroundColor: const Color(0xFFF7FBF8),
        body: SafeArea(
          child: Obx(() {
            if (controller.isLoading.value && controller.record.value == null) {
              return const Center(
                child: CircularProgressIndicator(color: _green),
              );
            }
            return Column(
              children: [
                Padding(
                  padding: EdgeInsets.fromLTRB(12.w, 8.h, 12.w, 0),
                  child: _buildHeroHeader(),
                ),
                Padding(
                  padding: EdgeInsets.fromLTRB(12.w, 10.h, 12.w, 0),
                  child: _buildGrtBanner(),
                ),
                Padding(
                  padding: EdgeInsets.fromLTRB(12.w, 10.h, 12.w, 0),
                  child: _buildTabBar(),
                ),
                Expanded(
                  child: TabBarView(
                    controller: _tabController,
                    children: [
                      _buildCashFlowTab(),
                      _buildLoanAppraisalTab(),
                      _buildHouseholdVisitTab(),
                    ],
                  ),
                ),
              ],
            );
          }),
        ),
      ),
    );
  }

  // Mirrors the web's gradient "Hero header" — back button, avatar
  // initials, client name/loan/center, and the "X/3 tabs complete" +
  // All Complete/Pending badges.
  Widget _buildHeroHeader() {
    final loan = controller.loan;
    final clientName = _field(loan, 'clientName', '');
    return Container(
      width: double.infinity,
      padding: EdgeInsets.fromLTRB(8.w, 10.h, 14.w, 14.h),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF013318), Color(0xFF025C27), Color(0xFF037F35)],
        ),
        borderRadius: BorderRadius.circular(16.r),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              IconButton(
                onPressed: () => Navigator.maybePop(context),
                icon: const Icon(Icons.arrow_back, color: Colors.white),
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
              ),
              SizedBox(width: 8.w),
              CircleAvatar(
                radius: 20.r,
                backgroundColor: Colors.white.withValues(alpha: 0.15),
                child: Text(
                  _initials(clientName),
                  style: TextStyle(
                    fontSize: 12.5.sp,
                    fontWeight: FontWeight.w800,
                    color: Colors.white,
                  ),
                ),
              ),
              SizedBox(width: 10.w),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      loan.isEmpty
                          ? 'Member Individual'
                          : '${_field(loan, 'clientDisplayId')} — $clientName',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 14.sp,
                        fontWeight: FontWeight.w800,
                        color: Colors.white,
                      ),
                    ),
                    SizedBox(height: 2.h),
                    Text(
                      '${_field(loan, 'loanNumber')} · ${_field(controller.center, 'name')}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 10.5.sp,
                        color: const Color(0xFFBBF0CE),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          SizedBox(height: 10.h),
          Row(
            children: [
              _heroBadge(
                '${controller.completedTabsCount}/3 tabs complete',
                background: Colors.white.withValues(alpha: 0.15),
                textColor: Colors.white,
              ),
              SizedBox(width: 6.w),
              _heroBadge(
                controller.isComplete ? 'All Complete' : 'Pending',
                background: controller.isComplete
                    ? const Color(0xFF34D399)
                    : const Color(0xFFFCD34D),
                textColor: controller.isComplete
                    ? const Color(0xFF022C1E)
                    : const Color(0xFF451A03),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _heroBadge(
    String label, {
    required Color background,
    required Color textColor,
  }) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 9.w, vertical: 4.h),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(20.r),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 9.5.sp,
          fontWeight: FontWeight.w700,
          color: textColor,
        ),
      ),
    );
  }



  Widget _buildGrtBanner() {
    final complete = controller.grtComplete;
    final sessionId = _field(controller.grt, 'completedSessionId', '');
    return Container(
      width: double.infinity,
      padding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 10.h),
      decoration: BoxDecoration(
        color: complete ? const Color(0xFFE6F5EC) : const Color(0xFFFFF8E1),
        border: Border.all(
          color: complete ? const Color(0xFFA7E3BF) : const Color(0xFFF5DD9E),
        ),
        borderRadius: BorderRadius.circular(10.r),
      ),
      child: Row(
        children: [
          Icon(
            Icons.chat_bubble_outline_rounded,
            size: 15.sp,
            color: complete ? _green : const Color(0xFF9A6B00),
          ),
          SizedBox(width: 8.w),
          Expanded(
            child: Text(
              complete
                  ? 'GRT complete — covered by session $sessionId.'
                  : 'GRT not yet complete for this member — fill it on the GRT Sessions '
                        'tab (center-wise, covers multiple members at once).',
              style: TextStyle(
                fontSize: 10.5.sp,
                color: complete ? _green : const Color(0xFF9A6B00),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _tabLabel(String label, IconData iconData, bool isDone) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(iconData, size: 12.sp),
        SizedBox(width: 3.w),
        Flexible(
          child: Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: 9.5.sp, fontWeight: FontWeight.w700),
          ),
        ),
        SizedBox(width: 2.w),
        Icon(
          isDone ? Icons.check_circle_rounded : Icons.radio_button_unchecked_rounded,
          size: 11.sp,
          color: isDone ? const Color(0xFF15803D) : const Color(0xFF94A3B8),
        ),
      ],
    );
  }

  Widget _buildTabBar() {
    return Container(
      padding: EdgeInsets.all(3.w),
      decoration: BoxDecoration(
        color: const Color(0xFFF1F5F4),
        borderRadius: BorderRadius.circular(10.r),
      ),
      child: TabBar(
        controller: _tabController,
        indicator: BoxDecoration(
          color: const Color(0xFFE6F5EC),
          borderRadius: BorderRadius.circular(8.r),
        ),
        indicatorSize: TabBarIndicatorSize.tab,
        dividerColor: Colors.transparent,
        labelColor: _green,
        unselectedLabelColor: _muted,
        tabs: [
          Tab(child: _tabLabel('Cash Flow', Icons.account_balance_wallet_outlined, controller.cashFlowComplete)),
          Tab(child: _tabLabel('Loan Appraisal', Icons.assignment_turned_in_outlined, controller.loanAppraisalComplete)),
          Tab(child: _tabLabel('House Hold Assessment', Icons.home_outlined, controller.houseHoldVisitComplete)),
        ],
      ),
    );
  }

  // -------------------------------------------------------------------
  // Cash Flow
  // -------------------------------------------------------------------

  // Mirrors `EXPENSE_FIELDS` in the web's MemberIndividualDetailPage.tsx —
  // same 8 fields, same order, same icon per field.
  static const List<(String, IconData)> _expenseFieldMeta = [
    ('Food Expense', Icons.restaurant_rounded),
    ('Medical Expense', Icons.monitor_heart_rounded),
    ('Cooking Fuel Expense', Icons.local_fire_department_rounded),
    ('Electricity Expense', Icons.bolt_rounded),
    ('Transport Expense', Icons.directions_bus_rounded),
    ('Water Expense', Icons.water_drop_rounded),
    ('Educational Expense', Icons.school_rounded),
    ('Monthly Expense', Icons.receipt_long_rounded),
  ];

  Widget _buildCashFlowTab() {
    final fields = <(String, IconData, TextEditingController)>[
      (
        _expenseFieldMeta[0].$1,
        _expenseFieldMeta[0].$2,
        controller.foodExpenseCtrl,
      ),
      (
        _expenseFieldMeta[1].$1,
        _expenseFieldMeta[1].$2,
        controller.medicalExpenseCtrl,
      ),
      (
        _expenseFieldMeta[2].$1,
        _expenseFieldMeta[2].$2,
        controller.cookingFuelExpenseCtrl,
      ),
      (
        _expenseFieldMeta[3].$1,
        _expenseFieldMeta[3].$2,
        controller.electricityExpenseCtrl,
      ),
      (
        _expenseFieldMeta[4].$1,
        _expenseFieldMeta[4].$2,
        controller.transportExpenseCtrl,
      ),
      (
        _expenseFieldMeta[5].$1,
        _expenseFieldMeta[5].$2,
        controller.waterExpenseCtrl,
      ),
      (
        _expenseFieldMeta[6].$1,
        _expenseFieldMeta[6].$2,
        controller.educationalExpenseCtrl,
      ),
      (
        _expenseFieldMeta[7].$1,
        _expenseFieldMeta[7].$2,
        controller.monthlyExpenseCtrl,
      ),
    ];

    return SingleChildScrollView(
      padding: EdgeInsets.all(16.w),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Obx(
            () => controller.cashFlowComplete
                ? Padding(
                    padding: EdgeInsets.only(bottom: 10.h),
                    child: _completeBanner(
                      'Cash Flow completed on ${_formatDateTime(controller.cashFlow['completedAt'])}',
                    ),
                  )
                : const SizedBox.shrink(),
          ),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(
                  'Household Income & Expense Details',
                  style: TextStyle(
                    fontSize: 13.sp,
                    fontWeight: FontWeight.w800,
                    color: _darkText,
                  ),
                ),
              ),
              Obx(
                () => Container(
                  padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 4.h),
                  decoration: BoxDecoration(
                    border: Border.all(color: _green.withValues(alpha: 0.35)),
                    borderRadius: BorderRadius.circular(20.r),
                  ),
                  child: Text(
                    'Total: ₹${controller.totalExpense.value.toStringAsFixed(0)}',
                    style: TextStyle(
                      fontSize: 10.sp,
                      fontWeight: FontWeight.w800,
                      color: _green,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                  ),
                ),
              ),
            ],
          ),
          SizedBox(height: 10.h),
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            crossAxisSpacing: 8.w,
            mainAxisSpacing: 8.h,
            childAspectRatio: 1.55,
            children: fields
                .map(
                  (f) => _expenseFieldCard(
                    label: f.$1,
                    icon: f.$2,
                    controller: f.$3,
                  ),
                )
                .toList(),
          ),
          SizedBox(height: 14.h),
          Obx(
            () => SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: controller.isSavingCashFlow.value
                    ? null
                    : () async {
                        final ok = await controller.saveCashFlow();
                        if (ok && mounted) {
                          _tabController.animateTo(1);
                        }
                      },
                style: ElevatedButton.styleFrom(
                  backgroundColor: _green,
                  foregroundColor: Colors.white,
                  padding: EdgeInsets.symmetric(vertical: 13.h),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10.r),
                  ),
                ),
                icon: controller.isSavingCashFlow.value
                    ? SizedBox(
                        width: 16.sp,
                        height: 16.sp,
                        child: const CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.check_circle_rounded, size: 18),
                label: Text(
                  controller.isSavingCashFlow.value
                      ? 'Saving...'
                      : 'Save & Continue',
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _expenseFieldCard({
    required String label,
    required IconData icon,
    required TextEditingController controller,
  }) {
    return Container(
      padding: EdgeInsets.all(10.w),
      decoration: BoxDecoration(
        color: const Color(0xFFF0FAF4),
        border: Border.all(color: const Color(0xFFE1EAE4)),
        borderRadius: BorderRadius.circular(12.r),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Row(
            children: [
              Icon(icon, size: 13.sp, color: _green),
              SizedBox(width: 5.w),
              Expanded(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 10.sp,
                    fontWeight: FontWeight.w700,
                    color: _green,
                  ),
                ),
              ),
            ],
          ),
          SizedBox(height: 6.h),
          SizedBox(
            height: 34.h,
            child: TextField(
              controller: controller,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              style: TextStyle(fontSize: 12.sp),
              decoration: InputDecoration(
                prefixText: '₹ ',
                prefixStyle: TextStyle(fontSize: 12.sp, color: _muted),
                hintText: '0.00',
                isDense: true,
                filled: true,
                fillColor: Colors.white,
                contentPadding: EdgeInsets.symmetric(
                  horizontal: 8.w,
                  vertical: 8.h,
                ),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8.r),
                  borderSide: const BorderSide(color: Color(0xFFCBD5E1)),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8.r),
                  borderSide: const BorderSide(color: Color(0xFFCBD5E1)),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8.r),
                  borderSide: const BorderSide(color: _green, width: 1.4),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  // -------------------------------------------------------------------
  // Loan Appraisal
  // -------------------------------------------------------------------

  // Mirrors the 5 fields shown in the web's "Loan Details" card (Product,
  // Amount, Interest Rate, Tenure, Frequency) — same order, same icons.
  Widget _buildLoanAppraisalTab() {
    return Obx(() {
      final loan = controller.loan;
      final appraisalFields = <(String, IconData, String)>[
        (
          'Product',
          Icons.assignment_turned_in_rounded,
          _field(loan, 'productName'),
        ),
        (
          'Amount',
          Icons.account_balance_wallet_rounded,
          _currency(_amount(loan, 'amount')),
        ),
        (
          'Interest Rate',
          Icons.percent_rounded,
          '${_amount(loan, 'interestRate').toStringAsFixed(0)}%',
        ),
        (
          'Tenure',
          Icons.calendar_month_rounded,
          '${_field(loan, 'tenureMonths')} mo',
        ),
        ('Frequency', Icons.repeat_rounded, _field(loan, 'frequency')),
      ];

      return SingleChildScrollView(
        padding: EdgeInsets.all(16.w),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (controller.loanAppraisalComplete)
              Padding(
                padding: EdgeInsets.only(bottom: 10.h),
                child: _completeBanner(
                  'Loan Appraisal reviewed on ${_formatDateTime(controller.loanAppraisal['reviewedAt'])}',
                ),
              ),
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
                OutlinedButton.icon(
                  onPressed: () {
                    final clientDbId = _field(loan, 'clientId');
                    final clientDisplayId = _field(loan, 'clientDisplayId');
                    final clientName = _field(loan, 'clientName');
                    showHighmarkReport(
                      context,
                      api: Get.isRegistered<EnrollmentApiService>()
                          ? Get.find<EnrollmentApiService>()
                          : Get.put(
                              EnrollmentApiService(
                                Get.isRegistered<ApiClient>()
                                    ? Get.find<ApiClient>()
                                    : Get.put(ApiClient()),
                              ),
                            ),
                      clientDbId: clientDbId,
                      clientName: '$clientDisplayId - $clientName'.trim(),
                    );
                  },
                  style: OutlinedButton.styleFrom(
                    foregroundColor: _green,
                    side: BorderSide(color: _green.withValues(alpha: 0.35)),
                    padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 4.h),
                    minimumSize: Size.zero,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(20.r),
                    ),
                  ),
                  icon: Icon(Icons.shield_outlined, size: 13.sp),
                  label: Text(
                    'Highmark History',
                    style: TextStyle(
                      fontSize: 10.sp,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
            SizedBox(height: 10.h),
            GridView.count(
              crossAxisCount: 2,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              crossAxisSpacing: 8.w,
              mainAxisSpacing: 8.h,
              childAspectRatio: 1.7,
              children: appraisalFields
                  .map(
                    (f) => _appraisalFieldCard(
                      label: f.$1,
                      icon: f.$2,
                      value: f.$3,
                    ),
                  )
                  .toList(),
            ),
            SizedBox(height: 14.h),
            const Divider(height: 1, color: Color(0xFFE1EAE4)),
            SizedBox(height: 14.h),
            Padding(
              padding: EdgeInsets.only(bottom: 12.h),
              child: SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: () => _showEditProductSheet(context),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: _green,
                    side: const BorderSide(color: _green, width: 1.2),
                    padding: EdgeInsets.symmetric(vertical: 12.h),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10.r),
                    ),
                  ),
                  icon: const Icon(Icons.edit_rounded, size: 18),
                  label: Text(
                    'Change Product',
                    style: TextStyle(
                      fontSize: 13.sp,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
            ),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed:
                    controller.isCompletingAppraisal.value ||
                        controller.loanAppraisalComplete
                    ? null
                    : () async {
                        final ok = await controller.markLoanAppraisalReviewed();
                        if (ok && mounted) {
                          _tabController.animateTo(2);
                        }
                      },
                style: ElevatedButton.styleFrom(
                  backgroundColor: _green,
                  foregroundColor: Colors.white,
                  disabledBackgroundColor: const Color(0xFFA8D5BC),
                  padding: EdgeInsets.symmetric(vertical: 13.h),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10.r),
                  ),
                ),
                icon: controller.isCompletingAppraisal.value
                    ? SizedBox(
                        width: 16.sp,
                        height: 16.sp,
                        child: const CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.check_circle_rounded, size: 18),
                label: Text(
                  controller.loanAppraisalComplete
                      ? 'Reviewed'
                      : controller.isCompletingAppraisal.value
                      ? 'Saving...'
                      : 'Save & Continue',
                ),
              ),
            ),
          ],
        ),
      );
    });
  }

  void _showEditProductSheet(BuildContext context) {
    controller.fetchProductEditData();

    final loan = controller.loan;
    final currentProductId = loan['loanProductId']?.toString() ?? '';

    final selectedTypeId = RxnString();
    final selectedFrequency = RxnString();
    final selectedProductId = RxnString();

    bool initialized = false;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20.r)),
      ),
      builder: (ctx) {
        return Padding(
          padding: EdgeInsets.fromLTRB(
            16.w,
            16.h,
            16.w,
            24.h + MediaQuery.of(ctx).viewInsets.bottom,
          ),
          child: Obx(() {
            if (controller.isLoadingProductData.value) {
              return Container(
                height: 250.h,
                alignment: Alignment.center,
                child: const CircularProgressIndicator(color: _green),
              );
            }

            final types = controller.productTypes;
            final products = controller.allProducts;

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

            // If maxAmount filtering results in no products, fallback to showing all products for the selected type
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
                    onPressed: selectedProductId.value == null || controller.isUpdatingProduct.value
                        ? null
                        : () async {
                            final ok = await controller.updateLoanProduct(selectedProductId.value!);
                            if (ok && ctx.mounted) {
                              Navigator.pop(ctx);
                            }
                          },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: _green,
                      foregroundColor: Colors.white,
                      padding: EdgeInsets.symmetric(vertical: 13.h),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10.r)),
                    ),
                    child: controller.isUpdatingProduct.value
                        ? SizedBox(
                            width: 16.sp,
                            height: 16.sp,
                            child: const CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                          )
                        : Text('Update Product', style: TextStyle(fontSize: 13.sp, fontWeight: FontWeight.w700)),
                  ),
                ),
              ],
            );
          }),
        );
      },
    );
  }

  Widget _appraisalFieldCard({
    required String label,
    required IconData icon,
    required String value,
  }) {
    return Container(
      padding: EdgeInsets.all(10.w),
      decoration: BoxDecoration(
        color: const Color(0xFFF0FAF4),
        border: Border.all(color: const Color(0xFFE1EAE4)),
        borderRadius: BorderRadius.circular(12.r),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Row(
            children: [
              Icon(icon, size: 12.sp, color: _muted),
              SizedBox(width: 5.w),
              Expanded(
                child: Text(
                  label.toUpperCase(),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 8.5.sp,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.4,
                    color: _muted,
                  ),
                ),
              ),
            ],
          ),
          SizedBox(height: 5.h),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 12.5.sp,
              fontWeight: FontWeight.w800,
              color: _darkText,
            ),
          ),
        ],
      ),
    );
  }

  Widget _storageImageWidget({
    required String? photoKey,
    required double width,
    required double height,
    BoxFit fit = BoxFit.cover,
    BorderRadius? borderRadius,
  }) {
    if (photoKey == null || photoKey.trim().isEmpty) {
      return Container(
        width: width,
        height: height,
        decoration: BoxDecoration(
          color: const Color(0xFFEFF3F1),
          borderRadius: borderRadius ?? BorderRadius.circular(8.r),
        ),
        child: Icon(Icons.image_outlined, size: 24.sp, color: _muted),
      );
    }

    final key = photoKey.trim();
    controller.resolveSignedUrl(key);

    return Obx(() {
      final resolvedUrl = controller.signedUrlCache[key];
      if (resolvedUrl == null) {
        return Container(
          width: width,
          height: height,
          decoration: BoxDecoration(
            color: const Color(0xFFEFF3F1),
            borderRadius: borderRadius ?? BorderRadius.circular(8.r),
          ),
          alignment: Alignment.center,
          child: SizedBox(
            width: 16.sp,
            height: 16.sp,
            child: const CircularProgressIndicator(strokeWidth: 2, color: _green),
          ),
        );
      }

      return ClipRRect(
        borderRadius: borderRadius ?? BorderRadius.circular(8.r),
        child: Image.network(
          resolvedUrl,
          width: width,
          height: height,
          fit: fit,
          errorBuilder: (_, __, ___) => Container(
            width: width,
            height: height,
            color: const Color(0xFFEFF3F1),
            alignment: Alignment.center,
            child: Icon(Icons.broken_image_outlined, size: 24.sp, color: Colors.redAccent),
          ),
        ),
      );
    });
  }

  Widget _distanceChip({
    required String label,
    required dynamic distanceMeters,
    dynamic fallbackDistanceMeters,
    double? maxRadiusMeters,
  }) {
    final dist = distanceMeters ?? fallbackDistanceMeters;
    if (dist == null) return const SizedBox.shrink();
    final meters = (dist is num)
        ? dist.toDouble()
        : (double.tryParse('$dist') ?? 0.0);
    final isKm = meters >= 1000;
    final displayDist = isKm
        ? '${(meters / 1000).toStringAsFixed(2)} km'
        : '${meters.round()} m';

    final outOfRange = maxRadiusMeters != null && meters > maxRadiusMeters;
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
            '$label: $displayDist',
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

  Widget _buildFdoHouseImageCard(Map<String, dynamic>? fdoHouseImage) {
    if (fdoHouseImage == null || fdoHouseImage['photoUrl'] == null || fdoHouseImage['photoUrl'].toString().trim().isEmpty) {
      return Container(
        width: double.infinity,
        padding: EdgeInsets.all(10.w),
        decoration: BoxDecoration(
          color: const Color(0xFFFFFBEB),
          border: Border.all(color: const Color(0xFFFDE68A)),
          borderRadius: BorderRadius.circular(10.r),
        ),
        child: Row(
          children: [
            Icon(Icons.info_outline, size: 16.sp, color: const Color(0xFFB45309)),
            SizedBox(width: 8.w),
            Expanded(
              child: Text(
                'FDO did not upload a house image at enrollment.',
                style: TextStyle(fontSize: 11.sp, color: const Color(0xFFB45309)),
              ),
            ),
          ],
        ),
      );
    }

    final photoKey = fdoHouseImage['photoUrl'].toString();

    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(12.w),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: const Color(0xFFE1EAE4)),
        borderRadius: BorderRadius.circular(12.r),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.home_work_rounded, size: 15.sp, color: _green),
              SizedBox(width: 6.w),
              Text(
                'FDO Uploaded House Image (at enrollment)',
                style: TextStyle(
                  fontSize: 11.5.sp,
                  fontWeight: FontWeight.w700,
                  color: _darkText,
                ),
              ),
            ],
          ),
          SizedBox(height: 10.h),
          _storageImageWidget(
            photoKey: photoKey,
            width: double.infinity,
            height: 160.h,
            fit: BoxFit.cover,
            borderRadius: BorderRadius.circular(10.r),
          ),
          if (fdoHouseImage['uploadedByName'] != null) ...[
            SizedBox(height: 6.h),
            Text(
              'Uploaded by: ${fdoHouseImage['uploadedByName']}'
              '${fdoHouseImage['createdAt'] != null ? ' · ${_formatDateTime(fdoHouseImage['createdAt'])}' : ''}',
              style: TextStyle(fontSize: 10.sp, color: _muted),
            ),
          ],
        ],
      ),
    );
  }

  // -------------------------------------------------------------------
  // House Hold Visit
  // -------------------------------------------------------------------

  Widget _buildHouseholdVisitTab() {
    return Obx(() {
      final photos = controller.photos;
      final fdoHouseImage = controller.houseHoldVisit['fdoHouseImage'];
      final fdoMap = fdoHouseImage is Map ? Map<String, dynamic>.from(fdoHouseImage) : null;

      return SingleChildScrollView(
        padding: EdgeInsets.all(16.w),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (controller.houseHoldVisitComplete)
              _completeBanner(
                'House Hold Visit completed on ${_formatDateTime(controller.houseHoldVisit['completedAt'])}',
              ),
            SizedBox(height: 10.h),
            _buildFdoHouseImageCard(fdoMap),
            SizedBox(height: 14.h),
            _buildLiveLocationCard(),
            SizedBox(height: 14.h),
            Container(
              padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 8.h),
              decoration: BoxDecoration(
                color: const Color(0xFFFFF8E1),
                borderRadius: BorderRadius.circular(10.r),
              ),
              child: Row(
                children: [
                  Icon(
                    Icons.info_outline,
                    size: 15.sp,
                    color: const Color(0xFF9A6B00),
                  ),
                  SizedBox(width: 6.w),
                  Expanded(
                    child: Text(
                      'Capture one mandatory photo with GPS at the client\'s house. '
                      'It must be within 500m of the center — remove and re-capture '
                      'if it\'s out of range.',
                      style: TextStyle(
                        fontSize: 10.sp,
                        color: const Color(0xFF9A6B00),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            SizedBox(height: 14.h),
            Text(
              'BM Verification Photos',
              style: TextStyle(
                fontSize: 13.sp,
                fontWeight: FontWeight.w800,
                color: _darkText,
              ),
            ),
            SizedBox(height: 10.h),
            if (photos.isEmpty)
              _emptyState('No verification photos captured yet.')
            else
              ListView.separated(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: photos.length,
                separatorBuilder: (_, __) => SizedBox(height: 8.h),
                itemBuilder: (_, index) =>
                    _photoCard(Map<String, dynamic>.from(photos[index])),
              ),
            SizedBox(height: 12.h),
            Row(
              children: [
                Expanded(
                  child: Obx(
                    () => OutlinedButton.icon(
                      onPressed: controller.isUploadingPhoto.value
                          ? null
                          : () => controller.captureAndUploadPhoto(
                              isMandatory: !controller.hasMandatoryPhoto,
                              useCamera: true,
                            ),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: _green,
                        side: const BorderSide(color: _green),
                        padding: EdgeInsets.symmetric(vertical: 12.h),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10.r),
                        ),
                      ),
                      icon: controller.isUploadingPhoto.value
                          ? SizedBox(
                              width: 15.sp,
                              height: 15.sp,
                              child: const CircularProgressIndicator(
                                strokeWidth: 2,
                                color: _green,
                              ),
                            )
                          : const Icon(Icons.camera_alt_rounded, size: 17),
                      label: Text(
                        controller.hasMandatoryPhoto
                            ? 'Add Optional Photo'
                            : 'Capture Mandatory Photo',
                      ),
                    ),
                  ),
                ),
              ],
            ),
            SizedBox(height: 12.h),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed:
                    controller.isCompletingVisit.value ||
                        controller.houseHoldVisitComplete ||
                        !controller.hasMandatoryPhoto
                    ? null
                    : () => controller.markHouseholdVisitComplete(),
                style: ElevatedButton.styleFrom(
                  backgroundColor: _green,
                  foregroundColor: Colors.white,
                  disabledBackgroundColor: const Color(0xFFA8D5BC),
                  padding: EdgeInsets.symmetric(vertical: 13.h),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10.r),
                  ),
                ),
                icon: controller.isCompletingVisit.value
                    ? SizedBox(
                        width: 16.sp,
                        height: 16.sp,
                        child: const CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.check_circle_rounded, size: 18),
                label: Text(
                  controller.houseHoldVisitComplete
                      ? 'Completed'
                      : controller.isCompletingVisit.value
                      ? 'Saving...'
                      : 'Mark Complete',
                ),
              ),
            ),
          ],
        ),
      );
    });
  }

  Widget _buildLiveLocationCard() {
    return Obx(() {
      final isFetching = controller.isFetchingLiveLocation.value;
      final error = controller.liveLocationError.value;
      final lat = controller.liveLatitude.value;
      final lng = controller.liveLongitude.value;
      final acc = controller.liveAccuracy.value;
      final centerDist = controller.centerDistanceMeters.value;
      final fdoDist = controller.fdoDistanceMeters.value;
      final branchDist = controller.branchDistanceMeters.value;

      return Container(
        padding: EdgeInsets.all(12.w),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12.r),
          border: Border.all(color: const Color(0xFFE2E8F0)),
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
              children: [
                Container(
                  padding: EdgeInsets.all(6.w),
                  decoration: BoxDecoration(
                    color: const Color(0xFFE8F5E9),
                    borderRadius: BorderRadius.circular(8.r),
                  ),
                  child: Icon(Icons.my_location_rounded, size: 16.sp, color: _green),
                ),
                SizedBox(width: 8.w),
                Expanded(
                  child: Text(
                    'Live Visit Location & Distance Check',
                    style: TextStyle(
                      fontSize: 12.5.sp,
                      fontWeight: FontWeight.w800,
                      color: _darkText,
                    ),
                  ),
                ),
                IconButton(
                  onPressed: isFetching ? null : () => controller.fetchLiveLocation(),
                  icon: isFetching
                      ? SizedBox(
                          width: 14.sp,
                          height: 14.sp,
                          child: const CircularProgressIndicator(
                            strokeWidth: 2,
                            color: _green,
                          ),
                        )
                      : Icon(Icons.refresh_rounded, size: 18.sp, color: _green),
                  tooltip: 'Refresh Location',
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(),
                ),
              ],
            ),
            if (error != null) ...[
              SizedBox(height: 8.h),
              Row(
                children: [
                  Icon(Icons.warning_amber_rounded, size: 14.sp, color: Colors.red.shade700),
                  SizedBox(width: 6.w),
                  Expanded(
                    child: Text(
                      error,
                      style: TextStyle(fontSize: 11.sp, color: Colors.red.shade700),
                    ),
                  ),
                ],
              ),
            ] else if (lat != null && lng != null) ...[
              SizedBox(height: 10.h),
              Container(
                padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 6.h),
                decoration: BoxDecoration(
                  color: const Color(0xFFF8FAFC),
                  borderRadius: BorderRadius.circular(8.r),
                  border: Border.all(color: const Color(0xFFF1F5F9)),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      'Lat: ${lat.toStringAsFixed(6)}, Lng: ${lng.toStringAsFixed(6)}',
                      style: TextStyle(
                        fontSize: 11.sp,
                        fontWeight: FontWeight.w600,
                        color: const Color(0xFF334155),
                      ),
                    ),
                    if (acc != null)
                      Text(
                        'Acc: ±${acc.toStringAsFixed(1)}m',
                        style: TextStyle(
                          fontSize: 10.5.sp,
                          fontWeight: FontWeight.w500,
                          color: const Color(0xFF64748B),
                        ),
                      ),
                  ],
                ),
              ),
              SizedBox(height: 10.h),
              Wrap(
                spacing: 8.w,
                runSpacing: 6.h,
                children: [
                  if (centerDist != null)
                    _distanceChip(
                      label: 'Center',
                      distanceMeters: centerDist,
                      maxRadiusMeters: 500,
                    ),
                  if (fdoDist != null)
                    _distanceChip(
                      label: 'FDO',
                      distanceMeters: fdoDist,
                      maxRadiusMeters: 50,
                    ),
                  if (branchDist != null)
                    _distanceChip(
                      label: 'Branch',
                      distanceMeters: branchDist,
                    ),
                ],
              ),
            ] else if (isFetching) ...[
              SizedBox(height: 10.h),
              Row(
                children: [
                  SizedBox(
                    width: 14.sp,
                    height: 14.sp,
                    child: const CircularProgressIndicator(strokeWidth: 2, color: _green),
                  ),
                  SizedBox(width: 8.w),
                  Text(
                    'Fetching device GPS location...',
                    style: TextStyle(fontSize: 11.sp, color: const Color(0xFF64748B)),
                  ),
                ],
              ),
            ],
          ],
        ),
      );
    });
  }

  double? _asDouble(dynamic v) => v == null ? null : double.tryParse('$v');

  /// Legacy photos uploaded before the backend started persisting
  /// `distanceMeters`/`distanceFromBranchMeters`/`distanceFromClientMeters`
  /// have those fields null. Rather than estimating straight-line (which
  /// would read as "different" from the road distance the software always
  /// shows), fetch and cache the same road-distance figure the backend
  /// would have computed, via the shared `/api/geo/driving-distance`
  /// endpoint — kicked off here, read back from the cache inside the Obx
  /// below once resolved.
  void _ensureLegacyDistancesResolved(
    Map<String, dynamic> photo,
    double? photoLat,
    double? photoLng,
    Map center,
    Map branch,
    Map? client,
  ) {
    if (photoLat == null || photoLng == null) return;
    if (photo['distanceMeters'] == null) {
      controller.resolveDrivingDistance(
        photoLat, photoLng, _asDouble(center['latitude']), _asDouble(center['longitude']),
      );
    }
    if (photo['distanceFromBranchMeters'] == null) {
      controller.resolveDrivingDistance(
        photoLat, photoLng, _asDouble(branch['latitude']), _asDouble(branch['longitude']),
      );
    }
    if (photo['distanceFromClientMeters'] == null) {
      controller.resolveDrivingDistance(
        photoLat, photoLng, _asDouble(client?['latitude']), _asDouble(client?['longitude']),
      );
    }
  }

  Widget _photoCard(Map<String, dynamic> photo) {
    final isMandatory = photo['isMandatory'] == true;
    final photoLat = _asDouble(photo['latitude']);
    final photoLng = _asDouble(photo['longitude']);
    final center = controller.center;
    final branch = controller.branch;
    final client = controller.record.value?['client'] as Map?;

    final photoId = photo['id']?.toString() ?? '';
    final photoKey = photo['photoUrl']?.toString() ?? '';

    return Obx(() {
      _ensureLegacyDistancesResolved(photo, photoLat, photoLng, center, branch, client);

      final fallbackCenter = controller.cachedDrivingDistance(
        photoLat, photoLng, _asDouble(center['latitude']), _asDouble(center['longitude']),
      );
      final fallbackBranch = controller.cachedDrivingDistance(
        photoLat, photoLng, _asDouble(branch['latitude']), _asDouble(branch['longitude']),
      );
      final fallbackFdo = controller.cachedDrivingDistance(
        photoLat, photoLng, _asDouble(client?['latitude']), _asDouble(client?['longitude']),
      );

      final distanceCenter = photo['distanceMeters'] ?? fallbackCenter;
      final outOfRange = isMandatory && distanceCenter is num && distanceCenter > 500;

      final deleting = controller.deletingPhotoId.value == photoId;
      return Container(
        padding: EdgeInsets.all(10.w),
        decoration: BoxDecoration(
          color: outOfRange ? const Color(0xFFFDECEC) : Colors.white,
          border: Border.all(
            color: outOfRange
                ? Colors.red.withValues(alpha: 0.35)
                : const Color(0xFFE1EAE4),
          ),
          borderRadius: BorderRadius.circular(10.r),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _storageImageWidget(
                  photoKey: photoKey,
                  width: 60.w,
                  height: 60.w,
                  fit: BoxFit.cover,
                  borderRadius: BorderRadius.circular(8.r),
                ),
                SizedBox(width: 10.w),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            isMandatory ? 'Mandatory Photo' : 'Optional Photo',
                            style: TextStyle(
                              fontSize: 11.sp,
                              fontWeight: FontWeight.w800,
                              color: isMandatory ? _green : _darkText,
                            ),
                          ),
                          IconButton(
                            onPressed: deleting
                                ? null
                                : () => controller.deletePhoto(photoId),
                            icon: deleting
                                ? SizedBox(
                                    width: 14.sp,
                                    height: 14.sp,
                                    child: const CircularProgressIndicator(
                                      strokeWidth: 2,
                                      color: Colors.redAccent,
                                    ),
                                  )
                                : Icon(
                                    Icons.delete_outline_rounded,
                                    color: Colors.redAccent,
                                    size: 18.sp,
                                  ),
                            padding: EdgeInsets.zero,
                            constraints: const BoxConstraints(),
                          ),
                        ],
                      ),
                      SizedBox(height: 6.h),
                      Wrap(
                        spacing: 6.w,
                        runSpacing: 4.h,
                        children: [
                          _distanceChip(
                            label: 'Branch',
                            distanceMeters: photo['distanceFromBranchMeters'],
                            fallbackDistanceMeters: fallbackBranch,
                          ),
                          _distanceChip(
                            label: 'Center',
                            distanceMeters: photo['distanceMeters'],
                            fallbackDistanceMeters: fallbackCenter,
                            maxRadiusMeters: isMandatory ? 500 : null,
                          ),
                          _distanceChip(
                            label: 'FDO',
                            distanceMeters: photo['distanceFromClientMeters'],
                            fallbackDistanceMeters: fallbackFdo,
                            maxRadiusMeters: isMandatory ? 100 : null,
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ],
        ),
      );
    });
  }

  Widget _completeBanner(String message) => Container(
    width: double.infinity,
    padding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 10.h),
    decoration: BoxDecoration(
      color: const Color(0xFFE6F5EC),
      borderRadius: BorderRadius.circular(10.r),
    ),
    child: Row(
      children: [
        const Icon(Icons.check_circle_rounded, color: _green, size: 18),
        SizedBox(width: 8.w),
        Expanded(
          child: Text(
            message,
            style: TextStyle(
              fontSize: 11.sp,
              fontWeight: FontWeight.w700,
              color: _green,
            ),
          ),
        ),
      ],
    ),
  );

  Widget _emptyState(String message) => Container(
    width: double.infinity,
    padding: EdgeInsets.symmetric(vertical: 24.h),
    decoration: BoxDecoration(
      border: Border.all(color: const Color(0xFFE1EAE4)),
      borderRadius: BorderRadius.circular(12.r),
    ),
    child: Column(
      children: [
        Icon(Icons.photo_camera_outlined, size: 30.sp, color: _muted),
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
