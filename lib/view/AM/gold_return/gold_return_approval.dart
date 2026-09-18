import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import 'package:sarvam/controller/gold_return_controller.dart';
import 'package:sarvam/widgets/confirm_dialog.dart';

class GoldReturnApproval extends StatefulWidget {
  const GoldReturnApproval({super.key});

  @override
  State<GoldReturnApproval> createState() => _GoldReturnApprovalState();
}

class _GoldReturnApprovalState extends State<GoldReturnApproval>
    with SingleTickerProviderStateMixin {
  static const _green = Color(0xFF0D6842);
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);
  static const _border = Color(0xFFE8F0EB);

  final GoldReturnController _controller = Get.isRegistered<GoldReturnController>()
      ? Get.find<GoldReturnController>()
      : Get.put(GoldReturnController());

  late TabController _tabController;
  final TextEditingController _reasonController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _controller.fetchGoldTransactions();
  }

  @override
  void dispose() {
    _tabController.dispose();
    _reasonController.dispose();
    super.dispose();
  }

  String _formatMoney(dynamic val) {
    final num v = val is num ? val : (num.tryParse('$val') ?? 0);
    return '₹${v.toStringAsFixed(2)}';
  }

  void _showRejectDialog(String transactionId) {
    _reasonController.clear();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16.r)),
        title: Text(
          'Reject Gold Return',
          style: GoogleFonts.inter(fontWeight: FontWeight.w700, fontSize: 16.sp),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Please provide a reason for rejecting this gold return:',
              style: GoogleFonts.inter(fontSize: 12.sp, color: _muted),
            ),
            SizedBox(height: 12.h),
            TextField(
              controller: _reasonController,
              maxLines: 3,
              style: GoogleFonts.inter(fontSize: 13.sp),
              decoration: InputDecoration(
                hintText: 'Rejection reason...',
                hintStyle: GoogleFonts.inter(color: Colors.grey.shade400, fontSize: 12.sp),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10.r),
                  borderSide: const BorderSide(color: _border),
                ),
                contentPadding: EdgeInsets.all(12.w),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: Text('Cancel', style: TextStyle(color: _muted, fontSize: 13.sp)),
          ),
          ElevatedButton(
            onPressed: () async {
              if (_reasonController.text.trim().isEmpty) return;
              Navigator.of(ctx).pop();
              await _controller.rejectReturn(transactionId, _reasonController.text);
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFDC2626),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8.r)),
            ),
            child: Text('Reject', style: TextStyle(color: Colors.white, fontSize: 13.sp)),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0.5,
        iconTheme: const IconThemeData(color: _darkText),
        title: Text(
          'Gold Return Approval',
          style: GoogleFonts.inter(
            color: _darkText,
            fontWeight: FontWeight.w700,
            fontSize: 17.sp,
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded, color: _green),
            onPressed: () => _controller.fetchGoldTransactions(),
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          labelColor: _green,
          unselectedLabelColor: _muted,
          indicatorColor: _green,
          labelStyle: GoogleFonts.inter(fontWeight: FontWeight.w700, fontSize: 12.sp),
          unselectedLabelStyle: GoogleFonts.inter(fontWeight: FontWeight.w500, fontSize: 12.sp),
          tabs: const [
            Tab(text: 'Pending Returns'),
            Tab(text: 'Active Gold'),
            Tab(text: 'Completed'),
          ],
        ),
      ),
      body: SafeArea(
        child: Obx(() {
          if (_controller.isLoading.value) {
            return const Center(child: CircularProgressIndicator(color: _green));
          }

          return TabBarView(
            controller: _tabController,
            children: [
              _buildList(_controller.pendingReturns, isPending: true),
              _buildList(_controller.activeGoldLoans, isActive: true),
              _buildList(_controller.completedReturns, isCompleted: true),
            ],
          );
        }),
      ),
    );
  }

  Widget _buildList(List items, {bool isPending = false, bool isActive = false, bool isCompleted = false}) {
    if (items.isEmpty) {
      return RefreshIndicator(
        color: _green,
        onRefresh: () => _controller.fetchGoldTransactions(),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: EdgeInsets.all(32.w),
          children: [
            SizedBox(height: 40.h),
            Icon(Icons.workspace_premium_rounded, size: 56.sp, color: Colors.amber.shade600),
            SizedBox(height: 16.h),
            Text(
              isPending ? 'No Pending Returns' : (isActive ? 'No Active Gold Loans' : 'No Completed Returns'),
              textAlign: TextAlign.center,
              style: GoogleFonts.inter(fontSize: 16.sp, fontWeight: FontWeight.w700, color: _darkText),
            ),
            SizedBox(height: 8.h),
            Text(
              'Pull down to refresh transaction records.',
              textAlign: TextAlign.center,
              style: GoogleFonts.inter(fontSize: 13.sp, color: _muted),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      color: _green,
      onRefresh: () => _controller.fetchGoldTransactions(),
      child: ListView.builder(
        padding: EdgeInsets.all(16.w),
        itemCount: items.length,
        itemBuilder: (ctx, idx) {
          final tx = items[idx] as Map;
          return _buildGoldCard(tx, isPending: isPending, isActive: isActive, isCompleted: isCompleted);
        },
      ),
    );
  }

  Widget _buildGoldCard(Map tx, {bool isPending = false, bool isActive = false, bool isCompleted = false}) {
    final loan = (tx['loan'] as Map?) ?? {};
    final client = (loan['client'] as Map?) ?? {};
    final center = (loan['center'] as Map?) ?? {};
    final branch = (loan['branch'] as Map?) ?? {};
    final goldDetail = (loan['goldLoanDetail'] as Map?) ?? {};
    final initiatedBy = (tx['initiatedBy'] as Map?) ?? {};
    final txId = "${tx['id']}";

    final clientName = "${client['firstName'] ?? ''} ${client['lastName'] ?? ''}".trim();
    final loanNo = "${loan['loanNumber'] ?? 'N/A'}";
    final centerName = "${center['name'] ?? 'N/A'}";
    final branchName = "${branch['name'] ?? 'N/A'}";
    final initiatorName = "${initiatedBy['firstName'] ?? ''} ${initiatedBy['lastName'] ?? ''}".trim();

    return Container(
      margin: EdgeInsets.only(bottom: 14.h),
      padding: EdgeInsets.all(14.w),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14.r),
        border: Border.all(color: const Color(0xFFC8EBD4)),
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
              Expanded(
                child: Text(
                  clientName,
                  style: GoogleFonts.inter(
                    fontWeight: FontWeight.w700,
                    fontSize: 15.sp,
                    color: _darkText,
                  ),
                ),
              ),
              Container(
                padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 3.h),
                decoration: BoxDecoration(
                  color: isPending
                      ? const Color(0xFFFEF3C7)
                      : (isCompleted ? const Color(0xFFE4F5EB) : const Color(0xFFE0F2FE)),
                  borderRadius: BorderRadius.circular(6.r),
                ),
                child: Text(
                  isPending ? 'PENDING AM APPROVAL' : (isCompleted ? 'RETURN APPROVED' : 'ACTIVE GOLD'),
                  style: GoogleFonts.inter(
                    fontSize: 9.sp,
                    fontWeight: FontWeight.w800,
                    color: isPending
                        ? const Color(0xFFB45309)
                        : (isCompleted ? _green : const Color(0xFF0369A1)),
                  ),
                ),
              ),
            ],
          ),
          SizedBox(height: 4.h),
          Text(
            'Loan: $loanNo  •  Branch: $branchName  •  Center: $centerName',
            style: GoogleFonts.inter(fontSize: 11.sp, color: _muted),
          ),
          SizedBox(height: 10.h),
          const Divider(height: 1, color: _border),
          SizedBox(height: 10.h),
          Row(
            children: [
              _goldCell('Grams', '${tx['gramCount'] ?? goldDetail['gramCount'] ?? 0}g'),
              _goldCell('Gold Value', _formatMoney(tx['goldValue'] ?? goldDetail['goldTakenValue'])),
              _goldCell('Cash Given', _formatMoney(goldDetail['cashGiven'])),
            ],
          ),
          if (initiatorName.isNotEmpty) ...[
            SizedBox(height: 8.h),
            Text(
              'Initiated by: $initiatorName',
              style: GoogleFonts.inter(fontSize: 11.sp, color: _muted),
            ),
          ],
          if (isPending) ...[
            SizedBox(height: 14.h),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => _showRejectDialog(txId),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: const Color(0xFFDC2626),
                      side: const BorderSide(color: Color(0xFFFECACA)),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10.r)),
                      padding: EdgeInsets.symmetric(vertical: 10.h),
                    ),
                    child: Text('Reject', style: GoogleFonts.inter(fontWeight: FontWeight.w700, fontSize: 13.sp)),
                  ),
                ),
                SizedBox(width: 10.w),
                Expanded(
                  child: ElevatedButton(
                    onPressed: () async {
                      final confirm = await showConfirmDialog(
                        context,
                        title: 'Approve Gold Return',
                        message: 'Are you sure you want to approve gold return for $clientName?',
                        confirmLabel: 'Approve',
                        danger: false,
                      );
                      if (confirm == true) {
                        await _controller.approveReturn(txId);
                      }
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: _green,
                      elevation: 0,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10.r)),
                      padding: EdgeInsets.symmetric(vertical: 10.h),
                    ),
                    child: Text('Approve', style: GoogleFonts.inter(fontWeight: FontWeight.w700, fontSize: 13.sp, color: Colors.white)),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _goldCell(String label, String val) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: GoogleFonts.inter(fontSize: 10.sp, color: _muted)),
          SizedBox(height: 1.h),
          Text(
            val,
            style: GoogleFonts.inter(fontSize: 12.sp, fontWeight: FontWeight.w700, color: _darkText),
          ),
        ],
      ),
    );
  }
}
