import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:get/get.dart';
import 'package:sarvam/controller/collection_view_controller.dart';
import 'package:sarvam/view/AM/collection_view/advance_collection_view.dart';
import 'package:sarvam/view/AM/collection_view/arrear_collection_view.dart';
import 'package:sarvam/view/AM/collection_view/live_collection_view.dart';
import 'package:sarvam/view/AM/collection_view/single_collection_view.dart';

/// Read-only entry point for AM/BM to view Live, Arrear and Advance
/// collection data. Unlike the FDO `Collection` hub, nothing here leads to
/// an editable/submission flow — it's oversight-only.
class CollectionViewHub extends StatefulWidget {
  const CollectionViewHub({super.key, required this.isBranchManager});

  final bool isBranchManager;

  @override
  State<CollectionViewHub> createState() => _CollectionViewHubState();
}

class _CollectionViewHubState extends State<CollectionViewHub>
    with SingleTickerProviderStateMixin {
  static const _green = Color(0xFF0D6842);
  static const _muted = Color(0xFF64748B);

  late final AnimationController _animationController;
  late final Animation<double> _fadeAnimation;
  late final Animation<Offset> _slideAnimation;
  final CollectionViewController _controller = Get.put(
    CollectionViewController(),
  );

  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      duration: const Duration(milliseconds: 800),
      vsync: this,
    );

    _fadeAnimation = CurvedAnimation(
      parent: _animationController,
      curve: Curves.easeOut,
    );

    _slideAnimation =
        Tween<Offset>(begin: const Offset(0, 0.15), end: Offset.zero).animate(
          CurvedAnimation(
            parent: _animationController,
            curve: Curves.easeOutCubic,
          ),
        );

    WidgetsBinding.instance.addPostFrameCallback((_) {
      _controller.loadBranches(isBranchManager: widget.isBranchManager);
      _animationController.forward();
    });
  }

  @override
  void dispose() {
    _animationController.dispose();
    Get.delete<CollectionViewController>();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: _buildAppBar(),
      body: SafeArea(
        child: Obx(() {
          final branchId = _controller.selectedBranchId.value;
          return FadeTransition(
            opacity: _fadeAnimation,
            child: SlideTransition(
              position: _slideAnimation,
              child: SingleChildScrollView(
                padding: EdgeInsets.all(16.w),
                physics: const BouncingScrollPhysics(),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (!widget.isBranchManager) ...[
                      _buildSectionHeader('BRANCH'),
                      SizedBox(height: 8.h),
                      _branchPicker(),
                      SizedBox(height: 20.h),
                    ],
                    _buildSectionHeader('COLLECTIONS'),
                    SizedBox(height: 8.h),
                    _buildCollectionOption(
                      title: 'Live Collection',
                      subtitle: "View today's due repayments.",
                      imagePath: 'assets/images/live_collection.png',
                      enabled: branchId.isNotEmpty,
                      index: 0,
                      onTap: () => Navigator.of(context).push(
                        _buildPageRoute(
                          LiveCollectionView(
                            branchId: branchId,
                            branchName: _controller.selectedBranchName.value,
                          ),
                        ),
                      ),
                    ),
                    _buildCollectionOption(
                      title: 'Arrear Collection',
                      subtitle: 'View overdue repayments.',
                      imagePath: 'assets/images/arrear_collection.png',
                      enabled: branchId.isNotEmpty,
                      index: 1,
                      onTap: () => Navigator.of(context).push(
                        _buildPageRoute(
                          ArrearCollectionView(
                            branchId: branchId,
                            branchName: _controller.selectedBranchName.value,
                          ),
                        ),
                      ),
                    ),
                    _buildCollectionOption(
                      title: 'Advance Collection',
                      subtitle: 'View advance payments collected.',
                      imagePath: 'assets/images/advance_collection.png',
                      enabled: branchId.isNotEmpty,
                      index: 2,
                      onTap: () => Navigator.of(context).push(
                        _buildPageRoute(
                          AdvanceCollectionView(
                            branchId: branchId,
                            branchName: _controller.selectedBranchName.value,
                          ),
                        ),
                      ),
                    ),
                    _buildCollectionOption(
                      title: 'Single / Bulk Collection',
                      subtitle:
                          'View single client or full-centre demand sheet.',
                      imagePath: 'assets/images/single_bulk_collection.png',
                      enabled: branchId.isNotEmpty,
                      index: 3,
                      onTap: () => Navigator.of(context).push(
                        _buildPageRoute(
                          SingleCollectionView(
                            branchId: branchId,
                            branchName: _controller.selectedBranchName.value,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        }),
      ),
    );
  }

  PreferredSizeWidget _buildAppBar() {
    return AppBar(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.white,
      elevation: 0,
      title: Text(
        'View Collections',
        style: GoogleFonts.inter(
          fontSize: 18.sp,
          fontWeight: FontWeight.w600,
          color: const Color(0xFF084E33),
        ),
      ),
      centerTitle: false,
      leading: IconButton(
        onPressed: () => Navigator.of(context).pop(),
        icon: const Icon(Icons.arrow_back_ios_new_rounded),
        color: const Color(0xFF084E33),
        iconSize: 20.w,
        splashRadius: 24,
      ),
      bottom: PreferredSize(
        preferredSize: Size.fromHeight(1.h),
        child: Container(height: 1.h, color: const Color(0xFFE8ECEF)),
      ),
    );
  }

  Widget _buildSectionHeader(String title) {
    return Text(
      title,
      style: GoogleFonts.inter(
        fontSize: 13.sp,
        fontWeight: FontWeight.w800,
        color: _muted,
        letterSpacing: 1.1,
      ),
    );
  }

  Widget _branchPicker() {
    if (_controller.isLoading.value && _controller.branches.isEmpty) {
      return Center(
        child: Container(
          padding: EdgeInsets.all(24.w),
          child: Column(
            children: [
              SizedBox(
                width: 36.w,
                height: 36.w,
                child: const CircularProgressIndicator(
                  color: _green,
                  strokeWidth: 3,
                ),
              ),
              SizedBox(height: 12.h),
              Text(
                'Loading branches...',
                style: GoogleFonts.inter(color: _muted, fontSize: 13.sp),
              ),
            ],
          ),
        ),
      );
    }

    final branches = _controller.branches;
    if (branches.isEmpty) {
      return Container(
        padding: EdgeInsets.symmetric(vertical: 16.h, horizontal: 16.w),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12.r),
          border: Border.all(color: const Color(0xFFF1F5F9)),
        ),
        child: Row(
          children: [
            Icon(Icons.info_outline_rounded, color: _muted, size: 20.w),
            SizedBox(width: 12.w),
            Expanded(
              child: Text(
                'No branches assigned.',
                style: GoogleFonts.inter(color: _muted, fontSize: 13.sp),
              ),
            ),
          ],
        ),
      );
    }

    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: const Color(0xFFD8E0E1), width: 1.5),
        borderRadius: BorderRadius.circular(10.r),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.02),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 2.h),
        decoration: BoxDecoration(borderRadius: BorderRadius.circular(10.r)),
        child: DropdownButtonHideUnderline(
          child: DropdownButton<String>(
            isExpanded: true,
            value: _controller.selectedBranchId.value.isNotEmpty
                ? _controller.selectedBranchId.value
                : null,
            hint: Text(
              'Select a branch',
              style: GoogleFonts.inter(fontSize: 13.sp, color: _muted),
            ),
            icon: Icon(
              Icons.keyboard_arrow_down_rounded,
              color: const Color(0xFF084E33),
              size: 24.w,
            ),
            items: branches
                .map(
                  (b) => DropdownMenuItem<String>(
                    value: '${b['id'] ?? ''}',
                    child: Text(
                      '${b['name'] ?? ''}',
                      style: GoogleFonts.inter(
                        fontSize: 13.sp,
                        fontWeight: FontWeight.w500,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                )
                .toList(),
            onChanged: (value) {
              if (value == null) return;
              final matched = branches.firstWhere(
                (b) => '${b['id'] ?? ''}' == value,
              );
              _controller.selectBranch(value, '${matched['name'] ?? ''}');
            },
          ),
        ),
      ),
    );
  }

  Widget _buildCollectionOption({
    required String title,
    required String subtitle,
    required String imagePath,
    required VoidCallback onTap,
    required bool enabled,
    required int index,
  }) {
    final delay = Duration(milliseconds: 100 + (index * 80));

    return FadeTransition(
      opacity: _fadeAnimation,
      child: SlideTransition(
        position: _slideAnimation,
        child: Padding(
          padding: EdgeInsets.only(bottom: 12.h),
          child: _CollectionViewOption(
            title: title,
            subtitle: subtitle,
            imagePath: imagePath,
            onTap: onTap,
            enabled: enabled,
            delay: delay,
          ),
        ),
      ),
    );
  }

  Route _buildPageRoute(Widget page) {
    return PageRouteBuilder(
      pageBuilder: (context, animation, secondaryAnimation) => page,
      transitionsBuilder: (context, animation, secondaryAnimation, child) {
        const begin = Offset(0.3, 0);
        const end = Offset.zero;
        const curve = Curves.easeOutCubic;

        var tween = Tween(
          begin: begin,
          end: end,
        ).chain(CurveTween(curve: curve));
        var offsetAnimation = animation.drive(tween);

        return SlideTransition(
          position: offsetAnimation,
          child: FadeTransition(
            opacity: animation.drive(
              Tween(
                begin: 0.0,
                end: 1.0,
              ).chain(CurveTween(curve: Curves.easeOut)),
            ),
            child: child,
          ),
        );
      },
      transitionDuration: const Duration(milliseconds: 400),
    );
  }
}

class _CollectionViewOption extends StatefulWidget {
  const _CollectionViewOption({
    required this.title,
    required this.subtitle,
    required this.imagePath,
    required this.onTap,
    required this.enabled,
    this.delay = Duration.zero,
  });

  final String title, subtitle;
  final String imagePath;
  final VoidCallback onTap;
  final bool enabled;
  final Duration delay;

  @override
  State<_CollectionViewOption> createState() => _CollectionViewOptionState();
}

class _CollectionViewOptionState extends State<_CollectionViewOption>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _scaleAnimation;
  late final Animation<double> _opacityAnimation;

  bool _isHovered = false;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: const Duration(milliseconds: 400),
      vsync: this,
    );

    _scaleAnimation = Tween<double>(
      begin: 0.95,
      end: 1.0,
    ).animate(CurvedAnimation(parent: _controller, curve: Curves.easeOutCubic));

    _opacityAnimation = Tween<double>(
      begin: 0.0,
      end: 1.0,
    ).animate(CurvedAnimation(parent: _controller, curve: Curves.easeOut));

    WidgetsBinding.instance.addPostFrameCallback((_) {
      Future.delayed(widget.delay, () {
        if (mounted) _controller.forward();
      });
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ScaleTransition(
      scale: _scaleAnimation,
      child: FadeTransition(
        opacity: _opacityAnimation,
        child: Opacity(
          opacity: widget.enabled ? 1 : 0.5,
          child: MouseRegion(
            onEnter: (_) => setState(() => _isHovered = true),
            onExit: (_) => setState(() => _isHovered = false),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16.r),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(
                      alpha: _isHovered && widget.enabled ? 0.08 : 0.04,
                    ),
                    blurRadius: _isHovered && widget.enabled ? 20 : 12,
                    offset: Offset(0, _isHovered && widget.enabled ? 6 : 4),
                  ),
                ],
                border: Border.all(
                  color: _isHovered && widget.enabled
                      ? const Color(0xFF0D6842).withValues(alpha: 0.2)
                      : const Color(0xFFF1F5F9),
                ),
              ),
              child: Material(
                color: Colors.transparent,
                borderRadius: BorderRadius.circular(16.r),
                child: InkWell(
                  onTap: widget.enabled ? widget.onTap : null,
                  borderRadius: BorderRadius.circular(16.r),
                  splashColor: widget.enabled
                      ? const Color(0xFF0D6842).withValues(alpha: 0.08)
                      : Colors.transparent,
                  highlightColor: widget.enabled
                      ? const Color(0xFF0D6842).withValues(alpha: 0.04)
                      : Colors.transparent,
                  child: Padding(
                    padding: EdgeInsets.symmetric(
                      horizontal: 16.w,
                      vertical: 16.h,
                    ),
                    child: Row(
                      children: [
                        _buildImageIcon(),
                        SizedBox(width: 16.w),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                widget.title,
                                style: GoogleFonts.inter(
                                  fontSize: 16.sp,
                                  fontWeight: FontWeight.bold,
                                  color: widget.enabled
                                      ? const Color(0xFF084E33)
                                      : const Color(0xFF94A3B8),
                                ),
                              ),
                              SizedBox(height: 4.h),
                              Text(
                                widget.subtitle,
                                style: GoogleFonts.inter(
                                  fontSize: 12.sp,
                                  color: const Color(0xFF64748B),
                                  height: 1.2,
                                ),
                              ),
                            ],
                          ),
                        ),
                        AnimatedContainer(
                          duration: const Duration(milliseconds: 200),
                          transform: Matrix4.translationValues(
                            _isHovered && widget.enabled ? 4 : 0,
                            0,
                            0,
                          ),
                          child: Icon(
                            Icons.chevron_right_rounded,
                            color: widget.enabled
                                ? const Color(0xFF084E33)
                                : const Color(0xFF94A3B8),
                            size: 24.w,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildImageIcon() {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      transform: Matrix4.rotationZ(_isHovered && widget.enabled ? 0.1 : 0),
      child: Container(
        width: 52.w,
        height: 52.w,
        decoration: BoxDecoration(
          color: widget.enabled
              ? const Color(0xFFE8F5E9)
              : const Color(0xFFF1F5F9),
          shape: BoxShape.circle,
          boxShadow: [
            if (_isHovered && widget.enabled)
              BoxShadow(
                color: const Color(0xFF0D6842).withValues(alpha: 0.1),
                blurRadius: 8,
                offset: const Offset(0, 2),
              ),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(26.r),
          child: Image.asset(
            widget.imagePath,
            fit: BoxFit.cover,
            width: 52.w,
            height: 52.w,
            errorBuilder: (context, error, stackTrace) {
              return Container(
                color: const Color(0xFFE8F5E9),
                child: Icon(
                  Icons.image_not_supported_rounded,
                  color: const Color(0xFF084E33),
                  size: 24.sp,
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}
