import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/controller/collection_controller.dart';
import 'package:sarvam/controller/live_collection_controller.dart';
import 'package:sarvam/view/FDO/colletion/collection_submission_flow.dart';
import 'package:sarvam/utils/center_formatter.dart';

class DemandCollection extends StatefulWidget {
  const DemandCollection({super.key, this.initialDate});
  final DateTime? initialDate;

  @override
  State<DemandCollection> createState() => _DemandCollectionState();
}

/// Complete, read-only collection and loan snapshot for one selected client.
class ClientCollectionDetailsPage extends StatelessWidget {
  const ClientCollectionDetailsPage({super.key, required this.client});

  final Map<String, dynamic> client;

  static const _green = Color(0xFF008A3D);

  @override
  Widget build(BuildContext context) {
    final clientName = _text('clientName', fallback: 'Unknown client');
    final status = _text('status', fallback: 'PENDING').toUpperCase();
    final fields = <_ClientDetailField>[
      _ClientDetailField('Client Name', clientName),
      _ClientDetailField('Client Code', _text('clientCode', fallback: '-')),
      _ClientDetailField('Loan No.', _text('loanNumber', fallback: '-')),
      _ClientDetailField(
        'Inst.',
        _number([
          'installmentNo',
          'installmentNumber',
          'installment',
        ], plain: true),
      ),
      _ClientDetailField(
        'OS Pri',
        _number(['outstandingPrincipal', 'osPrincipal', 'openingPrincipal']),
      ),
      _ClientDetailField(
        'OS Int',
        _number(['outstandingInterest', 'osInterest', 'openingInterest']),
      ),
      _ClientDetailField(
        'Due Pri',
        _number(['duePrincipal', 'currentDuePrincipal']),
      ),
      _ClientDetailField(
        'Due Int',
        _number(['dueInterest', 'currentDueInterest']),
      ),
      _ClientDetailField(
        'Arr Pri',
        _number([
          'arrearPrincipal',
          'arrearsPrincipal',
          'openingArrearsPrincipal',
        ]),
      ),
      _ClientDetailField(
        'Arr Int',
        _number([
          'arrearInterest',
          'arrearsInterest',
          'openingArrearsInterest',
        ]),
      ),
      _ClientDetailField(
        'Cur Dmd Pri',
        _number(['currentDemandPrincipal', 'currentDuePrincipal']),
      ),
      _ClientDetailField(
        'Cur Dmd Int',
        _number(['currentDemandInterest', 'currentDueInterest']),
      ),
      _ClientDetailField(
        'Total Due',
        _number(['totalDemand', 'totalDue', 'dueAmount', 'totalDueAmount']),
        highlighted: true,
      ),
      _ClientDetailField(
        'Already Collected',
        _number(['alreadyCollected', 'collectedAmount']),
      ),
      _ClientDetailField(
        'Rem Principal',
        _number(['remainingPrincipal', 'remPrincipal']),
      ),
      _ClientDetailField(
        'Rem Interest',
        _number(['remainingInterest', 'remInterest']),
      ),
      _ClientDetailField(
        'Loan Advance',
        _number(['loanAdvance', 'advanceAmount', 'advance', 'loanAdv']),
      ),
      _ClientDetailField(
        'Loan Adv Adjusted',
        _number([
          'loanAdvanceAdjusted',
          'advanceAdjusted',
          'adjustedLoanAdvance',
          'loanAdvAdjusted',
        ]),
      ),
      _ClientDetailField(
        'Loan Adv Collect',
        _number([
          'loanAdvanceCollectedToday',
          'loanAdvanceCollect',
          'advanceCollect',
          'loanAdvanceCollection',
          'loanAdvCollect',
        ]),
      ),
      _ClientDetailField(
        'Attendance',
        _text('attendance', fallback: _text('attendanceStatus', fallback: 'A')),
      ),
      _ClientDetailField(
        'Collect Amount',
        _number([
          'collectedAmount',
          'collectAmount',
          'collectionAmount',
          'amountCollected',
        ]),
      ),
      _ClientDetailField('Status', status),
    ];

    return Scaffold(
      backgroundColor: const Color(0xFFF5FBF7),
      appBar: AppBar(
        backgroundColor: _green,
        foregroundColor: Colors.white,
        elevation: 0,
        title: const Text('Client Details'),
      ),
      body: SafeArea(
        top: false,
        child: SingleChildScrollView(
          padding: EdgeInsets.all(16.w),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: double.infinity,
                padding: EdgeInsets.all(16.w),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(14.r),
                  border: Border.all(color: const Color(0xFFD2E9DB)),
                ),
                child: Row(
                  children: [
                    CircleAvatar(
                      radius: 25.r,
                      backgroundColor: const Color(0xFFE4F5EB),
                      child: Icon(
                        Icons.person_outline,
                        color: _green,
                        size: 27.sp,
                      ),
                    ),
                    SizedBox(width: 12.w),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            clientName,
                            style: TextStyle(
                              fontSize: 16.sp,
                              fontWeight: FontWeight.w800,
                              color: const Color(0xFF10472A),
                            ),
                          ),
                          SizedBox(height: 3.h),
                          Text(
                            '${_text('clientCode', fallback: '-')}  •  ${_text('loanNumber', fallback: '-')}',
                            style: TextStyle(
                              fontSize: 11.sp,
                              color: const Color(0xFF4B8A68),
                            ),
                          ),
                        ],
                      ),
                    ),
                    _statusChip(status),
                  ],
                ),
              ),
              SizedBox(height: 18.h),
              Text(
                'Overall Collection Details',
                style: TextStyle(
                  fontSize: 18.sp,
                  fontWeight: FontWeight.w800,
                  color: const Color(0xFF10472A),
                ),
              ),
              SizedBox(height: 12.h),
              GridView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: fields.length,
                gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: MediaQuery.sizeOf(context).width < 360
                      ? 1
                      : 2,
                  mainAxisExtent: 82.h,
                  crossAxisSpacing: 10.w,
                  mainAxisSpacing: 10.h,
                ),
                itemBuilder: (_, index) => _detailTile(fields[index]),
              ),
              SizedBox(height: 18.h),
              ClientCollectionEditPanel(client: client),
            ],
          ),
        ),
      ),
    );
  }

  Widget _detailTile(_ClientDetailField field) => Container(
    padding: EdgeInsets.symmetric(horizontal: 14.w, vertical: 12.h),
    decoration: BoxDecoration(
      color: field.highlighted ? const Color(0xFFFFF7E1) : Colors.white,
      borderRadius: BorderRadius.circular(10.r),
      border: Border.all(
        color: field.highlighted
            ? const Color(0xFFF2B006)
            : const Color(0xFFDCEDE3),
      ),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Text(
          field.label,
          style: TextStyle(fontSize: 12.sp, color: const Color(0xFF638B74)),
        ),
        SizedBox(height: 5.h),
        Text(
          field.value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            fontSize: field.highlighted ? 19.sp : 15.sp,
            fontWeight: FontWeight.w800,
            color: field.highlighted
                ? const Color(0xFFC66A00)
                : const Color(0xFF10472A),
          ),
        ),
      ],
    ),
  );

  Widget _statusChip(String status) => Container(
    padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 5.h),
    decoration: BoxDecoration(
      color: status == 'COLLECTED' ? _green : const Color(0xFFC98A00),
      borderRadius: BorderRadius.circular(12.r),
    ),
    child: Text(
      status,
      style: TextStyle(
        color: Colors.white,
        fontSize: 9.sp,
        fontWeight: FontWeight.w700,
      ),
    ),
  );

  String _text(String key, {required String fallback}) {
    final value = _lookup([key]);
    return value == null || value.toString().trim().isEmpty
        ? fallback
        : value.toString();
  }

  String _number(List<String> keys, {bool plain = false}) {
    final value = _lookup(keys);
    if (value == null || value.toString().trim().isEmpty) {
      return plain ? '-' : '₹0.00';
    }
    if (plain) return value.toString();
    final number = value is num
        ? value.toDouble()
        : double.tryParse(value.toString().replaceAll(',', ''));
    return number == null ? value.toString() : '₹${number.toStringAsFixed(2)}';
  }

  dynamic _lookup(List<String> keys) {
    for (final key in keys) {
      if (client[key] != null) return client[key];
    }
    final normalizedKeys = keys.map(_normalize).toSet();
    for (final entry in client.entries) {
      if (normalizedKeys.contains(_normalize(entry.key))) return entry.value;
    }
    return null;
  }

  String _normalize(String key) =>
      key.toLowerCase().replaceAll(RegExp('[^a-z0-9]'), '');
}

