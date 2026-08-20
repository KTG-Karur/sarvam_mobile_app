import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:sarvam/controller/admin/admin_master_controller.dart';

/// GL Accounts registry — lists /api/masters/gl and supports adding a GL.
class GlList extends StatefulWidget {
  const GlList({super.key});

  @override
  State<GlList> createState() => _GlListState();
}

class _GlListState extends State<GlList> with TickerProviderStateMixin {
  static const _green = Color(0xFF0D6842);
  static const _greenLight = Color(0xFF1A8A5A);
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);
  static const _lightBg = Color(0xFFF8FAFC);
  static const _cardBg = Color(0xFFFFFFFF);

  static const List<String> _glTypes = [
    'ASSET',
    'LIABILITY',
    'INCOME',
    'EXPENSE',
    'EQUITY',
  ];

  static const Map<String, Color> _typeColors = {
    'ASSET': Color(0xFF0D6842),
    'LIABILITY': Color(0xFFDC2626),
    'INCOME': Color(0xFF7C3AED),
    'EXPENSE': Color(0xFFB45309),
    'EQUITY': Color(0xFF0D9488),
  };

  static const Map<String, IconData> _typeIcons = {
    'ASSET': Icons.account_balance_rounded,
    'LIABILITY': Icons.assignment_rounded,
    'INCOME': Icons.trending_up_rounded,
    'EXPENSE': Icons.trending_down_rounded,
    'EQUITY': Icons.pie_chart_rounded,
  };

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
      builder: (_) => _CreateGlSheet(
        onCreate: (payload) async {
          final error = await _controller.createGlAccount(payload);
          if (!mounted) return false;
          if (error == null) {
            _showSuccessSnackbar('GL account created successfully');
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
        onRefresh: _controller.loadGlAccounts,
        child: Obx(() {
          if (_controller.isLoading.value && _controller.glAccounts.isEmpty) {
            return _buildLoadingState();
          }
          if (_controller.glAccounts.isEmpty) {
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
                itemCount: _controller.glAccounts.length,
                separatorBuilder: (_, __) => SizedBox(height: 12.h),
                itemBuilder: (_, i) =>
                    _buildGlTile(_controller.glAccounts[i], i),
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
              Icons.menu_book_rounded,
              color: Colors.white,
              size: 18.sp,
            ),
          ),
          SizedBox(width: 10.w),
          Text(
            'GL Accounts',
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
              Icon(
                Icons.account_balance_wallet_rounded,
                color: _green,
                size: 14.sp,
              ),
              SizedBox(width: 4.w),
              Obx(
                () => AnimatedSwitcher(
                  duration: const Duration(milliseconds: 300),
                  child: Text(
                    '${_controller.glAccounts.length}',
                    key: ValueKey(_controller.glAccounts.length),
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

  // ============== GL TILE ==============
  Widget _buildGlTile(dynamic glAccount, int index) {
    final typeColor = _typeColors[glAccount.glType] ?? _green;
    final typeIcon = _typeIcons[glAccount.glType] ?? Icons.toc_rounded;

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
            splashColor: typeColor.withOpacity(0.08),
            highlightColor: typeColor.withOpacity(0.04),
            onTap: () {
              _showGlDetails(glAccount);
            },
            child: Padding(
              padding: EdgeInsets.all(14.w),
              child: Row(
                children: [
                  Container(
                    padding: EdgeInsets.all(10.w),
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: [typeColor, typeColor.withOpacity(0.6)],
                      ),
                      borderRadius: BorderRadius.circular(12.r),
                      boxShadow: [
                        BoxShadow(
                          color: typeColor.withOpacity(0.2),
                          blurRadius: 8,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    child: Icon(typeIcon, color: Colors.white, size: 20.sp),
                  ),
                  SizedBox(width: 12.w),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                glAccount.glName,
                                style: GoogleFonts.inter(
                                  fontSize: 15.sp,
                                  fontWeight: FontWeight.w700,
                                  color: _darkText,
                                ),
                              ),
                            ),
                            if (!glAccount.isActive)
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
                        SizedBox(height: 4.h),
                        Row(
                          children: [
                            Container(
                              padding: EdgeInsets.symmetric(
                                horizontal: 8.w,
                                vertical: 2.h,
                              ),
                              decoration: BoxDecoration(
                                color: typeColor.withOpacity(0.1),
                                borderRadius: BorderRadius.circular(6.r),
                              ),
                              child: Text(
                                glAccount.glId,
                                style: GoogleFonts.inter(
                                  fontSize: 11.sp,
                                  color: typeColor,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                            SizedBox(width: 8.w),
                            Container(
                              padding: EdgeInsets.symmetric(
                                horizontal: 8.w,
                                vertical: 2.h,
                              ),
                              decoration: BoxDecoration(
                                color: typeColor.withOpacity(0.08),
                                borderRadius: BorderRadius.circular(6.r),
                              ),
                              child: Text(
                                glAccount.glType,
                                style: GoogleFonts.inter(
                                  fontSize: 11.sp,
                                  color: typeColor,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                          ],
                        ),
                        if (glAccount.description.isNotEmpty) ...[
                          SizedBox(height: 6.h),
                          Container(
                            padding: EdgeInsets.all(8.w),
                            decoration: BoxDecoration(
                              color: Colors.grey.shade50,
                              borderRadius: BorderRadius.circular(8.r),
                              border: Border.all(color: Colors.grey.shade200),
                            ),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Icon(
                                  Icons.format_quote_rounded,
                                  size: 12.sp,
                                  color: _muted.withOpacity(0.5),
                                ),
                                SizedBox(width: 6.w),
                                Expanded(
                                  child: Text(
                                    glAccount.description,
                                    style: GoogleFonts.inter(
                                      fontSize: 11.sp,
                                      color: _muted,
                                      height: 1.3,
                                    ),
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  // Animated arrow
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    padding: EdgeInsets.all(6.w),
                    decoration: BoxDecoration(
                      color: typeColor.withOpacity(0.08),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      Icons.arrow_forward_ios_rounded,
                      color: typeColor,
                      size: 12.sp,
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
            'Loading GL accounts...',
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
                      Icons.menu_book_outlined,
                      size: 52.sp,
                      color: _muted,
                    ),
                  ),
                  SizedBox(height: 16.h),
                  Text(
                    'No GL Accounts Found',
                    style: GoogleFonts.inter(
                      fontSize: 18.sp,
                      fontWeight: FontWeight.w700,
                      color: _darkText,
                    ),
                  ),
                  SizedBox(height: 8.h),
                  Text(
                    'Add GL accounts to manage your chart of accounts',
                    style: GoogleFonts.inter(fontSize: 13.sp, color: _muted),
                    textAlign: TextAlign.center,
                  ),
                  SizedBox(height: 24.h),
                  ElevatedButton.icon(
                    onPressed: _openCreate,
                    icon: const Icon(Icons.add_rounded),
                    label: Text(
                      'Add GL Account',
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

  // ============== GL DETAILS DIALOG ==============
  void _showGlDetails(dynamic glAccount) {
    final typeColor = _typeColors[glAccount.glType] ?? _green;
    final typeIcon = _typeIcons[glAccount.glType] ?? Icons.toc_rounded;

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
                              colors: [typeColor, typeColor.withOpacity(0.6)],
                            ),
                            borderRadius: BorderRadius.circular(12.r),
                          ),
                          child: Icon(
                            typeIcon,
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
                                glAccount.glName,
                                style: GoogleFonts.inter(
                                  fontSize: 18.sp,
                                  fontWeight: FontWeight.w700,
                                  color: _darkText,
                                ),
                              ),
                              Text(
                                '${glAccount.glId} • ${glAccount.glType}',
                                style: GoogleFonts.inter(
                                  fontSize: 13.sp,
                                  color: typeColor,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ],
                          ),
                        ),
                        if (!glAccount.isActive)
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
                    if (glAccount.description.isNotEmpty) ...[
                      Container(
                        padding: EdgeInsets.all(12.w),
                        decoration: BoxDecoration(
                          color: Colors.grey.shade50,
                          borderRadius: BorderRadius.circular(12.r),
                          border: Border.all(color: Colors.grey.shade200),
                        ),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Icon(
                              Icons.format_quote_rounded,
                              size: 16.sp,
                              color: _muted.withOpacity(0.5),
                            ),
                            SizedBox(width: 8.w),
                            Expanded(
                              child: Text(
                                glAccount.description,
                                style: GoogleFonts.inter(
                                  fontSize: 13.sp,
                                  color: _muted,
                                  height: 1.5,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      SizedBox(height: 12.h),
                    ],
                    _buildDetailRow(
                      'GL ID',
                      glAccount.glId,
                      Icons.code_rounded,
                      typeColor,
                    ),
                    _buildDetailRow(
                      'GL Type',
                      glAccount.glType,
                      Icons.label_rounded,
                      typeColor,
                    ),
                    _buildDetailRow(
                      'Status',
                      glAccount.isActive ? 'Active' : 'Inactive',
                      glAccount.isActive
                          ? Icons.check_circle_rounded
                          : Icons.cancel_rounded,
                      glAccount.isActive ? _green : Colors.red,
                    ),
                    SizedBox(height: 20.h),
                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton(
                        onPressed: () => Navigator.pop(context),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: typeColor,
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

  Widget _buildDetailRow(
    String label,
    String value,
    IconData icon,
    Color color,
  ) {
    return Padding(
      padding: EdgeInsets.only(bottom: 10.h),
      child: Row(
        children: [
          Icon(icon, size: 16.sp, color: color),
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

// ============== CREATE GL SHEET ==============
class _CreateGlSheet extends StatefulWidget {
  const _CreateGlSheet({required this.onCreate});

  final Future<bool> Function(Map<String, dynamic> payload) onCreate;

  @override
  State<_CreateGlSheet> createState() => _CreateGlSheetState();
}

class _CreateGlSheetState extends State<_CreateGlSheet>
    with TickerProviderStateMixin {
  static const _green = Color(0xFF0D6842);
  static const _greenLight = Color(0xFF1A8A5A);
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);

  static const List<String> _glTypes = [
    'ASSET',
    'LIABILITY',
    'INCOME',
    'EXPENSE',
    'EQUITY',
  ];

  static const Map<String, Color> _typeColors = {
    'ASSET': Color(0xFF0D6842),
    'LIABILITY': Color(0xFFDC2626),
    'INCOME': Color(0xFF7C3AED),
    'EXPENSE': Color(0xFFB45309),
    'EQUITY': Color(0xFF0D9488),
  };

  static const Map<String, IconData> _typeIcons = {
    'ASSET': Icons.account_balance_rounded,
    'LIABILITY': Icons.assignment_rounded,
    'INCOME': Icons.trending_up_rounded,
    'EXPENSE': Icons.trending_down_rounded,
    'EQUITY': Icons.pie_chart_rounded,
  };

  final _formKey = GlobalKey<FormState>();
  final _glName = TextEditingController();
  final _description = TextEditingController();
  String _glType = 'ASSET';
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
    _glName.dispose();
    _description.dispose();
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
                        'Add GL Account',
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
                    controller: _glName,
                    label: 'GL Name',
                    icon: Icons.text_fields_rounded,
                    validator: (v) => (v == null || v.trim().isEmpty)
                        ? 'GL name is required'
                        : null,
                  ),
                  SizedBox(height: 14.h),
                  _buildTypeDropdown(),
                  SizedBox(height: 14.h),
                  _buildTextField(
                    controller: _description,
                    label: 'Description (Optional)',
                    icon: Icons.description_rounded,
                    maxLines: 3,
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
                              'Create GL Account',
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
    int maxLines = 1,
    String? Function(String?)? validator,
  }) {
    return TextFormField(
      controller: controller,
      maxLines: maxLines,
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
        contentPadding: EdgeInsets.symmetric(
          horizontal: 12.w,
          vertical: maxLines > 1 ? 12.h : 0,
        ),
      ),
      validator: validator,
      style: GoogleFonts.inter(fontSize: 14.sp, color: _darkText),
    );
  }

  Widget _buildTypeDropdown() {
    final currentColor = _typeColors[_glType] ?? _green;
    final currentIcon = _typeIcons[_glType] ?? Icons.label_rounded;

    return DropdownButtonFormField<String>(
      value: _glType,
      decoration: InputDecoration(
        labelText: 'GL Type',
        labelStyle: GoogleFonts.inter(fontSize: 13.sp, color: _muted),
        prefixIcon: Icon(currentIcon, color: currentColor, size: 20.sp),
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
      items: _glTypes.map((type) {
        final color = _typeColors[type] ?? _green;
        final icon = _typeIcons[type] ?? Icons.label_rounded;
        return DropdownMenuItem(
          value: type,
          child: Row(
            children: [
              Icon(icon, color: color, size: 16.sp),
              SizedBox(width: 8.w),
              Text(
                type,
                style: GoogleFonts.inter(
                  fontSize: 13.sp,
                  color: _darkText,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        );
      }).toList(),
      onChanged: (v) => setState(() => _glType = v ?? _glType),
      style: GoogleFonts.inter(fontSize: 14.sp, color: _darkText),
      dropdownColor: Colors.white,
      borderRadius: BorderRadius.circular(12.r),
    );
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);

    final success = await widget.onCreate({
      'glName': _glName.text.trim(),
      'glType': _glType,
      'description': _description.text.trim().isEmpty
          ? null
          : _description.text.trim(),
    });

    if (!mounted) return;
    setState(() => _saving = false);
    if (success) Navigator.of(context).pop();
  }
}
