import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:get/get.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/controller/bulk_centre_collection_controller.dart';
import 'package:sarvam/controller/live_collection_controller.dart';
import 'package:sarvam/view/FDO/colletion/collection_submission_flow.dart';
import 'package:sarvam/view/FDO/colletion/demand_collection.dart'
    show ClientCollectionDetailsPage;
import 'package:sarvam/view/FDO/colletion/single_collection_controller.dart';
import 'package:sarvam/utils/center_formatter.dart';
import 'package:sarvam/view/shared/eod_pending_banner.dart';

class SingleCollectionDetailsBulkCenterCollection extends StatefulWidget {
  const SingleCollectionDetailsBulkCenterCollection({super.key});

  @override
  State<SingleCollectionDetailsBulkCenterCollection> createState() =>
      _SingleCollectionDetailsBulkCenterCollectionState();
}

class _SingleCollectionDetailsBulkCenterCollectionState
    extends State<SingleCollectionDetailsBulkCenterCollection> {
  final SingleCollectionController _controller = Get.put(
    SingleCollectionController(),
  );
  final BulkCentreCollectionController _bulkController = Get.put(
    BulkCentreCollectionController(),
  );

  bool _isBulk = false;
  final _singleAmount = TextEditingController(text: '0.00');
  final _advance = TextEditingController(text: '0.00');

  String _singleCollectionType = 'CASH';
  String _bulkCollectionType = 'BANK';

  DateTime _collectionDate = DateTime.now();

  String get _apiDate => DateFormat('yyyy-MM-dd').format(_collectionDate);
  String get _displayDate => DateFormat('dd-MM-yyyy').format(_collectionDate);

  bool get _isSingleCollected =>
      (_controller.singleCollectionData['status'] ?? '')
          .toString()
          .toUpperCase() ==
      'COLLECTED';

  final List<bool> _bulkSelections = [];
  final List<TextEditingController> _bulkAmounts = [];
  final List<TextEditingController> _bulkAdvances = [];

  @override
  void initState() {
    super.initState();
    // Default dates and clears
    _controller.selectedCenterId.value = '';
    _controller.selectedCenterName.value = '';
    _controller.selectedClientId.value = '';
    _controller.selectedClientName.value = '';
    _controller.clientsList.clear();
    _controller.singleCollectionData.clear();
    _bulkController.demandSheet.clear();
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
          _collectionDate = eodDate;
        });
      }
    }
  }

  @override
  void dispose() {
    _singleAmount.dispose();
    _advance.dispose();
    for (final controller in _bulkAmounts) {
      controller.dispose();
    }
    for (final controller in _bulkAdvances) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _loadBulkClients(String centerId) async {
    for (final controller in _bulkAmounts) {
      controller.dispose();
    }
    _bulkAmounts.clear();
    for (final controller in _bulkAdvances) {
      controller.dispose();
    }
    _bulkAdvances.clear();
    _bulkSelections.clear();

    await _bulkController.getBulkCollection(centerId: centerId, date: _apiDate);

    final sheet = _bulkController.demandSheet;
    for (final item in sheet) {
      final bool selected = item['isSelected'] ?? true;
      _bulkSelections.add(selected);
      final double dueAmt = _dueAmount(item);
      final textVal = dueAmt.truncateToDouble() == dueAmt
          ? dueAmt.toStringAsFixed(0)
          : dueAmt.toStringAsFixed(2);
      _bulkAmounts.add(TextEditingController(text: textVal));
      _bulkAdvances.add(TextEditingController(text: '0'));
    }
    setState(() {});
  }

  double _asDouble(dynamic value) =>
      value is num ? value.toDouble() : double.tryParse('$value') ?? 0;

  double _dueAmount(Map<String, dynamic> item) {
    if (item['dueAmount'] is num) return (item['dueAmount'] as num).toDouble();
    if (item['netDue'] is num) return (item['netDue'] as num).toDouble();
    if (item['dueAmount'] != null) {
      final parsed = double.tryParse('${item['dueAmount']}');
      if (parsed != null) return parsed;
    }

    double totalDemand = 0;
    for (final key in const ['totalDue', 'totalDemand', 'totalDueAmount']) {
      if (item[key] is Map) {
        final data = item[key] as Map;
        totalDemand = _asDouble(
          data['amount'] ?? data['totalDue'] ?? data['dueAmount'],
        );
        if (totalDemand > 0) break;
      }
      if (item[key] is num) {
        totalDemand = (item[key] as num).toDouble();
        break;
      }
      if (item[key] is String) {
        final parsed = double.tryParse(item[key]);
        if (parsed != null) {
          totalDemand = parsed;
          break;
        }
      }
    }

    double alreadyCollected = 0;
    for (final key in const ['alreadyCollected', 'collectedAmount', 'paidAmount']) {
      if (item[key] is num) {
        alreadyCollected = (item[key] as num).toDouble();
        break;
      }
      if (item[key] is String) {
        final parsed = double.tryParse(item[key]);
        if (parsed != null) {
          alreadyCollected = parsed;
          break;
        }
      }
    }

    if (totalDemand > 0) {
      final net = totalDemand - alreadyCollected;
      return net < 0 ? 0 : net;
    }

    return _asDouble(item['duePrincipal']) + _asDouble(item['dueInterest']);
  }

  Future<void> _handleRefresh() async {
    if (_isBulk) {
      final centerId = _bulkController.selectedCenterId.value;
      if (centerId.isNotEmpty) {
        await _loadBulkClients(centerId);
      }
    } else {
      final clientId = _controller.selectedClientId.value;
      if (clientId.isNotEmpty) {
        await _controller.getSingleCollection(
          clientId,
          clientSummary: Map<String, dynamic>.from(
            _controller.singleCollectionData,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) => Theme(
    data: Theme.of(context).copyWith(
      textTheme: GoogleFonts.poppinsTextTheme(Theme.of(context).textTheme),
    ),
    child: Scaffold(
      backgroundColor: const Color(0xFFF7FBF8),
      appBar: AppBar(
        elevation: 0,
        scrolledUnderElevation: 0,
        backgroundColor: const Color(0xFFF7FBF8),
        leading: IconButton(
          onPressed: () => Navigator.maybePop(context),
          icon: const Icon(Icons.arrow_back, color: Color(0xFF0D6842)),
        ),
        title: Text(
          _isBulk ? 'Bulk Center Collection' : 'Single Collection Details',
          style: TextStyle(
            fontSize: 18.sp,
            fontWeight: FontWeight.w800,
            color: const Color(0xFF10472A),
          ),
        ),
        actions: [
          IconButton(
            tooltip: 'Refresh Data',
            icon: const Icon(Icons.refresh, color: Color(0xFF0D6842)),
            onPressed: () async {
              await _handleRefresh();
            },
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: EdgeInsets.fromLTRB(16.w, 2.h, 16.w, 12.h),
            child: _modeSelector(),
          ),
          Expanded(
            child: RefreshIndicator(
              color: const Color(0xFF008A3D),
              onRefresh: _handleRefresh,
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(
                  parent: BouncingScrollPhysics(),
                ),
                padding: EdgeInsets.fromLTRB(16.w, 2.h, 16.w, 20.h),
                child: _isBulk ? _bulkBody() : _singleBody(),
              ),
            ),
          ),
        ],
      ),
      bottomNavigationBar: _bottomActions(),
    ),
  );

  Widget _modeSelector() => Container(
    padding: EdgeInsets.all(4.w),
    decoration: BoxDecoration(
      color: const Color(0xFFE5F1EA),
      borderRadius: BorderRadius.circular(11.r),
    ),
    child: Row(
      children: [
        _modeButton('Single', Icons.person_outline, !_isBulk),
        _modeButton('Bulk center', Icons.groups_outlined, _isBulk),
      ],
    ),
  );

  Widget _modeButton(String text, IconData icon, bool selected) => Expanded(
    child: InkWell(
      onTap: () {
        setState(() {
          _isBulk = text == 'Bulk center';
        });
      },
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
              color: selected
                  ? const Color(0xFF008A3D)
                  : const Color(0xFF64748B),
            ),
            SizedBox(width: 5.w),
            Text(
              text,
              style: TextStyle(
                fontSize: 13.sp,
                fontWeight: FontWeight.w700,
                color: selected
                    ? const Color(0xFF008A3D)
                    : const Color(0xFF64748B),
              ),
            ),
          ],
        ),
      ),
    ),
  );

  Widget _singleBody() {
    final double collectVal = double.tryParse(_singleAmount.text) ?? 0.0;
    final double advVal = double.tryParse(_advance.text) ?? 0.0;
    final double totalCollected = collectVal + advVal;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _sectionHeader(
          Icons.person_pin_outlined,
          'Single Collection Details',
          'Enter collection information for a single client',
        ),
        SizedBox(height: 12.h),
        _card(
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Center Name',
                style: TextStyle(
                  fontSize: 12.sp,
                  fontWeight: FontWeight.w600,
                  color: const Color(0xFF1E293B),
                ),
              ),
              SizedBox(height: 6.h),
              Obx(() {
                final centers = _controller.centersList;
                if (_controller.isLoading.value && centers.isEmpty) {
                  return Container(
                    height: 46.h,
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
                      style: TextStyle(fontSize: 12.sp),
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
                      fontSize: 12.sp,
                      color: const Color(0xFF64748B),
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                  items: dropdownItems,
                  onChanged: (value) async {
                    if (value != null) {
                      _controller.selectedCenterName.value = value;
                      // Match the same formatter dropdownItems was built
                      // with — formatCenterDisplay can reformat the code
                      // (e.g. pad "6" to "06"), so a raw concat here could
                      // fail to match and crash with "Bad state: No element".
                      final matched = centers.cast<Map?>().firstWhere(
                        (c) => c != null && formatCenterDisplay(c['name'], c['code'], parenthetical: true) == value,
                        orElse: () => null,
                      );
                      if (matched != null) {
                        _controller.selectedCenterId.value = matched['id'] ?? '';
                        await _controller.getClients(matched['id'] ?? '');
                      }
                      setState(() {});
                    }
                  },
                  decoration: _dropdownDecoration(),
                );
              }),
              SizedBox(height: 13.h),
              // Locked to the branch's current EOD working date, same as
              // Bulk Collection — single collection is always for the
              // branch's active meeting day.
              _readField(
                'Collection Date',
                _displayDate,
                icon: Icons.lock_outline_rounded,
              ),
              EodPendingBanner(workingDate: _collectionDate),
              SizedBox(height: 13.h),
              Text(
                'Client Name',
                style: TextStyle(
                  fontSize: 12.sp,
                  fontWeight: FontWeight.w600,
                  color: const Color(0xFF1E293B),
                ),
              ),
              SizedBox(height: 6.h),
              Obx(() {
                final clients = _controller.clientsList;
                if (_controller.isLoading.value && clients.isEmpty) {
                  return Container(
                    height: 46.h,
                    alignment: Alignment.center,
                    child: const CircularProgressIndicator(
                      color: Color(0xFF008A3D),
                    ),
                  );
                }
                final dropdownItems = clients.map((c) {
                  final String first = c['firstName'] ?? '';
                  final String last = c['lastName'] ?? '';
                  final String code = c['clientId'] ?? '';
                  final String display = '$first $last ($code)';
                  return DropdownMenuItem<String>(
                    value: display,
                    child: Text(
                      display,
                      style: TextStyle(fontSize: 12.sp),
                      overflow: TextOverflow.ellipsis,
                    ),
                  );
                }).toList();

                return DropdownButtonFormField<String>(
                  isExpanded: true,
                  key: ValueKey(_controller.selectedClientName.value),
                  initialValue: _controller.selectedClientName.value.isNotEmpty
                      ? _controller.selectedClientName.value
                      : null,
                  hint: Text(
                    '-- SELECT CLIENT --',
                    style: TextStyle(
                      fontSize: 12.sp,
                      color: const Color(0xFF64748B),
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                  items: dropdownItems,
                  onChanged: (value) async {
                    if (value != null) {
                      _controller.selectedClientName.value = value;
                      final matched = clients.cast<Map?>().firstWhere(
                        (c) =>
                            c != null &&
                            "${c['firstName']} ${c['lastName']} (${c['clientId']})" == value,
                        orElse: () => null,
                      );
                      if (matched == null) return;
                      _controller.selectedClientId.value = matched['id'] ?? '';
                      await _controller.getSingleCollection(
                        matched['id'] ?? '',
                        clientSummary: Map<String, dynamic>.from(matched),
                      );

                      final clientData = _controller.singleCollectionData;
                      final loadFailed = clientData['loadFailed'] == true;
                      if (loadFailed) {
                        _singleAmount.text = '';
                      } else {
                        final totalDue =
                            (clientData['openingArrearsPrincipal'] ?? 0) +
                            (clientData['openingArrearsInterest'] ?? 0);
                        _singleAmount.text = totalDue.toString();
                      }
                      _advance.text = '0.0';
                      setState(() {});
                    }
                  },
                  decoration: _dropdownDecoration(),
                );
              }),
              SizedBox(height: 13.h),
              Obx(() {
                final data = _controller.singleCollectionData;
                final loanNo = data['loanNumber'] ?? '--';
                final disbDate = data['disbursementDate'] ?? '--';
                final funder = data['productName'] ?? '--';
                final loadFailed = data['loadFailed'] == true;
                final locked = _isSingleCollected;

                return Column(
                  children: [
                    if (loadFailed) _loadFailedBanner(),
                    if (locked) _lockedCollectionBanner(),
                    _readField('Loan A/c No.', loanNo),
                    _readField(
                      'Disbursal Date',
                      disbDate,
                      icon: Icons.calendar_today_outlined,
                    ),
                    _readField('Funder Name', funder),
                    _infoGrid(),
                  ],
                );
              }),
              SizedBox(height: 13.h),
              Text(
                'Collection Type',
                style: TextStyle(
                  fontSize: 12.sp,
                  fontWeight: FontWeight.w600,
                  color: const Color(0xFF1E293B),
                ),
              ),
              SizedBox(height: 6.h),
              DropdownButtonFormField<String>(
                isExpanded: true,
                initialValue: _singleCollectionType,
                items: ['CASH', 'BANK', 'BANK-GPAY'].map((type) {
                  return DropdownMenuItem<String>(
                    value: type,
                    child: Text(
                      type,
                      style: TextStyle(fontSize: 12.sp),
                      overflow: TextOverflow.ellipsis,
                    ),
                  );
                }).toList(),
                onChanged: _isSingleCollected
                    ? null
                    : (value) {
                        if (value != null) {
                          setState(() {
                            _singleCollectionType = value;
                          });
                        }
                      },
                decoration: _dropdownDecoration(),
              ),
              SizedBox(height: 13.h),
              _inputField(
                'Loan Collected',
                _singleAmount,
                enabled: !_isSingleCollected,
              ),
              _inputField(
                'Loan Advance',
                _advance,
                enabled: !_isSingleCollected,
              ),
              _readField(
                'Total Collected',
                '₹${totalCollected.toStringAsFixed(2)}',
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _bulkBody() {
    int selectedCount = 0;
    double totalExpected = 0;
    double totalCollecting = 0;

    for (int i = 0; i < _bulkSelections.length; i++) {
      if (i < _bulkSelections.length && _bulkSelections[i]) {
        selectedCount++;
        final item = _bulkController.demandSheet[i];
        totalExpected += _dueAmount(item);

        if (i < _bulkAmounts.length) {
          totalCollecting += double.tryParse(_bulkAmounts[i].text) ?? 0;
        }
        if (i < _bulkAdvances.length) {
          totalCollecting += double.tryParse(_bulkAdvances[i].text) ?? 0;
        }
      }
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _sectionHeader(
          Icons.groups_outlined,
          'Collection Context',
          'Select center, date, and collection type',
        ),
        SizedBox(height: 12.h),
        _card(
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Center Name',
                style: TextStyle(
                  fontSize: 12.sp,
                  fontWeight: FontWeight.w600,
                  color: const Color(0xFF1E293B),
                ),
              ),
              SizedBox(height: 6.h),
              Obx(() {
                final centers = _controller.centersList;
                if (_controller.isLoading.value && centers.isEmpty) {
                  return Container(
                    height: 46.h,
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
                      style: TextStyle(fontSize: 12.sp),
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
                      fontSize: 12.sp,
                      color: const Color(0xFF64748B),
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                  items: dropdownItems,
                  onChanged: (value) async {
                    if (value != null) {
                      _controller.selectedCenterName.value = value;
                      // Match the same formatter dropdownItems was built
                      // with — see the single-collection center dropdown's
                      // onChanged above for why a raw concat here can fail
                      // to match and crash with "Bad state: No element".
                      final matched = centers.cast<Map?>().firstWhere(
                        (c) => c != null && formatCenterDisplay(c['name'], c['code'], parenthetical: true) == value,
                        orElse: () => null,
                      );
                      if (matched == null) return;
                      _controller.selectedCenterId.value = matched['id'] ?? '';
                      _bulkController.selectedCenterId.value =
                          matched['id'] ?? '';
                      await _loadBulkClients(matched['id'] ?? '');
                    }
                  },
                  decoration: _dropdownDecoration(),
                );
              }),
              SizedBox(height: 14.h),
              // Locked to the branch's current EOD working date — bulk
              // collection is for the active meeting day, not a date the
              // FDO should be able to pick freely.
              _readField(
                'Collection Date',
                _displayDate,
                icon: Icons.lock_outline_rounded,
              ),
              EodPendingBanner(workingDate: _collectionDate),
              SizedBox(height: 14.h),
              Text(
                'Collection Type',
                style: TextStyle(
                  fontSize: 12.sp,
                  fontWeight: FontWeight.w600,
                  color: const Color(0xFF1E293B),
                ),
              ),
              SizedBox(height: 6.h),
              DropdownButtonFormField<String>(
                isExpanded: true,
                initialValue: _bulkCollectionType,
                items: ['BANK', 'CASH', 'BANK-GPAY'].map((type) {
                  return DropdownMenuItem<String>(
                    value: type,
                    child: Text(
                      type,
                      style: TextStyle(fontSize: 12.sp),
                      overflow: TextOverflow.ellipsis,
                    ),
                  );
                }).toList(),
                onChanged: (value) {
                  if (value != null) {
                    setState(() {
                      _bulkCollectionType = value;
                    });
                  }
                },
                decoration: _dropdownDecoration(),
              ),
            ],
          ),
        ),
        SizedBox(height: 16.h),
        Obx(() {
          final sheet = _bulkController.demandSheet;
          if (_bulkController.isLoading.value && sheet.isEmpty) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(20),
                child: CircularProgressIndicator(color: Color(0xFF008A3D)),
              ),
            );
          }
          if (sheet.isEmpty) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(20),
                child: Text(
                  'No bulk collection details found. Please select a center.',
                ),
              ),
            );
          }

          final bool isAllSelected =
              _bulkSelections.isNotEmpty && _bulkSelections.every((val) => val);

          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: _sectionHeader(
                      Icons.receipt_long_outlined,
                      'Demand Sheet',
                      '${sheet.length} clients with pending dues',
                    ),
                  ),
                  Row(
                    children: [
                      Checkbox(
                        value: isAllSelected,
                        onChanged: (val) {
                          setState(() {
                            for (int i = 0; i < _bulkSelections.length; i++) {
                              _bulkSelections[i] = val ?? false;
                            }
                          });
                        },
                        activeColor: const Color(0xFF008A3D),
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
                ],
              ),
              SizedBox(height: 10.h),
              ListView.separated(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: sheet.length,
                separatorBuilder: (_, __) => SizedBox(height: 10.h),
                itemBuilder: (context, index) {
                  final item = sheet[index];
                  if (index >= _bulkSelections.length ||
                      index >= _bulkAmounts.length ||
                      index >= _bulkAdvances.length) {
                    return const SizedBox.shrink();
                  }

                  return _clientCard(
                    index: index,
                    item: item,
                    amountController: _bulkAmounts[index],
                    advanceController: _bulkAdvances[index],
                  );
                },
              ),
            ],
          );
        }),
        SizedBox(height: 16.h),
        _card(
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _stat('$selectedCount', 'Clients Selected', Icons.people_outline),
              _stat(
                '₹${totalExpected.toStringAsFixed(0)}',
                'Total Expected',
                Icons.currency_rupee,
                color: const Color(0xFFF2B006),
              ),
              _stat(
                '₹${totalCollecting.toStringAsFixed(0)}',
                'Total Collecting',
                Icons.currency_rupee,
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _sectionHeader(IconData icon, String title, String subtitle) => Row(
    children: [
      Container(
        padding: EdgeInsets.all(9.w),
        decoration: const BoxDecoration(
          color: Color(0xFFE4F5EB),
          shape: BoxShape.circle,
        ),
        child: Icon(icon, color: const Color(0xFF008A3D), size: 19.sp),
      ),
      SizedBox(width: 10.w),
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: TextStyle(
                fontSize: 16.sp,
                fontWeight: FontWeight.w800,
                color: const Color(0xFF10472A),
              ),
            ),
            Text(
              subtitle,
              style: TextStyle(fontSize: 11.sp, color: const Color(0xFF4B8A68)),
            ),
          ],
        ),
      ),
    ],
  );

  Widget _loadFailedBanner() => Container(
    margin: EdgeInsets.only(bottom: 13.h),
    padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 8.h),
    decoration: BoxDecoration(
      color: const Color(0xFFFFF8E6),
      borderRadius: BorderRadius.circular(8.r),
      border: Border.all(color: const Color(0xFFFFE0B2)),
    ),
    child: Row(
      children: [
        Icon(
          Icons.warning_amber_rounded,
          size: 14.sp,
          color: const Color(0xFFE65100),
        ),
        SizedBox(width: 6.w),
        Expanded(
          child: Text(
            "Couldn't load full loan/arrears details for this client. "
            'Showing limited info from the client record — verify the '
            'collection amount manually before submitting.',
            style: TextStyle(
              fontSize: 10.sp,
              fontWeight: FontWeight.w600,
              color: const Color(0xFFE65100),
            ),
          ),
        ),
      ],
    ),
  );

  Widget _lockedCollectionBanner() => Container(
    margin: EdgeInsets.only(bottom: 13.h),
    padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 8.h),
    decoration: BoxDecoration(
      color: const Color(0xFFF7FBF8),
      borderRadius: BorderRadius.circular(8.r),
      border: Border.all(color: const Color(0xFFD8E0E1)),
    ),
    child: Text(
      'This collection is completed and cannot be edited. Contact your '
      'Branch/Area Manager to correct it.',
      style: TextStyle(fontSize: 10.sp, color: const Color(0xFF64748B)),
    ),
  );

  Widget _readField(String label, String value, {IconData? icon}) =>
      _field(label, value, icon);

  Widget _field(String label, String value, IconData? icon) => Padding(
    padding: EdgeInsets.only(bottom: 13.h),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize: 12.sp,
            fontWeight: FontWeight.w600,
            color: const Color(0xFF1E293B),
          ),
        ),
        SizedBox(height: 6.h),
        Container(
          height: 46.h,
          padding: EdgeInsets.symmetric(horizontal: 12.w),
          decoration: BoxDecoration(
            color: const Color(0xFFF4FAF6),
            border: Border.all(color: const Color(0xFFD2E9DB)),
            borderRadius: BorderRadius.circular(8.r),
          ),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  value,
                  style: TextStyle(
                    fontSize: 13.sp,
                    color: const Color(0xFF64748B),
                  ),
                ),
              ),
              if (icon != null)
                Icon(icon, size: 18.sp, color: const Color(0xFF5D7E6B)),
            ],
          ),
        ),
      ],
    ),
  );

  Widget _inputField(
    String label,
    TextEditingController controller, {
    bool enabled = true,
  }) => Padding(
    padding: EdgeInsets.only(bottom: 13.h),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(fontSize: 12.sp, fontWeight: FontWeight.w600),
        ),
        SizedBox(height: 6.h),
        SizedBox(
          height: 46.h,
          child: TextField(
            controller: controller,
            enabled: enabled,
            keyboardType: TextInputType.number,
            onChanged: (_) => setState(() {}),
            style: TextStyle(
              fontSize: 12.sp,
              color: const Color(0xFF008A3D),
              fontWeight: FontWeight.w700,
            ),
            decoration: InputDecoration(
              filled: true,
              fillColor: Colors.white,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8.r),
                borderSide: const BorderSide(color: Color(0xFFA9D8BB)),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8.r),
                borderSide: const BorderSide(color: Color(0xFFA9D8BB)),
              ),
              contentPadding: EdgeInsets.symmetric(horizontal: 12.w),
            ),
          ),
        ),
      ],
    ),
  );

  Widget _infoGrid() {
    final data = _controller.singleCollectionData;
    final dueWeeks = data['dueWeeks'] ?? 0;
    final collWeeks = data['collectedWeeks'] ?? 0;
    final loanAmt = data['loanAmount'] ?? 0;
    final loanOut = data['loanOutstanding'] ?? 0;
    final intBal = data['interestBalance'] ?? 0;
    final arrPri = data['openingArrearsPrincipal'] ?? 0;
    final arrInt = data['openingArrearsInterest'] ?? 0;

    final items = [
      'Due Weeks|$dueWeeks',
      'Coll Weeks|$collWeeks',
      'Loan Amount|₹${loanAmt.toString()}',
      'Loan Outstanding|₹${loanOut.toString()}',
      'Interest Balance|₹${intBal.toString()}',
      'Opening Arr. Pri|₹${arrPri.toString()}',
      'Opening Arr. Int|₹${arrInt.toString()}',
    ];

    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      childAspectRatio: 2.6,
      crossAxisSpacing: 10.w,
      mainAxisSpacing: 4.h,
      children: items.map((item) {
        final parts = item.split('|');
        return _miniInfo(parts[0], parts[1]);
      }).toList(),
    );
  }

  Widget _miniInfo(String label, String value) => Container(
    padding: EdgeInsets.all(9.w),
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
          style: TextStyle(fontSize: 13.sp, fontWeight: FontWeight.w700),
        ),
      ],
    ),
  );

  Widget _clientCard({
    required int index,
    required dynamic item,
    required TextEditingController amountController,
    required TextEditingController advanceController,
  }) {
    final String name = item['clientName'] ?? '';
    final String code = item['clientCode'] ?? '';
    final String loanNo = item['loanNumber'] ?? '--';
    final String prod = item['productName'] ?? '--';
    final double loanAmt = (item['loanAmount'] ?? 0).toDouble();
    final double os = (item['loanOutstanding'] ?? 0).toDouble();
    final double arrears = (item['totalArrears'] ?? 0).toDouble();
    final double curDue = _asDouble(item['totalCurrentDue']);
    final double totalDue = _dueAmount(item);

    return _card(
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Checkbox(
                value: index < _bulkSelections.length
                    ? _bulkSelections[index]
                    : false,
                onChanged: (val) {
                  setState(() {
                    if (index < _bulkSelections.length) {
                      _bulkSelections[index] = val ?? false;
                    }
                  });
                },
                activeColor: const Color(0xFF008A3D),
              ),
              Expanded(
                child: InkWell(
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => ClientCollectionDetailsPage(
                        client: Map<String, dynamic>.from(item),
                      ),
                    ),
                  ),
                  borderRadius: BorderRadius.circular(8.r),
                  child: Padding(
                    padding: EdgeInsets.symmetric(vertical: 4.h),
                    child: Row(
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
                                code,
                                style: TextStyle(
                                  fontSize: 11.sp,
                                  color: const Color(0xFF64748B),
                                ),
                              ),
                            ],
                          ),
                        ),
                        Icon(
                          Icons.chevron_right_rounded,
                          color: const Color(0xFF008A3D),
                          size: 22.sp,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
          const Divider(color: Color(0xFFE2E8F0)),
          Padding(
            padding: EdgeInsets.symmetric(horizontal: 4.w),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      'Loan No: $loanNo',
                      style: TextStyle(
                        fontSize: 11.sp,
                        fontWeight: FontWeight.w600,
                        color: const Color(0xFF475569),
                      ),
                    ),
                    Text(
                      prod,
                      style: TextStyle(
                        fontSize: 11.sp,
                        fontWeight: FontWeight.bold,
                        color: const Color(0xFF008A3D),
                      ),
                    ),
                  ],
                ),
                SizedBox(height: 8.h),
                Row(
                  children: [
                    Expanded(
                      child: _cardStat(
                        'Loan Amt',
                        '₹${loanAmt.toStringAsFixed(0)}',
                      ),
                    ),
                    Expanded(
                      child: _cardStat(
                        'Outstanding',
                        '₹${os.toStringAsFixed(0)}',
                      ),
                    ),
                  ],
                ),
                SizedBox(height: 6.h),
                Row(
                  children: [
                    Expanded(
                      child: _cardStat(
                        'Arrears',
                        '₹${arrears.toStringAsFixed(0)}',
                        valueColor: arrears > 0
                            ? const Color(0xFFEF4444)
                            : null,
                      ),
                    ),
                    Expanded(
                      child: _cardStat(
                        'Current Due',
                        '₹${curDue.toStringAsFixed(0)}',
                      ),
                    ),
                  ],
                ),
                SizedBox(height: 8.h),
                Container(
                  padding: EdgeInsets.symmetric(
                    horizontal: 10.w,
                    vertical: 6.h,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF1F5F9),
                    borderRadius: BorderRadius.circular(6.r),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'Total Due',
                        style: TextStyle(
                          fontSize: 12.sp,
                          fontWeight: FontWeight.w700,
                          color: const Color(0xFF475569),
                        ),
                      ),
                      Text(
                        '₹${totalDue.toStringAsFixed(0)}',
                        style: TextStyle(
                          fontSize: 13.sp,
                          fontWeight: FontWeight.w800,
                          color: const Color(0xFF1E293B),
                        ),
                      ),
                    ],
                  ),
                ),
                SizedBox(height: 12.h),
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Collected Amount',
                            style: TextStyle(
                              fontSize: 10.sp,
                              fontWeight: FontWeight.w600,
                              color: const Color(0xFF475569),
                            ),
                          ),
                          SizedBox(height: 4.h),
                          SizedBox(
                            height: 38.h,
                            child: TextField(
                              controller: amountController,
                              keyboardType: TextInputType.number,
                              onChanged: (_) => setState(() {}),
                              style: TextStyle(
                                fontSize: 12.sp,
                                fontWeight: FontWeight.w700,
                              ),
                              decoration: _inputDecoration(),
                            ),
                          ),
                        ],
                      ),
                    ),
                    SizedBox(width: 10.w),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Loan Advance',
                            style: TextStyle(
                              fontSize: 10.sp,
                              fontWeight: FontWeight.w600,
                              color: const Color(0xFF475569),
                            ),
                          ),
                          SizedBox(height: 4.h),
                          SizedBox(
                            height: 38.h,
                            child: TextField(
                              controller: advanceController,
                              keyboardType: TextInputType.number,
                              onChanged: (_) => setState(() {}),
                              style: TextStyle(
                                fontSize: 12.sp,
                                fontWeight: FontWeight.w700,
                              ),
                              decoration: _inputDecoration(),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _cardStat(String label, String value, {Color? valueColor}) => Column(
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
          color: valueColor ?? const Color(0xFF1E293B),
        ),
      ),
    ],
  );

  InputDecoration _inputDecoration() => InputDecoration(
    isDense: true,
    filled: true,
    fillColor: const Color(0xFFFFFDF5),
    contentPadding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 8.h),
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
  );

  Widget _stat(String value, String label, IconData icon, {Color? color}) =>
      Row(
        children: [
          Icon(icon, color: color ?? const Color(0xFF008A3D), size: 20.sp),
          SizedBox(width: 6.w),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: TextStyle(
                  fontSize: 9.sp,
                  color: const Color(0xFF64748B),
                ),
              ),
              Text(
                value,
                style: TextStyle(
                  fontSize: 16.sp,
                  fontWeight: FontWeight.w800,
                  color: color ?? const Color(0xFF008A3D),
                ),
              ),
            ],
          ),
        ],
      );

  Widget _bottomActions() => SafeArea(
    child: Container(
      padding: EdgeInsets.fromLTRB(16.w, 10.h, 16.w, 14.h),
      decoration: const BoxDecoration(color: Colors.white),
      child: Row(
        children: [
          Expanded(
            child: OutlinedButton.icon(
              onPressed: () {
                setState(() {
                  _singleAmount.text = '0.00';
                  _advance.text = '0.00';
                  for (var controller in _bulkAmounts) {
                    controller.text = _dueAmount(
                      _bulkController.demandSheet[_bulkAmounts.indexOf(
                            controller,
                          )]
                          as Map<String, dynamic>,
                    ).toStringAsFixed(2);
                  }
                  for (var controller in _bulkAdvances) {
                    controller.text = '0';
                  }
                });
              },
              icon: const Icon(Icons.restart_alt_rounded),
              label: const Text('Reset'),
              style: OutlinedButton.styleFrom(
                foregroundColor: Colors.red,
                side: const BorderSide(color: Colors.red),
                padding: EdgeInsets.symmetric(vertical: 13.h),
              ),
            ),
          ),
          SizedBox(width: 10.w),
          Expanded(
            flex: 2,
            child: ElevatedButton.icon(
              onPressed: () async {
                if (!_isBulk) {
                  final clientId = _controller.selectedClientId.value;
                  if (clientId.isEmpty) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('Please select a client first.'),
                      ),
                    );
                    return;
                  }
                  final loanId = _controller.singleCollectionData['loanId']
                      ?.toString();
                  if (loanId == null || loanId.isEmpty) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text(
                          'No active loan found for this client.',
                        ),
                      ),
                    );
                    return;
                  }

                  final double collectVal =
                      double.tryParse(_singleAmount.text) ?? 0.0;
                  final double advVal = double.tryParse(_advance.text) ?? 0.0;

                  final submitted = await Navigator.of(context).push<bool>(
                    MaterialPageRoute(
                      builder: (_) => CollectionSubmissionFlowPage(
                        collectedAmount: collectVal + advVal,
                        selectedClients: const [],
                        allClients: const [],
                        centerId: _controller.selectedCenterId.value,
                        collectionDate: _apiDate,
                        onSubmit: (photoBytes, denomination, total) =>
                            _controller.submitSingleCollection(
                              clientId: clientId,
                              loanId: loanId,
                              collectionDate: _apiDate,
                              amount: collectVal,
                              loanAdvance: advVal,
                              collectionType: _singleCollectionType,
                              denomination: denomination,
                              photoBytes: photoBytes,
                            ),
                      ),
                    ),
                  );
                  if (submitted == true && mounted) {
                    Navigator.maybePop(context);
                  }
                } else {
                  final centerId = _bulkController.selectedCenterId.value;
                  final sheet = _bulkController.demandSheet;

                  final collections = <Map<String, dynamic>>[];
                  double totalCollected = 0;
                  for (int i = 0; i < sheet.length; i++) {
                    final bool isSel = i < _bulkSelections.length
                        ? _bulkSelections[i]
                        : false;
                    if (!isSel) continue;
                    final item = sheet[i] as Map<String, dynamic>;
                    final double amount = i < _bulkAmounts.length
                        ? (double.tryParse(_bulkAmounts[i].text) ?? 0.0)
                        : 0.0;
                    if (amount <= 0) continue;
                    final double advance = i < _bulkAdvances.length
                        ? (double.tryParse(_bulkAdvances[i].text) ?? 0.0)
                        : 0.0;
                    collections.add({
                      'clientId': item['clientId'],
                      'loanId': item['loanId'],
                      'amount': amount,
                      'loanAdvance': advance,
                      'isSelected': true,
                    });
                    totalCollected += amount + advance;
                  }

                  if (collections.isEmpty) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text(
                          'Select at least one client with a collection amount greater than zero.',
                        ),
                      ),
                    );
                    return;
                  }

                  final submitted = await Navigator.of(context).push<bool>(
                    MaterialPageRoute(
                      builder: (_) => CollectionSubmissionFlowPage(
                        collectedAmount: totalCollected,
                        selectedClients: const [],
                        allClients: const [],
                        centerId: centerId,
                        collectionDate: _apiDate,
                        onSubmit: (photoBytes, denomination, total) =>
                            _bulkController.submitBulkCollection(
                              centerId: centerId,
                              collectionDate: _apiDate,
                              collectionType: _bulkCollectionType,
                              collections: collections,
                              denomination: denomination,
                              photoBytes: photoBytes,
                            ),
                      ),
                    ),
                  );
                  if (submitted == true && mounted) {
                    Navigator.maybePop(context);
                  }
                }
              },
              icon: const Icon(Icons.check_circle_outline),
              label: Text(_isBulk ? 'Approve Collection' : 'Submit Collection'),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF008A3D),
                foregroundColor: Colors.white,
                disabledBackgroundColor: const Color(0xFFA7D1B8),
                padding: EdgeInsets.symmetric(vertical: 13.h),
              ),
            ),
          ),
        ],
      ),
    ),
  );

  InputDecoration _dropdownDecoration() => InputDecoration(
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
      borderSide: const BorderSide(color: Color(0xFF008A3D)),
    ),
  );

  Widget _card(Widget child) => Container(
    width: double.infinity,
    padding: EdgeInsets.all(14.w),
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