class _ClientDetailField {
  const _ClientDetailField(this.label, this.value, {this.highlighted = false});
  final String label;
  final String value;
  final bool highlighted;
}

/// Editable fields used while collecting from the selected client.
class ClientCollectionEditPanel extends StatefulWidget {
  const ClientCollectionEditPanel({super.key, required this.client});

  final Map<String, dynamic> client;

  @override
  State<ClientCollectionEditPanel> createState() =>
      _ClientCollectionEditPanelState();
}

class _ClientCollectionEditPanelState extends State<ClientCollectionEditPanel> {
  late final TextEditingController _advanceCollectController;
  late final TextEditingController _collectAmountController;
  late String _attendance;

  @override
  void initState() {
    super.initState();
    // For a PENDING item, don't trust whatever is currently sitting on the
    // shared client map for these two fields — it can be a leftover edit
    // from a previous, unrelated selection round on the same loaded list
    // (e.g. testing a different client earlier without reloading). Only a
    // COLLECTED item's stored amounts reflect a real, submitted value.
    final trustPersistedAmounts = _isCollected;
    final existingAdvance = _value([
      'loanAdvanceCollectedToday',
      'loanAdvanceCollect',
      'advanceCollect',
      'loanAdvanceCollection',
      'loanAdvCollect',
    ]);
    final existingCollection = _value([
      'collectedAmount',
      'collectAmount',
      'collectionAmount',
      'amountCollected',
    ]);
    final defaultDemand = _value([
      'totalDemand',
      'totalDue',
      'dueAmount',
      'totalDueAmount',
    ]);

    final numAdv = double.tryParse(existingAdvance) ?? 0;
    final numColl = double.tryParse(existingCollection) ?? 0;
    final numDemand = double.tryParse(defaultDemand) ?? 0;

    _advanceCollectController = TextEditingController(
      text: trustPersistedAmounts || numAdv > 0 ? existingAdvance : '0',
    );
    _collectAmountController = TextEditingController(
      text: trustPersistedAmounts || numColl > 0
          ? existingCollection
          : numDemand.toStringAsFixed(2),
    );

    widget.client['loanAdvanceCollectedToday'] =
        double.tryParse(_advanceCollectController.text) ?? 0;
    widget.client['collectedAmount'] =
        double.tryParse(_collectAmountController.text) ?? numDemand;

    final attendance = _value(['attendance', 'attendanceStatus']);
    _attendance =
        attendance.toUpperCase() == 'P' || attendance.toUpperCase() == 'ABSENT'
        ? 'P'
        : 'A';
    widget.client['attendance'] = _attendance;
  }

  @override
  void dispose() {
    _advanceCollectController.dispose();
    _collectAmountController.dispose();
    super.dispose();
  }

  String _value(List<String> keys) {
    for (final key in keys) {
      final value = widget.client[key];
      if (value != null) return value.toString();
    }
    final normalizedKeys = keys.map(_normalize).toSet();
    for (final entry in widget.client.entries) {
      if (normalizedKeys.contains(_normalize(entry.key)) &&
          entry.value != null) {
        return entry.value.toString();
      }
    }
    return '0';
  }

  String _normalize(String key) =>
      key.toLowerCase().replaceAll(RegExp('[^a-z0-9]'), '');

