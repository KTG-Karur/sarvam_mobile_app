import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:sarvam/controller/member_individual_detail_controller.dart';

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

  // GRT is filled center-wide (group) on a separate web-only screen, not
  // per-loan here — this is an informational banner only.
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
                        'screen (center-wise, covers multiple members at once).',
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
        labelStyle: TextStyle(fontSize: 10.5.sp, fontWeight: FontWeight.w700),
        tabs: const [
          Tab(text: 'Cash Flow'),
          Tab(text: 'Appraisal'),
          Tab(text: 'House Visit'),
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
            Text(
              'Loan Details',
              style: TextStyle(
                fontSize: 13.sp,
                fontWeight: FontWeight.w800,
                color: _darkText,
              ),
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
              padding: EdgeInsets.only(bottom: 10.h),
              child: Text(
                'Changing the loan product is available on the web app.',
                style: TextStyle(fontSize: 10.5.sp, color: _muted),
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

  // -------------------------------------------------------------------
  // House Hold Visit
  // -------------------------------------------------------------------

  Widget _buildHouseholdVisitTab() {
    return Obx(() {
      final photos = controller.photos;
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
              'Photos',
              style: TextStyle(
                fontSize: 13.sp,
                fontWeight: FontWeight.w800,
                color: _darkText,
              ),
            ),
            SizedBox(height: 10.h),
            if (photos.isEmpty)
              _emptyState('No photos captured yet.')
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

  Widget _photoCard(Map<String, dynamic> photo) {
    final isMandatory = photo['isMandatory'] == true;
    final distanceMeters = photo['distanceMeters'];
    final photoId = photo['id']?.toString() ?? '';
    final outOfRange =
        isMandatory && distanceMeters is num && distanceMeters > 500;

    return Obx(() {
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
        child: Row(
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(8.r),
              child: photo['photoUrl'] != null
                  ? Image.network(
                      photo['photoUrl'].toString(),
                      width: 48.w,
                      height: 48.w,
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => Container(
                        width: 48.w,
                        height: 48.w,
                        color: const Color(0xFFEFF3F1),
                        child: Icon(
                          Icons.image_outlined,
                          color: _muted,
                          size: 20.sp,
                        ),
                      ),
                    )
                  : Container(
                      width: 48.w,
                      height: 48.w,
                      color: const Color(0xFFEFF3F1),
                      child: Icon(
                        Icons.image_outlined,
                        color: _muted,
                        size: 20.sp,
                      ),
                    ),
            ),
            SizedBox(width: 10.w),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        isMandatory ? 'Mandatory' : 'Optional',
                        style: TextStyle(
                          fontSize: 10.5.sp,
                          fontWeight: FontWeight.w700,
                          color: isMandatory ? _green : _muted,
                        ),
                      ),
                    ],
                  ),
                  if (distanceMeters != null)
                    Text(
                      '${(distanceMeters as num).round()}m from center',
                      style: TextStyle(
                        fontSize: 10.sp,
                        color: outOfRange ? Colors.red : _muted,
                      ),
                    ),
                ],
              ),
            ),
            IconButton(
              onPressed: deleting
                  ? null
                  : () => controller.deletePhoto(photoId),
              icon: deleting
                  ? SizedBox(
                      width: 16.sp,
                      height: 16.sp,
                      child: const CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Icon(
                      Icons.delete_outline_rounded,
                      color: Colors.red,
                      size: 20.sp,
                    ),
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
