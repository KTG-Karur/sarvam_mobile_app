import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/api_client.dart';

const _green = Color(0xFF0D6842);
const _darkGreen = Color(0xFF075E2E);
const _darkText = Color(0xFF172033);
const _muted = Color(0xFF64748B);
const _border = Color(0xFFE1EEE6);

/// BM/AM "Collection Approval" screen — allows reviewing and approving/reverting
/// collection batches submitted by Field Development Officers (FDO).
class CollectionApproval extends StatefulWidget {
  const CollectionApproval({super.key});

  @override
  State<CollectionApproval> createState() => _CollectionApprovalState();
}

class _CollectionApprovalState extends State<CollectionApproval> {
  final ApiClient _client = ApiClient();
  final RxBool _isLoading = false.obs;
  final RxBool _isSubmitting = false.obs;
  final RxList<dynamic> _batches = <dynamic>[].obs;
  String _branchId = '';

  @override
  void initState() {
    super.initState();
    _loadBatches();
  }

  Future<void> _loadBatches() async {
    _isLoading.value = true;
    try {
      final prefs = await SharedPreferences.getInstance();
      _branchId = prefs.getString('branchId') ?? '';
      final token = prefs.getString('accessToken') ?? '';

      final url = "${Api.baseUrl}/api/collections/approve?branchId=$_branchId";
      final response = await _client.get(
        url,
        headers: {'Authorization': 'Bearer $token'},
      );

      if (response.statusCode == 200 && response.body != null) {
        final data = response.body['data'];
        if (data is List) {
          _batches.assignAll(data);
        } else if (data is Map && data['batches'] is List) {
          _batches.assignAll(data['batches']);
        }
      }
    } catch (e) {
      debugPrint('Failed to load collection approval batches: $e');
    } finally {
      _isLoading.value = false;
    }
  }

  Future<void> _processBatch(String batchId, String action, {String? remarks}) async {
    _isSubmitting.value = true;
    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('accessToken') ?? '';

      final response = await _client.post(
        "${Api.baseUrl}/api/collections/approve",
        {
          'batchId': batchId,
          'action': action,
          if (remarks != null && remarks.isNotEmpty) 'remarks': remarks,
        },
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        },
      );

      if (response.statusCode == 200 || response.statusCode == 201) {
        Get.snackbar(
          'Success',
          action == 'APPROVE'
              ? 'Collection batch approved successfully.'
              : 'Collection batch reverted back to FDO.',
          backgroundColor: action == 'APPROVE' ? _green : Colors.orange,
          colorText: Colors.white,
        );
        await _loadBatches();
      } else {
        final err = response.body?['error'] ?? response.body?['message'] ?? 'Action failed.';
        Get.snackbar('Error', '$err', backgroundColor: Colors.redAccent, colorText: Colors.white);
      }
    } catch (e) {
      Get.snackbar('Error', '$e', backgroundColor: Colors.redAccent, colorText: Colors.white);
    } finally {
      _isSubmitting.value = false;
    }
  }

  void _showRevertDialog(String batchId) {
    final remarksCtrl = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Revert Collection Batch'),
        content: TextField(
          controller: remarksCtrl,
          decoration: const InputDecoration(
            hintText: 'Enter reason for reverting batch...',
            border: OutlineInputBorder(),
          ),
          maxLines: 3,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () {
              final remarks = remarksCtrl.text.trim();
              if (remarks.isEmpty) {
                Get.snackbar('Remark Required', 'Please enter a reason for reverting.', backgroundColor: Colors.orange, colorText: Colors.white);
                return;
              }
              Navigator.pop(ctx);
              _processBatch(batchId, 'REJECT', remarks: remarks);
            },
            child: const Text('Revert Batch'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Theme(
      data: Theme.of(context).copyWith(
        textTheme: GoogleFonts.poppinsTextTheme(Theme.of(context).textTheme),
      ),
      child: Scaffold(
        backgroundColor: const Color(0xFFF7FBF8),
        appBar: AppBar(
          elevation: 0,
          backgroundColor: Colors.white,
          leading: IconButton(
            onPressed: () => Navigator.maybePop(context),
            icon: const Icon(Icons.arrow_back, color: _green),
          ),
          title: Text(
            'Collection Approval',
            style: TextStyle(fontSize: 17.sp, fontWeight: FontWeight.w800, color: _darkGreen),
          ),
          actions: [
            IconButton(
              icon: const Icon(Icons.refresh, color: _green),
              onPressed: _loadBatches,
            ),
          ],
        ),
        body: Obx(() {
          if (_isLoading.value) {
            return const Center(child: CircularProgressIndicator(color: _green));
          }
          if (_batches.isEmpty) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.done_all_rounded, size: 48.sp, color: _muted),
                  SizedBox(height: 12.h),
                  Text(
                    'No pending collection batches to approve.',
                    style: TextStyle(fontSize: 13.sp, color: _muted),
                  ),
                ],
              ),
            );
          }
          return RefreshIndicator(
            onRefresh: _loadBatches,
            color: _green,
            child: ListView.separated(
              padding: EdgeInsets.all(16.w),
              itemCount: _batches.length,
              separatorBuilder: (_, __) => SizedBox(height: 12.h),
              itemBuilder: (context, index) {
                final batch = Map<String, dynamic>.from(_batches[index]);
                return _buildBatchCard(batch);
              },
            ),
          );
        }),
      ),
    );
  }

  Widget _buildBatchCard(Map<String, dynamic> batch) {
    final batchId = batch['id']?.toString() ?? '';
    final centerName = batch['centerName'] ?? batch['center']?['name'] ?? 'Center';
    final centerCode = batch['centerCode'] ?? batch['center']?['code'] ?? '';
    final fdoName = batch['fdoName'] ?? batch['fdo']?['firstName'] ?? 'FDO';
    final totalAmount = double.tryParse('${batch['totalAmount'] ?? batch['collectedAmount']}') ?? 0.0;
    final totalClients = batch['totalClients'] ?? batch['clientCount'] ?? 0;

    return Container(
      padding: EdgeInsets.all(14.w),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: _border),
        borderRadius: BorderRadius.circular(12.r),
        boxShadow: const [
          BoxShadow(color: Color(0x08000000), blurRadius: 8, offset: Offset(0, 2)),
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
                  centerCode.isNotEmpty ? '$centerCode - $centerName' : centerName,
                  style: TextStyle(fontSize: 13.5.sp, fontWeight: FontWeight.w800, color: _darkText),
                ),
              ),
              Text(
                '₹${totalAmount.toStringAsFixed(2)}',
                style: TextStyle(fontSize: 14.sp, fontWeight: FontWeight.w800, color: _green),
              ),
            ],
          ),
          SizedBox(height: 4.h),
          Text('Submitted by $fdoName · $totalClients clients', style: TextStyle(fontSize: 11.sp, color: _muted)),
          SizedBox(height: 12.h),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _isSubmitting.value ? null : () => _showRevertDialog(batchId),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: Colors.red,
                    side: const BorderSide(color: Colors.red),
                    padding: EdgeInsets.symmetric(vertical: 10.h),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8.r)),
                  ),
                  icon: const Icon(Icons.undo_rounded, size: 16),
                  label: const Text('Revert'),
                ),
              ),
              SizedBox(width: 10.w),
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: _isSubmitting.value ? null : () => _processBatch(batchId, 'APPROVE'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _green,
                    foregroundColor: Colors.white,
                    padding: EdgeInsets.symmetric(vertical: 10.h),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8.r)),
                  ),
                  icon: const Icon(Icons.check_circle_rounded, size: 16),
                  label: const Text('Approve'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