  Future<void> _save() async {
    final advance = double.tryParse(_advanceCollectController.text.trim());
    final collection = double.tryParse(_collectAmountController.text.trim());
    if (advance == null ||
        collection == null ||
        advance < 0 ||
        collection < 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter valid collection amounts.')),
      );
      return;
    }

    setState(() {
      widget.client['loanAdvanceCollectedToday'] = advance;
      widget.client['collectedAmount'] = collection;
      widget.client['attendance'] = _attendance;
    });
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Collection Amount added successfully.')),
    );
  }

  @override
  Widget build(BuildContext context) => Container(
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
          'Collection Entry',
          style: TextStyle(
            fontSize: 14.sp,
            fontWeight: FontWeight.w800,
            color: const Color(0xFF10472A),
          ),
        ),
        SizedBox(height: 12.h),
        if (_isCollected)
          Padding(
            padding: EdgeInsets.only(bottom: 12.h),
            child: Text(
              'This collection is completed and cannot be edited. Contact your '
              'Branch/Area Manager to correct it.',
              style: TextStyle(fontSize: 10.sp, color: const Color(0xFF638B74)),
            ),
          ),
        _amountField(
          'Loan Adv Collect',
          _advanceCollectController,
          enabled: !_isCollected,
        ),
        SizedBox(height: 12.h),
        _amountField(
          'Due Amount',
          _collectAmountController,
          enabled: !_isCollected,
        ),
        SizedBox(height: 12.h),
        Text(
          'Attendance',
          style: TextStyle(fontSize: 11.sp, fontWeight: FontWeight.w600),
        ),
        SizedBox(height: 6.h),
        DropdownButtonFormField<String>(
          initialValue: _attendance,
          decoration: _decoration(),
          items: const [
            DropdownMenuItem(value: 'A', child: Text('A - Present')),
            DropdownMenuItem(value: 'P', child: Text('P - Absent')),
          ],
          onChanged: _isCollected
              ? null
              : (value) => setState(() => _attendance = value ?? 'A'),
        ),
        SizedBox(height: 14.h),
        SizedBox(
          width: double.infinity,
          height: 46.h,
          child: ElevatedButton.icon(
            onPressed: _isCollected ? null : _save,
            icon: const Icon(Icons.save_outlined),
            label: const Text('Save Collection Entry'),
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF008A3D),
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(9.r),
              ),
            ),
          ),
        ),
      ],
    ),
  );

  bool get _isCollected =>
      widget.client['status']?.toString().toUpperCase() == 'COLLECTED';

  Widget _amountField(
    String label,
    TextEditingController controller, {
    required bool enabled,
  }) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        label,
        style: TextStyle(fontSize: 11.sp, fontWeight: FontWeight.w600),
      ),
      SizedBox(height: 6.h),
      TextFormField(
        controller: controller,
        enabled: enabled,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        decoration: _decoration().copyWith(prefixText: '₹ '),
      ),
    ],
  );

  InputDecoration _decoration() => InputDecoration(
    isDense: true,
    contentPadding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 14.h),
    filled: true,
    fillColor: const Color(0xFFF7FCF8),
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
      borderSide: const BorderSide(color: Color(0xFF008A3D), width: 1.5),
    ),
  );
}

class _DemandCollectionState extends State<DemandCollection> {

  // ignore: unused_field
  static const List<Map<String, dynamic>> _demoClients = [
    {
      'clientId': '37-2-1-1',
      'clientCode': '37-2-1-1',
      'clientName': 'Gowri Natarajan',
      'loanNumber': 'LN26000008',
      'loanProductTypeName': 'Gold Loan',
      'totalDemand': 1100,
      'duePrincipal': 800,
      'dueInterest': 300,
      'status': 'PENDING',
      'collectedAmount': 1100,
      'loanAdvanceCollectedToday': 100,
      'attendance': 'P',
    },
    {
      'clientId': '37-2-1-3',
      'clientCode': '37-2-1-3',
      'clientName': 'Muthulakshmi Mariyapan',
      'loanNumber': 'LN26000010',
      'loanProductTypeName': 'Gold Loan',
      'totalDemand': 1100,
      'duePrincipal': 800,
      'dueInterest': 300,
      'status': 'PENDING',
      'collectedAmount': 1100,
      'loanAdvanceCollectedToday': 100,
      'attendance': 'P',
    },
    {
      'clientId': '37-2-1-2',
      'clientCode': '37-2-1-2',
      'clientName': 'Pappaselvi sudhakar',
      'loanNumber': 'LN26000009',
      'loanProductTypeName': 'Gold Loan',
      'totalDemand': 1100,
      'duePrincipal': 800,
      'dueInterest': 300,
      'status': 'PENDING',
      'collectedAmount': 1100,
      'loanAdvanceCollectedToday': 100,
      'attendance': 'P',
    },
  ];

  final CollectionController _collectionController = Get.put(
    CollectionController(),
  );
  final LiveCollectionController _liveCollectionController = Get.put(
    LiveCollectionController(),
  );
  String? _center;
  late DateTime _date;
  bool _loaded = true;
  final Set<String> _selectedClientKeys = <String>{};

  bool _quickPresent = true;
  bool _quickFullCollection = true;
  bool _quickFullAdvance = true;
  Map<String, String>? _attendanceSnapshot;
  Map<String, num>? _collectionSnapshot;
  Map<String, num>? _advanceSnapshot;

  @override
  void initState() {
    super.initState();
    _date = widget.initialDate ?? DateTime.now();
    _collectionController.demandCollections.clear();
    _loadEligibleCenters();
  }

  void _initSelections() {
    final list = _collectionController.demandCollections;
    _selectedClientKeys.clear();
    for (var i = 0; i < list.length; i++) {
      final raw = list[i];
      if (raw is Map) {
        final item = Map<String, dynamic>.from(raw);
        list[i] = item;
        _selectedClientKeys.add(_clientKey(item, i));
        if (_quickFullAdvance) {
          final num target = _asNum(
            item['loanAdvance'] ??
                item['advanceAmount'] ??
                item['advance'] ??
                item['loanAdv'] ??
                item['savingsDue'] ??
                item['totalSavingsDue'] ??
                item['savingsCurrentDemand'],
          );
          item['loanAdvanceCollectedToday'] = target;
        }
      }
    }
  }

