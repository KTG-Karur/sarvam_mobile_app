import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:sarvam/controller/admin/admin_master_controller.dart';

/// Funder registry — lists /api/masters/funder and supports adding a funder
/// by picking Principal & Interest GL accounts.
class FunderList extends StatefulWidget {
  const FunderList({super.key});

  @override
  State<FunderList> createState() => _FunderListState();
}

class _FunderListState extends State<FunderList> with TickerProviderStateMixin {
  static const _green = Color(0xFF0D6842);
  static const _greenLight = Color(0xFF1A8A5A);
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);
  static const _lightBg = Color(0xFFF8FAFC);
  static const _cardBg = Color(0xFFFFFFFF);

  late AdminMasterController _controller;

  // Animation controllers
  late AnimationController _headerController;
  late Animation<double> _headerAnimation;
  late Animation<Offset> _headerSlideAnimation;
  late AnimationController _fabController;
  late Animation<double> _fabAnimation;

  @override
  void initState() {
    super.initState();

    // Initialize header animation
    _headerController = AnimationController(
      duration: const Duration(milliseconds: 400),
      vsync: this,
    );
    _headerAnimation = CurvedAnimation(
      parent: _headerController,
      curve: Curves.easeOut,
    );
    _headerSlideAnimation =
        Tween<Offset>(begin: Offset(0, -0.3), end: Offset.zero).animate(
          CurvedAnimation(
            parent: _headerController,
            curve: Curves.easeOutCubic,
          ),
        );
    _headerController.forward();

    // Initialize FAB animation
    _fabController = AnimationController(
      duration: const Duration(milliseconds: 500),
      vsync: this,
    );
    _fabAnimation = CurvedAnimation(
      parent: _fabController,
      curve: Curves.easeOutBack,
    );
    _fabController.forward();

    _controller = Get.isRegistered<AdminMasterController>()
        ? Get.find<AdminMasterController>()
        : Get.put(AdminMasterController());
    _controller.loadFunders();
    _controller.loadGlAccounts();
  }

  @override
  void dispose() {
    _headerController.dispose();
    _fabController.dispose();
    super.dispose();
  }

  void _openCreate() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _CreateFunderSheet(
        glAccounts: _controller.glAccounts,
        onCreate: (payload) async {
          final error = await _controller.createFunder(payload);
          if (!mounted) return false;
          if (error == null) {
            _showSuccessSnackbar('Funder created successfully');
            return true;
          }
          _showErrorSnackbar('Creation Failed', error);
          return false;
        },
      ),
    );
  }

  void _showSuccessSnackbar(String message) {
    Get.snackbar(
      'Success ✅',
      message,
      snackPosition: SnackPosition.BOTTOM,
      backgroundColor: _green,
      colorText: Colors.white,
      margin: EdgeInsets.all(16.w),
      borderRadius: 12.r,
      duration: const Duration(seconds: 2),
      icon: const Icon(Icons.check_circle_rounded, color: Colors.white),
    );
  }

  void _showErrorSnackbar(String title, String message) {
    Get.snackbar(
      title,
      message,
      snackPosition: SnackPosition.BOTTOM,
      backgroundColor: const Color(0xFFDC2626),
      colorText: Colors.white,
      margin: EdgeInsets.all(16.w),
      borderRadius: 12.r,
      duration: const Duration(seconds: 3),
      icon: const Icon(Icons.error_outline_rounded, color: Colors.white),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _lightBg,
      appBar: _buildAppBar(),
      floatingActionButton: ScaleTransition(
        scale: _fabAnimation,
        child: FloatingActionButton(
          onPressed: _openCreate,
          backgroundColor: _green,
          elevation: 4,
          child: const Icon(Icons.add, color: Colors.white),
        ),
      ),
      body: RefreshIndicator(
        color: _green,
        onRefresh: _controller.loadFunders,
        child: Obx(() {
          if (_controller.isLoading.value && _controller.funders.isEmpty) {
            return _buildLoadingState();
          }
          if (_controller.funders.isEmpty) {
            return _buildEmptyState();
          }
          return SlideTransition(
            position: _headerSlideAnimation,
            child: FadeTransition(
              opacity: _headerAnimation,
              child: ListView.separated(
                physics: const AlwaysScrollableScrollPhysics(
                  parent: BouncingScrollPhysics(),
                ),
                padding: EdgeInsets.fromLTRB(16.w, 16.w, 16.w, 90.h),
                itemCount: _controller.funders.length,
                separatorBuilder: (_, __) => SizedBox(height: 12.h),
                itemBuilder: (_, i) =>
                    _buildFunderTile(_controller.funders[i], i),
              ),
            ),
          );
        }),
      ),
    );
  }

  // ============== APP BAR ==============
  PreferredSizeWidget _buildAppBar() {
    return AppBar(
      backgroundColor: Colors.white,
      foregroundColor: _darkText,
      elevation: 0,
      title: Row(
        children: [
          Container(
            padding: EdgeInsets.all(8.w),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF0D6842), Color(0xFF1A8A5A)],
              ),
              borderRadius: BorderRadius.circular(10.r),
            ),
            child: Icon(
              Icons.account_balance_rounded,
              color: Colors.white,
              size: 18.sp,
            ),
          ),
          SizedBox(width: 10.w),
          Text(
            'Funders',
            style: GoogleFonts.inter(
              fontSize: 18.sp,
              fontWeight: FontWeight.w700,
              color: _darkText,
            ),
          ),
        ],
      ),
      actions: [
        Container(
          margin: EdgeInsets.only(right: 16.w),
          padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 4.h),
          decoration: BoxDecoration(
            color: _green.withOpacity(0.1),
            borderRadius: BorderRadius.circular(8.r),
          ),
          child: Row(
            children: [
              Icon(Icons.business_center_rounded, color: _green, size: 14.sp),
              SizedBox(width: 4.w),
              Obx(
                () => AnimatedSwitcher(
                  duration: const Duration(milliseconds: 300),
                  child: Text(
                    '${_controller.funders.length}',
                    key: ValueKey(_controller.funders.length),
                    style: GoogleFonts.inter(
                      fontSize: 13.sp,
                      fontWeight: FontWeight.w700,
                      color: _green,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
      bottom: PreferredSize(
        preferredSize: Size.fromHeight(1.h),
        child: Container(height: 1.h, color: Colors.grey.shade200),
      ),
    );
  }

  // ============== FUNDER TILE ==============
  Widget _buildFunderTile(dynamic funder, int index) {
    return TweenAnimationBuilder(
      duration: Duration(milliseconds: 300 + (index * 50)),
      curve: Curves.easeOutCubic,
      tween: Tween<double>(begin: 0.0, end: 1.0),
      builder: (context, value, child) {
        return Opacity(
          opacity: value,
          child: Transform.translate(
            offset: Offset(30 * (1 - value), 0),
            child: child,
          ),
        );
      },
      child: Container(
        decoration: BoxDecoration(
          color: _cardBg,
          borderRadius: BorderRadius.circular(16.r),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.04),
              blurRadius: 12,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Material(
          color: Colors.transparent,
          borderRadius: BorderRadius.circular(16.r),
          child: InkWell(
            borderRadius: BorderRadius.circular(16.r),
            splashColor: _green.withOpacity(0.08),
            highlightColor: _green.withOpacity(0.04),
            onTap: () {
              _showFunderDetails(funder);
            },
            child: Padding(
              padding: EdgeInsets.all(14.w),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: EdgeInsets.all(10.w),
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            colors: [_green, _greenLight],
                          ),
                          borderRadius: BorderRadius.circular(12.r),
                          boxShadow: [
                            BoxShadow(
                              color: _green.withOpacity(0.2),
                              blurRadius: 8,
                              offset: const Offset(0, 4),
                            ),
                          ],
                        ),
                        child: Icon(
                          Icons.account_balance_rounded,
                          color: Colors.white,
                          size: 20.sp,
                        ),
                      ),
                      SizedBox(width: 12.w),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              funder.funderName,
                              style: GoogleFonts.inter(
                                fontSize: 15.sp,
                                fontWeight: FontWeight.w700,
                                color: _darkText,
                              ),
                            ),
                            SizedBox(height: 2.h),
                            Container(
                              padding: EdgeInsets.symmetric(
                                horizontal: 8.w,
                                vertical: 2.h,
                              ),
                              decoration: BoxDecoration(
                                color: _green.withOpacity(0.08),
                                borderRadius: BorderRadius.circular(6.r),
                              ),
                              child: Text(
                                'ID: ${funder.funderId}',
                                style: GoogleFonts.inter(
                                  fontSize: 11.sp,
                                  color: _green,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      if (!funder.isActive)
                        Container(
                          padding: EdgeInsets.symmetric(
                            horizontal: 8.w,
                            vertical: 3.h,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.red.withOpacity(0.1),
                            borderRadius: BorderRadius.circular(20.r),
                            border: Border.all(
                              color: Colors.red.withOpacity(0.2),
                            ),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Container(
                                width: 6.w,
                                height: 6.w,
                                decoration: const BoxDecoration(
                                  color: Color(0xFFDC2626),
                                  shape: BoxShape.circle,
                                ),
                              ),
                              SizedBox(width: 4.w),
                              Text(
                                'Inactive',
                                style: GoogleFonts.inter(
                                  fontSize: 10.sp,
                                  color: const Color(0xFFDC2626),
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
                  SizedBox(height: 12.h),
                  Wrap(
                    spacing: 8.w,
                    runSpacing: 8.h,
                    children: [
                      _buildGlChip(
                        'Principal',
                        funder.principalGL.isNotEmpty
                            ? '${funder.principalGL['glName'] ?? funder.principalGLId}'
                            : funder.principalGLId,
                        Colors.blue,
                      ),
                      _buildGlChip(
                        'Interest',
                        funder.interestGL.isNotEmpty
                            ? '${funder.interestGL['glName'] ?? funder.interestGLId}'
                            : funder.interestGLId,
                        Colors.purple,
                      ),
                      _buildPercentChip(
                        'Interest %',
                        funder.interestPercent,
                        Colors.orange,
                      ),
                      _buildPercentChip('TDS %', funder.tdsPercent, Colors.red),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  // ============== GL CHIP ==============
  Widget _buildGlChip(String label, String value, Color color) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 6.h),
      decoration: BoxDecoration(
        color: color.withOpacity(0.08),
        borderRadius: BorderRadius.circular(10.r),
        border: Border.all(color: color.withOpacity(0.15)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.account_balance_wallet_rounded, size: 12.sp, color: color),
          SizedBox(width: 4.w),
          Text(
            '$label: ',
            style: GoogleFonts.inter(
              fontSize: 10.5.sp,
              color: _muted,
              fontWeight: FontWeight.w600,
            ),
          ),
          Text(
            value,
            style: GoogleFonts.inter(
              fontSize: 10.5.sp,
              color: _darkText,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }

  // ============== PERCENT CHIP ==============
  Widget _buildPercentChip(String label, double value, Color color) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 6.h),
      decoration: BoxDecoration(
        color: color.withOpacity(0.08),
        borderRadius: BorderRadius.circular(10.r),
        border: Border.all(color: color.withOpacity(0.15)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.percent_rounded, size: 12.sp, color: color),
          SizedBox(width: 4.w),
          Text(
            '$label: ',
            style: GoogleFonts.inter(
              fontSize: 10.5.sp,
              color: _muted,
              fontWeight: FontWeight.w600,
            ),
          ),
          Text(
            '${value.toStringAsFixed(value == value.roundToDouble() ? 0 : 1)}%',
            style: GoogleFonts.inter(
              fontSize: 10.5.sp,
              color: _darkText,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }

  // ============== LOADING STATE ==============
  Widget _buildLoadingState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          SizedBox(
            width: 40.w,
            height: 40.w,
            child: CircularProgressIndicator(color: _green, strokeWidth: 3),
          ),
          SizedBox(height: 16.h),
          Text(
            'Loading funders...',
            style: GoogleFonts.inter(
              fontSize: 14.sp,
              color: _muted,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }

  // ============== EMPTY STATE ==============
  Widget _buildEmptyState() {
    return SlideTransition(
      position: _headerSlideAnimation,
      child: FadeTransition(
        opacity: _headerAnimation,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            SizedBox(height: 80.h),
            Center(
              child: Column(
                children: [
                  Container(
                    padding: EdgeInsets.all(24.w),
                    decoration: BoxDecoration(
                      color: _green.withOpacity(0.08),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      Icons.account_balance_outlined,
                      size: 52.sp,
                      color: _muted,
                    ),
                  ),
                  SizedBox(height: 16.h),
                  Text(
                    'No Funders Found',
                    style: GoogleFonts.inter(
                      fontSize: 18.sp,
                      fontWeight: FontWeight.w700,
                      color: _darkText,
                    ),
                  ),
                  SizedBox(height: 8.h),
                  Text(
                    'Add funders to manage lending partners',
                    style: GoogleFonts.inter(fontSize: 13.sp, color: _muted),
                    textAlign: TextAlign.center,
                  ),
                  SizedBox(height: 24.h),
                  ElevatedButton.icon(
                    onPressed: _openCreate,
                    icon: const Icon(Icons.add_rounded),
                    label: Text(
                      'Add Funder',
                      style: GoogleFonts.inter(
                        fontSize: 14.sp,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: _green,
                      foregroundColor: Colors.white,
                      padding: EdgeInsets.symmetric(
                        horizontal: 24.w,
                        vertical: 12.h,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12.r),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ============== FUNDER DETAILS DIALOG ==============
  void _showFunderDetails(dynamic funder) {
    showDialog(
      context: context,
      barrierDismissible: true,
      builder: (context) => Dialog(
        elevation: 0,
        backgroundColor: Colors.transparent,
        child: TweenAnimationBuilder(
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOutBack,
          tween: Tween<double>(begin: 0.0, end: 1.0),
          builder: (context, value, child) {
            return Transform.scale(
              scale: value,
              child: Container(
                padding: EdgeInsets.all(24.w),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(20.r),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withOpacity(0.15),
                      blurRadius: 30,
                      spreadRadius: 5,
                    ),
                  ],
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: EdgeInsets.all(12.w),
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              colors: [_green, _greenLight],
                            ),
                            borderRadius: BorderRadius.circular(12.r),
                          ),
                          child: Icon(
                            Icons.account_balance_rounded,
                            color: Colors.white,
                            size: 24.sp,
                          ),
                        ),
                        SizedBox(width: 12.w),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                funder.funderName,
                                style: GoogleFonts.inter(
                                  fontSize: 18.sp,
                                  fontWeight: FontWeight.w700,
                                  color: _darkText,
                                ),
                              ),
                              Text(
                                'ID: ${funder.funderId}',
                                style: GoogleFonts.inter(
                                  fontSize: 13.sp,
                                  color: _green,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ],
                          ),
                        ),
                        if (!funder.isActive)
                          Container(
                            padding: EdgeInsets.symmetric(
                              horizontal: 8.w,
                              vertical: 3.h,
                            ),
                            decoration: BoxDecoration(
                              color: Colors.red.withOpacity(0.1),
                              borderRadius: BorderRadius.circular(20.r),
                            ),
                            child: Text(
                              'Inactive',
                              style: GoogleFonts.inter(
                                fontSize: 11.sp,
                                color: const Color(0xFFDC2626),
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                      ],
                    ),
                    SizedBox(height: 20.h),
                    _buildDetailRow(
                      'Principal GL',
                      funder.principalGL.isNotEmpty
                          ? '${funder.principalGL['glName'] ?? funder.principalGLId}'
                          : funder.principalGLId,
                      Icons.account_balance_wallet_rounded,
                    ),
                    _buildDetailRow(
                      'Interest GL',
                      funder.interestGL.isNotEmpty
                          ? '${funder.interestGL['glName'] ?? funder.interestGLId}'
                          : funder.interestGLId,
                      Icons.account_balance_wallet_rounded,
                    ),
                    _buildDetailRow(
                      'Interest %',
                      '${funder.interestPercent.toStringAsFixed(funder.interestPercent == funder.interestPercent.roundToDouble() ? 0 : 1)}%',
                      Icons.percent_rounded,
                    ),
                    _buildDetailRow(
                      'TDS %',
                      '${funder.tdsPercent.toStringAsFixed(funder.tdsPercent == funder.tdsPercent.roundToDouble() ? 0 : 1)}%',
                      Icons.percent_rounded,
                    ),
                    SizedBox(height: 20.h),
                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton(
                        onPressed: () => Navigator.pop(context),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: _green,
                          foregroundColor: Colors.white,
                          padding: EdgeInsets.symmetric(vertical: 12.h),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12.r),
                          ),
                        ),
                        child: Text(
                          'Close',
                          style: GoogleFonts.inter(
                            fontSize: 14.sp,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _buildDetailRow(String label, String value, IconData icon) {
    return Padding(
      padding: EdgeInsets.only(bottom: 12.h),
      child: Row(
        children: [
          Icon(icon, size: 16.sp, color: _muted),
          SizedBox(width: 10.w),
          Text(
            '$label:',
            style: GoogleFonts.inter(
              fontSize: 13.sp,
              color: _muted,
              fontWeight: FontWeight.w500,
            ),
          ),
          SizedBox(width: 8.w),
          Expanded(
            child: Text(
              value,
              style: GoogleFonts.inter(
                fontSize: 13.sp,
                color: _darkText,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ============== CREATE FUNDER SHEET ==============
class _CreateFunderSheet extends StatefulWidget {
  const _CreateFunderSheet({required this.glAccounts, required this.onCreate});

  final RxList<AdminGlAccount> glAccounts;
  final Future<bool> Function(Map<String, dynamic> payload) onCreate;

  @override
  State<_CreateFunderSheet> createState() => _CreateFunderSheetState();
}

class _CreateFunderSheetState extends State<_CreateFunderSheet>
    with TickerProviderStateMixin {
  static const _green = Color(0xFF0D6842);
  static const _greenLight = Color(0xFF1A8A5A);
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);

  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _interest = TextEditingController();
  final _tds = TextEditingController();
  String? _principalGLId;
  String? _interestGLId;
  bool _saving = false;

  late AnimationController _sheetController;
  late Animation<double> _sheetAnimation;

  @override
  void initState() {
    super.initState();
    _sheetController = AnimationController(
      duration: const Duration(milliseconds: 400),
      vsync: this,
    );
    _sheetAnimation = CurvedAnimation(
      parent: _sheetController,
      curve: Curves.easeOutCubic,
    );
    _sheetController.forward();
  }

  @override
  void dispose() {
    _name.dispose();
    _interest.dispose();
    _tds.dispose();
    _sheetController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: _sheetAnimation,
      child: Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(context).viewInsets.bottom,
        ),
        child: Container(
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          padding: EdgeInsets.fromLTRB(20.w, 14.h, 20.w, 24.h),
          child: Form(
            key: _formKey,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Center(
                    child: Container(
                      width: 40.w,
                      height: 5.h,
                      decoration: BoxDecoration(
                        color: const Color(0xFFE2E8F0),
                        borderRadius: BorderRadius.circular(10.r),
                      ),
                    ),
                  ),
                  SizedBox(height: 18.h),
                  Row(
                    children: [
                      Container(
                        padding: EdgeInsets.all(8.w),
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            colors: [_green, _greenLight],
                          ),
                          borderRadius: BorderRadius.circular(10.r),
                        ),
                        child: Icon(
                          Icons.add_rounded,
                          color: Colors.white,
                          size: 18.sp,
                        ),
                      ),
                      SizedBox(width: 10.w),
                      Text(
                        'Add Funder',
                        style: GoogleFonts.inter(
                          fontSize: 18.sp,
                          fontWeight: FontWeight.w700,
                          color: _darkText,
                        ),
                      ),
                    ],
                  ),
                  SizedBox(height: 20.h),
                  _buildTextField(
                    controller: _name,
                    label: 'Funder Name',
                    icon: Icons.business_rounded,
                    validator: (v) => (v == null || v.trim().isEmpty)
                        ? 'Funder name is required'
                        : null,
                  ),
                  SizedBox(height: 14.h),
                  _buildDropdown(
                    label: 'Principal GL',
                    icon: Icons.account_balance_wallet_rounded,
                    value: _principalGLId,
                    items: widget.glAccounts
                        .map(
                          (g) => DropdownMenuItem(
                            value: g.glId,
                            child: Text(
                              '${g.glName} (${g.glId})',
                              overflow: TextOverflow.ellipsis,
                              style: GoogleFonts.inter(fontSize: 13.sp),
                            ),
                          ),
                        )
                        .toList(),
                    onChanged: (v) => setState(() => _principalGLId = v),
                    validator: (v) =>
                        v == null ? 'Principal GL is required' : null,
                  ),
                  SizedBox(height: 14.h),
                  _buildDropdown(
                    label: 'Interest GL',
                    icon: Icons.percent_rounded,
                    value: _interestGLId,
                    items: widget.glAccounts
                        .map(
                          (g) => DropdownMenuItem(
                            value: g.glId,
                            child: Text(
                              '${g.glName} (${g.glId})',
                              overflow: TextOverflow.ellipsis,
                              style: GoogleFonts.inter(fontSize: 13.sp),
                            ),
                          ),
                        )
                        .toList(),
                    onChanged: (v) => setState(() => _interestGLId = v),
                    validator: (v) =>
                        v == null ? 'Interest GL is required' : null,
                  ),
                  SizedBox(height: 14.h),
                  Row(
                    children: [
                      Expanded(
                        child: _buildTextField(
                          controller: _interest,
                          label: 'Interest %',
                          icon: Icons.percent_rounded,
                          keyboardType: const TextInputType.numberWithOptions(
                            decimal: true,
                          ),
                          validator: (v) {
                            if (v == null || v.isEmpty) return null;
                            if (double.tryParse(v) == null)
                              return 'Invalid number';
                            return null;
                          },
                        ),
                      ),
                      SizedBox(width: 12.w),
                      Expanded(
                        child: _buildTextField(
                          controller: _tds,
                          label: 'TDS %',
                          icon: Icons.percent_rounded,
                          keyboardType: const TextInputType.numberWithOptions(
                            decimal: true,
                          ),
                          validator: (v) {
                            if (v == null || v.isEmpty) return null;
                            if (double.tryParse(v) == null)
                              return 'Invalid number';
                            return null;
                          },
                        ),
                      ),
                    ],
                  ),
                  SizedBox(height: 24.h),
                  SizedBox(
                    width: double.infinity,
                    height: 50.h,
                    child: ElevatedButton(
                      onPressed: _saving ? null : _submit,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: _green,
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12.r),
                        ),
                        elevation: 2,
                        disabledBackgroundColor: Colors.grey.shade300,
                      ),
                      child: _saving
                          ? SizedBox(
                              width: 22.w,
                              height: 22.w,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : Text(
                              'Create Funder',
                              style: GoogleFonts.inter(
                                fontSize: 15.sp,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildTextField({
    required TextEditingController controller,
    required String label,
    required IconData icon,
    TextInputType? keyboardType,
    String? Function(String?)? validator,
  }) {
    return TextFormField(
      controller: controller,
      keyboardType: keyboardType,
      decoration: InputDecoration(
        labelText: label,
        labelStyle: GoogleFonts.inter(fontSize: 13.sp, color: _muted),
        prefixIcon: Icon(icon, color: _muted, size: 20.sp),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12.r)),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12.r),
          borderSide: const BorderSide(color: _green, width: 2),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12.r),
          borderSide: BorderSide(color: Colors.grey.shade300),
        ),
        contentPadding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 0),
      ),
      validator: validator,
      style: GoogleFonts.inter(fontSize: 14.sp, color: _darkText),
    );
  }

  Widget _buildDropdown({
    required String label,
    required IconData icon,
    required String? value,
    required List<DropdownMenuItem<String>> items,
    required void Function(String?)? onChanged,
    required String? Function(String?)? validator,
  }) {
    return DropdownButtonFormField<String>(
      value: value,
      isExpanded: true,
      decoration: InputDecoration(
        labelText: label,
        labelStyle: GoogleFonts.inter(fontSize: 13.sp, color: _muted),
        prefixIcon: Icon(icon, color: _muted, size: 20.sp),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12.r)),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12.r),
          borderSide: const BorderSide(color: _green, width: 2),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12.r),
          borderSide: BorderSide(color: Colors.grey.shade300),
        ),
        contentPadding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 0),
      ),
      items: items,
      onChanged: onChanged,
      validator: validator,
      style: GoogleFonts.inter(fontSize: 14.sp, color: _darkText),
      dropdownColor: Colors.white,
      borderRadius: BorderRadius.circular(12.r),
    );
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);

    final success = await widget.onCreate({
      'funderName': _name.text.trim(),
      'principleGL': _principalGLId,
      'interestGL': _interestGLId,
      'interestPercent': double.tryParse(_interest.text.trim()) ?? 0,
      'tdsPercent': double.tryParse(_tds.text.trim()) ?? 0,
    });

    if (!mounted) return;
    setState(() => _saving = false);
    if (success) Navigator.of(context).pop();
  }
}
