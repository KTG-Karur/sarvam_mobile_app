import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:intl/intl.dart';
import 'package:sarvam/controller/bulk_centre_collection_controller.dart';
import 'package:sarvam/view/FDO/colletion/single_collection_controller.dart';
import 'package:sarvam/utils/center_formatter.dart';

/// Read-only Single / Bulk-Centre Collection view for AM and BM.
///
/// Mirrors the FDO [SingleCollectionDetailsBulkCenterCollection] screen but
/// strips every editable field, checkbox, submit button and reset action.
/// AM/BM can switch between Single and Bulk modes, pick a center/date, and
/// inspect the demand data — nothing can be modified or submitted.
class SingleCollectionView extends StatefulWidget {
  const SingleCollectionView({
    super.key,
    required this.branchId,
    required this.branchName,
  });

  final String branchId;
  final String branchName;

  @override
  State<SingleCollectionView> createState() => _SingleCollectionViewState();
}

class _SingleCollectionViewState extends State<SingleCollectionView> {
  static const _green = Color(0xFF008A3D);

  // Controllers — tagged so they don't clash with FDO instances.
  late final SingleCollectionController _singleCtrl;
  late final BulkCentreCollectionController _bulkCtrl;

  bool _isBulk = false;
  DateTime _date = DateTime.now();

  String get _apiDate => DateFormat('yyyy-MM-dd').format(_date);
  String get _displayDate => DateFormat('dd-MM-yyyy').format(_date);

  @override
  void initState() {
    super.initState();
    _singleCtrl = Get.put(SingleCollectionController(), tag: 'singleView');
    _bulkCtrl = Get.put(
      BulkCentreCollectionController(),
      tag: 'singleBulkView',
    );

    WidgetsBinding.instance.addPostFrameCallback((_) async {
      await _singleCtrl.getCenters(widget.branchId);
      await _bulkCtrl.getCenters(widget.branchId);
    });
  }

  @override
  void dispose() {
    Get.delete<SingleCollectionController>(tag: 'singleView');
    Get.delete<BulkCentreCollectionController>(tag: 'singleBulkView');
    super.dispose();
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  double _asDouble(dynamic v) =>
      v is num ? v.toDouble() : double.tryParse('$v') ?? 0;

  double _dueAmount(Map<String, dynamic> item) {
    for (final key in const [
      'totalDue',
      'totalDemand',
      'dueAmount',
      'totalDueAmount',
      'dueData',
    ]) {
      if (item[key] is Map) {
        final d = item[key] as Map;
        return _asDouble(d['amount'] ?? d['totalDue'] ?? d['dueAmount']);
      }
      if (item[key] != null) {
        return _asDouble(item[key]);
      }
    }
    return _asDouble(item['duePrincipal']) + _asDouble(item['dueInterest']);
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime(2020),
      lastDate: DateTime(2035),
      builder: (ctx, child) => Theme(
        data: Theme.of(
          ctx,
        ).copyWith(colorScheme: const ColorScheme.light(primary: _green)),
        child: child!,
      ),
    );
    if (picked == null || !mounted) {
      return;
    }
    setState(() => _date = picked);
    if (_isBulk && _bulkCtrl.selectedCenterId.value.isNotEmpty) {
      await _bulkCtrl.getBulkCollection(
        centerId: _bulkCtrl.selectedCenterId.value,
        date: _apiDate,
      );
    }
  }