  Future<void> _loadEligibleCenters() async {
    final prefs = await SharedPreferences.getInstance();
    final branchId = prefs.getString('branchId') ?? '';
    if (branchId.isNotEmpty) {
      final centers = await _liveCollectionController.getEligibleCenters(
        branchId,
      );
      if (centers != null && centers.isNotEmpty) {
        if (_liveCollectionController.collectionDate.value.isNotEmpty) {
          try {
            final apiDate = DateTime.parse(
              _liveCollectionController.collectionDate.value,
            );
            setState(() {
              _date = apiDate;
            });
          } catch (_) {}
        }
      }
    }
  }

  Future<void> _loadDemandCollection() async {
    if (_center == null || _center!.isEmpty) return;

    final String formattedDate =
        "${_date.year}-${_date.month.toString().padLeft(2, '0')}-${_date.day.toString().padLeft(2, '0')}";

    final data = await _collectionController.getDemandCollection(
      centerId: _center!,
      date: formattedDate,
    );

    if (data != null) {
      setState(() {
        _loaded = true;
        _initSelections();
        _quickPresent = true;
        _quickFullCollection = true;
        _quickFullAdvance = true;
        _attendanceSnapshot = null;
        _collectionSnapshot = null;
        _advanceSnapshot = null;
      });
    }
  }

