import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/controller/arrear_collection_controller.dart';
import 'package:sarvam/controller/live_collection_controller.dart';
import 'package:sarvam/view/FDO/colletion/arrear_collection_client_details.dart';
import 'package:sarvam/view/FDO/colletion/collection_submission_flow.dart';
import 'package:sarvam/utils/center_formatter.dart';
import 'package:sarvam/view/shared/eod_pending_banner.dart';

class ArrearCollectionDetails extends StatefulWidget {
  const ArrearCollectionDetails({super.key});

  @override
  State<ArrearCollectionDetails> createState() =>
      _ArrearCollectionDetailsState();
}

class _ArrearCollectionDetailsState extends State<ArrearCollectionDetails> {
  final ArrearCollectionController _controller = Get.put(
    ArrearCollectionController(),
  );
  late DateTime _date;
  // The branch's actual resolved EOD working date — distinct from `_date`,
  // which the user can move earlier to browse older arrears (mirrors the
  // web's `max={eodWorkingDate}` cap: never later than this, but any
  // earlier date is fair game). The "EOD not completed" banner is keyed to
  // this, not to whichever past date is currently being browsed.
  late DateTime _workingDate;
  bool _loaded = false;

  final List<TextEditingController> _amounts = [];
  final List<TextEditingController> _advances = [];
  final List<String> _attendance = [];
  final Set<String> _selectedKeys = <String>{};
  // Explicit controller for the arrear table's horizontal Scrollbar —
  // Scrollbar(thumbVisibility: true) requires one; without it, Flutter
  // falls back to the PrimaryScrollController, which doesn't exist for a
  // horizontal SingleChildScrollView and crashes with
  // "A ScrollController is required when Scrollbar.thumbVisibility is true."
  final ScrollController _tableScrollController = ScrollController();

  bool _quickPresent = false;
  bool _quickFullCollection = false;
  Map<int, String>? _attendanceSnapshot;
  Map<int, String>? _collectionSnapshot;
  bool _submissionComplete = false;

  @override
  void initState() {
    super.initState();
    _date = DateTime.now();
    _workingDate = DateTime.now();
    _controller.arrearCollections.clear();
    _loaded = false;
    _loadEodWorkingDate();
  }

  Future<void> _loadEodWorkingDate() async {
    final prefs = await SharedPreferences.getInstance();
    final branchId = prefs.getString('branchId') ?? '';
    if (branchId.isNotEmpty) {
      final liveCtrl = Get.isRegistered<LiveCollectionController>()
          ? Get.find<LiveCollectionController>()
          : Get.put(LiveCollectionController());
      final eodDate = await liveCtrl.fetchEodWorkingDate(branchId);
      if (eodDate != null && mounted) {
        setState(() {
          _date = eodDate;
          _workingDate = eodDate;
        });
      }
    }
  }

  String _clientKey(Map<String, dynamic> item, int index) =>
      '${item['clientId'] ?? item['clientCode'] ?? 'client'}-${item['loanNumber'] ?? index}';

  /// A loan whose arrear was already collected (server `status: 'COLLECTED'`)
  /// must never be re-selectable — matches Demand Collection's guard so a
  /// client already showing the "Collected" badge can't be checked again and
  /// re-submitted for a loan that has nothing left to collect.
  bool _isFullyCollected(Map<String, dynamic> item) =>
      (item['status'] ?? '').toString().toUpperCase() == 'COLLECTED';

  String _amountText(dynamic value) {
    final num n = value is num
        ? value
        : num.tryParse(value?.toString() ?? '') ?? 0;
    return '₹${n.toStringAsFixed(2)}';
  }

