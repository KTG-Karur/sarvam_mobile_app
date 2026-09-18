import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/controller/collection_reversal_controller.dart';
import 'package:sarvam/controller/foreclosure_approval_controller.dart';
import 'package:sarvam/widgets/confirm_dialog.dart';

class ForeclosureApproval extends StatefulWidget {
  const ForeclosureApproval({super.key});

  @override
  State<ForeclosureApproval> createState() => _ForeclosureApprovalState();
}

class _ForeclosureApprovalState extends State<ForeclosureApproval> {
  static const _green = Color(0xFF0D6842);
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);
  static const _border = Color(0xFFE8F0EB);

  final ForeclosureApprovalController _controller =
      Get.isRegistered<ForeclosureApprovalController>()
          ? Get.find<ForeclosureApprovalController>()
          : Get.put(ForeclosureApprovalController());

  final CollectionReversalController _reversalController =
      Get.isRegistered<CollectionReversalController>()
          ? Get.find<CollectionReversalController>()
          : Get.put(CollectionReversalController());

  List<Map<String, String>> _branches = [];
  String? _selectedBranchId;
  final TextEditingController _reasonController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadBranches();
  }

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
  }

  Future<void> _loadBranches() async {
    final branches = await _reversalController.getBranchesForCurrentUser();
    if (!mounted) return;
    setState(() {
      _branches = branches;
      _selectedBranchId = branches.isNotEmpty ? branches.first['id'] : null;
    });
    if (_selectedBranchId != null && _selectedBranchId!.isNotEmpty) {
      await _controller.fetchCenters(_selectedBranchId!);
      await _controller.fetchPendingForeclosures(branchId: _selectedBranchId!);
    }
  }

  Future<void> _onBranchChanged(String? branchId) async {
    if (branchId == null) return;
    setState(() {
      _selectedBranchId = branchId;
    });
    await _controller.fetchCenters(branchId);
    await _controller.fetchPendingForeclosures(branchId: branchId);
  }

  String _formatCurrency(dynamic amt) {
    final v = amt is num ? amt.toDouble() : (double.tryParse('$amt') ?? 0.0);
    return '₹${v.toStringAsFixed(2)}';
  }

  void _showRejectDialog(String requestId) {
    _reasonController.clear();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16.r)),
        title: Text(
          'Reject Foreclosure',
          style: GoogleFonts.inter(fontWeight: FontWeight.w700, fontSize: 16.sp),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Please specify the reason for rejecting this foreclosure request:',
              style: GoogleFonts.inter(fontSize: 12.sp, color: _muted),
            ),
            SizedBox(height: 12.h),
            TextField(
              controller: _reasonController,
              maxLines: 3,
              style: GoogleFonts.inter(fontSize: 13.sp),
              decoration: InputDecoration(
                hintText: 'Reason for rejection...',
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
              await _controller.rejectForeclosure(requestId, _reasonController.text);
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
          'Foreclosure Approval',
          style: GoogleFonts.inter(
            color: _darkText,
            fontWeight: FontWeight.w700,
            fontSize: 17.sp,
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded, color: _green),
            onPressed: () => _controller.fetchPendingForeclosures(),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            _buildFilters(),
            Expanded(
              child: Obx(() {
                if (_controller.isLoading.value) {
                  return const Center(child: CircularProgressIndicator(color: _green));
                }

                if (_controller.pendingItems.isEmpty) {
                  return _buildEmptyState();
                }

                return RefreshIndicator(
                  color: _green,
                  onRefresh: () => _controller.fetchPendingForeclosures(),
                  child: ListView.builder(
                    padding: EdgeInsets.all(16.w),
                    itemCount: _controller.pendingItems.length,
                    itemBuilder: (ctx, idx) {
                      final item = _controller.pendingItems[idx] as Map;
                      return _buildForeclosureCard(item);
                    },
                  ),
                );
              }),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFilters() {
    return Container(
      color: Colors.white,
      padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 12.h),
      child: Row(
        children: [
          if (_branches.length > 1) ...[
            Expanded(
              child: DropdownButtonFormField<String>(
                value: _selectedBranchId,
                isExpanded: true,
                decoration: InputDecoration(
                  labelText: 'Branch',
                  labelStyle: GoogleFonts.inter(fontSize: 11.sp, color: _muted),
                  contentPadding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 8.h),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10.r),
                    borderSide: const BorderSide(color: _border),
                  ),
                ),
                items: _branches.map((b) {
                  return DropdownMenuItem<String>(
                    value: b['id'],
                    child: Text(
                      '${b['code']} - ${b['name']}',
                      style: GoogleFonts.inter(fontSize: 12.sp),
                    ),
                  );
                }).toList(),
                onChanged: _onBranchChanged,
              ),
            ),
            SizedBox(width: 10.w),
          ],
          Obx(() {
            final centersList = _controller.centers;
            return Expanded(
              child: DropdownButtonFormField<String>(
                value: _controller.selectedCenterId.value,
                isExpanded: true,
                decoration: InputDecoration(
                  labelText: 'Center',
                  labelStyle: GoogleFonts.inter(fontSize: 11.sp, color: _muted),
                  contentPadding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 8.h),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10.r),
                    borderSide: const BorderSide(color: _border),
                  ),
                ),
                items: [
                  const DropdownMenuItem(value: 'all', child: Text('All Centers')),
                  ...centersList.map((c) {
                    final map = c as Map;
                    return DropdownMenuItem<String>(
                      value: "${map['id']}",
                      child: Text(
                        "${map['name']} (${map['code']})",
                        style: GoogleFonts.inter(fontSize: 12.sp),
                      ),
                    );
                  }),
                ],
                onChanged: (val) {
                  if (val != null) {
                    _controller.selectedCenterId.value = val;
                    _controller.fetchPendingForeclosures();
                  }
                },
              ),
            );
          }),
        ],
      ),
    );
  }

  Widget _buildEmptyState() {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: EdgeInsets.all(32.w),
      children: [
        SizedBox(height: 40.h),
        Icon(Icons.check_circle_outline_rounded, size: 56.sp, color: _green),
        SizedBox(height: 16.h),
        Text(
          'No Pending Foreclosure Requests',
          textAlign: TextAlign.center,
          style: GoogleFonts.inter(
            fontSize: 16.sp,
            fontWeight: FontWeight.w700,
            color: _darkText,
          ),
        ),
        SizedBox(height: 8.h),
        Text(
          'All initiated loan foreclosure requests for your assigned branches have been processed.',
          textAlign: TextAlign.center,
          style: GoogleFonts.inter(fontSize: 13.sp, color: _muted),
        ),
      ],
    );
  }

  Widget _buildForeclosureCard(Map item) {
    final client = (item['client'] as Map?) ?? {};
    final center = (item['center'] as Map?) ?? {};
    final loan = (item['loan'] as Map?) ?? {};
    final amounts = (item['amounts'] as Map?) ?? {};
    final initiatedBy = (item['initiatedBy'] as Map?) ?? {};
    final requestId = "${item['id']}";

    final clientName = "${client['firstName'] ?? ''} ${client['lastName'] ?? ''}".trim();
    final loanNo = "${loan['loanNumber'] ?? 'N/A'}";
    final centerName = "${center['name'] ?? 'N/A'} (${center['code'] ?? ''})";
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
                  color: const Color(0xFFFEF3C7),
                  borderRadius: BorderRadius.circular(6.r),
                ),
                child: Text(
                  'PENDING AM APPROVAL',
                  style: GoogleFonts.inter(
                    fontSize: 9.sp,
                    fontWeight: FontWeight.w800,
                    color: const Color(0xFFB45309),
                  ),
                ),
              ),
            ],
          ),
          SizedBox(height: 4.h),
          Text(
            'Loan No: $loanNo  •  Center: $centerName',
            style: GoogleFonts.inter(fontSize: 11.sp, color: _muted),
          ),
          SizedBox(height: 10.h),
          const Divider(height: 1, color: _border),
          SizedBox(height: 10.h),
          Row(
            children: [
              _detailCell('Collected', _formatCurrency(amounts['collected']), isBold: true),
              _detailCell('Principal', _formatCurrency(amounts['principal'])),
              _detailCell('Interest', _formatCurrency(amounts['interest'])),
            ],
          ),
          SizedBox(height: 8.h),
          Row(
            children: [
              _detailCell('Penalty', _formatCurrency(amounts['penalty'])),
              _detailCell('Fees', _formatCurrency(amounts['fees'])),
              _detailCell('Initiator', initiatorName.isNotEmpty ? initiatorName : 'Branch Manager'),
            ],
          ),
          if (item['remarks'] != null && "${item['remarks']}".isNotEmpty) ...[
            SizedBox(height: 8.h),
            Text(
              'Remarks: ${item['remarks']}',
              style: GoogleFonts.inter(fontSize: 11.sp, color: _muted, fontStyle: FontStyle.italic),
            ),
          ],
          SizedBox(height: 14.h),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => _showRejectDialog(requestId),
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
                      title: 'Approve Foreclosure',
                      message: 'Are you sure you want to approve foreclosure for $clientName?',
                      confirmLabel: 'Approve',
                      danger: false,
                    );
                    if (confirm == true) {
                      await _controller.approveForeclosure(requestId);
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
      ),
    );
  }

  Widget _detailCell(String label, String val, {bool isBold = false}) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: GoogleFonts.inter(fontSize: 10.sp, color: _muted)),
          SizedBox(height: 1.h),
          Text(
            val,
            style: GoogleFonts.inter(
              fontSize: 12.sp,
              fontWeight: isBold ? FontWeight.w800 : FontWeight.w600,
              color: isBold ? _green : _darkText,
            ),
          ),
        ],
      ),
    );
  }
}
