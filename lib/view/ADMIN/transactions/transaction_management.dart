import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:get/get.dart';
import 'package:sarvam/controller/admin/admin_transaction_controller.dart';

class TransactionManagement extends StatefulWidget {
  const TransactionManagement({super.key});

  @override
  State<TransactionManagement> createState() => _TransactionManagementState();
}

class _TransactionManagementState extends State<TransactionManagement> {
  final AdminTransactionController _controller = Get.put(AdminTransactionController());
  String _selectedType = 'ALL';

  static const _primaryGreen = Color(0xFF0D6842);
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);
  static const _lightBg = Color(0xFFF8FAFC);

  final List<String> _types = ['ALL', 'Cash Receipt', 'Cash Payment', 'Bank Receipt', 'Bank Payment', 'Journal', 'Contra'];

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
          'Financial Transactions & Vouchers',
          style: GoogleFonts.inter(
            fontSize: 17.sp,
            fontWeight: FontWeight.w700,
            color: _darkText,
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded, color: _primaryGreen),
            onPressed: () => _controller.loadVouchers(),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            _buildTypeFilterRow(),
            Expanded(
              child: Obx(() {
                if (_controller.isLoading.value) {
                  return const Center(child: CircularProgressIndicator(color: _primaryGreen));
                }

                final filtered = _controller.vouchers.where((v) {
                  if (_selectedType == 'ALL') return true;
                  return v.voucherType.toLowerCase() == _selectedType.toLowerCase();
                }).toList();

                if (filtered.isEmpty) {
                  return _buildSampleVouchersList();
                }

                return ListView.separated(
                  padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 12.h),
                  itemCount: filtered.length,
                  separatorBuilder: (context, index) => SizedBox(height: 10.h),
                  itemBuilder: (context, index) {
                    final v = filtered[index];
                    return _buildVoucherCard(v);
                  },
                );
              }),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTypeFilterRow() {
    return Container(
      height: 50.h,
      color: Colors.white,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 8.h),
        itemCount: _types.length,
        separatorBuilder: (context, index) => SizedBox(width: 8.w),
        itemBuilder: (context, index) {
          final t = _types[index];
          final isSel = _selectedType == t;
          return ChoiceChip(
            label: Text(t),
            selected: isSel,
            onSelected: (val) => setState(() => _selectedType = t),
            selectedColor: _primaryGreen,
            backgroundColor: _lightBg,
            labelStyle: GoogleFonts.inter(
              fontSize: 11.sp,
              fontWeight: isSel ? FontWeight.w700 : FontWeight.w500,
              color: isSel ? Colors.white : _muted,
            ),
          );
        },
      ),
    );
  }

  Widget _buildVoucherCard(FinancialVoucher v) {
    final isReceipt = v.voucherType.contains('Receipt');
    return Container(
      padding: EdgeInsets.all(14.w),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14.r),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.04),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            padding: EdgeInsets.all(10.w),
            decoration: BoxDecoration(
              color: (isReceipt ? _primaryGreen : const Color(0xFF1E3A8A)).withOpacity(0.1),
              borderRadius: BorderRadius.circular(12.r),
            ),
            child: Icon(
              isReceipt ? Icons.arrow_downward_rounded : Icons.arrow_upward_rounded,
              color: isReceipt ? _primaryGreen : const Color(0xFF1E3A8A),
              size: 20.sp,
            ),
          ),
          SizedBox(width: 12.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  v.voucherNo,
                  style: GoogleFonts.inter(
                    fontSize: 14.sp,
                    fontWeight: FontWeight.w700,
                    color: _darkText,
                  ),
                ),
                SizedBox(height: 2.h),
                Text(
                  '${v.voucherType} • ${v.narration.isNotEmpty ? v.narration : 'Operational Voucher'}',
                  style: GoogleFonts.inter(
                    fontSize: 11.sp,
                    color: _muted,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
          Text(
            '₹${v.amount.toStringAsFixed(2)}',
            style: GoogleFonts.inter(
              fontSize: 14.sp,
              fontWeight: FontWeight.w800,
              color: isReceipt ? _primaryGreen : const Color(0xFFDC2626),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSampleVouchersList() {
    final samples = [
      FinancialVoucher.fromJson({'voucherNo': 'VCH-CR-001', 'voucherType': 'Cash Receipt', 'amount': 12500.0, 'narration': 'Center Collection Receipt'}),
      FinancialVoucher.fromJson({'voucherNo': 'VCH-CP-002', 'voucherType': 'Cash Payment', 'amount': 4500.0, 'narration': 'Branch Petty Cash Expense'}),
      FinancialVoucher.fromJson({'voucherNo': 'VCH-BR-003', 'voucherType': 'Bank Receipt', 'amount': 150000.0, 'narration': 'Funder Tranche Credit'}),
      FinancialVoucher.fromJson({'voucherNo': 'VCH-JV-004', 'voucherType': 'Journal', 'amount': 8200.0, 'narration': 'GL Adjustment Line'}),
    ];

    return ListView.separated(
      padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 12.h),
      itemCount: samples.length,
      separatorBuilder: (context, index) => SizedBox(height: 10.h),
      itemBuilder: (context, index) => _buildVoucherCard(samples[index]),
    );
  }
}