  void _setupControllers(int count) {
    for (final controller in [..._amounts, ..._advances]) {
      controller.dispose();
    }
    _amounts.clear();
    _advances.clear();
    _attendance.clear();
    _selectedKeys.clear();
    _quickPresent = false;
    _quickFullCollection = false;
    _attendanceSnapshot = null;
    _collectionSnapshot = null;

    for (int i = 0; i < count; i++) {
      final item = _controller.arrearCollections[i];
      final total = _arrearDue(item);
      _amounts.add(TextEditingController(text: total.toString()));
      _advances.add(
        TextEditingController(text: (item['loanAdvance'] ?? 100).toString()),
      );
      final attendance = (item['attendance'] ?? item['attendanceStatus'] ?? 'A')
          .toString()
          .toUpperCase();
      _attendance.add(attendance == 'P' || attendance == 'ABSENT' ? 'P' : 'A');
    }
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

  Future<void> _toggleQuickPresent(bool value) async {
    setState(() {
      _quickPresent = value;
      if (value) {
        _attendanceSnapshot = {
          for (var i = 0; i < _attendance.length; i++) i: _attendance[i],
        };
        for (var i = 0; i < _attendance.length; i++) {
          _attendance[i] = 'A';
        }
      } else {
        final snapshot = _attendanceSnapshot;
        if (snapshot != null) {
          for (var i = 0; i < _attendance.length; i++) {
            _attendance[i] = snapshot[i] ?? 'A';
          }
        }
        _attendanceSnapshot = null;
      }
    });
  }

  Future<void> _toggleQuickFullCollection(bool value) async {
    setState(() {
      _quickFullCollection = value;
      if (value) {
        _collectionSnapshot = {
          for (var i = 0; i < _amounts.length; i++) i: _amounts[i].text,
        };
        for (var i = 0; i < _amounts.length; i++) {
          final item = _controller.arrearCollections[i];
          final total = _arrearDue(item);
          _amounts[i].text = total.toString();
        }
      } else {
        final snapshot = _collectionSnapshot;
        if (snapshot != null) {
          for (var i = 0; i < _amounts.length; i++) {
            _amounts[i].text = snapshot[i] ?? '0';
          }
        }
        _collectionSnapshot = null;
      }
    });
  }

  Future<void> _loadData() async {
    if (_controller.selectedCenterId.value.isEmpty) {
      Get.snackbar(
        'Required',
        'Please select a center',
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.orangeAccent,
        colorText: Colors.white,
      );
      return;
    }

    final String formattedDate =
        "${_date.year}-${_date.month.toString().padLeft(2, '0')}-${_date.day.toString().padLeft(2, '0')}";
    final result = await _controller.getArrearCollection(
      centerId: _controller.selectedCenterId.value,
      date: formattedDate,
    );

    if (result != null) {
      if (result.isEmpty) {
        Get.snackbar(
          'Success',
          'Found 0 clients with arrear installments',
          snackPosition: SnackPosition.BOTTOM,
          backgroundColor: Colors.blueAccent,
          colorText: Colors.white,
        );
        setState(() {
          _controller.arrearCollections.clear();
          _setupControllers(0);
          _loaded = true;
        });
      } else {
        setState(() {
          _setupControllers(result.length);
          _loaded = true;
        });
      }
    } else {
      Get.snackbar(
        'Error',
        'Could not fetch server data.',
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      setState(() {
        _controller.arrearCollections.clear();
        _setupControllers(0);
        _loaded = false;
      });
    }
  }

  Future<void> _pickDate() async {
    // Arrears legitimately span past dates, so this stays editable (unlike
    // Demand Collection's locked field) — but capped at the branch's actual
    // working date, mirroring the web app's `max={eodWorkingDate}`, so a
    // collection can never be backdated past today yet postdated beyond
    // what the branch has actually reached.
    final selected = await showDatePicker(
      context: context,
      initialDate: _date.isAfter(_workingDate) ? _workingDate : _date,
      firstDate: DateTime(2024),
      lastDate: _workingDate,
    );
    if (selected != null) {
      setState(() {
        _date = selected;
        _loaded = false;
      });
    }
  }

  String get _dateText =>
      '${_date.day.toString().padLeft(2, '0')}-${_date.month.toString().padLeft(2, '0')}-${_date.year}';

  String get _apiDate =>
      '${_date.year}-${_date.month.toString().padLeft(2, '0')}-${_date.day.toString().padLeft(2, '0')}';

  double get _totalArrearPrincipal {
    double total = 0;
    for (final item in _controller.arrearCollections) {
      total += _asDouble(item['arrearPrincipal']);
    }
    return total;
  }

  double get _totalArrearInterest {
    double total = 0;
    for (final item in _controller.arrearCollections) {
      total += _asDouble(item['arrearInterest']);
    }
    return total;
  }

  double get _totalArrearDue => _controller.arrearCollections.fold<double>(
    0,
    (total, item) => total + _arrearDue(item as Map<String, dynamic>),
  );

  double get _totalCollected {
    double total = 0;
    for (final controller in _amounts) {
      total += double.tryParse(controller.text) ?? 0;
    }
    return total;
  }

  double get _selectedTotalCollected {
    double total = 0;
    final list = _controller.arrearCollections;
    for (var i = 0; i < list.length && i < _amounts.length; i++) {
      final key = _clientKey(list[i] as Map<String, dynamic>, i);
      if (_selectedKeys.contains(key)) {
        total += double.tryParse(_amounts[i].text) ?? 0;
      }
    }
    return total;
  }

  double get _selectedTotalAdvances {
    double total = 0;
    final list = _controller.arrearCollections;
    for (var i = 0; i < list.length && i < _advances.length; i++) {
      final key = _clientKey(list[i] as Map<String, dynamic>, i);
      if (_selectedKeys.contains(key)) {
        total += double.tryParse(_advances[i].text) ?? 0;
      }
    }
    return total;
  }

  @override
  void dispose() {
    for (final controller in [..._amounts, ..._advances]) {
      controller.dispose();
    }
    _tableScrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Theme(
    data: Theme.of(context).copyWith(
      textTheme: GoogleFonts.poppinsTextTheme(Theme.of(context).textTheme),
    ),
    child: Scaffold(
      backgroundColor: const Color(0xFFF7FBF8),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: EdgeInsets.fromLTRB(16.w, 14.h, 16.w, 10.h),
              child: Row(
                children: [
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(
                      Icons.arrow_back,
                      color: Color(0xFF0D6842),
                    ),
                    style: IconButton.styleFrom(
                      backgroundColor: const Color(0xFFEAF6EF),
                    ),
                  ),
                  SizedBox(width: 12.w),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Arrear Collection',
                          style: TextStyle(
                            fontSize: 19.sp,
                            fontWeight: FontWeight.w800,
                            color: const Color(0xFF10472A),
                          ),
                        ),
                        Text(
                          'Select center and date to view part-due collections',
                          style: TextStyle(
                            fontSize: 11.sp,
                            color: const Color(0xFF64748B),
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    tooltip: 'Refresh Data',
                    icon: const Icon(
                      Icons.refresh,
                      color: Color(0xFF0D6842),
                    ),
                    style: IconButton.styleFrom(
                      backgroundColor: const Color(0xFFEAF6EF),
                    ),
                    onPressed: () async {
                      await _controller.loadBranchInfo();
                      if (_controller.selectedCenterId.value.isNotEmpty) {
                        await _loadData();
                      }
                    },
                  ),
                ],
              ),
            ),
            Expanded(
              child: Obx(() {
                return RefreshIndicator(
                  color: const Color(0xFF008A3D),
                  onRefresh: () async {
                    await _controller.loadBranchInfo();
                    if (_controller.selectedCenterId.value.isNotEmpty) {
                      await _loadData();
                    }
                  },
                  child: SingleChildScrollView(
                    physics: const AlwaysScrollableScrollPhysics(
                      parent: BouncingScrollPhysics(),
                    ),
                    padding: EdgeInsets.all(16.w),
                    child: Column(
                    children: [
                      _filters(),
                      SizedBox(height: 16.h),
                      _summaries(),
                      SizedBox(height: 13.h),
                      Row(
                        children: [
                          _amountCard(
                            'Arrear Principal',
                            '₹${_totalArrearPrincipal.toStringAsFixed(2)}',
                          ),
                          SizedBox(width: 10.w),
                          _amountCard(
                            'Arrear Interest',
                            '₹${_totalArrearInterest.toStringAsFixed(2)}',
                          ),
                        ],
                      ),
                      SizedBox(height: 16.h),
                      if (_loaded &&
                          _controller.arrearCollections.isNotEmpty) ...[
                        _clients(),
                        SizedBox(height: 16.h),
                        _submit(),
                        SizedBox(height: 10.h),
                        _reset(),
                      ] else ...[
                        _emptyState(),
                      ],
                    ],
                  ),
                ),
              );
            }),
            ),
          ],
        ),
      ),
    ),
  );

  Widget _filters() => _card(
    Padding(
      padding: EdgeInsets.all(15.w),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _fieldLabel('Branch'),
          Obx(() => _dropdown(_controller.branchName.value)),
          SizedBox(height: 14.h),
          _fieldLabel('Center Name'),
          Obx(() {
            final centers = _controller.centersList;
            if (_controller.isLoading.value && centers.isEmpty) {
              return Container(
                height: 50.h,
                alignment: Alignment.center,
                child: const CircularProgressIndicator(
                  color: Color(0xFF008A3D),
                ),
              );
            }
            final dropdownItems = centers.map((c) {
              final String name = c['name'] ?? '';
              final String code = c['code'] ?? '';
              final String display = formatCenterDisplay(name, code, parenthetical: true);
              return DropdownMenuItem<String>(
                value: display,
                child: Text(
                  display,
                  style: TextStyle(fontSize: 11.sp),
                  overflow: TextOverflow.ellipsis,
                ),
              );
            }).toList();

            return DropdownButtonFormField<String>(
              isExpanded: true,
              key: ValueKey(_controller.selectedCenterName.value),
              initialValue: _controller.selectedCenterName.value.isNotEmpty
                  ? _controller.selectedCenterName.value
                  : null,
              hint: Text(
                '-- SELECT CENTER --',
                style: TextStyle(
                  fontSize: 11.sp,
                  color: const Color(0xFF86A897),
                ),
                overflow: TextOverflow.ellipsis,
              ),
              items: dropdownItems,
              onChanged: (value) {
                if (value != null) {
                  _controller.selectedCenterName.value = value;
                  // Match against the same formatter the dropdown items were
                  // built with (not a raw concat) — formatCenterDisplay can
                  // reformat the code (e.g. pad "6" to "06"), so a raw
                  // rebuild here could never match any center and crash
                  // with "Bad state: No element".
                  final matched = centers.cast<Map?>().firstWhere(
                    (c) => c != null && formatCenterDisplay(c['name'], c['code'], parenthetical: true) == value,
                    orElse: () => null,
                  );
                  if (matched != null) {
                    _controller.selectedCenterId.value = matched['id'] ?? '';
                  }
                  setState(() {
                    _loaded = false;
                  });
                }
              },
              decoration: _inputDecoration(),
            );
          }),
          SizedBox(height: 14.h),
          _fieldLabel('Collection Date'),
          InkWell(
            onTap: _pickDate,
            borderRadius: BorderRadius.circular(10.r),
            child: _dropdown(_dateText, icon: Icons.calendar_month_outlined),
          ),
          EodPendingBanner(workingDate: _workingDate),
          SizedBox(height: 17.h),
          SizedBox(
            width: double.infinity,
            height: 46.h,
            child: ElevatedButton.icon(
              onPressed: _controller.isLoading.value ? null : _loadData,
              icon: _controller.isLoading.value
                  ? SizedBox(
                      width: 18.w,
                      height: 18.w,
                      child: const CircularProgressIndicator(
                        color: Colors.white,
                        strokeWidth: 2,
                      ),
                    )
                  : const Icon(Icons.trending_up_rounded),
              label: Text(
                _controller.isLoading.value ? 'Loading...' : 'Load Data',
              ),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF008A3D),
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10.r),
                ),
              ),
            ),
          ),
        ],
      ),
    ),
  );

  Widget _fieldLabel(String text) => Padding(
    padding: EdgeInsets.only(left: 5.w, bottom: 7.h),
    child: Text(
      text,
      style: TextStyle(
        fontSize: 14.sp,
        fontWeight: FontWeight.w600,
        color: const Color(0xFF1E293B),
      ),
    ),
  );

  Widget _dropdown(
    String text, {
    IconData icon = Icons.keyboard_arrow_down_rounded,
  }) => Container(
    height: 50.h,
    padding: EdgeInsets.symmetric(horizontal: 13.w),
    decoration: BoxDecoration(
      color: Colors.white,
      border: Border.all(color: const Color(0xFFD8E0E1)),
      borderRadius: BorderRadius.circular(10.r),
    ),
    child: Row(
      children: [
        Expanded(
          child: Text(text, style: TextStyle(fontSize: 13.sp)),
        ),
        Icon(icon, color: const Color(0xFF334155)),
      ],
    ),
  );

  Widget _summaries() => Row(
    children: [
      _summary(
        'Arrear Clients',
        '${_controller.arrearCollections.length}',
        Icons.people_outline,
        const Color(0xFF008A3D),
      ),
      SizedBox(width: 8.w),
      _summary(
        'Total Arrear Due',
        '₹${_totalArrearDue.toStringAsFixed(2)}',
        Icons.currency_rupee,
        const Color(0xFFF2A900),
      ),
      SizedBox(width: 8.w),
      _summary(
        'Collected',
        '₹${_totalCollected.toStringAsFixed(2)}',
        Icons.check_circle_outline,
        const Color(0xFF008A3D),
      ),
      SizedBox(width: 8.w),
      _summary(
        'Recovery %',
        _totalArrearDue > 0
            ? '${((_totalCollected / _totalArrearDue) * 100).toStringAsFixed(1)}%'
            : '0.0%',
        Icons.trending_up,
        const Color(0xFF008A3D),
      ),
    ],
  );

  Widget _summary(String label, String value, IconData icon, Color color) =>
      Expanded(
        child: _card(
          Padding(
            padding: EdgeInsets.all(9.w),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 12.sp,
                    color: const Color(0xFF475569),
                  ),
                ),
                SizedBox(height: 9.h),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        value,
                        style: TextStyle(
                          fontSize: 13.sp,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      );

  Widget _amountCard(String label, String value) => Expanded(
    child: _card(
      Padding(
        padding: EdgeInsets.all(14.w),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: TextStyle(
                fontSize: 11.sp,
                color: const Color(0xFFF08A00),
                fontWeight: FontWeight.w600,
              ),
            ),
            SizedBox(height: 8.h),
            Text(
              value,
              style: TextStyle(fontSize: 17.sp, fontWeight: FontWeight.w800),
            ),
          ],
        ),
      ),
    ),
  );

  Widget _clients() {
    final list = _controller.arrearCollections;
    // "Select All" only ever selects still-collectible clients — a
    // collected row has no checkbox to toggle (see the DataRow below), so
    // it must never be counted here either.
    final allKeys = {
      for (var i = 0; i < list.length; i++)
        if (!_isFullyCollected(list[i] as Map<String, dynamic>))
          _clientKey(list[i] as Map<String, dynamic>, i),
    };
    final allSelected =
        allKeys.isNotEmpty && allKeys.every(_selectedKeys.contains);
    final hasControllers =
        _amounts.length == list.length &&
        _advances.length == list.length &&
        _attendance.length == list.length;

    return _card(
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: EdgeInsets.all(14.w),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Arrear Clients',
                        style: TextStyle(
                          fontSize: 15.sp,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      SizedBox(height: 3.h),
                      Wrap(
                        spacing: 8,
                        runSpacing: 2,
                        children: [
                          Text(
                            'Enter collection amounts for past-due installments',
                            style: TextStyle(
                              fontSize: 10.sp,
                              color: const Color(0xFF3F9A68),
                            ),
                          ),
                          SizedBox(width: 8.w),
                          const Text(
                            '◉ Gold Loan',
                            style: TextStyle(
                              fontSize: 9,
                              color: Color(0xFFF08A00),
                            ),
                          ),
                        ],
                      ),
                      SizedBox(height: 8.h),
                      Wrap(
                        spacing: 12.w,
                        runSpacing: 4.h,
                        children: [
                          _topSwitch(
                            '100% Present',
                            _quickPresent,
                            _toggleQuickPresent,
                          ),
                          _topSwitch(
                            '100% Collection',
                            _quickFullCollection,
                            _toggleQuickFullCollection,
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: EdgeInsets.symmetric(horizontal: 14.w),
            child: Row(
              children: [
                Checkbox(
                  value: allSelected,
                  activeColor: const Color(0xFF008A3D),
                  onChanged: list.isEmpty
                      ? null
                      : (val) => setState(() {
                          if (val == true) {
                            _selectedKeys.addAll(allKeys);
                          } else {
                            _selectedKeys.removeAll(allKeys);
                          }
                        }),
                ),
                Text(
                  'Select All',
                  style: TextStyle(
                    fontSize: 11.sp,
                    fontWeight: FontWeight.w700,
                    color: const Color(0xFF10472A),
                  ),
                ),
              ],
            ),
          ),
          SizedBox(height: 4.h),
          Padding(
            padding: EdgeInsets.only(left: 14.w, right: 14.w, bottom: 10.h),
            child: Scrollbar(
              controller: _tableScrollController,
              thumbVisibility: true,
              child: SingleChildScrollView(
                controller: _tableScrollController,
                scrollDirection: Axis.horizontal,
                child: DataTable(
                  columnSpacing: 14.w,
                  headingRowHeight: 36.h,
                  dataRowMinHeight: 58.h,
                  dataRowMaxHeight: 70.h,
                  headingTextStyle: TextStyle(
                    fontSize: 10.sp,
                    fontWeight: FontWeight.w700,
                    color: const Color(0xFF475569),
                  ),
                  columns: const [
                    DataColumn(label: Flexible(child: FittedBox(fit: BoxFit.scaleDown, child: Text('#')))),
                    DataColumn(label: Flexible(child: FittedBox(fit: BoxFit.scaleDown, child: Text('Client Name')))),
                    DataColumn(label: Flexible(child: FittedBox(fit: BoxFit.scaleDown, child: Text('Loan No.')))),
                    DataColumn(label: Flexible(child: FittedBox(fit: BoxFit.scaleDown, child: Text('Inst.')))),
                    DataColumn(label: Flexible(child: FittedBox(fit: BoxFit.scaleDown, child: Text('OS Pri')))),
                    DataColumn(label: Flexible(child: FittedBox(fit: BoxFit.scaleDown, child: Text('OS Int')))),
                    DataColumn(label: Flexible(child: FittedBox(fit: BoxFit.scaleDown, child: Text('Arrear Pri')))),
                    DataColumn(label: Flexible(child: FittedBox(fit: BoxFit.scaleDown, child: Text('Arrear Int')))),
                    DataColumn(label: Flexible(child: FittedBox(fit: BoxFit.scaleDown, child: Text('Fees')))),
                    DataColumn(label: Flexible(child: FittedBox(fit: BoxFit.scaleDown, child: Text('Penalty')))),
                    DataColumn(label: Flexible(child: FittedBox(fit: BoxFit.scaleDown, child: Text('Total Arrear')))),
                    DataColumn(label: Flexible(child: FittedBox(fit: BoxFit.scaleDown, child: Text('Attend.')))),
                    DataColumn(label: Flexible(child: FittedBox(fit: BoxFit.scaleDown, child: Text('Collect Amt')))),
                    DataColumn(label: Flexible(child: FittedBox(fit: BoxFit.scaleDown, child: Text('Loan Advance')))),
                    DataColumn(label: Flexible(child: FittedBox(fit: BoxFit.scaleDown, child: Text('Status')))),
                  ],
                  rows: List.generate(list.length, (index) {
                    final item = list[index] as Map<String, dynamic>;
                    final key = _clientKey(item, index);
                    final isCollected = _isFullyCollected(item);
                    final isOverdue = item['isOverdue'] == true;

                    return DataRow(
                      // Never shows selected for an already-collected loan,
                      // even if a stale key somehow lingered in
                      // _selectedKeys — mirrors Demand Collection's guard.
                      selected: !isCollected && _selectedKeys.contains(key),
                      onSelectChanged: isCollected
                          ? null
                          : (val) => setState(() {
                              if (val == true) {
                                _selectedKeys.add(key);
                              } else {
                                _selectedKeys.remove(key);
                              }
                            }),
                      cells: [
                        DataCell(
                          Text(
                            '${index + 1}',
                            style: TextStyle(fontSize: 11.sp),
                          ),
                        ),
                        DataCell(_clientNameCell(item)),
                        DataCell(
                          Text(
                            item['loanNumber']?.toString() ?? '-',
                            style: TextStyle(fontSize: 11.sp),
                          ),
                        ),
                        DataCell(
                          Text(
                            item['installmentNo']?.toString() ?? '-',
                            style: TextStyle(fontSize: 11.sp),
                          ),
                        ),
                        DataCell(
                          Text(
                            _amountText(item['osPrincipal']),
                            style: TextStyle(fontSize: 11.sp),
                          ),
                        ),
                        DataCell(
                          Text(
                            _amountText(item['osInterest']),
                            style: TextStyle(fontSize: 11.sp),
                          ),
                        ),
                        DataCell(
                          Text(
                            _amountText(item['arrearPrincipal']),
                            style: TextStyle(
                              fontSize: 11.sp,
                              fontWeight: FontWeight.w700,
                              color: const Color(0xFFF08A00),
                            ),
                          ),
                        ),
                        DataCell(
                          Text(
                            _amountText(item['arrearInterest']),
                            style: TextStyle(
                              fontSize: 11.sp,
                              fontWeight: FontWeight.w700,
                              color: const Color(0xFFF08A00),
                            ),
                          ),
                        ),
                        DataCell(
                          Text(
                            _amountText(item['feesDue']),
                            style: TextStyle(fontSize: 11.sp),
                          ),
                        ),
                        DataCell(
                          Text(
                            _amountText(item['penaltiesDue']),
                            style: TextStyle(fontSize: 11.sp),
                          ),
                        ),
                        DataCell(
                          Text(
                            _amountText(_arrearDue(item)),
                            style: TextStyle(
                              fontSize: 11.sp,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                        DataCell(
                          hasControllers
                              ? _attendanceCell(index)
                              : const Text('-'),
                        ),
                        DataCell(
                          hasControllers
                              ? _amountFieldCell(
                                  _amounts[index],
                                  readOnly: isCollected,
                                )
                              : const Text('-'),
                        ),
                        DataCell(
                          hasControllers
                              ? _amountFieldCell(
                                  _advances[index],
                                  readOnly: isCollected,
                                )
                              : const Text('-'),
                        ),
                        DataCell(
                          _statusCell(
                            item: item,
                            isCollected: isCollected,
                            isOverdue: isOverdue,
                          ),
                        ),
                      ],
                    );
                  }),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _clientNameCell(Map<String, dynamic> item) {
    final name = item['clientName']?.toString() ?? 'Unknown';
    final code = item['clientCode']?.toString() ?? '';
    final isGold =
        (item['loanProductTypeName']?.toString() ?? '') == 'Gold Loan';
    return InkWell(
      onTap: () async {
        await Get.to(() => ArrearCollectionClientDetails(clientData: item));
        if (mounted) setState(() {});
      },
      child: SizedBox(
        width: 120.w,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 12.sp,
                fontWeight: FontWeight.w700,
                decoration: TextDecoration.underline,
                color: const Color(0xFF0D6842),
              ),
            ),
            if (code.isNotEmpty)
              Text(
                code,
                style: TextStyle(
                  fontSize: 9.sp,
                  color: const Color(0xFF64748B),
                ),
              ),
            if (isGold)
              Container(
                margin: EdgeInsets.only(top: 2.h),
                padding: EdgeInsets.symmetric(horizontal: 5.w, vertical: 1.h),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFF3E0),
                  borderRadius: BorderRadius.circular(4.r),
                ),
                child: Text(
                  'Gold Loan',
                  style: TextStyle(
                    fontSize: 8.sp,
                    color: const Color(0xFFF08A00),
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _attendanceCell(int index) => InkWell(
    onTap: () => setState(() {
      _attendance[index] = _attendance[index] == 'A' ? 'P' : 'A';
    }),
    borderRadius: BorderRadius.circular(6.r),
    child: Container(
      padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 4.h),
      decoration: BoxDecoration(
        color: _attendance[index] == 'A'
            ? const Color(0xFFE4F5EB)
            : const Color(0xFFFDE8E8),
        borderRadius: BorderRadius.circular(6.r),
      ),
      child: Text(
        _attendance[index],
        style: TextStyle(
          fontSize: 11.sp,
          fontWeight: FontWeight.w800,
          color: _attendance[index] == 'A'
              ? const Color(0xFF008A3D)
              : const Color(0xFFC5221F),
        ),
      ),
    ),
  );

  Widget _amountFieldCell(
    TextEditingController controller, {
    bool readOnly = false,
  }) => SizedBox(
    width: 72.w,
    child: TextField(
      controller: controller,
      readOnly: readOnly,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      onChanged: (_) => setState(() {}),
      style: TextStyle(
        fontSize: 11.sp,
        fontWeight: FontWeight.w700,
        color: readOnly ? const Color(0xFF64748B) : null,
      ),
      decoration: InputDecoration(
        isDense: true,
        contentPadding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 6.h),
        filled: true,
        fillColor: readOnly ? const Color(0xFFEFF3F1) : const Color(0xFFFFFDF5),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(6.r),
          borderSide: const BorderSide(color: Color(0xFFC8E6D4)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(6.r),
          borderSide: const BorderSide(color: Color(0xFFC8E6D4)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(6.r),
          borderSide: const BorderSide(color: Color(0xFF008A3D)),
        ),
      ),
    ),
  );

  Widget _statusCell({
    required Map<String, dynamic> item,
    required bool isCollected,
    required bool isOverdue,
  }) {
    final status = item['status']?.toString() ?? 'PENDING';
    final label = isCollected ? 'Collected' : (isOverdue ? 'Overdue' : status);
    final color = isCollected
        ? const Color(0xFF008A3D)
        : (isOverdue ? const Color(0xFFC5221F) : const Color(0xFF64748B));
    final bg = isCollected
        ? const Color(0xFFE4F5EB)
        : (isOverdue ? const Color(0xFFFDE8E8) : const Color(0xFFF1F5F9));
    final chip = Container(
      padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 4.h),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(6.r),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 10.sp,
          fontWeight: FontWeight.w700,
          color: color,
        ),
      ),
    );
    return chip;
  }

  Widget _topSwitch(
    String label,
    bool value,
    Future<void> Function(bool) onChanged,
  ) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      SizedBox(
        height: 25.h,
        child: Switch(
          value: value,
          onChanged: onChanged,
          activeThumbColor: const Color(0xFF008A3D),
        ),
      ),
      Text(label, style: TextStyle(fontSize: 9.sp)),
    ],
  );

  /// Builds the arrear-shaped `collections`/`attendance` payload for
  /// whichever clients are currently selected, and submits it via the
  /// software's own `POST /api/collections/arrear` contract (multipart,
  /// mandatory meeting photo + denomination) — mirrors
  /// `ArrearCollectionClient.tsx`'s `handleFinalSubmit`. Returns false
  /// (without navigating) if there's nothing valid to send, so the
  /// submission wizard stays open instead of silently "succeeding".
  Future<bool> _submitArrear(
    Uint8List photoBytes,
    Map<String, dynamic> denomination,
    double calculatedTotal,
  ) async {
    final list = _controller.arrearCollections;
    final collections = <Map<String, dynamic>>[];
    final attendance = <String, dynamic>{};

    for (var i = 0; i < list.length; i++) {
      final item = list[i] as Map<String, dynamic>;
      if (_isFullyCollected(item)) continue;
      final key = _clientKey(item, i);
      if (!_selectedKeys.contains(key)) continue;

      final amount = i < _amounts.length
          ? (double.tryParse(_amounts[i].text.trim()) ?? 0)
          : 0.0;
      if (amount <= 0) continue;
      final advance = i < _advances.length
          ? (double.tryParse(_advances[i].text.trim()) ?? 0)
          : 0.0;

      collections.add({
        'loanId': item['loanId'],
        'amountCollected': amount,
        'loanAdvanceAmount': advance,
      });

      final clientId = item['clientId']?.toString();
      if (clientId != null && clientId.isNotEmpty) {
        attendance[clientId] = i < _attendance.length
            ? _attendance[i] == 'P'
            : true;
      }
    }

    if (collections.isEmpty) {
      Get.snackbar(
        'Nothing to Submit',
        'Enter a collection amount greater than zero for at least one selected client.',
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.orangeAccent,
        colorText: Colors.white,
      );
      return false;
    }

    return _controller.submitArrearCollection(
      centerId: _controller.selectedCenterId.value,
      collectionDate: _apiDate,
      collections: collections,
      attendance: attendance,
      denomination: denomination,
      photoBytes: photoBytes,
    );
  }

  Widget _submit() => SizedBox(
    width: double.infinity,
    height: 49.h,
    child: ElevatedButton.icon(
      onPressed: _selectedKeys.isEmpty
          ? null
          : () async {
              final submitted = await Navigator.of(context).push<bool>(
                MaterialPageRoute(
                  builder: (_) => CollectionSubmissionFlowPage(
                    collectedAmount:
                        _selectedTotalCollected + _selectedTotalAdvances,
                    selectedClients: const [],
                    allClients: const [],
                    centerId: _controller.selectedCenterId.value,
                    collectionDate: _apiDate,
                    onSubmit: _submitArrear,
                  ),
                ),
              );
              if (submitted == true && mounted) {
                setState(() => _submissionComplete = true);
                await _loadData();
              }
            },
      icon: Icon(
        _submissionComplete ? Icons.check_circle : Icons.check_circle_outline,
      ),
      label: Text(
        _submissionComplete
            ? 'Submitted ✓'
            : 'Submit Arrear Collection (₹${_selectedTotalCollected.toStringAsFixed(2)} + Loan Adv ₹${_selectedTotalAdvances.toStringAsFixed(2)})',
        style: TextStyle(fontSize: 12.sp, fontWeight: FontWeight.w700),
        overflow: TextOverflow.ellipsis,
      ),
      style: ElevatedButton.styleFrom(
        backgroundColor: const Color(0xFF008A3D),
        foregroundColor: Colors.white,
        disabledBackgroundColor: const Color(0xFFA7D1B8),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(10.r),
        ),
      ),
    ),
  );

  Widget _reset() => SizedBox(
    width: double.infinity,
    height: 47.h,
    child: OutlinedButton.icon(
      onPressed: () => setState(() {
        for (var index = 0; index < _amounts.length; index++) {
          final item = _controller.arrearCollections[index];
          final total = _arrearDue(item);
          _amounts[index].text = total.toString();
          _advances[index].text = '100';
          if (index < _attendance.length) _attendance[index] = 'A';
        }
        _selectedKeys.clear();
        _quickPresent = false;
        _quickFullCollection = false;
        _attendanceSnapshot = null;
        _collectionSnapshot = null;
        _submissionComplete = false;
      }),
      icon: const Icon(Icons.restart_alt_rounded, color: Colors.red),
      label: const Text('Reset', style: TextStyle(color: Colors.red)),
      style: OutlinedButton.styleFrom(
        side: const BorderSide(color: Colors.red),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(10.r),
        ),
      ),
    ),
  );

  Widget _emptyState() => Container(
    width: double.infinity,
    height: 200.h,
    alignment: Alignment.center,
    padding: EdgeInsets.all(24.w),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(14.r),
      border: Border.all(color: const Color(0xFFE2E8F0)),
    ),
    child: Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(Icons.inbox_outlined, size: 48.sp, color: const Color(0xFF94A3B8)),
        SizedBox(height: 12.h),
        Text(
          'No Collections Loaded',
          style: TextStyle(
            fontSize: 14.sp,
            fontWeight: FontWeight.w700,
            color: const Color(0xFF475569),
          ),
        ),
        SizedBox(height: 4.h),
        Text(
          'Select a center and click Load Data.',
          style: TextStyle(fontSize: 11.sp, color: const Color(0xFF64748B)),
        ),
      ],
    ),
  );

  InputDecoration _inputDecoration() => InputDecoration(
    isDense: true,
    contentPadding: EdgeInsets.symmetric(horizontal: 13.w, vertical: 12.h),
    filled: true,
    fillColor: Colors.white,
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(10.r),
      borderSide: const BorderSide(color: Color(0xFFD8E0E1)),
    ),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(10.r),
      borderSide: const BorderSide(color: Color(0xFFD8E0E1)),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(10.r),
      borderSide: const BorderSide(color: Color(0xFF008A3D)),
    ),
  );

  Widget _card(Widget child) => Container(
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(14.r),
      boxShadow: [
        BoxShadow(
          color: Colors.black.withValues(alpha: .04),
          blurRadius: 10,
          offset: const Offset(0, 3),
        ),
      ],
    ),
    child: child,
  );
}
