import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/controller/collection_reversal_controller.dart';
import 'package:sarvam/widgets/confirm_dialog.dart';

const List<String> _reversalAllowedRoles = [
  'BRANCH_MANAGER',
  'BM',
  'BRANCH MANAGER',
  'AREA_MANAGER',
  'AM',
  'AREA MANAGER',
  'ADMIN',
];

/// Reverses ad-hoc "Non Demand Collection" entries for one client — no
/// meeting/denomination involved, unlike the batch-based demand/arrear flow.
class CorrectSingleCollection extends StatefulWidget {
  const CorrectSingleCollection({super.key});

  @override
  State<CorrectSingleCollection> createState() => _CorrectSingleCollectionState();
}

class _CorrectSingleCollectionState extends State<CorrectSingleCollection> {
  static const _green = Color(0xFF0D6842);
  static const _darkGreen = Color(0xFF0B4A2C);
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);
  static const _border = Color(0xFFE1EEE6);
  static const _pageBg = Color(0xFFF2FAF5);

  final CollectionReversalController _controller =
      Get.isRegistered<CollectionReversalController>()
      ? Get.find<CollectionReversalController>()
      : Get.put(CollectionReversalController());

  List<Map<String, String>> _branches = [];
  String? _selectedBranchId;
  String? _selectedCenterId;
  String? _selectedClientId;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _checkRole());
    _loadBranches();
  }

  Future<void> _checkRole() async {
    final prefs = await SharedPreferences.getInstance();
    final role = (prefs.getString('role') ?? '').trim().toUpperCase();
    final rbacRoleName = (prefs.getString('rbacRoleName') ?? '').trim().toUpperCase();
    final authorized =
        _reversalAllowedRoles.contains(role) || _reversalAllowedRoles.contains(rbacRoleName);
    if (!authorized && mounted) {
      Navigator.of(context).maybePop();
      Get.snackbar(
        'Not authorized',
        'Only Branch Managers, Area Managers, or Admins can correct collections.',
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
    }
  }

  Future<void> _loadBranches() async {
    final branches = await _controller.getBranchesForCurrentUser();
    if (!mounted) return;
    setState(() {
      _branches = branches;
      _selectedBranchId = branches.isNotEmpty ? branches.first['id'] : null;
    });
    if (_selectedBranchId != null && _selectedBranchId!.isNotEmpty) {
      await _controller.getCenters(_selectedBranchId!);
    }
  }

  Future<void> _onCenterSelected(String? centerId) async {
    setState(() {
      _selectedCenterId = centerId;
      _selectedClientId = null;
    });
    if (centerId != null) {
      await _controller.getClients(centerId);
    }
  }

  Future<void> _onClientSelected(String? clientId) async {
    setState(() => _selectedClientId = clientId);
    if (clientId != null) {
      await _controller.getNonDemandCollections(clientId: clientId);
    }
  }

  Future<void> _revert(Map row) async {
    final amount = ((row['amount'] ?? 0) as num).toDouble();
    final txnLabel = "${row['transactionId'] ?? row['id'] ?? ''}";
    final confirmed = await showConfirmDialog(
      context,
      title: 'Reverse this collection?',
      message:
          'Reverse the collection of ₹${amount.toStringAsFixed(2)} for transaction '
          '$txnLabel? This restores the dues on the client\'s schedule.',
      confirmLabel: 'Reverse',
    );
    if (!confirmed) return;

    final success = await _controller.reverseTransactions(
      transactionId: "${row['id']}",
      remarks: 'Reversed via mobile Correct Single Collection screen',
    );
    if (success && _selectedClientId != null) {
      await _controller.getNonDemandCollections(clientId: _selectedClientId!);
    }
  }

  Widget _dropdownContainer({required Widget child}) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 10.w),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8.r),
        border: Border.all(color: _border),
      ),
      child: child,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _pageBg,
      body: SafeArea(
        child: SingleChildScrollView(
          physics: const BouncingScrollPhysics(),
          padding: EdgeInsets.fromLTRB(16.w, 12.h, 16.w, 24.h),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildHeader(),
              SizedBox(height: 16.h),
              _buildSelectionCard(),
              SizedBox(height: 16.h),
              _buildHistoryCard(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Row(
      children: [
        GestureDetector(
          onTap: () => Navigator.maybePop(context),
          child: Container(
            padding: EdgeInsets.all(8.w),
            decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
            child: Icon(Icons.arrow_back_ios_new_rounded, size: 15.sp, color: _darkText),
          ),
        ),
        SizedBox(width: 10.w),
        Expanded(
          child: Text(
            'Correct Single Collection',
            style: TextStyle(fontSize: 17.sp, fontWeight: FontWeight.w800, color: _darkGreen),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }

  Widget _buildSelectionCard() {
    return Container(
      padding: EdgeInsets.all(14.w),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14.r),
        border: Border.all(color: _border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (_branches.length > 1) ...[
            Text('Branch', style: TextStyle(fontSize: 11.sp, fontWeight: FontWeight.w700)),
            SizedBox(height: 6.h),
            _dropdownContainer(
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  isExpanded: true,
                  value: _selectedBranchId,
                  hint: const Text('Select branch'),
                  items: _branches
                      .map((b) => DropdownMenuItem(value: b['id'], child: Text("${b['name']} (${b['code']})")))
                      .toList(),
                  onChanged: (value) async {
                    setState(() {
                      _selectedBranchId = value;
                      _selectedCenterId = null;
                      _selectedClientId = null;
                    });
                    if (value != null) await _controller.getCenters(value);
                  },
                ),
              ),
            ),
            SizedBox(height: 12.h),
          ],
          Text('Center', style: TextStyle(fontSize: 11.sp, fontWeight: FontWeight.w700)),
          SizedBox(height: 6.h),
          Obx(
            () => _dropdownContainer(
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  isExpanded: true,
                  value: _selectedCenterId,
                  hint: const Text('Select center'),
                  items: _controller.centers
                      .map((c) => DropdownMenuItem<String>(value: "${c['id']}", child: Text("${c['name']} (${c['code']})")))
                      .toList(),
                  onChanged: _onCenterSelected,
                ),
              ),
            ),
          ),
          SizedBox(height: 12.h),
          Text('Client', style: TextStyle(fontSize: 11.sp, fontWeight: FontWeight.w700)),
          SizedBox(height: 6.h),
          Obx(
            () => _dropdownContainer(
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  isExpanded: true,
                  value: _selectedClientId,
                  hint: const Text('Select client'),
                  items: _controller.clients
                      .map(
                        (c) => DropdownMenuItem<String>(
                          value: "${c['id']}",
                          child: Text(
                            "${c['firstName'] ?? ''} ${c['lastName'] ?? ''} (${c['clientId'] ?? ''})",
                          ),
                        ),
                      )
                      .toList(),
                  onChanged: _onClientSelected,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildHistoryCard() {
    return Container(
      padding: EdgeInsets.all(14.w),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14.r),
        border: Border.all(color: _border),
      ),
      child: Obx(() {
        final rows = _controller.nonDemandCollections;
        if (_controller.isLoading.value && rows.isEmpty) {
          return Padding(
            padding: EdgeInsets.symmetric(vertical: 24.h),
            child: const Center(child: CircularProgressIndicator(color: _green)),
          );
        }
        if (_selectedClientId == null) {
          return Padding(
            padding: EdgeInsets.symmetric(vertical: 24.h),
            child: Center(
              child: Text(
                'Select a client to see their non-demand collections.',
                style: TextStyle(fontSize: 12.sp, color: _muted),
              ),
            ),
          );
        }
        if (rows.isEmpty) {
          return Padding(
            padding: EdgeInsets.symmetric(vertical: 24.h),
            child: Center(
              child: Text(
                'No reversible collections found for this client.',
                style: TextStyle(fontSize: 12.sp, color: _muted),
              ),
            ),
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Non-Demand Collections',
              style: TextStyle(fontSize: 14.sp, fontWeight: FontWeight.w800, color: _darkText),
            ),
            SizedBox(height: 10.h),
            ListView.separated(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: rows.length,
              separatorBuilder: (_, __) => Divider(height: 1.h, color: _border),
              itemBuilder: (context, index) => _buildHistoryRow(rows[index] as Map),
            ),
          ],
        );
      }),
    );
  }

  Widget _buildHistoryRow(Map row) {
    final amount = ((row['amount'] ?? 0) as num).toDouble();
    final date = _formatDate(row['transactionDate']);
    final txnLabel = "${row['transactionId'] ?? '—'}";
    final collectedBy = "${row['collectedBy'] ?? ''}";
    final remarks = "${row['remarks'] ?? ''}";

    return Padding(
      padding: EdgeInsets.symmetric(vertical: 10.h),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '₹${amount.toStringAsFixed(2)} — $date',
                  style: TextStyle(fontSize: 12.5.sp, fontWeight: FontWeight.w700, color: _darkText),
                ),
                Text(txnLabel, style: TextStyle(fontSize: 10.sp, color: _muted)),
                if (collectedBy.isNotEmpty)
                  Text('By $collectedBy', style: TextStyle(fontSize: 10.sp, color: _muted)),
                if (remarks.isNotEmpty)
                  Text(remarks, style: TextStyle(fontSize: 10.sp, color: _muted)),
              ],
            ),
          ),
          IconButton(
            onPressed: () => _revert(row),
            icon: Icon(Icons.undo_rounded, size: 18.sp, color: const Color(0xFFB91C1C)),
            tooltip: 'Reverse',
          ),
        ],
      ),
    );
  }

  String _formatDate(dynamic isoString) {
    if (isoString == null || isoString.toString().isEmpty) return '—';
    try {
      final dateTime = DateTime.parse(isoString.toString());
      return DateFormat('dd MMM yyyy').format(dateTime);
    } catch (_) {
      return isoString.toString();
    }
  }
}