  // ── build ──────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7FBF8),
      appBar: AppBar(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        title: const Text('Single Collection View'),
      ),
      body: SafeArea(
        child: Column(
          children: [
            // Mode toggle
            Padding(
              padding: EdgeInsets.fromLTRB(16.w, 12.h, 16.w, 0),
              child: _modeSelector(),
            ),
            // Scrollable content
            Expanded(
              child: RefreshIndicator(
                color: _green,
                onRefresh: () async {
                  if (_isBulk && _bulkCtrl.selectedCenterId.value.isNotEmpty) {
                    await _bulkCtrl.getBulkCollection(
                      centerId: _bulkCtrl.selectedCenterId.value,
                      date: _apiDate,
                    );
                  } else {
                    final clientId = _singleCtrl.selectedClientId.value;
                    if (clientId.isNotEmpty) {
                      await _singleCtrl.getSingleCollection(clientId);
                    }
                  }
                },
                child: SingleChildScrollView(
                  physics: const AlwaysScrollableScrollPhysics(
                    parent: BouncingScrollPhysics(),
                  ),
                  padding: EdgeInsets.all(16.w),
                  child: _isBulk ? _bulkBody() : _singleBody(),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── mode selector ──────────────────────────────────────────────────────────

  Widget _modeSelector() => Container(
    padding: EdgeInsets.all(4.w),
    decoration: BoxDecoration(
      color: const Color(0xFFE5F1EA),
      borderRadius: BorderRadius.circular(11.r),
    ),
    child: Row(
      children: [
        _modeBtn('Single', Icons.person_outline, !_isBulk),
        _modeBtn('Bulk Centre', Icons.groups_outlined, _isBulk),
      ],
    ),
  );

  Widget _modeBtn(String text, IconData icon, bool selected) => Expanded(
    child: InkWell(
      onTap: () => setState(() => _isBulk = text == 'Bulk Centre'),
      borderRadius: BorderRadius.circular(8.r),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        padding: EdgeInsets.symmetric(vertical: 9.h),
        decoration: BoxDecoration(
          color: selected ? Colors.white : Colors.transparent,
          borderRadius: BorderRadius.circular(8.r),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              icon,
              size: 16.sp,
              color: selected ? _green : const Color(0xFF64748B),
            ),
            SizedBox(width: 5.w),
            Text(
              text,
              style: TextStyle(
                fontSize: 13.sp,
                fontWeight: FontWeight.w700,
                color: selected ? _green : const Color(0xFF64748B),
              ),
            ),
          ],
        ),
      ),
    ),
  );

  // ── SINGLE body ────────────────────────────────────────────────────────────

  Widget _singleBody() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Branch + center + client filters
        _filterCard(_singleFilters()),
        SizedBox(height: 16.h),
        // Data
        Obx(() {
          if (_singleCtrl.isLoading.value &&
              _singleCtrl.singleCollectionData.isEmpty) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(32),
                child: CircularProgressIndicator(color: _green),
              ),
            );
          }
          final data = _singleCtrl.singleCollectionData;
          if (data.isEmpty) {
            return _emptyState(
              'Select a center and client to view collection details.',
            );
          }
          return _singleDataCard(data);
        }),
      ],
    );
  }

  Widget _singleFilters() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      _filterLabel(widget.branchName),
      SizedBox(height: 10.h),
      _fieldLabel('Center'),
      SizedBox(height: 6.h),
      Obx(() {
        final centers = _singleCtrl.centersList;
        if (_singleCtrl.isLoading.value && centers.isEmpty) {
          return const Center(child: CircularProgressIndicator(color: _green));
        }
        return DropdownButtonFormField<String>(
          isExpanded: true,
          key: ValueKey(_singleCtrl.selectedCenterName.value),
          initialValue: _singleCtrl.selectedCenterName.value.isNotEmpty
              ? _singleCtrl.selectedCenterName.value
              : null,
          hint: const Text('-- SELECT CENTER --'),
          // formatCenterDisplay, not a raw concat — must match what
          // SingleCollectionController.getCenters() sets selectedCenterName
          // to (it can reformat the code, e.g. pad "6" to "06"), or the
          // initial dropdown selection breaks and this onChanged mismatches.
          items: centers.map((c) {
            final display = formatCenterDisplay(c['name'], c['code'], parenthetical: true);
            return DropdownMenuItem<String>(
              value: display,
              child: Text(
                display,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 12.sp),
              ),
            );
          }).toList(),
          onChanged: (value) async {
            if (value == null) {
              return;
            }
            _singleCtrl.selectedCenterName.value = value;
            final matched = _singleCtrl.centersList.cast<Map?>().firstWhere(
              (c) => c != null && formatCenterDisplay(c['name'], c['code'], parenthetical: true) == value,
              orElse: () => null,
            );
            if (matched == null) return;
            _singleCtrl.selectedCenterId.value = matched['id'] ?? '';
            await _singleCtrl.getClients(matched['id'] ?? '');
          },
          decoration: _inputDeco(),
        );
      }),
      SizedBox(height: 12.h),
      _fieldLabel('Client'),
      SizedBox(height: 6.h),
      Obx(() {
        final clients = _singleCtrl.clientsList;
        if (_singleCtrl.isLoading.value && clients.isEmpty) {
          return const Center(child: CircularProgressIndicator(color: _green));
        }
        return DropdownButtonFormField<String>(
          isExpanded: true,
          key: ValueKey(_singleCtrl.selectedClientName.value),
          initialValue: _singleCtrl.selectedClientName.value.isNotEmpty
              ? _singleCtrl.selectedClientName.value
              : null,
          hint: const Text('-- SELECT CLIENT --'),
          items: clients.map((c) {
            final display =
                '${c['firstName']} ${c['lastName']} (${c['clientId']})';
            return DropdownMenuItem<String>(
              value: display,
              child: Text(
                display,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 12.sp),
              ),
            );
          }).toList(),
          onChanged: (value) async {
            if (value == null) {
              return;
            }
            _singleCtrl.selectedClientName.value = value;
            final matched = _singleCtrl.clientsList.cast<Map?>().firstWhere(
              (c) =>
                  c != null &&
                  '${c['firstName']} ${c['lastName']} (${c['clientId']})' == value,
              orElse: () => null,
            );
            if (matched == null) return;
            _singleCtrl.selectedClientId.value = matched['id'] ?? '';
            await _singleCtrl.getSingleCollection(
              matched['id'] ?? '',
              clientSummary: Map<String, dynamic>.from(matched),
            );
          },
          decoration: _inputDeco(),
        );
      }),
    ],
  );

  Widget _singleDataCard(Map<String, dynamic> data) {
    final loanNo = data['loanNumber']?.toString() ?? '—';
    final disbDate = data['disbursementDate']?.toString() ?? '—';
    final funder = data['productName']?.toString() ?? '—';
    final status = (data['status'] ?? 'PENDING').toString().toUpperCase();
    final isCollected = status == 'COLLECTED';
    final loanAmt = _asDouble(data['loanAmount']);
    final loanOut = _asDouble(data['loanOutstanding']);
    final intBal = _asDouble(data['interestBalance']);
    final arrPri = _asDouble(data['openingArrearsPrincipal']);
    final arrInt = _asDouble(data['openingArrearsInterest']);
    final dueWeeks = data['dueWeeks'] ?? 0;
    final collWeeks = data['collectedWeeks'] ?? 0;
    final totalDue = arrPri + arrInt;

    return _card(
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Status banner
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _infoRow(Icons.receipt_long_outlined, 'Loan A/c', loanNo),
              _statusBadge(isCollected),
            ],
          ),
          SizedBox(height: 8.h),
          _infoRow(Icons.calendar_today_outlined, 'Disbursal Date', disbDate),
          _infoRow(Icons.business_outlined, 'Funder', funder),
          const Divider(color: Color(0xFFE2E8F0)),
          SizedBox(height: 6.h),
          // Stats grid
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            childAspectRatio: 2.6,
            crossAxisSpacing: 10.w,
            mainAxisSpacing: 6.h,
            children: [
              _miniStat('Due Weeks', '$dueWeeks'),
              _miniStat('Coll. Weeks', '$collWeeks'),
              _miniStat('Loan Amount', _fmt(loanAmt)),
              _miniStat('Outstanding', _fmt(loanOut)),
              _miniStat('Interest Bal.', _fmt(intBal)),
              _miniStat('Arr. Principal', _fmt(arrPri), accent: arrPri > 0),
              _miniStat('Arr. Interest', _fmt(arrInt), accent: arrInt > 0),
            ],
          ),
          SizedBox(height: 10.h),
          // Total due footer
          _totalDueRow('Total Due', totalDue),
        ],
      ),
    );
  }

  // ── BULK CENTRE body ───────────────────────────────────────────────────────

  Widget _bulkBody() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _filterCard(_bulkFilters()),
        SizedBox(height: 16.h),
        Obx(() {
          final sheet = _bulkCtrl.demandSheet;
          if (_bulkCtrl.isLoading.value && sheet.isEmpty) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(32),
                child: CircularProgressIndicator(color: _green),
              ),
            );
          }
          if (sheet.isEmpty) {
            return _emptyState(
              _bulkCtrl.selectedCenterId.value.isEmpty
                  ? 'Select a center to view the demand sheet.'
                  : 'No demand sheet found for this date.',
            );
          }
          // Summary row
          final totalDue = sheet.fold<double>(
            0,
            (sum, item) => sum + _dueAmount(item as Map<String, dynamic>),
          );
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _bulkSummaryBar(sheet.length, totalDue),
              SizedBox(height: 12.h),
              ...sheet.map(
                (item) => _bulkClientCard(item as Map<String, dynamic>),
              ),
            ],
          );
        }),
      ],
    );
  }

  Widget _bulkFilters() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      _filterLabel(widget.branchName),
      SizedBox(height: 10.h),
      _fieldLabel('Center'),
      SizedBox(height: 6.h),
      Obx(() {
        final centers = _bulkCtrl.centersList;
        if (_bulkCtrl.isLoading.value && centers.isEmpty) {
          return const Center(child: CircularProgressIndicator(color: _green));
        }
        return DropdownButtonFormField<String>(
          isExpanded: true,
          key: ValueKey(_bulkCtrl.selectedCenterName.value),
          initialValue: _bulkCtrl.selectedCenterName.value.isNotEmpty
              ? _bulkCtrl.selectedCenterName.value
              : null,
          hint: const Text('-- SELECT CENTER --'),
          // formatCenterDisplay, not a raw concat — must match what
          // BulkCentreCollectionController.getCenters() sets
          // selectedCenterName to.
          items: centers.map((c) {
            final display = formatCenterDisplay(c['name'], c['code'], parenthetical: true);
            return DropdownMenuItem<String>(
              value: display,
              child: Text(
                display,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 12.sp),
              ),
            );
          }).toList(),
          onChanged: (value) async {
            if (value == null) {
              return;
            }
            _bulkCtrl.selectedCenterName.value = value;
            final matched = _bulkCtrl.centersList.cast<Map?>().firstWhere(
              (c) => c != null && formatCenterDisplay(c['name'], c['code'], parenthetical: true) == value,
              orElse: () => null,
            );
            if (matched == null) return;
            _bulkCtrl.selectedCenterId.value = matched['id'] ?? '';
            await _bulkCtrl.getBulkCollection(
              centerId: matched['id'] ?? '',
              date: _apiDate,
            );
          },
          decoration: _inputDeco(),
        );
      }),
      SizedBox(height: 12.h),
      _fieldLabel('Collection Date'),
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
            color: const Color(0xFFF4FAF6),
          ),
          child: Row(
            children: [
              Expanded(
                child: Text(_displayDate, style: TextStyle(fontSize: 13.sp)),
              ),
              const Icon(Icons.calendar_month_outlined, color: _green),
            ],
          ),
        ),
      ),
    ],
  );

  Widget _bulkSummaryBar(int count, double totalDue) => Container(
    padding: EdgeInsets.symmetric(horizontal: 14.w, vertical: 10.h),
    decoration: BoxDecoration(
      color: const Color(0xFFE5F7EA),
      borderRadius: BorderRadius.circular(10.r),
    ),
    child: Row(
      children: [
        Icon(Icons.people_outline, size: 16.sp, color: _green),
        SizedBox(width: 6.w),
        Text(
          '$count clients',
          style: TextStyle(
            fontSize: 13.sp,
            fontWeight: FontWeight.w700,
            color: _green,
          ),
        ),
        const Spacer(),
        Icon(Icons.currency_rupee, size: 14.sp, color: const Color(0xFFC98A00)),
        Text(
          'Total Due: ${_fmt(totalDue)}',
          style: TextStyle(
            fontSize: 13.sp,
            fontWeight: FontWeight.w700,
            color: const Color(0xFFC98A00),
          ),
        ),
      ],
    ),
  );

  Widget _bulkClientCard(Map<String, dynamic> item) {
    final name = item['clientName']?.toString() ?? 'Unknown';
    final code = item['clientCode']?.toString() ?? '—';
    final loanNo = item['loanNumber']?.toString() ?? '—';
    final prod = item['productName']?.toString() ?? '—';
    final loanAmt = _asDouble(item['loanAmount']);
    final os = _asDouble(item['loanOutstanding']);
    final arrears = _asDouble(item['totalArrears']);
    final curDue = _asDouble(item['totalCurrentDue']);
    final totalDue = _dueAmount(item);

    return _card(
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Client header
          Row(
            children: [
              _avatar(name),
              SizedBox(width: 10.w),
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
                padding: EdgeInsets.symmetric(horizontal: 7.w, vertical: 3.h),
                decoration: BoxDecoration(
                  color: const Color(0xFFE5F7EA),
                  borderRadius: BorderRadius.circular(6.r),
                ),
                child: Text(
                  prod,
                  style: TextStyle(
                    fontSize: 10.sp,
                    fontWeight: FontWeight.w700,
                    color: _green,
                  ),
                ),
              ),
            ],
          ),
          const Divider(color: Color(0xFFE2E8F0)),
          Row(
            children: [
              Expanded(child: _stat('Loan Amt', _fmt(loanAmt))),
              Expanded(child: _stat('Outstanding', _fmt(os))),
            ],
          ),
          SizedBox(height: 6.h),
          Row(
            children: [
              Expanded(
                child: _stat('Arrears', _fmt(arrears), accent: arrears > 0),
              ),
              Expanded(child: _stat('Current Due', _fmt(curDue))),
            ],
          ),
          SizedBox(height: 8.h),
          _totalDueRow('Total Due', totalDue),
        ],
      ),
    );
  }

  // ── shared widgets ─────────────────────────────────────────────────────────

  Widget _filterCard(Widget child) => Container(
    width: double.infinity,
    padding: EdgeInsets.all(14.w),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(14.r),
      border: Border.all(color: const Color(0xFFD2E9DB)),
    ),
    child: child,
  );

  Widget _card(Widget child) => Container(
    width: double.infinity,
    margin: EdgeInsets.only(bottom: 12.h),
    padding: EdgeInsets.all(14.w),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(12.r),
      border: Border.all(color: const Color(0xFFE2E8F0)),
    ),
    child: child,
  );

  Widget _filterLabel(String text) => Text(
    text,
    style: TextStyle(fontSize: 13.sp, fontWeight: FontWeight.w700),
  );

  Widget _fieldLabel(String text) => Text(
    text,
    style: TextStyle(
      fontSize: 12.sp,
      fontWeight: FontWeight.w600,
      color: const Color(0xFF1E293B),
    ),
  );

  Widget _infoRow(IconData icon, String label, String value) => Padding(
    padding: EdgeInsets.only(bottom: 6.h),
    child: Row(
      children: [
        Icon(icon, size: 14.sp, color: const Color(0xFF64748B)),
        SizedBox(width: 6.w),
        Text(
          '$label: ',
          style: TextStyle(fontSize: 12.sp, color: const Color(0xFF64748B)),
        ),
        Expanded(
          child: Text(
            value,
            style: TextStyle(
              fontSize: 12.sp,
              fontWeight: FontWeight.w700,
              color: const Color(0xFF1E293B),
            ),
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    ),
  );

  Widget _statusBadge(bool collected) => Container(
    padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 4.h),
    decoration: BoxDecoration(
      color: collected ? const Color(0xFFDCFCE7) : const Color(0xFFFEF9C3),
      borderRadius: BorderRadius.circular(8.r),
    ),
    child: Text(
      collected ? 'COLLECTED' : 'PENDING',
      style: TextStyle(
        fontSize: 10.sp,
        fontWeight: FontWeight.w700,
        color: collected ? const Color(0xFF166534) : const Color(0xFF854D0E),
      ),
    ),
  );

  Widget _miniStat(String label, String value, {bool accent = false}) =>
      Container(
        padding: EdgeInsets.all(8.w),
        decoration: BoxDecoration(
          color: const Color(0xFFF4FAF6),
          borderRadius: BorderRadius.circular(8.r),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              label,
              style: TextStyle(fontSize: 10.sp, color: const Color(0xFF64748B)),
            ),
            Text(
              value,
              style: TextStyle(
                fontSize: 13.sp,
                fontWeight: FontWeight.w700,
                color: accent
                    ? const Color(0xFFDC2626)
                    : const Color(0xFF1E293B),
              ),
            ),
          ],
        ),
      );

  Widget _stat(String label, String value, {bool accent = false}) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        label,
        style: TextStyle(fontSize: 10.sp, color: const Color(0xFF64748B)),
      ),
      Text(
        value,
        style: TextStyle(
          fontSize: 12.sp,
          fontWeight: FontWeight.w700,
          color: accent ? const Color(0xFFDC2626) : const Color(0xFF1E293B),
        ),
      ),
    ],
  );

  Widget _totalDueRow(String label, double amount) => Container(
    padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 7.h),
    decoration: BoxDecoration(
      color: const Color(0xFFF1F5F9),
      borderRadius: BorderRadius.circular(6.r),
    ),
    child: Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize: 12.sp,
            fontWeight: FontWeight.w700,
            color: const Color(0xFF475569),
          ),
        ),
        Text(
          _fmt(amount),
          style: TextStyle(
            fontSize: 13.sp,
            fontWeight: FontWeight.w800,
            color: const Color(0xFF1E293B),
          ),
        ),
      ],
    ),
  );

  Widget _avatar(String name) {
    final parts = name.trim().split(RegExp(r'\s+'));
    final initials = parts
        .take(2)
        .map((w) => w.isEmpty ? '' : w[0])
        .join()
        .toUpperCase();
    return CircleAvatar(
      radius: 18.r,
      backgroundColor: const Color(0xFFD1FAE5),
      child: Text(
        initials.isEmpty ? '?' : initials,
        style: TextStyle(
          fontSize: 11.sp,
          fontWeight: FontWeight.w800,
          color: _green,
        ),
      ),
    );
  }

  Widget _emptyState(String message) => Container(
    width: double.infinity,
    height: 160.h,
    alignment: Alignment.center,
    padding: EdgeInsets.all(24.w),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(14.r),
      border: Border.all(color: const Color(0xFFE2E8F0)),
    ),
    child: Text(
      message,
      textAlign: TextAlign.center,
      style: TextStyle(fontSize: 12.sp, color: const Color(0xFF64748B)),
    ),
  );

  String _fmt(double v) => '₹${NumberFormat('#,##,##0', 'en_IN').format(v)}';

  InputDecoration _inputDeco() => InputDecoration(
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
