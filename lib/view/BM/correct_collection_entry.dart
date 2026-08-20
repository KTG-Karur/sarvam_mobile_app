import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/controller/collection_reversal_controller.dart';
import 'package:sarvam/view/BM/collection_batch_revert.dart';
import 'package:sarvam/view/BM/correct_single_collection.dart';

const List<String> _reversalAllowedRoles = [
  'BRANCH_MANAGER',
  'BM',
  'BRANCH MANAGER',
  'AREA_MANAGER',
  'AM',
  'AREA MANAGER',
  'ADMIN',
];

/// Entry screen for BM/AM "correct a collection" — pick a branch/center/date,
/// list demand or arrear collection batches, then drill into one to reverse
/// specific transactions. Only reachable/usable by BM/AM/Admin — the backend
/// enforces this too (403 otherwise), this is just to avoid a dead-end screen
/// for anyone who navigates here without the right role.
class CorrectCollectionEntry extends StatefulWidget {
  const CorrectCollectionEntry({super.key});

  @override
  State<CorrectCollectionEntry> createState() =>
      _CorrectCollectionEntryState();
}

class _CorrectCollectionEntryState extends State<CorrectCollectionEntry> {
  static const _green = Color(0xFF0D6842);
  static const _darkGreen = Color(0xFF0B4A2C);
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);
  static const _border = Color(0xFFE1EEE6);
  static const _pageBg = Color(0xFFF2FAF5);
  static const _tableHeaderBg = Color(0xFFEAF6EE);

  final CollectionReversalController _controller =
      Get.isRegistered<CollectionReversalController>()
      ? Get.find<CollectionReversalController>()
      : Get.put(CollectionReversalController());

  List<Map<String, String>> _branches = [];
  String? _selectedBranchId;
  String? _selectedCenterId;
  DateTime _selectedDate = DateTime.now();
  String _type = 'demand';
  bool _loadingBranches = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _checkRole());
    _loadBranches();
  }

  Future<void> _checkRole() async {
    final prefs = await SharedPreferences.getInstance();
    final role = (prefs.getString('role') ?? '').trim().toUpperCase();
    final rbacRoleName = (prefs.getString('rbacRoleName') ?? '')
        .trim()
        .toUpperCase();
    final authorized =
        _reversalAllowedRoles.contains(role) ||
        _reversalAllowedRoles.contains(rbacRoleName);
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
      _loadingBranches = false;
    });
    if (_selectedBranchId != null && _selectedBranchId!.isNotEmpty) {
      await _controller.getCenters(_selectedBranchId!);
      if (mounted) setState(() => _selectedCenterId = null);
    }
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _selectedDate,
      firstDate: DateTime(2020),
      lastDate: DateTime.now(),
    );
    if (picked != null) setState(() => _selectedDate = picked);
  }

  Future<void> _loadBatches() async {
    if (_selectedCenterId == null || _selectedCenterId!.isEmpty) {
      Get.snackbar(
        'Select a center',
        'Please choose a center first.',
        snackPosition: SnackPosition.BOTTOM,
      );
      return;
    }
    final date = DateFormat('yyyy-MM-dd').format(_selectedDate);
    await _controller.getBatches(
      type: _type,
      centerId: _selectedCenterId!,
      date: date,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _pageBg,
      body: SafeArea(
        child: SingleChildScrollView(
          physics: const BouncingScrollPhysics(),
          padding: EdgeInsets.fromLTRB(16.w, 12.h, 16.w, 20.h),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildHeader(),
              SizedBox(height: 16.h),
              _buildFiltersCard(),
              SizedBox(height: 16.h),
              _buildBatchesCard(),
              SizedBox(height: 16.h),
              _buildSingleCollectionButton(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        GestureDetector(
          onTap: () => Navigator.maybePop(context),
          child: Container(
            padding: EdgeInsets.all(8.w),
            decoration: const BoxDecoration(
              color: Colors.white,
              shape: BoxShape.circle,
            ),
            child: Icon(
              Icons.arrow_back_ios_new_rounded,
              size: 15.sp,
              color: _darkText,
            ),
          ),
        ),
        SizedBox(width: 10.w),
        Container(
          padding: EdgeInsets.all(6.w),
          decoration: BoxDecoration(
            color: _green,
            borderRadius: BorderRadius.circular(8.r),
          ),
          child: Icon(Icons.undo_rounded, size: 16.sp, color: Colors.white),
        ),
        SizedBox(width: 8.w),
        Expanded(
          child: Text(
            'Correct Collections',
            style: TextStyle(
              fontSize: 19.sp,
              fontWeight: FontWeight.w800,
              color: _darkGreen,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
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

  Widget _buildFiltersCard() {
    return Container(
      width: double.infinity,
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
            Text(
              'Branch',
              style: TextStyle(
                fontSize: 11.sp,
                fontWeight: FontWeight.w700,
                color: _darkText,
              ),
            ),
            SizedBox(height: 6.h),
            _dropdownContainer(
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  isExpanded: true,
                  value: _selectedBranchId,
                  hint: const Text('Select branch'),
                  items: _branches
                      .map(
                        (b) => DropdownMenuItem(
                          value: b['id'],
                          child: Text("${b['name']} (${b['code']})"),
                        ),
                      )
                      .toList(),
                  onChanged: (value) async {
                    setState(() {
                      _selectedBranchId = value;
                      _selectedCenterId = null;
                    });
                    if (value != null) {
                      await _controller.getCenters(value);
                    }
                  },
                ),
              ),
            ),
            SizedBox(height: 12.h),
          ],
          Text(
            'Center',
            style: TextStyle(
              fontSize: 11.sp,
              fontWeight: FontWeight.w700,
              color: _darkText,
            ),
          ),
          SizedBox(height: 6.h),
          Obx(
            () => _dropdownContainer(
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  isExpanded: true,
                  value: _selectedCenterId,
                  hint: _loadingBranches || _controller.isLoading.value
                      ? const Text('Loading...')
                      : const Text('Select center'),
                  items: _controller.centers
                      .map(
                        (c) => DropdownMenuItem<String>(
                          value: "${c['id']}",
                          child: Text("${c['name']} (${c['code']})"),
                        ),
                      )
                      .toList(),
                  onChanged: (value) => setState(() => _selectedCenterId = value),
                ),
              ),
            ),
          ),
          SizedBox(height: 12.h),
          Text(
            'Date',
            style: TextStyle(
              fontSize: 11.sp,
              fontWeight: FontWeight.w700,
              color: _darkText,
            ),
          ),
          SizedBox(height: 6.h),
          GestureDetector(
            onTap: _pickDate,
            child: _dropdownContainer(
              child: Padding(
                padding: EdgeInsets.symmetric(vertical: 12.h),
                child: Row(
                  children: [
                    Icon(Icons.calendar_today_outlined, size: 15.sp, color: _green),
                    SizedBox(width: 8.w),
                    Text(DateFormat('dd MMM yyyy').format(_selectedDate)),
                  ],
                ),
              ),
            ),
          ),
          SizedBox(height: 12.h),
          Row(
            children: [
              Expanded(
                child: _buildTypeToggle('Demand', 'demand'),
              ),
              SizedBox(width: 8.w),
              Expanded(
                child: _buildTypeToggle('Arrear', 'arrear'),
              ),
            ],
          ),
          SizedBox(height: 14.h),
          SizedBox(
            width: double.infinity,
            child: Obx(
              () => ElevatedButton(
                onPressed: _controller.isLoading.value ? null : _loadBatches,
                style: ElevatedButton.styleFrom(
                  backgroundColor: _green,
                  padding: EdgeInsets.symmetric(vertical: 12.h),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8.r),
                  ),
                ),
                child: _controller.isLoading.value
                    ? SizedBox(
                        width: 16.w,
                        height: 16.w,
                        child: const CircularProgressIndicator(
                          color: Colors.white,
                          strokeWidth: 2,
                        ),
                      )
                    : Text(
                        'Load Batches',
                        style: TextStyle(
                          fontSize: 13.sp,
                          fontWeight: FontWeight.w700,
                          color: Colors.white,
                        ),
                      ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTypeToggle(String label, String value) {
    final selected = _type == value;
    return GestureDetector(
      onTap: () => setState(() => _type = value),
      child: Container(
        padding: EdgeInsets.symmetric(vertical: 10.h),
        decoration: BoxDecoration(
          color: selected ? _green : Colors.white,
          borderRadius: BorderRadius.circular(8.r),
          border: Border.all(color: selected ? _green : _border),
        ),
        child: Text(
          label,
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 12.5.sp,
            fontWeight: FontWeight.w700,
            color: selected ? Colors.white : _darkText,
          ),
        ),
      ),
    );
  }

  Widget _buildBatchesCard() {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(14.w),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14.r),
        border: Border.all(color: _border),
      ),
      child: Obx(() {
        final batches = _controller.batches;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Collection Batches',
              style: TextStyle(
                fontSize: 14.5.sp,
                fontWeight: FontWeight.w800,
                color: _darkText,
              ),
            ),
            SizedBox(height: 12.h),
            if (batches.isNotEmpty) _buildTableHeaderRow(),
            SizedBox(height: 8.h),
            if (batches.isEmpty)
              Padding(
                padding: EdgeInsets.symmetric(vertical: 24.h),
                child: Center(
                  child: Text(
                    'No batches loaded yet. Pick a center and date, then Load Batches.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 12.sp, color: _muted),
                  ),
                ),
              )
            else
              ListView.separated(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: batches.length,
                separatorBuilder: (_, __) => SizedBox(height: 8.h),
                itemBuilder: (context, index) =>
                    _buildBatchRow(batches[index] as Map),
              ),
          ],
        );
      }),
    );
  }

  Widget _buildTableHeaderRow() {
    final style = TextStyle(
      fontSize: 10.5.sp,
      fontWeight: FontWeight.w800,
      color: _darkGreen,
    );
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 10.h),
      decoration: BoxDecoration(
        color: _tableHeaderBg,
        borderRadius: BorderRadius.circular(8.r),
      ),
      child: Row(
        children: [
          Expanded(flex: 3, child: Text('Date', style: style)),
          Expanded(flex: 2, child: Text('Clients', style: style)),
          Expanded(flex: 3, child: Text('Total', style: style)),
          SizedBox(width: 20.w),
        ],
      ),
    );
  }

  Widget _buildBatchRow(Map batch) {
    final batchId = "${batch['batchId'] ?? ''}";
    final date = _formatDate(batch['collectionDate']);
    final noOfClients = "${batch['noOfClients'] ?? 0}";
    final total = "${batch['totalRepayment'] ?? 0}";
    final status = "${batch['status'] ?? ''}";

    return InkWell(
      onTap: batchId.isEmpty
          ? null
          : () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => CollectionBatchRevert(collectionBatchId: batchId),
              ),
            ),
      child: Container(
        padding: EdgeInsets.all(10.w),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(8.r),
          border: Border.all(color: _border),
        ),
        child: Row(
          children: [
            Expanded(
              flex: 3,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    date,
                    style: TextStyle(fontSize: 12.sp, fontWeight: FontWeight.w700),
                  ),
                  if (status.isNotEmpty)
                    Text(
                      status,
                      style: TextStyle(fontSize: 9.5.sp, color: _muted),
                    ),
                ],
              ),
            ),
            Expanded(
              flex: 2,
              child: Text(noOfClients, style: TextStyle(fontSize: 12.sp)),
            ),
            Expanded(
              flex: 3,
              child: Text('₹$total', style: TextStyle(fontSize: 12.sp)),
            ),
            SizedBox(
              width: 20.w,
              child: Icon(Icons.chevron_right_rounded, size: 18.sp, color: _muted),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSingleCollectionButton() {
    return SizedBox(
      width: double.infinity,
      child: OutlinedButton.icon(
        onPressed: () => Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => const CorrectSingleCollection()),
        ),
        icon: Icon(Icons.person_search_rounded, size: 16.sp, color: _green),
        label: Text(
          'Correct Single Collection',
          style: TextStyle(fontSize: 12.5.sp, fontWeight: FontWeight.w700),
        ),
        style: OutlinedButton.styleFrom(
          padding: EdgeInsets.symmetric(vertical: 12.h),
          side: BorderSide(color: _green),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8.r),
          ),
        ),
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
