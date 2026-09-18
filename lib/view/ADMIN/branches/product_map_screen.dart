import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import 'package:sarvam/controller/admin/admin_hub_controller.dart';

class ProductMapScreen extends StatefulWidget {
  const ProductMapScreen({super.key});

  @override
  State<ProductMapScreen> createState() => _ProductMapScreenState();
}

class _ProductMapScreenState extends State<ProductMapScreen> {
  static const _green = Color(0xFF037F35);
  static const _darkGreen = Color(0xFF013318);
  static const _subGreen = Color(0xFF025C27);
  static const _lightBg = Color(0xFFF0FAF4);
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);

  late AdminHubController _controller;
  String? _selectedBranchId;
  String _searchQuery = '';
  final TextEditingController _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _controller = Get.isRegistered<AdminHubController>()
        ? Get.find<AdminHubController>()
        : Get.put(AdminHubController());

    _controller.loadBranches();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  String _formatCurrency(double amount) {
    return NumberFormat('#,##,###', 'en_IN').format(amount.toInt());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: _buildAppBar(),
      body: SingleChildScrollView(
        physics: const BouncingScrollPhysics(),
        padding: EdgeInsets.all(16.w),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildMappingConfigurationCard(),
            SizedBox(height: 16.h),
            if (_selectedBranchId == null)
              _buildBranchContextRequiredCard()
            else
              _buildProductListCard(),
          ],
        ),
      ),
      bottomNavigationBar: _buildBottomActionBar(),
    );
  }

  // ==================== APP BAR ====================
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
              color: _green,
              borderRadius: BorderRadius.circular(10.r),
            ),
            child: Icon(
              Icons.inventory_2_rounded,
              color: Colors.white,
              size: 18.sp,
            ),
          ),
          SizedBox(width: 10.w),
          Text(
            'Product Map',
            style: GoogleFonts.inter(
              fontSize: 18.sp,
              fontWeight: FontWeight.w700,
              color: _darkText,
            ),
          ),
        ],
      ),
      bottom: PreferredSize(
        preferredSize: Size.fromHeight(1.h),
        child: Container(height: 1.h, color: Colors.grey.shade200),
      ),
    );
  }

  // ==================== HEADER & BRANCH SELECTOR CARD ====================
  Widget _buildMappingConfigurationCard() {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16.r),
        border: Border.all(color: _green.withValues(alpha: 0.2)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.04),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header Banner
          Container(
            padding: EdgeInsets.all(16.w),
            decoration: BoxDecoration(
              color: _lightBg,
              borderRadius: BorderRadius.vertical(top: Radius.circular(16.r)),
              border: Border(bottom: BorderSide(color: Colors.grey.shade100)),
            ),
            child: Row(
              children: [
                Container(
                  padding: EdgeInsets.all(10.w),
                  decoration: BoxDecoration(
                    color: _green,
                    borderRadius: BorderRadius.circular(12.r),
                  ),
                  child: Icon(
                    Icons.inventory_2_rounded,
                    color: Colors.white,
                    size: 22.sp,
                  ),
                ),
                SizedBox(width: 12.w),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Mapping Configuration',
                        style: GoogleFonts.inter(
                          fontSize: 16.sp,
                          fontWeight: FontWeight.w700,
                          color: _darkGreen,
                        ),
                      ),
                      SizedBox(height: 2.h),
                      Text(
                        'Configure exactly which loan products this branch can access.',
                        style: GoogleFonts.inter(
                          fontSize: 11.sp,
                          color: _muted,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          // Body: Branch Dropdown & Search & Select All
          Padding(
            padding: EdgeInsets.all(16.w),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                RichText(
                  text: TextSpan(
                    text: 'BRANCH NAME ',
                    style: GoogleFonts.inter(
                      fontSize: 11.sp,
                      fontWeight: FontWeight.w800,
                      color: _subGreen,
                      letterSpacing: 0.8,
                    ),
                    children: const [
                      TextSpan(
                        text: '*',
                        style: TextStyle(color: Colors.red),
                      ),
                    ],
                  ),
                ),
                SizedBox(height: 8.h),
                Obx(
                  () => DropdownButtonFormField<String>(
                    value: _selectedBranchId,
                    decoration: InputDecoration(
                      contentPadding: EdgeInsets.symmetric(horizontal: 14.w, vertical: 12.h),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12.r),
                        borderSide: BorderSide(color: _green.withValues(alpha: 0.3)),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12.r),
                        borderSide: BorderSide(color: _green.withValues(alpha: 0.3)),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12.r),
                        borderSide: const BorderSide(color: _green, width: 2),
                      ),
                    ),
                    hint: Text(
                      '-- SELECT BRANCH --',
                      style: GoogleFonts.inter(
                        fontSize: 13.sp,
                        fontWeight: FontWeight.w600,
                        color: _muted,
                      ),
                    ),
                    items: _controller.branches.map((branch) {
                      return DropdownMenuItem<String>(
                        value: branch.id,
                        child: Text(
                          '[${branch.code}] ${branch.name}',
                          style: GoogleFonts.inter(
                            fontSize: 14.sp,
                            fontWeight: FontWeight.w600,
                            color: _darkText,
                          ),
                        ),
                      );
                    }).toList(),
                    onChanged: (val) {
                      if (val != null) {
                        setState(() => _selectedBranchId = val);
                        _controller.loadProductsAndMappings(val);
                      }
                    },
                  ),
                ),

                if (_selectedBranchId != null) ...[
                  SizedBox(height: 14.h),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _searchController,
                          onChanged: (val) => setState(() => _searchQuery = val.trim().toLowerCase()),
                          decoration: InputDecoration(
                            hintText: 'Search products...',
                            hintStyle: GoogleFonts.inter(fontSize: 12.sp, color: _muted),
                            prefixIcon: Icon(Icons.search, color: _muted, size: 18.sp),
                            contentPadding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 8.h),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(10.r),
                              borderSide: BorderSide(color: Colors.grey.shade300),
                            ),
                          ),
                        ),
                      ),
                      SizedBox(width: 10.w),
                      Obx(() {
                        if (_controller.products.isEmpty) return const SizedBox.shrink();
                        final allSelected = _controller.isAllSelected;
                        return GestureDetector(
                          onTap: () {
                            _controller.toggleAllProducts(!allSelected);
                          },
                          child: Container(
                            padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 4.h),
                            decoration: BoxDecoration(
                              color: _lightBg,
                              borderRadius: BorderRadius.circular(10.r),
                              border: Border.all(color: _green.withValues(alpha: 0.3)),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  'SELECT ALL',
                                  style: GoogleFonts.inter(
                                    fontSize: 11.sp,
                                    fontWeight: FontWeight.w800,
                                    color: _green,
                                  ),
                                ),
                                SizedBox(width: 6.w),
                                IgnorePointer(
                                  child: Switch(
                                    value: allSelected,
                                    activeTrackColor: _green,
                                    onChanged: (_) {},
                                  ),
                                ),
                              ],
                            ),
                          ),
                        );
                      }),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ==================== BRANCH CONTEXT REQUIRED (EMPTY STATE) ====================
  Widget _buildBranchContextRequiredCard() {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.symmetric(vertical: 40.h, horizontal: 20.w),
      decoration: BoxDecoration(
        color: _lightBg,
        borderRadius: BorderRadius.circular(20.r),
        border: Border.all(color: _green.withValues(alpha: 0.15)),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            padding: EdgeInsets.all(20.w),
            decoration: const BoxDecoration(
              color: _green,
              shape: BoxShape.circle,
            ),
            child: Icon(
              Icons.storefront_rounded,
              color: Colors.white,
              size: 40.sp,
            ),
          ),
          SizedBox(height: 16.h),
          Text(
            'Branch Context Required',
            style: GoogleFonts.inter(
              fontSize: 18.sp,
              fontWeight: FontWeight.w700,
              color: _subGreen,
            ),
          ),
          SizedBox(height: 6.h),
          Text(
            'Please select a Branch Name above to view and assign accessibility for its loan products.',
            textAlign: TextAlign.center,
            style: GoogleFonts.inter(
              fontSize: 12.sp,
              color: _muted,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }

  // ==================== PRODUCTS LIST CARD ====================
  Widget _buildProductListCard() {
    return Obx(() {
      if (_controller.isLoading.value) {
        return Container(
          padding: EdgeInsets.all(40.h),
          alignment: Alignment.center,
          child: Column(
            children: [
              const CircularProgressIndicator(color: _green),
              SizedBox(height: 12.h),
              Text(
                'LOADING PRODUCT CONFIGURATIONS...',
                style: GoogleFonts.inter(
                  fontSize: 12.sp,
                  fontWeight: FontWeight.w700,
                  color: _subGreen,
                ),
              ),
            ],
          ),
        );
      }

      if (_controller.products.isEmpty) {
        return Container(
          padding: EdgeInsets.all(30.h),
          alignment: Alignment.center,
          child: Text(
            'No loan products set up in master catalog.',
            style: GoogleFonts.inter(fontSize: 13.sp, color: _muted),
          ),
        );
      }

      final filtered = _controller.products.where((p) {
        if (_searchQuery.isEmpty) return true;
        return p.productName.toLowerCase().contains(_searchQuery) ||
            p.productCode.toLowerCase().contains(_searchQuery) ||
            p.productId.toLowerCase().contains(_searchQuery);
      }).toList();

      if (filtered.isEmpty) {
        return Container(
          padding: EdgeInsets.all(30.h),
          alignment: Alignment.center,
          child: Text(
            'No products match "$_searchQuery"',
            style: GoogleFonts.inter(fontSize: 13.sp, color: _muted),
          ),
        );
      }

      return Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16.r),
          border: Border.all(color: Colors.grey.shade200),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.03),
              blurRadius: 8,
              offset: const Offset(0, 3),
            ),
          ],
        ),
        child: Column(
          children: [
            // Table Header Banner
            Container(
              padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 12.h),
              decoration: BoxDecoration(
                color: _green,
                borderRadius: BorderRadius.vertical(top: Radius.circular(16.r)),
              ),
              child: Row(
                children: [
                  Expanded(
                    flex: 3,
                    child: Text(
                      'PRODUCT NAME',
                      style: GoogleFonts.inter(
                        fontSize: 11.sp,
                        fontWeight: FontWeight.w800,
                        color: Colors.white,
                        letterSpacing: 0.5,
                      ),
                    ),
                  ),
                  Expanded(
                    flex: 2,
                    child: Text(
                      'DETAILS',
                      style: GoogleFonts.inter(
                        fontSize: 11.sp,
                        fontWeight: FontWeight.w800,
                        color: Colors.white,
                        letterSpacing: 0.5,
                      ),
                    ),
                  ),
                  Text(
                    'ACCESS',
                    style: GoogleFonts.inter(
                      fontSize: 11.sp,
                      fontWeight: FontWeight.w800,
                      color: Colors.white,
                      letterSpacing: 0.5,
                    ),
                  ),
                ],
              ),
            ),

            // Rows
            ListView.separated(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: filtered.length,
              separatorBuilder: (_, __) => Divider(height: 1, color: Colors.grey.shade200),
              itemBuilder: (context, index) {
                final product = filtered[index];
                return Obx(() {
                  final isMapped = _controller.productMappings[product.productId] ?? false;

                  return InkWell(
                    onTap: () {
                      final newVal = !isMapped;
                      product.isAccessible = newVal;
                      _controller.productMappings[product.productId] = newVal;
                    },
                    child: Container(
                      padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 14.h),
                      color: isMapped ? _lightBg.withValues(alpha: 0.5) : Colors.white,
                      child: Row(
                        children: [
                          // Left: Product Name & Frequency Badge
                          Expanded(
                            flex: 3,
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  product.productName,
                                  style: GoogleFonts.inter(
                                    fontSize: 13.sp,
                                    fontWeight: FontWeight.w700,
                                    color: _subGreen,
                                  ),
                                ),
                                SizedBox(height: 4.h),
                                Row(
                                  children: [
                                    Container(
                                      padding: EdgeInsets.symmetric(horizontal: 6.w, vertical: 2.h),
                                      decoration: BoxDecoration(
                                        color: const Color(0xFFE6F5EC),
                                        borderRadius: BorderRadius.circular(4.r),
                                      ),
                                      child: Text(
                                        product.frequency.toUpperCase(),
                                        style: GoogleFonts.inter(
                                          fontSize: 10.sp,
                                          fontWeight: FontWeight.w700,
                                          color: _subGreen,
                                        ),
                                      ),
                                    ),
                                    SizedBox(width: 6.w),
                                    Text(
                                      'Code: ${product.productCode}',
                                      style: GoogleFonts.inter(
                                        fontSize: 10.sp,
                                        color: _muted,
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),

                          // Center: Loan Amount & Interest
                          Expanded(
                            flex: 2,
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '₹ ${_formatCurrency(product.loanAmount)}',
                                  style: GoogleFonts.inter(
                                    fontSize: 12.sp,
                                    fontWeight: FontWeight.w700,
                                    color: const Color(0xFF047857),
                                  ),
                                ),
                                SizedBox(height: 2.h),
                                Text(
                                  'Interest: ₹ ${_formatCurrency(product.interest)}',
                                  style: GoogleFonts.inter(
                                    fontSize: 10.sp,
                                    color: Colors.orange.shade800,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ],
                            ),
                          ),

                          // Right: Access Switch
                          Switch(
                            value: isMapped,
                            activeTrackColor: _green,
                            onChanged: (val) {
                              product.isAccessible = val;
                              _controller.productMappings[product.productId] = val;
                            },
                          ),
                        ],
                      ),
                    ),
                  );
                });
              },
            ),
          ],
        ),
      );
    });
  }

  // ==================== BOTTOM ACTION BAR (SUBMIT & RESET) ====================
  Widget _buildBottomActionBar() {
    return Container(
      padding: EdgeInsets.all(16.w),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: Colors.grey.shade200)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 10,
            offset: const Offset(0, -4),
          ),
        ],
      ),
      child: Obx(() {
        final canAction = _selectedBranchId != null &&
            _controller.hasChanges &&
            !_controller.isSaving.value;

        return Row(
          children: [
            Expanded(
              flex: 2,
              child: ElevatedButton.icon(
                onPressed: canAction
                    ? () async {
                        await _controller.saveProductMappings(_selectedBranchId!);
                      }
                    : null,
                style: ElevatedButton.styleFrom(
                  backgroundColor: _green,
                  disabledBackgroundColor: Colors.grey.shade300,
                  minimumSize: Size.fromHeight(48.h),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12.r)),
                ),
                icon: _controller.isSaving.value
                    ? SizedBox(
                        width: 18.w,
                        height: 18.w,
                        child: const CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                      )
                    : const Icon(Icons.save_rounded, color: Colors.white),
                label: Text(
                  _controller.isSaving.value ? 'SAVING...' : 'SUBMIT',
                  style: GoogleFonts.inter(
                    fontSize: 14.sp,
                    fontWeight: FontWeight.w800,
                    color: Colors.white,
                    letterSpacing: 0.5,
                  ),
                ),
              ),
            ),
            SizedBox(width: 12.w),
            Expanded(
              flex: 1,
              child: OutlinedButton.icon(
                onPressed: canAction ? _controller.resetProductMappings : null,
                style: OutlinedButton.styleFrom(
                  foregroundColor: _subGreen,
                  side: BorderSide(
                    color: canAction ? _green : Colors.grey.shade300,
                  ),
                  minimumSize: Size.fromHeight(48.h),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12.r)),
                ),
                icon: const Icon(Icons.rotate_left_rounded),
                label: Text(
                  'RESET',
                  style: GoogleFonts.inter(
                    fontSize: 13.sp,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.5,
                  ),
                ),
              ),
            ),
          ],
        );
      }),
    );
  }
}
