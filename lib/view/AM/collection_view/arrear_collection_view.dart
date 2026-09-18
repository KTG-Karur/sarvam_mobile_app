import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:intl/intl.dart';
import 'package:sarvam/controller/arrear_collection_controller.dart';

/// Read-only Arrear Collection view for AM/BM — same data source as the FDO
/// `ArrearCollectionDetails` screen, minus the editable amount/attendance
/// fields and the submit action.
class ArrearCollectionView extends StatefulWidget {
  const ArrearCollectionView({
    super.key,
    required this.branchId,
    required this.branchName,
  });

  final String branchId;
  final String branchName;

  @override
  State<ArrearCollectionView> createState() => _ArrearCollectionViewState();
}

class _ArrearCollectionViewState extends State<ArrearCollectionView> {
  static const _green = Color(0xFF008A3D);

  final ArrearCollectionController _controller = Get.put(
    ArrearCollectionController(),
    tag: 'arrearView',
  );

  String? _selectedCenterId;
  DateTime _date = DateTime.now();

  String get _apiDate => DateFormat('yyyy-MM-dd').format(_date);
  String get _displayDate => DateFormat('dd-MM-yyyy').format(_date);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback(
      (_) => _controller.getCenters(widget.branchId),
    );
  }

  @override
  void dispose() {
    Get.delete<ArrearCollectionController>(tag: 'arrearView');
    super.dispose();
  }

  Future<void> _loadData() async {
    if (_selectedCenterId == null) return;
    await _controller.getArrearCollection(
      centerId: _selectedCenterId!,
      date: _apiDate,
    );
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime(2024),
      lastDate: DateTime(2030),
    );
    if (picked == null) return;
    setState(() => _date = picked);
    await _loadData();
  }

  double _asDouble(dynamic value) =>
      value is num ? value.toDouble() : double.tryParse('$value') ?? 0;

  double _arrearDue(Map<String, dynamic> item) {
    for (final key in const [
      'totalArrear',
      'arrearTotal',
      'totalDue',
      'dueAmount',
      'totalDemand',
    ]) {
      if (item[key] != null) return _asDouble(item[key]);
    }
    return _asDouble(item['arrearPrincipal']) +
        _asDouble(item['arrearInterest']) +
        _asDouble(item['feesDue']) +
        _asDouble(item['penaltiesDue']);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7FBF8),
      appBar: AppBar(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        title: const Text('Arrear Collection'),
      ),
      body: SafeArea(
        child: Obx(
          () => RefreshIndicator(
            color: _green,
            onRefresh: _loadData,
            child: SingleChildScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: EdgeInsets.all(16.w),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _filters(),
                  SizedBox(height: 16.h),
                  if (_controller.isLoading.value &&
                      _controller.arrearCollections.isEmpty)
                    const Center(
                      child: Padding(
                        padding: EdgeInsets.all(24),
                        child: CircularProgressIndicator(color: _green),
                      ),
                    )
                  else if (_controller.arrearCollections.isEmpty)
                    _emptyState()
                  else
                    ..._controller.arrearCollections.map(
                      (c) => _clientCard(c as Map<String, dynamic>),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _filters() => Container(
    width: double.infinity,
    padding: EdgeInsets.all(14.w),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(14.r),
      border: Border.all(color: const Color(0xFFD2E9DB)),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          widget.branchName,
          style: TextStyle(fontSize: 13.sp, fontWeight: FontWeight.w700),
        ),
        SizedBox(height: 12.h),
        Text(
          'Center',
          style: TextStyle(fontSize: 12.sp, fontWeight: FontWeight.w600),
        ),
        SizedBox(height: 6.h),
        Obx(() {
          final centers = _controller.centersList;
          if (_controller.isLoading.value && centers.isEmpty) {
            return const Center(child: CircularProgressIndicator(color: _green));
          }
          return DropdownButtonFormField<String>(
            isExpanded: true,
            initialValue: _selectedCenterId,
            hint: const Text('-- SELECT CENTER --'),
            items: centers
                .map(
                  (c) => DropdownMenuItem<String>(
                    value: '${c['id'] ?? ''}',
                    child: Text(
                      '${c['name'] ?? ''} (${c['code'] ?? ''})',
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 12.sp),
                    ),
                  ),
                )
                .toList(),
            onChanged: (value) {
              if (value == null) return;
              setState(() => _selectedCenterId = value);
              _loadData();
            },
            decoration: _inputDecoration(),
          );
        }),
        SizedBox(height: 12.h),
        Text(
          'Collection Date',
          style: TextStyle(fontSize: 12.sp, fontWeight: FontWeight.w600),
        ),
        SizedBox(height: 6.h),
        InkWell(
          onTap: _pickDate,
          borderRadius: BorderRadius.circular(10.r),
          child: Container(
            height: 46.h,
            padding: EdgeInsets.symmetric(horizontal: 12.w),
            decoration: BoxDecoration(
              border: Border.all(color: const Color(0xFFD8E0E1)),
              borderRadius: BorderRadius.circular(10.r),
            ),
            child: Row(
              children: [
                Expanded(child: Text(_displayDate)),
                const Icon(Icons.calendar_month_outlined, color: _green),
              ],
            ),
          ),
        ),
      ],
    ),
  );

  Widget _clientCard(Map<String, dynamic> item) {
    final name = item['clientName']?.toString() ?? 'Unknown';
    final code = item['clientCode']?.toString() ?? '-';
    final loanNo = item['loanNumber']?.toString() ?? '-';
    final status = (item['status'] ?? 'PENDING').toString();
    final isOverdue = item['isOverdue'] == true;
    final arrearPrincipal = _asDouble(item['arrearPrincipal']);
    final arrearInterest = _asDouble(item['arrearInterest']);
    final totalArrear = _arrearDue(item);

    return Container(
      margin: EdgeInsets.only(bottom: 10.h),
      padding: EdgeInsets.all(14.w),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12.r),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      style: TextStyle(
                        fontSize: 14.sp,
                        fontWeight: FontWeight.w800,
                        color: const Color(0xFF10472A),
                      ),
                    ),
                    Text(
                      '$code  •  $loanNo',
                      style: TextStyle(
                        fontSize: 11.sp,
                        color: const Color(0xFF64748B),
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 5.h),
                decoration: BoxDecoration(
                  color: isOverdue
                      ? const Color(0xFFFDE8E8)
                      : const Color(0xFFF1F5F9),
                  borderRadius: BorderRadius.circular(12.r),
                ),
                child: Text(
                  isOverdue ? 'Overdue' : status,
                  style: TextStyle(
                    color: isOverdue
                        ? const Color(0xFFC5221F)
                        : const Color(0xFF475569),
                    fontSize: 9.sp,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          SizedBox(height: 8.h),
          Row(
            children: [
              Expanded(
                child: _stat('Arrear Pri', '₹${arrearPrincipal.toStringAsFixed(2)}'),
              ),
              Expanded(
                child: _stat('Arrear Int', '₹${arrearInterest.toStringAsFixed(2)}'),
              ),
              Expanded(
                child: _stat(
                  'Total',
                  '₹${totalArrear.toStringAsFixed(2)}',
                  highlight: true,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _stat(String label, String value, {bool highlight = false}) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(label, style: TextStyle(fontSize: 10.sp, color: const Color(0xFF64748B))),
      Text(
        value,
        style: TextStyle(
          fontSize: 12.sp,
          fontWeight: FontWeight.w800,
          color: highlight ? const Color(0xFFC66A00) : const Color(0xFF1E293B),
        ),
      ),
    ],
  );

  Widget _emptyState() => Container(
    width: double.infinity,
    height: 180.h,
    alignment: Alignment.center,
    padding: EdgeInsets.all(24.w),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(14.r),
      border: Border.all(color: const Color(0xFFE2E8F0)),
    ),
    child: Text(
      _selectedCenterId == null
          ? 'Select a center to view arrear collections.'
          : 'No arrear collections found for this date.',
      textAlign: TextAlign.center,
      style: TextStyle(fontSize: 12.sp, color: const Color(0xFF64748B)),
    ),
  );

  InputDecoration _inputDecoration() => InputDecoration(
    isDense: true,
    contentPadding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 10.h),
    filled: true,
    fillColor: const Color(0xFFF4FAF6),
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(8.r),
      borderSide: const BorderSide(color: Color(0xFFD2E9DB)),
    ),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(8.r),
      borderSide: const BorderSide(color: Color(0xFFD2E9DB)),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(8.r),
      borderSide: const BorderSide(color: _green),
    ),
  );
}
