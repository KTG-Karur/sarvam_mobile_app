import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:google_fonts/google_fonts.dart';

class ArrearCollectionClientDetails extends StatefulWidget {
  final dynamic clientData;

  const ArrearCollectionClientDetails({super.key, required this.clientData});

  @override
  State<ArrearCollectionClientDetails> createState() =>
      _ArrearCollectionClientDetailsState();
}

class _ArrearCollectionClientDetailsState
    extends State<ArrearCollectionClientDetails> {
  late final dynamic data;

  late final TextEditingController _collectionAmountController;
  late final TextEditingController _loanAdvanceController;
  late String _collectionStatus;
  late String _attendanceStatus;

  static const _collectionStatusOptions = ['Pending', 'Approved'];
  static const _attendanceStatusOptions = ['Present', 'Absent'];

  bool get _isCollected =>
      (data['status'] ?? '').toString().toUpperCase() == 'COLLECTED';

  @override
  void initState() {
    super.initState();
    data = widget.clientData ?? <String, dynamic>{};

    final rawAmount =
        data['collectionAmount'] ??
        data['collectedAmount'] ??
        data['amountCollected'] ??
        data['amount'];
    final rawAdvance =
        data['loanAdvance'] ?? data['advanceAmount'] ?? data['advance'];

    _collectionAmountController = TextEditingController(
      text: rawAmount == null ? '' : rawAmount.toString(),
    );
    _loanAdvanceController = TextEditingController(
      text: rawAdvance == null ? '' : rawAdvance.toString(),
    );

    final status = (data['status'] ?? data['collectionStatus'] ?? 'Pending')
        .toString();
    _collectionStatus = _collectionStatusOptions.firstWhere(
      (o) => o.toUpperCase() == status.toUpperCase(),
      orElse: () => _collectionStatusOptions.first,
    );

    final attendance =
        (data['attendanceStatus'] ?? data['attendance'] ?? 'Present')
            .toString();
    _attendanceStatus = _attendanceStatusOptions.firstWhere(
      (o) => o.toUpperCase() == attendance.toUpperCase(),
      orElse: () => _attendanceStatusOptions.first,
    );
  }

  @override
  void dispose() {
    _collectionAmountController.dispose();
    _loanAdvanceController.dispose();
    super.dispose();
  }

  Future<void> _saveCollectionDetails() async {
    FocusScope.of(context).unfocus();
    final newCollect = double.tryParse(_collectionAmountController.text) ?? 0;
    final newAdvance = double.tryParse(_loanAdvanceController.text) ?? 0;

    // Initial arrear before collection deduction
    final double originalArrear = (data['originalTotalArrear'] ??
        data['totalDemand'] ??
        data['totalArrear'] ??
        data['arrearTotal'] ??
        2200).toDouble();

    // Store original if not present
    if (data['originalTotalArrear'] == null) {
      data['originalTotalArrear'] = originalArrear;
    }

    final double remainingArrear = (originalArrear - newCollect).clamp(0.0, double.infinity);

    setState(() {
      data['collectionAmount'] = newCollect;
      data['collectedAmount'] = newCollect;
      data['amountCollected'] = newCollect;

      data['loanAdvance'] = newAdvance;
      data['advanceAmount'] = newAdvance;

      data['totalDemand'] = remainingArrear;
      data['totalArrear'] = remainingArrear;
      data['arrearTotal'] = remainingArrear;

      data['status'] = _collectionStatus;
      data['collectionStatus'] = _collectionStatus;

      data['attendanceStatus'] = _attendanceStatus;
      data['attendance'] = _attendanceStatus;
    });

    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Collection details saved successfully!'),
        backgroundColor: Color(0xFF008A3D),
      ),
    );

    _showReceiptDialog();
  }

  void _showReceiptDialog() {
    showDialog(
      context: context,
      builder: (context) => Dialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16.r)),
        child: Container(
          width: 340.w,
          padding: EdgeInsets.all(16.w),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Arrear Collection Receipt',
                    style: TextStyle(
                      fontSize: 14.sp,
                      fontWeight: FontWeight.w800,
                      color: const Color(0xFF0F3E28),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close, size: 18),
                    onPressed: () => Navigator.pop(context),
                  ),
                ],
              ),
              Divider(height: 10.h),
              SizedBox(height: 10.h),
              // Receipt Container Mock UI matching image
              Container(
                padding: EdgeInsets.all(16.w),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(12.r),
                  border: Border.all(color: const Color(0xFFE2E8F0)),
                  boxShadow: const [
                    BoxShadow(color: Colors.black12, blurRadius: 4),
                  ],
                ),
                child: Column(
                  children: [
                    Image.asset('assets/images/sarvam_logo.png', height: 35.h, errorBuilder: (_, __, ___) => const Icon(Icons.account_balance, color: Color(0xFF008A3D), size: 32)),
                    SizedBox(height: 6.h),
                    Container(
                      padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 2.h),
                      decoration: BoxDecoration(
                        border: Border.all(color: Colors.black54),
                      ),
                      child: Text(
                        'COLLECTION RECEIPT',
                        style: TextStyle(fontSize: 10.sp, fontWeight: FontWeight.w700),
                      ),
                    ),
                    SizedBox(height: 12.h),
                    _receiptRow('Branch', _text(data['branchName'] ?? data['branch'], fallback: 'Theni')),
                    _receiptRow('Center', _text(data['centerName'] ?? data['center'], fallback: '1-FOREST ROAD')),
                    _receiptRow('Client', _text(data['clientName'] ?? data['name'], fallback: 'DHANALAKSHMI TAMILSELVAN')),
                    Divider(height: 16.h, color: Colors.black26),
                    _receiptRow('Loan', _text(data['loanNumber'] ?? data['loanNo'], fallback: 'LN260000001')),
                    _receiptRow('Inst.', '#${_text(data['installmentNo'] ?? data['installment'], fallback: '4')}'),
                    Divider(height: 16.h, color: Colors.black26),
                    _receiptRow('EMI Collected', _amount(data['collectionAmount'] ?? 3300), isBold: true),
                    _receiptRow('Loan Advance', _amount(data['loanAdvance'] ?? 100), color: const Color(0xFF008A3D)),
                    Divider(height: 16.h, color: Colors.black),
                    _receiptRow(
                      'TOTAL',
                      _amount(((data['collectionAmount'] ?? 3300) as num) + ((data['loanAdvance'] ?? 100) as num)),
                      isBold: true,
                    ),
                    SizedBox(height: 12.h),
                    _receiptRow('Date & Time', '27-Jul-26 04:47 PM'),
                    _receiptRow('FDO', 'Rajasekaran'),
                    SizedBox(height: 24.h),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('FDO Signature', style: TextStyle(fontSize: 9.sp, color: Colors.black54)),
                        Text('Client Signature', style: TextStyle(fontSize: 9.sp, color: Colors.black54)),
                      ],
                    ),
                    SizedBox(height: 12.h),
                    Text(
                      'SYSTEM GENERATED RECEIPT',
                      style: TextStyle(fontSize: 8.sp, color: Colors.black38, fontWeight: FontWeight.w600),
                    ),
                  ],
                ),
              ),
              SizedBox(height: 16.h),
              Row(
                children: [
                  OutlinedButton(
                    onPressed: () => Navigator.pop(context),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: const Color(0xFF008A3D),
                      side: const BorderSide(color: Color(0xFF008A3D)),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8.r)),
                    ),
                    child: const Text('Close'),
                  ),
                  SizedBox(width: 8.w),
                  Expanded(
                    child: ElevatedButton.icon(
                      onPressed: () {},
                      icon: const Icon(Icons.picture_as_pdf, size: 16),
                      label: Text('Download PDF', style: TextStyle(fontSize: 12.sp, fontWeight: FontWeight.w700)),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF008A3D),
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8.r)),
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
  }

  Widget _receiptRow(String label, String value, {bool isBold = false, Color? color}) {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 2.h),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: TextStyle(
              fontSize: 10.sp,
              fontWeight: isBold ? FontWeight.w800 : FontWeight.w500,
              color: color ?? Colors.black87,
            ),
          ),
          Text(
            value,
            style: TextStyle(
              fontSize: 10.sp,
              fontWeight: isBold ? FontWeight.w800 : FontWeight.w600,
              color: color ?? Colors.black87,
            ),
          ),
        ],
      ),
    );
  }

  String _text(dynamic value, {String fallback = '-'}) {
    if (value == null) return fallback;
    if (value is String && value.trim().isEmpty) return fallback;
    return value.toString();
  }

  String _genderIconPath() {
    final gender = (data['gender'] ?? data['sex'] ?? '')
        .toString()
        .toLowerCase();
    if (gender.startsWith('f')) return 'assets/icon/girl_icon.png';
    return 'assets/icon/boy_icon.png';
  }

  String _amount(dynamic value) {
    if (value == null) return '₹0.00';
    if (value is num) {
      return '₹${value.toDouble().toStringAsFixed(2)}';
    }
    final parsed = double.tryParse(value.toString());
    if (parsed != null) {
      return '₹${parsed.toStringAsFixed(2)}';
    }
    return '₹${value.toString()}';
  }

  Widget _sectionTitle(String title) => Padding(
    padding: EdgeInsets.symmetric(vertical: 10.h),
    child: Text(
      title,
      style: TextStyle(
        fontSize: 15.sp,
        fontWeight: FontWeight.w700,
        color: const Color(0xFF0F3E28),
      ),
    ),
  );

  Widget _infoCard(List<Map<String, String>> rows) => Container(
    width: double.infinity,
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16.r),
      border: Border.all(color: const Color(0xFFE2E8F0)),
    ),
    child: Padding(
      padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 6.h),
      child: Table(
        columnWidths: const {0: FlexColumnWidth(4), 1: FlexColumnWidth(5)},
        border: TableBorder(
          horizontalInside: BorderSide(color: const Color(0xFFE2E8F0)),
        ),
        children: rows.map((row) {
          final verticalPadding = row['label'] == 'Loan Advance' ? 0.0 : 10.h;
          return TableRow(
            children: [
              Padding(
                padding: EdgeInsets.symmetric(vertical: verticalPadding),
                child: Text(
                  row['label']!,
                  style: TextStyle(
                    fontSize: 12.sp,
                    color: const Color(0xFF64748B),
                  ),
                ),
              ),
              Padding(
                padding: EdgeInsets.symmetric(vertical: verticalPadding),
                child: Text(
                  row['value']!,
                  textAlign: TextAlign.right,
                  style: TextStyle(
                    fontSize: 13.sp,
                    fontWeight: FontWeight.w600,
                    color: const Color(0xFF102A43),
                  ),
                ),
              ),
            ],
          );
        }).toList(),
      ),
    ),
  );

  Widget _editableRow(String label, Widget field) => Padding(
    padding: EdgeInsets.symmetric(vertical: 8.h),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Expanded(
          flex: 4,
          child: Text(
            label,
            style: TextStyle(fontSize: 12.sp, color: const Color(0xFF64748B)),
          ),
        ),
        Expanded(flex: 5, child: field),
      ],
    ),
  );

  InputDecoration _fieldDecoration() => InputDecoration(
    isDense: true,
    contentPadding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 8.h),
    filled: true,
    fillColor: const Color(0xFFF7FBF8),
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(8.r),
      borderSide: const BorderSide(color: Color(0xFFD8E0E1)),
    ),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(8.r),
      borderSide: const BorderSide(color: Color(0xFFD8E0E1)),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(8.r),
      borderSide: const BorderSide(color: Color(0xFF008A3D)),
    ),
  );

  Widget _lockBanner() => Container(
    margin: EdgeInsets.only(bottom: 10.h),
    padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 8.h),
    decoration: BoxDecoration(
      color: const Color(0xFFF7FBF8),
      borderRadius: BorderRadius.circular(8.r),
      border: Border.all(color: const Color(0xFFE2E8F0)),
    ),
    child: Text(
      'This collection is completed and cannot be edited. Contact your '
      'Branch/Area Manager to correct it.',
      style: TextStyle(fontSize: 10.sp, color: const Color(0xFF64748B)),
    ),
  );

  Widget _editableCollectionCard() {
    final locked = _isCollected;
    return Container(
    width: double.infinity,
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16.r),
      border: Border.all(color: const Color(0xFFE2E8F0)),
    ),
    child: Padding(
      padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 6.h),
      child: Column(
        children: [
          if (locked) _lockBanner(),
          _editableRow(
            'Collection Amount',
            TextField(
              controller: _collectionAmountController,
              enabled: !locked,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              textAlign: TextAlign.right,
              style: TextStyle(fontSize: 13.sp, fontWeight: FontWeight.w600),
              decoration: _fieldDecoration(),
            ),
          ),
          Divider(height: 1.h, color: const Color(0xFFE2E8F0)),
          _editableRow(
            'Loan Advance',
            TextField(
              controller: _loanAdvanceController,
              enabled: !locked,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              textAlign: TextAlign.right,
              style: TextStyle(fontSize: 13.sp, fontWeight: FontWeight.w600),
              decoration: _fieldDecoration(),
            ),
          ),
          Divider(height: 1.h, color: const Color(0xFFE2E8F0)),
          _editableRow(
            'Collection Status',
            DropdownButtonFormField<String>(
              initialValue: _collectionStatus,
              isDense: true,
              items: _collectionStatusOptions
                  .map(
                    (o) => DropdownMenuItem(
                      value: o,
                      child: Text(o, style: TextStyle(fontSize: 12.sp)),
                    ),
                  )
                  .toList(),
              onChanged: locked
                  ? null
                  : (value) {
                      if (value != null) {
                        setState(() => _collectionStatus = value);
                      }
                    },
              decoration: _fieldDecoration(),
            ),
          ),
          Divider(height: 1.h, color: const Color(0xFFE2E8F0)),
          _editableRow(
            'Attendance Status',
            DropdownButtonFormField<String>(
              initialValue: _attendanceStatus,
              isDense: true,
              items: _attendanceStatusOptions
                  .map(
                    (o) => DropdownMenuItem(
                      value: o,
                      child: Text(o, style: TextStyle(fontSize: 12.sp)),
                    ),
                  )
                  .toList(),
              onChanged: locked
                  ? null
                  : (value) {
                      if (value != null) {
                        setState(() => _attendanceStatus = value);
                      }
                    },
              decoration: _fieldDecoration(),
            ),
          ),
        ],
      ),
    ),
  );
  }

  Widget _saveButton() => SizedBox(
    width: double.infinity,
    height: 47.h,
    child: ElevatedButton.icon(
      onPressed: _saveCollectionDetails,
      icon: const Icon(Icons.save_outlined),
      label: Text(
        'Save Collection Details',
        style: TextStyle(fontSize: 13.sp, fontWeight: FontWeight.w700),
      ),
      style: ElevatedButton.styleFrom(
        backgroundColor: const Color(0xFF008A3D),
        foregroundColor: Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(10.r),
        ),
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final clientName = _text(data['clientName'] ?? data['name']);
    final clientCode = _text(
      data['clientCode'] ?? data['clientId'] ?? data['memberCode'],
    );
    final groupName = _text(
      data['groupName'] ?? data['group'] ?? data['clientCode'],
    );
    final loanNumber = _text(
      data['loanNumber'] ?? data['loanNo'] ?? data['accountNumber'],
    );
    final productType = _text(
      data['loanProductTypeName'] ?? data['productType'] ?? 'Gold Loan',
    );
    final branchName = _text(
      data['branchName'] ?? data['branch'] ?? 'Unknown Branch',
    );
    final centerName = _text(
      data['centerName'] ?? data['center'] ?? 'Unknown Center',
    );
    final installment = _text(
      data['installmentNo'] ?? data['installment'] ?? data['instNo'] ?? '0',
    );
    final outstandingPrincipal = _amount(
      data['osPrincipal'] ?? data['osPri'] ?? data['outstandingPrincipal'],
    );
    final outstandingInterest = _amount(
      data['osInterest'] ?? data['osInt'] ?? data['outstandingInterest'],
    );
    final arrearPrincipal = _amount(
      data['arrearPrincipal'] ?? data['arrearPri'] ?? data['arrearAmount'],
    );
    final arrearInterest = _amount(
      data['arrearInterest'] ??
          data['arrearInt'] ??
          data['arrearInterestAmount'],
    );
    final fees = _amount(data['fees'] ?? data['fee'] ?? data['charges']);
    final penalty = _amount(
      data['penalty'] ?? data['penalties'] ?? data['latePenalty'],
    );
    final totalArrear = _amount(
      data['totalDemand'] ?? data['totalArrear'] ?? data['arrearTotal'],
    );

    return Theme(
      data: Theme.of(context).copyWith(
        textTheme: GoogleFonts.poppinsTextTheme(Theme.of(context).textTheme),
      ),
      child: Scaffold(
        backgroundColor: const Color(0xFFF7FBF8),
        appBar: AppBar(
          backgroundColor: const Color(0xFF008A3D),
          elevation: 0,
          leading: IconButton(
            icon: const Icon(Icons.arrow_back_ios_new, color: Colors.white),
            onPressed: () => Get.back(),
          ),
          title: Text(
            'Client Details',
            style: TextStyle(
              fontSize: 18.sp,
              fontWeight: FontWeight.w700,
              color: Colors.white,
            ),
          ),
          centerTitle: false,
        ),
        body: SafeArea(
          child: SingleChildScrollView(
            padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 18.h),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: double.infinity,
                  padding: EdgeInsets.all(18.w),
                  decoration: BoxDecoration(
                    color: const Color(0xFFEAF6EF),
                    borderRadius: BorderRadius.circular(18.r),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      CircleAvatar(
                        radius: 26.r,
                        backgroundColor: Colors.white,
                        backgroundImage: AssetImage(_genderIconPath()),
                      ),
                      SizedBox(width: 14.w),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              clientName,
                              style: TextStyle(
                                fontSize: 20.sp,
                                fontWeight: FontWeight.w800,
                                color: const Color(0xFF0F3E28),
                              ),
                            ),
                            SizedBox(height: 6.h),
                            Text(
                              '$productType • $loanNumber',
                              style: TextStyle(
                                fontSize: 12.sp,
                                color: const Color(0xFF1F5135),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                SizedBox(height: 4.h),
                _sectionTitle('Client Information'),
                _infoCard([
                  {'label': 'Client Name', 'value': clientName},
                  {'label': 'Client Code', 'value': clientCode},
                  {'label': 'Group Name', 'value': groupName},
                  {'label': 'Loan Product Type', 'value': productType},
                  {'label': 'Branch Name', 'value': branchName},
                  {'label': 'Center Name', 'value': centerName},
                ]),
                SizedBox(height: 4.h),
                _sectionTitle('Loan Information'),
                _infoCard([
                  {'label': 'Loan Number', 'value': loanNumber},
                  {'label': 'Installment Number', 'value': installment},
                  {
                    'label': 'Outstanding Principal',
                    'value': outstandingPrincipal,
                  },
                  {
                    'label': 'Outstanding Interest',
                    'value': outstandingInterest,
                  },
                ]),
                SizedBox(height: 4.h),
                _sectionTitle('Arrear Details'),
                _infoCard([
                  {'label': 'Arrear Principal', 'value': arrearPrincipal},
                  {'label': 'Arrear Interest', 'value': arrearInterest},
                  {'label': 'Fees', 'value': fees},
                  {'label': 'Penalty', 'value': penalty},
                  {'label': 'Total Arrear Amount', 'value': totalArrear},
                ]),
                SizedBox(height: 4.h),
                _sectionTitle('Collection Details'),
                _editableCollectionCard(),
                SizedBox(height: 12.h),
                _saveButton(),
                SizedBox(height: 24.h),
                Container(
                  width: double.infinity,
                  padding: EdgeInsets.symmetric(
                    horizontal: 16.w,
                    vertical: 18.h,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(16.r),
                    border: Border.all(color: const Color(0xFFE2E8F0)),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Current Status',
                              style: TextStyle(
                                fontSize: 12.sp,
                                color: const Color(0xFF64748B),
                              ),
                            ),
                            SizedBox(height: 8.h),
                            Text(
                              _collectionStatus.toUpperCase(),
                              style: TextStyle(
                                fontSize: 15.sp,
                                fontWeight: FontWeight.w800,
                                color: _collectionStatus.toUpperCase() == 'APPROVED'
                                    ? const Color(0xFF008A3D)
                                    : const Color(0xFFD97706),
                              ),
                            ),
                          ],
                        ),
                      ),
                      Container(
                        padding: EdgeInsets.symmetric(
                          horizontal: 12.w,
                          vertical: 8.h,
                        ),
                        decoration: BoxDecoration(
                          color: const Color(0xFFEAF6EF),
                          borderRadius: BorderRadius.circular(12.r),
                        ),
                        child: Text(
                          _attendanceStatus,
                          style: TextStyle(
                            fontSize: 12.sp,
                            fontWeight: FontWeight.w600,
                            color: const Color(0xFF0F3E28),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
