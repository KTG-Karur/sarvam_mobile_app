import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:get/get.dart';
import 'package:sarvam/controller/admin/admin_master_controller.dart';

class LoanProductsList extends StatefulWidget {
  const LoanProductsList({super.key});

  @override
  State<LoanProductsList> createState() => _LoanProductsListState();
}

class _LoanProductsListState extends State<LoanProductsList> {
  final AdminMasterController _controller = Get.put(AdminMasterController());
  final TextEditingController _searchController = TextEditingController();
  String _filterQuery = '';

  static const _primaryGreen = Color(0xFF0D6842);
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);
  static const _lightBg = Color(0xFFF8FAFC);

  @override
  void initState() {
    super.initState();
    _controller.loadLoanProducts();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _lightBg,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: _darkText, size: 20),
          onPressed: () => Get.back(),
        ),
        title: Text(
          'Loan Products Master',
          style: GoogleFonts.inter(
            fontSize: 18.sp,
            fontWeight: FontWeight.w700,
            color: _darkText,
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded, color: _primaryGreen),
            onPressed: () => _controller.loadLoanProducts(),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            _buildSearchBar(),
            Expanded(
              child: Obx(() {
                if (_controller.isLoading.value) {
                  return const Center(
                    child: CircularProgressIndicator(color: _primaryGreen),
                  );
                }

                final filtered = _controller.loanProducts.where((product) {
                  final query = _filterQuery.toLowerCase();
                  return product.productName.toLowerCase().contains(query) ||
                      product.productCode.toLowerCase().contains(query) ||
                      product.loanProductTypeName.toLowerCase().contains(query);
                }).toList();

                if (filtered.isEmpty) {
                  return _buildEmptyState();
                }

                return ListView.separated(
                  padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 12.h),
                  itemCount: filtered.length,
                  separatorBuilder: (context, index) => SizedBox(height: 12.h),
                  itemBuilder: (context, index) {
                    final product = filtered[index];
                    return _buildProductCard(product);
                  },
                );
              }),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSearchBar() {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 12.h),
      color: Colors.white,
      child: TextField(
        controller: _searchController,
        onChanged: (val) => setState(() => _filterQuery = val),
        decoration: InputDecoration(
          hintText: 'Search loan product by name or code...',
          hintStyle: GoogleFonts.inter(fontSize: 13.sp, color: _muted),
          prefixIcon: const Icon(Icons.search_rounded, color: _muted),
          filled: true,
          fillColor: _lightBg,
          contentPadding: EdgeInsets.symmetric(vertical: 10.h),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12.r),
            borderSide: BorderSide.none,
          ),
        ),
      ),
    );
  }

  Widget _buildProductCard(AdminLoanProduct product) {
    return Container(
      padding: EdgeInsets.all(16.w),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16.r),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.04),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: EdgeInsets.all(10.w),
                decoration: BoxDecoration(
                  color: _primaryGreen.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(12.r),
                ),
                child: Icon(Icons.inventory_2_rounded, color: _primaryGreen, size: 20.sp),
              ),
              SizedBox(width: 12.w),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      product.productName.isNotEmpty ? product.productName : 'Standard MFI Product',
                      style: GoogleFonts.inter(
                        fontSize: 15.sp,
                        fontWeight: FontWeight.w700,
                        color: _darkText,
                      ),
                    ),
                    SizedBox(height: 2.h),
                    Text(
                      'Code: ${product.productCode.isNotEmpty ? product.productCode : 'PROD-MFI'} • ${product.loanProductTypeName}',
                      style: GoogleFonts.inter(
                        fontSize: 12.sp,
                        color: _muted,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 4.h),
                decoration: BoxDecoration(
                  color: product.isActive ? const Color(0xFFDCFCE7) : const Color(0xFFFEE2E2),
                  borderRadius: BorderRadius.circular(20.r),
                ),
                child: Text(
                  product.isActive ? 'Active' : 'Inactive',
                  style: GoogleFonts.inter(
                    fontSize: 11.sp,
                    fontWeight: FontWeight.w600,
                    color: product.isActive ? const Color(0xFF166534) : const Color(0xFF991B1B),
                  ),
                ),
              ),
            ],
          ),
          SizedBox(height: 12.h),
          const Divider(height: 1),
          SizedBox(height: 12.h),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _buildDetailItem('Interest Rate', '${product.interestRate}% p.a.'),
              _buildDetailItem('Tenure', '${product.tenureMonths} Months'),
              _buildDetailItem('Max Amount', '₹${product.maxAmount.toStringAsFixed(0)}'),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildDetailItem(String label, String value) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: GoogleFonts.inter(fontSize: 10.sp, color: _muted, fontWeight: FontWeight.w500),
        ),
        SizedBox(height: 2.h),
        Text(
          value,
          style: GoogleFonts.inter(fontSize: 13.sp, color: _darkText, fontWeight: FontWeight.w700),
        ),
      ],
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.inventory_2_outlined, size: 48.sp, color: _muted.withOpacity(0.5)),
          SizedBox(height: 12.h),
          Text(
            'No Loan Products Found',
            style: GoogleFonts.inter(fontSize: 15.sp, fontWeight: FontWeight.w600, color: _darkText),
          ),
          SizedBox(height: 4.h),
          Text(
            'Try adjusting search filter or tap refresh',
            style: GoogleFonts.inter(fontSize: 12.sp, color: _muted),
          ),
        ],
      ),
    );
  }
}