  @override
  Widget build(BuildContext context) => Theme(
    data: Theme.of(context).copyWith(
      textTheme: GoogleFonts.poppinsTextTheme(Theme.of(context).textTheme),
    ),
    child: Scaffold(
      backgroundColor: const Color(0xFFF5FBF7),
      appBar: AppBar(
        elevation: 0,
        scrolledUnderElevation: 0,
        backgroundColor: const Color(0xFF008A3D),
        leading: IconButton(
          onPressed: () => Navigator.maybePop(context),
          icon: const Icon(Icons.arrow_back, color: Colors.white),
        ),
        title: Text(
          'Live Collection',
          style: TextStyle(
            fontSize: 19.sp,
            fontWeight: FontWeight.w800,
            color: Colors.white,
          ),
        ),
        actions: [
          IconButton(
            tooltip: 'Refresh Data',
            icon: const Icon(Icons.refresh, color: Colors.white),
            onPressed: () async {
              await _loadEligibleCenters();
              if (_center != null && _center!.isNotEmpty) {
                await _loadDemandCollection();
              }
            },
          ),
        ],
      ),
      body: SafeArea(
        top: false,
        child: RefreshIndicator(
          color: const Color(0xFF008A3D),
          onRefresh: () async {
            await _loadEligibleCenters();
            if (_center != null && _center!.isNotEmpty) {
              await _loadDemandCollection();
            }
          },
          child: SingleChildScrollView(
            physics: const AlwaysScrollableScrollPhysics(
              parent: BouncingScrollPhysics(),
            ),
            padding: EdgeInsets.fromLTRB(16.w, 3.h, 16.w, 24.h),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Collect scheduled loan repayments from clients during center meetings',
                  style: TextStyle(
                    fontSize: 11.sp,
                    color: const Color(0xFF4B8A68),
                  ),
                ),
                SizedBox(height: 20.h),
                _collectionDetailsCard(),
                SizedBox(height: 18.h),
                Obx(() {
                  final collections = _collectionController.demandCollections;
                  final isLoading = _collectionController.isLoading.value;
                  if (isLoading) {
                    return Padding(
                      padding: EdgeInsets.all(30.w),
                      child: const Center(
                        child: CircularProgressIndicator(
                          color: Color(0xFF008A3D),
                        ),
                      ),
                    );
                  }
                  if (!_loaded || collections.isEmpty) {
                    return _emptyState();
                  }
                  return _buildDemandList();
                }),
              ],
            ),
          ),
        ),
      ),
    ),
  );

  Widget _collectionDetailsCard() => _card(
    Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Container(
              padding: EdgeInsets.all(8.w),
              decoration: const BoxDecoration(
                color: Color(0xFFE4F5EB),
                shape: BoxShape.circle,
              ),
              child: Icon(
                Icons.receipt_long_outlined,
                color: const Color(0xFF008A3D),
                size: 18.sp,
              ),
            ),
            SizedBox(width: 9.w),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Collection Details',
                    style: TextStyle(
                      fontSize: 14.sp,
                      fontWeight: FontWeight.w800,
                      color: const Color(0xFF10472A),
                    ),
                  ),
                  Text(
                    'Select center and date to view pending collections',
                    style: TextStyle(
                      fontSize: 10.sp,
                      color: const Color(0xFF4B8A68),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        SizedBox(height: 20.h),
        Text(
          'Collection Date',
          style: TextStyle(fontSize: 11.sp, fontWeight: FontWeight.w600),
        ),
        SizedBox(height: 6.h),
        InkWell(
          onTap: _pickDate,
          borderRadius: BorderRadius.circular(8.r),
          child: Container(
            height: 47.h,
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
                    _dateText,
                    style: TextStyle(
                      fontSize: 12.sp,
                      color: const Color(0xFF385046),
                    ),
                  ),
                ),
                Icon(
                  Icons.calendar_today_outlined,
                  color: const Color(0xFF4B8A68),
                  size: 18.sp,
                ),
              ],
            ),
          ),
        ),
        SizedBox(height: 13.h),
        Text(
          'Center Name',
          style: TextStyle(fontSize: 11.sp, fontWeight: FontWeight.w600),
        ),
        SizedBox(height: 6.h),
        Obx(() {
          final centers = _liveCollectionController.eligibleCenters;
          if (_liveCollectionController.isLoading.value) {
            return const Center(
              child: CircularProgressIndicator(color: Color(0xFF008A3D)),
            );
          }
          final dropdownItems = centers.map((c) {
              final String id = c['id']?.toString() ?? '';
              final String name = c['name']?.toString() ?? '';
              final String code = c['code']?.toString() ?? '';
              final String display = formatCenterDisplay(name, code);
              return DropdownMenuItem<String>(
                value: id,
                child: Text(
                  display,
                  style: TextStyle(fontSize: 11.sp),
                  overflow: TextOverflow.ellipsis,
                ),
              );
            }).toList();

          return DropdownButtonFormField<String>(
            isExpanded: true,
            initialValue: _center,
            hint: Text(
              '-- SELECT CENTER --',
              style: TextStyle(fontSize: 11.sp, color: const Color(0xFF86A897)),
              overflow: TextOverflow.ellipsis,
            ),
            items: dropdownItems,
            onChanged: (value) => setState(() {
              _center = value;
              _loaded = false;
            }),
            decoration: _inputDecoration(),
          );
        }),
        SizedBox(height: 16.h),
        Obx(
          () => SizedBox(
            width: double.infinity,
            height: 47.h,
            child: ElevatedButton.icon(
              onPressed:
                  _center == null || _collectionController.isLoading.value
                  ? null
                  : _loadDemandCollection,
              icon: _collectionController.isLoading.value
                  ? SizedBox(
                      width: 18.w,
                      height: 18.w,
                      child: const CircularProgressIndicator(
                        color: Colors.white,
                        strokeWidth: 2,
                      ),
                    )
                  : Icon(Icons.trending_up_rounded, size: 19.sp),
              label: Text(
                _collectionController.isLoading.value
                    ? 'Loading...'
                    : 'Load Data',
                style: TextStyle(fontSize: 13.sp, fontWeight: FontWeight.w700),
              ),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF008A3D),
                foregroundColor: Colors.white,
                disabledBackgroundColor: const Color(0xFFA7D1B8),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(9.r),
                ),
              ),
            ),
          ),
        ),
        if (_center == null)
          Padding(
            padding: EdgeInsets.only(top: 9.h),
            child: Text(
              'Select a center to load pending collections.',
              style: TextStyle(fontSize: 10.sp, color: const Color(0xFF638B74)),
            ),
          ),
      ],
    ),
  );

  Widget _emptyState() => Container(
    width: double.infinity,
    height: 260.h,
    padding: EdgeInsets.all(25.w),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(14.r),
      border: Border.all(color: const Color(0xFFD2E9DB)),
    ),
    child: Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Container(
          padding: EdgeInsets.all(15.w),
          decoration: const BoxDecoration(
            color: Color(0xFFE4F5EB),
            shape: BoxShape.circle,
          ),
          child: Icon(
            _loaded ? Icons.check_circle_outline : Icons.receipt_long_outlined,
            color: const Color(0xFF008A3D),
            size: 30.sp,
          ),
        ),
        SizedBox(height: 14.h),
        Text(
          _loaded ? 'No Pending Collections' : 'Select a Center',
          style: TextStyle(
            fontSize: 15.sp,
            fontWeight: FontWeight.w800,
            color: const Color(0xFF10472A),
          ),
        ),
        SizedBox(height: 6.h),
        Text(
          _loaded
              ? 'There are no pending collections for the selected date.'
              : 'Please select a center and collection date to view pending collections.',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 11.sp, color: const Color(0xFF4B8A68)),
        ),
      ],
    ),
  );

  Future<void> _pickDate() async {
    final selected = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime(2024),
      lastDate: DateTime(2030),
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
  InputDecoration _inputDecoration() => InputDecoration(
    isDense: true,
    contentPadding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 15.h),
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
  );
  Widget _card(Widget child) => Container(
    width: double.infinity,
    padding: EdgeInsets.all(15.w),
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

  Widget _buildDemandList() {
    final list = _collectionController.demandCollections;
    final summary = _collectionController.summary;

    num totalDemandSum = 0;
    num collectedSum = 0;
    num arrearPrincipalSum = 0;
    num arrearInterestSum = 0;
    num curDemandPrincipalSum = 0;
    num curDemandInterestSum = 0;

    for (var raw in list) {
      final item = raw as Map<String, dynamic>;
      totalDemandSum += _asNum(item['totalDemand']);
      collectedSum += _asNum(item['collectedAmount']);
      arrearPrincipalSum += _asNum(item['arrearPrincipal']);
      arrearInterestSum += _asNum(item['arrearInterest']);
      curDemandPrincipalSum += _asNum(item['currentDemandPrincipal']);
      curDemandInterestSum += _asNum(item['currentDemandInterest']);
    }

    final totalClients = summary['totalClients'] is num
        ? (summary['totalClients'] as num).toInt()
        : list.length;
    final totalDemand = summary['totalDemand'] is num
        ? _asNum(summary['totalDemand'])
        : totalDemandSum;
    final arrearPrincipal = summary['totalArrearPrincipal'] is num
        ? _asNum(summary['totalArrearPrincipal'])
        : arrearPrincipalSum;
    final arrearInterest = summary['totalArrearInterest'] is num
        ? _asNum(summary['totalArrearInterest'])
        : arrearInterestSum;
    final curDemandPrincipal = summary['totalCurrentDemandPrincipal'] is num
        ? _asNum(summary['totalCurrentDemandPrincipal'])
        : curDemandPrincipalSum;
    final curDemandInterest = summary['totalCurrentDemandInterest'] is num
        ? _asNum(summary['totalCurrentDemandInterest'])
        : curDemandInterestSum;
    final collectionPercent = totalDemand > 0
        ? (collectedSum / totalDemand) * 100
        : 0;

    final allKeys = {
      for (var i = 0; i < list.length; i++)
        _clientKey(list[i] as Map<String, dynamic>, i),
    };
    final allSelected =
        allKeys.isNotEmpty && allKeys.every(_selectedClientKeys.contains);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            _summaryMetricCard(
              'Total Clients',
              '$totalClients',
              Icons.people_outline,
              const Color(0xFF008A3D),
            ),
            SizedBox(width: 8.w),
            _summaryMetricCard(
              'Total Demand',
              '₹${totalDemand.toStringAsFixed(2)}',
              Icons.currency_rupee,
              const Color(0xFF008A3D),
            ),
          ],
        ),
        SizedBox(height: 8.h),
        Row(
          children: [
            _summaryMetricCard(
              'Collected',
              '₹${collectedSum.toStringAsFixed(2)}',
              Icons.check_circle_outline,
              const Color(0xFF008A3D),
            ),
            SizedBox(width: 8.w),
            _summaryMetricCard(
              'Collection %',
              '${collectionPercent.toStringAsFixed(1)}%',
              Icons.trending_up_rounded,
              const Color(0xFF008A3D),
            ),
          ],
        ),
        SizedBox(height: 8.h),
        Row(
          children: [
            _summaryMetricCard(
              'Arrear Principal',
              '₹${arrearPrincipal.toStringAsFixed(2)}',
              Icons.warning_amber_rounded,
              const Color(0xFFC98A00),
            ),
            SizedBox(width: 8.w),
            _summaryMetricCard(
              'Arrear Interest',
              '₹${arrearInterest.toStringAsFixed(2)}',
              Icons.warning_amber_rounded,
              const Color(0xFFC98A00),
            ),
          ],
        ),
        SizedBox(height: 8.h),
        Row(
          children: [
            _summaryMetricCard(
              'Cur. Demand Principal',
              '₹${curDemandPrincipal.toStringAsFixed(2)}',
              Icons.account_balance_wallet_outlined,
              const Color(0xFF008A3D),
            ),
            SizedBox(width: 8.w),
            _summaryMetricCard(
              'Cur. Demand Interest',
              '₹${curDemandInterest.toStringAsFixed(2)}',
              Icons.percent_outlined,
              const Color(0xFF008A3D),
            ),
          ],
        ),
        SizedBox(height: 16.h),
        Text(
          'Enter collection amounts and mark attendance',
          style: TextStyle(fontSize: 10.sp, color: const Color(0xFF638B74)),
        ),
        SizedBox(height: 8.h),
        Wrap(
          spacing: 14.w,
          runSpacing: 6.h,
          children: [
            _quickToggle('100% Present', _quickPresent, _toggleQuickPresent),
            _quickToggle(
              '100% Collection',
              _quickFullCollection,
              _toggleQuickFullCollection,
            ),
            _quickToggle(
              '100% Loan Advance',
              _quickFullAdvance,
              _toggleQuickFullAdvance,
            ),
          ],
        ),
        SizedBox(height: 14.h),
        Row(
          children: [
            InkWell(
              onTap: list.isEmpty
                  ? null
                  : () => setState(() {
                      if (allSelected) {
                        _selectedClientKeys.removeAll(allKeys);
                      } else {
                        _selectedClientKeys.addAll(allKeys);
                      }
                    }),
              borderRadius: BorderRadius.circular(6.r),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Checkbox(
                    value: allSelected,
                    activeColor: const Color(0xFF008A3D),
                    onChanged: list.isEmpty
                        ? null
                        : (value) => setState(() {
                            if (value == true) {
                              _selectedClientKeys.addAll(allKeys);
                            } else {
                              _selectedClientKeys.removeAll(allKeys);
                            }
                          }),
                  ),
                  Text(
                    'Select All',
                    style: TextStyle(
                      fontSize: 12.sp,
                      fontWeight: FontWeight.w700,
                      color: const Color(0xFF10472A),
                    ),
                  ),
                ],
              ),
            ),
            SizedBox(width: 8.w),
            Flexible(
              child: Text(
                'Pending Client Collections (${list.length})',
                textAlign: TextAlign.right,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 14.sp,
                  fontWeight: FontWeight.w700,
                  color: const Color(0xFF10472A),
                ),
              ),
            ),
          ],
        ),
        SizedBox(height: 10.h),
        ListView.separated(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: list.length,
          separatorBuilder: (_, __) => SizedBox(height: 12.h),
          itemBuilder: (context, index) {
            final item = list[index] as Map<String, dynamic>;
            final key = _clientKey(item, index);
            return _clientDemandCard(
              item,
              selected: _selectedClientKeys.contains(key),
              onSelected: (selected) => setState(() {
                if (selected) {
                  _selectedClientKeys.add(key);
                } else {
                  _selectedClientKeys.remove(key);
                }
              }),
            );
          },
        ),
        SizedBox(height: 14.h),
        _collectionActions(list),
      ],
    );
  }

  Widget _quickToggle(String label, bool value, ValueChanged<bool> onChanged) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize: 10.sp,
            fontWeight: FontWeight.w600,
            color: const Color(0xFF385046),
          ),
        ),
        Transform.scale(
          scale: 0.75,
          child: Switch(
            value: value,
            activeThumbColor: const Color(0xFF008A3D),
            onChanged: onChanged,
          ),
        ),
      ],
    );
  }

  void _toggleQuickPresent(bool value) {
    final list = _collectionController.demandCollections;
    setState(() {
      _quickPresent = value;
      if (value) {
        _attendanceSnapshot = {
          for (var i = 0; i < list.length; i++)
            _clientKey(list[i] as Map<String, dynamic>, i):
                (list[i] as Map<String, dynamic>)['attendance']?.toString() ??
                'A',
        };
        for (var i = 0; i < list.length; i++) {
          final raw = list[i];
          if (raw is Map) {
            final item = Map<String, dynamic>.from(raw);
            item['attendance'] = 'A';
            list[i] = item;
          }
        }
      } else {
        final snapshot = _attendanceSnapshot;
        if (snapshot != null) {
          for (var i = 0; i < list.length; i++) {
            final raw = list[i];
            if (raw is Map) {
              final item = Map<String, dynamic>.from(raw);
              item['attendance'] = snapshot[_clientKey(item, i)] ?? 'A';
              list[i] = item;
            }
          }
        }
        _attendanceSnapshot = null;
      }
    });
  }

  void _toggleQuickFullCollection(bool value) {
    final list = _collectionController.demandCollections;
    setState(() {
      _quickFullCollection = value;
      if (value) {
        _collectionSnapshot = {
          for (var i = 0; i < list.length; i++)
            _clientKey(list[i] as Map<String, dynamic>, i): _asNum(
              (list[i] as Map<String, dynamic>)['collectedAmount'],
            ),
        };
        for (var i = 0; i < list.length; i++) {
          final raw = list[i];
          if (raw is Map) {
            final item = Map<String, dynamic>.from(raw);
            item['collectedAmount'] = _asNum(item['totalDemand']);
            list[i] = item;
          }
        }
      } else {
        final snapshot = _collectionSnapshot;
        if (snapshot != null) {
          for (var i = 0; i < list.length; i++) {
            final raw = list[i];
            if (raw is Map) {
              final item = Map<String, dynamic>.from(raw);
              item['collectedAmount'] = snapshot[_clientKey(item, i)] ?? 0;
              list[i] = item;
            }
          }
        }
        _collectionSnapshot = null;
      }
    });
  }

  void _toggleQuickFullAdvance(bool value) {
    final list = _collectionController.demandCollections;
    setState(() {
      _quickFullAdvance = value;
      if (value) {
        _advanceSnapshot = {
          for (var i = 0; i < list.length; i++)
            _clientKey(list[i] as Map<String, dynamic>, i): _asNum(
              (list[i] as Map<String, dynamic>)['loanAdvanceCollectedToday'],
            ),
        };
        for (var i = 0; i < list.length; i++) {
          final raw = list[i];
          if (raw is Map) {
            final item = Map<String, dynamic>.from(raw);
            final num target = _asNum(
              item['loanAdvance'] ??
                  item['advanceAmount'] ??
                  item['advance'] ??
                  item['loanAdv'] ??
                  item['savingsDue'] ??
                  item['totalSavingsDue'] ??
                  item['savingsCurrentDemand'],
            );
            item['loanAdvanceCollectedToday'] = target > 0 ? target : 100;
            list[i] = item;
          }
        }
      } else {
        final snapshot = _advanceSnapshot;
        if (snapshot != null) {
          for (var i = 0; i < list.length; i++) {
            final raw = list[i];
            if (raw is Map) {
              final item = Map<String, dynamic>.from(raw);
              item['loanAdvanceCollectedToday'] =
                  snapshot[_clientKey(item, i)] ?? 0;
              list[i] = item;
            }
          }
        }
        _advanceSnapshot = null;
      }
    });
  }

  String _clientKey(Map<String, dynamic> item, int index) =>
      '${item['clientId'] ?? item['clientCode'] ?? 'client'}-${item['loanNumber'] ?? index}';

  Widget _clientDemandCard(
    Map<String, dynamic> item, {
    required bool selected,
    required ValueChanged<bool> onSelected,
  }) {
    final clientName = item['clientName'] ?? 'Unknown';
    final clientCode = item['clientCode'] ?? '';
    final loanNumber = item['loanNumber'] ?? '';
    final loanProduct = item['loanProductTypeName'] ?? 'JLG';
    final centerName = item['centerName']?.toString() ?? '';
    final totalDemand = item['totalDemand'] ?? 0;
    final duePrincipal = item['duePrincipal'] ?? 0;
    final dueInterest = item['dueInterest'] ?? 0;
    final arrearPrincipal = item['arrearPrincipal'] ?? 0;
    final arrearInterest = item['arrearInterest'] ?? 0;
    final isOverdue = item['isOverdue'] == true;
    final status = item['status']?.toString() ?? 'PENDING';

    return Semantics(
      button: true,
      label: 'Open complete details for $clientName',
      child: InkWell(
        onTap: () async {
          await Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => ClientCollectionDetailsPage(client: item),
            ),
          );
          if (mounted) setState(() {});
        },
        borderRadius: BorderRadius.circular(14.r),
        child: _card(
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Checkbox(
                    value: selected,
                    activeColor: const Color(0xFF008A3D),
                    onChanged: (value) => onSelected(value ?? false),
                  ),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          clientName,
                          style: TextStyle(
                            fontSize: 14.sp,
                            fontWeight: FontWeight.w700,
                            color: const Color(0xFF10472A),
                          ),
                        ),
                        SizedBox(height: 2.h),
                        Text(
                          centerName.isNotEmpty
                              ? 'Client ID: $clientCode | Loan: $loanNumber ($loanProduct) | Center: $centerName'
                              : 'Client ID: $clientCode | Loan: $loanNumber ($loanProduct)',
                          style: TextStyle(
                            fontSize: 10.sp,
                            color: const Color(0xFF4B8A68),
                          ),
                        ),
                      ],
                    ),
                  ),
                  Container(
                    padding: EdgeInsets.symmetric(
                      horizontal: 8.w,
                      vertical: 4.h,
                    ),
                    decoration: BoxDecoration(
                      color: isOverdue
                          ? const Color(0xFFFDE8E8)
                          : const Color(0xFFE4F5EB),
                      borderRadius: BorderRadius.circular(6.r),
                    ),
                    child: Text(
                      isOverdue ? 'OVERDUE' : status,
                      style: TextStyle(
                        fontSize: 9.sp,
                        fontWeight: FontWeight.w700,
                        color: isOverdue
                            ? const Color(0xFFC5221F)
                            : const Color(0xFF008A3D),
                      ),
                    ),
                  ),
                ],
              ),
              Divider(height: 18.h, color: const Color(0xFFE2F1E8)),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  _amountDetail('Total Demand', '₹$totalDemand', isBold: true),
                  _amountDetail('Due Principal', '₹$duePrincipal'),
                  _amountDetail('Due Interest', '₹$dueInterest'),
                ],
              ),
              if (arrearPrincipal > 0 || arrearInterest > 0) ...[
                SizedBox(height: 8.h),
                Container(
                  padding: EdgeInsets.symmetric(
                    horizontal: 10.w,
                    vertical: 6.h,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFF8E6),
                    borderRadius: BorderRadius.circular(6.r),
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
                          'Includes Arrears: Principal ₹$arrearPrincipal + Interest ₹$arrearInterest',
                          style: TextStyle(
                            fontSize: 10.sp,
                            fontWeight: FontWeight.w600,
                            color: const Color(0xFFE65100),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
              SizedBox(height: 10.h),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const SizedBox.shrink(),
                  Row(
                    children: [
                      Icon(
                        Icons.visibility_outlined,
                        size: 16.sp,
                        color: const Color(0xFF008A3D),
                      ),
                      SizedBox(width: 5.w),
                      Text(
                        'View client details',
                        style: TextStyle(
                          fontSize: 11.sp,
                          color: const Color(0xFF008A3D),
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      Icon(
                        Icons.chevron_right_rounded,
                        size: 18.sp,
                        color: const Color(0xFF008A3D),
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _collectionActions(List<dynamic> list) {
    final selected = <Map<String, dynamic>>[];
    for (var index = 0; index < list.length; index++) {
      final item = Map<String, dynamic>.from(list[index]);
      if (_selectedClientKeys.contains(_clientKey(item, index))) {
        // The demand API returns collectedAmount: 0 (not null) for clients
        // who haven't been individually edited yet, so `??` never falls
        // through to totalDemand. Selecting a client is treated as
        // "collect the full due amount" unless the FDO has explicitly
        // entered a different amount via the client edit panel.
        final explicitAmount =
            item['collectedAmount'] ?? item['collectAmount'];
        if (_asNum(explicitAmount) == 0) {
          item['collectedAmount'] = _asNum(item['totalDemand']);
        }
        selected.add(item);
      }
    }
    final totalCollection = selected.fold<num>(
      0,
      (sum, item) => sum + _asNum(item['collectedAmount']),
    );
    final totalAdvance = selected.fold<num>(
      0,
      (sum, item) =>
          sum +
          _asNum(
            item['loanAdvanceCollectedToday'] ??
                item['loanAdvanceCollect'] ??
                item['loanAdvance'] ??
                item['advanceAmount'],
          ),
    );
    return Row(
      children: [
        Expanded(
          child: SizedBox(
            height: 48.h,
            child: ElevatedButton.icon(
              onPressed: selected.isEmpty
                  ? null
                  : () async {
                      final submitted = await Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => CollectionSubmissionFlowPage(
                            collectedAmount: (totalCollection + totalAdvance)
                                .toDouble(),
                            selectedClients: selected,
                            centerId: _center ?? '',
                            collectionDate:
                                "${_date.year}-${_date.month.toString().padLeft(2, '0')}-${_date.day.toString().padLeft(2, '0')}",
                            allClients: list
                                .map(
                                  (e) => Map<String, dynamic>.from(e as Map),
                                )
                                .toList(),
                          ),
                        ),
                      );
                      if (submitted == true && mounted) {
                        setState(() => _selectedClientKeys.clear());
                        await _loadDemandCollection();
                      }
                    },
              icon: const Icon(Icons.arrow_forward_rounded),
              label: Text(
                'Continue (₹${totalCollection.toStringAsFixed(2)} + Loan Adv ₹${totalAdvance.toStringAsFixed(2)})',
                overflow: TextOverflow.ellipsis,
              ),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF008A3D),
                foregroundColor: Colors.white,
                disabledBackgroundColor: const Color(0xFFA7D1B8),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8.r),
                ),
              ),
            ),
          ),
        ),
        SizedBox(width: 10.w),
        SizedBox(
          height: 48.h,
          child: OutlinedButton.icon(
            onPressed: _selectedClientKeys.isEmpty
                ? null
                : () => setState(() {
                    _selectedClientKeys.clear();
                    // Clear locally-edited amounts too — otherwise a value
                    // typed in for one client while testing (or left over
                    // from a quick toggle) keeps reappearing in unrelated
                    // selections made later in the same loaded list.
                    for (var i = 0; i < list.length; i++) {
                      final raw = list[i];
                      if (raw is Map) {
                        final item = Map<String, dynamic>.from(raw);
                        item['collectedAmount'] = 0;
                        item['loanAdvanceCollectedToday'] = 0;
                        list[i] = item;
                      }
                    }
                  }),
            icon: const Icon(Icons.restart_alt_rounded),
            label: const Text('Reset'),
            style: OutlinedButton.styleFrom(
              foregroundColor: const Color(0xFFC5221F),
              side: const BorderSide(color: Color(0xFFC5221F)),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(8.r),
              ),
            ),
          ),
        ),
      ],
    );
  }

  num _asNum(dynamic value) => value is num
      ? value
      : num.tryParse(value?.toString().replaceAll(',', '') ?? '') ?? 0;

  Widget _summaryMetricCard(
    String label,
    String value,
    IconData icon,
    Color color,
  ) {
    return Expanded(
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 10.h),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(10.r),
          border: Border.all(color: const Color(0xFFD2E9DB)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 10.sp,
                      color: const Color(0xFF638B74),
                    ),
                  ),
                  SizedBox(height: 4.h),
                  Text(
                    value,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 13.sp,
                      fontWeight: FontWeight.w800,
                      color: const Color(0xFF10472A),
                    ),
                  ),
                ],
              ),
            ),
            SizedBox(width: 6.w),
            Icon(icon, color: color, size: 16.sp),
          ],
        ),
      ),
    );
  }

  Widget _amountDetail(String label, String value, {bool isBold = false}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(fontSize: 10.sp, color: const Color(0xFF638B74)),
        ),
        SizedBox(height: 2.h),
        Text(
          value,
          style: TextStyle(
            fontSize: 12.sp,
            fontWeight: isBold ? FontWeight.w800 : FontWeight.w600,
            color: const Color(0xFF10472A),
          ),
        ),
      ],
    );
  }
}
