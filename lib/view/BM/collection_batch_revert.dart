import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:intl/intl.dart';
import 'package:sarvam/controller/collection_reversal_controller.dart';
import 'package:sarvam/widgets/confirm_dialog.dart';

const List<int> _noteValues = [500, 200, 100, 50, 20, 10, 5, 2, 1];

/// Batch detail + reversal screen: shows the meeting photo, denomination,
/// and every transaction in a demand/arrear collection batch; lets a
/// BM/AM/Admin select which transaction(s) to reverse and re-balance the
/// batch's cash denomination to match what remains afterward.
class CollectionBatchRevert extends StatefulWidget {
  final String collectionBatchId;
  const CollectionBatchRevert({super.key, required this.collectionBatchId});

  @override
  State<CollectionBatchRevert> createState() => _CollectionBatchRevertState();
}

class _CollectionBatchRevertState extends State<CollectionBatchRevert> {
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

  final Set<String> _selected = {};
  final Map<int, TextEditingController> _noteControllers = {
    for (final n in _noteValues) n: TextEditingController(text: '0'),
  };
  final TextEditingController _upiController = TextEditingController(text: '0');
  final TextEditingController _remarksController = TextEditingController();

  bool _denominationInitialized = false;

  @override
  void initState() {
    super.initState();
    for (final ctrl in _noteControllers.values) {
      ctrl.addListener(() => setState(() {}));
    }
    _upiController.addListener(() => setState(() {}));
    _load();
  }

  @override
  void dispose() {
    for (final ctrl in _noteControllers.values) {
      ctrl.dispose();
    }
    _upiController.dispose();
    _remarksController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    _denominationInitialized = false;
    await _controller.getBatchDetail(collectionBatchId: widget.collectionBatchId);
    if (!mounted) return;
    _initDenomination();
  }

  Map<String, dynamic> get _detail => _controller.batchDetail;
  Map<String, dynamic> get _denomination =>
      Map<String, dynamic>.from(_detail['denomination'] ?? {});
  List<dynamic> get _transactions =>
      (_detail['transactions'] as List?) ?? const [];

  Map<int, int> _originalCounts() {
    final denom = _denomination;
    return {
      for (final n in _noteValues) n: ((denom['d$n'] ?? 0) as num).toInt(),
    };
  }

  double get _originalUpi => ((_denomination['upi'] ?? 0) as num).toDouble();

  bool _isSelectable(Map t) =>
      t['isReversed'] != true && t['isEodLocked'] != true && t['isSavingsRow'] != true;

  double _amountOf(Map t) => ((t['amount'] ?? 0) as num).toDouble();

  void _initDenomination() {
    final original = _originalCounts();
    for (final n in _noteValues) {
      _noteControllers[n]!.text = '${original[n] ?? 0}';
    }
    _upiController.text = _formatMoney(_originalUpi);
    setState(() => _denominationInitialized = true);
  }

  String _formatMoney(double v) =>
      v == v.roundToDouble() ? v.toInt().toString() : v.toString();

  void _toggle(String transactionId) {
    setState(() {
      if (_selected.contains(transactionId)) {
        _selected.remove(transactionId);
      } else {
        _selected.add(transactionId);
      }
      _applySuggestion();
    });
  }

  void _toggleAll(bool selectAll) {
    setState(() {
      _selected.clear();
      if (selectAll) {
        for (final t in _transactions) {
          final m = t as Map;
          if (_isSelectable(m)) _selected.add("${m['transactionId']}");
        }
      }
      _applySuggestion();
    });
  }

  /// Re-suggests the denomination that should REMAIN after removing the
  /// selected transactions' cash, largest note first — mirrors the web
  /// app's BatchRevertDialog.suggestDenomination, recomputed from the
  /// original (pre-this-revert) counts every time, not incrementally.
  void _applySuggestion() {
    final original = _originalCounts();
    double remainingToRemove = 0;
    for (final t in _transactions) {
      final m = t as Map;
      if (_selected.contains("${m['transactionId']}")) {
        remainingToRemove += _amountOf(m);
      }
    }

    for (final n in _noteValues) {
      final origCount = original[n] ?? 0;
      final maxByAmount = remainingToRemove <= 0
          ? 0
          : (remainingToRemove / n).floor();
      final removable = origCount < maxByAmount ? origCount : maxByAmount;
      _noteControllers[n]!.text = '${origCount - removable}';
      remainingToRemove -= removable * n;
    }
    // UPI is left as the original value — not a physical note, so it's not
    // part of the largest-note-first suggestion; the user edits it by hand
    // if the cash breakdown actually needs it adjusted.
    _upiController.text = _formatMoney(_originalUpi);
  }

  double get _enteredTotal {
    double total = 0;
    for (final n in _noteValues) {
      total += (int.tryParse(_noteControllers[n]!.text) ?? 0) * n;
    }
    total += double.tryParse(_upiController.text) ?? 0;
    return total;
  }

  double get _remainingRequired {
    double total = 0;
    for (final t in _transactions) {
      final m = t as Map;
      final id = "${m['transactionId']}";
      if (m['isReversed'] != true && !_selected.contains(id)) {
        total += _amountOf(m);
      }
    }
    return total;
  }

  bool get _isBalanced => (_enteredTotal - _remainingRequired).abs() < 0.01;

  double get _selectedTotal {
    double total = 0;
    for (final t in _transactions) {
      final m = t as Map;
      if (_selected.contains("${m['transactionId']}")) total += _amountOf(m);
    }
    return total;
  }

  Future<void> _submit() async {
    final confirmed = await showConfirmDialog(
      context,
      title: 'Reverse selected collections?',
      message:
          'This will reverse ${_selected.length} transaction(s) totaling '
          '₹${_selectedTotal.toStringAsFixed(2)}. The client\'s dues will be '
          'restored so they can be recollected. This cannot be undone from this screen.',
      confirmLabel: 'Reverse',
    );
    if (!confirmed) return;

    final denomination = {
      for (final n in _noteValues)
        'd$n': int.tryParse(_noteControllers[n]!.text) ?? 0,
      'upi': double.tryParse(_upiController.text) ?? 0,
    };

    final success = await _controller.reverseTransactions(
      transactionIds: _selected.toList(),
      remarks: _remarksController.text.trim(),
      denomination: denomination,
    );

    if (success && mounted) {
      Navigator.pop(context, true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _pageBg,
      body: SafeArea(
        child: Obx(() {
          if (_controller.isLoading.value && _detail.isEmpty) {
            return const Center(child: CircularProgressIndicator(color: _green));
          }
          if (_detail.isEmpty) {
            return Center(
              child: Text(
                'Batch details unavailable.',
                style: TextStyle(fontSize: 12.sp, color: _muted),
              ),
            );
          }
          return SingleChildScrollView(
            physics: const BouncingScrollPhysics(),
            padding: EdgeInsets.fromLTRB(16.w, 12.h, 16.w, 24.h),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildHeader(),
                SizedBox(height: 16.h),
                _buildMeetingCard(),
                SizedBox(height: 16.h),
                _buildTransactionsCard(),
                SizedBox(height: 16.h),
                if (_denominationInitialized) _buildDenominationCard(),
                SizedBox(height: 16.h),
                _buildRemarksField(),
                SizedBox(height: 16.h),
                _buildSubmitButton(),
              ],
            ),
          );
        }),
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
            'Collection Batch Revert',
            style: TextStyle(fontSize: 18.sp, fontWeight: FontWeight.w800, color: _darkGreen),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }

  Widget _buildMeetingCard() {
    final center = _detail['center'] as Map? ?? {};
    final branch = _detail['branch'] as Map? ?? {};
    final photoUrl = "${_detail['photoUrl'] ?? ''}";
    return Container(
      padding: EdgeInsets.all(14.w),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14.r),
        border: Border.all(color: _border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(8.r),
            child: photoUrl.isEmpty
                ? Container(
                    width: 64.w,
                    height: 64.w,
                    color: _tableHeaderBg,
                    child: Icon(Icons.image_not_supported_outlined, color: _muted),
                  )
                : Image.network(
                    photoUrl,
                    width: 64.w,
                    height: 64.w,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => Container(
                      width: 64.w,
                      height: 64.w,
                      color: _tableHeaderBg,
                      child: Icon(Icons.broken_image_outlined, color: _muted),
                    ),
                  ),
          ),
          SizedBox(width: 12.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  "${center['name'] ?? '—'} (${center['code'] ?? '—'})",
                  style: TextStyle(fontSize: 13.sp, fontWeight: FontWeight.w800, color: _darkText),
                ),
                SizedBox(height: 2.h),
                Text(
                  "${branch['name'] ?? ''}",
                  style: TextStyle(fontSize: 11.sp, color: _muted),
                ),
                SizedBox(height: 2.h),
                Text(
                  _formatDate(_detail['collectionDate']),
                  style: TextStyle(fontSize: 11.sp, color: _muted),
                ),
                if (_detail['submittedBy'] != null)
                  Text(
                    'Submitted by ${_detail['submittedBy']}',
                    style: TextStyle(fontSize: 10.5.sp, color: _muted),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTransactionsCard() {
    final transactions = _transactions;
    final allSelectableSelected = transactions.isNotEmpty &&
        transactions.every(
          (t) => !_isSelectable(t as Map) || _selected.contains("${t['transactionId']}"),
        );

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
          Row(
            children: [
              Expanded(
                child: Text(
                  'Transactions',
                  style: TextStyle(fontSize: 14.5.sp, fontWeight: FontWeight.w800, color: _darkText),
                ),
              ),
              Checkbox(
                value: allSelectableSelected,
                onChanged: (v) => _toggleAll(v ?? false),
                activeColor: _green,
              ),
              Text('Select all', style: TextStyle(fontSize: 11.sp, color: _muted)),
            ],
          ),
          SizedBox(height: 8.h),
          ListView.separated(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: transactions.length,
            separatorBuilder: (_, __) => Divider(height: 1.h, color: _border),
            itemBuilder: (context, index) => _buildTransactionRow(transactions[index] as Map),
          ),
        ],
      ),
    );
  }

  Widget _buildTransactionRow(Map t) {
    final id = "${t['transactionId'] ?? ''}";
    final selectable = _isSelectable(t);
    final selected = _selected.contains(id);

    String badgeLabel;
    Color badgeColor;
    if (t['isReversed'] == true) {
      badgeLabel = 'Already reverted';
      badgeColor = _muted;
    } else if (t['isEodLocked'] == true) {
      badgeLabel = 'EOD locked';
      badgeColor = const Color(0xFFB45309);
    } else if (t['isSavingsRow'] == true) {
      badgeLabel = 'Loan advance';
      badgeColor = const Color(0xFFB45309);
    } else {
      badgeLabel = 'Revertible';
      badgeColor = _green;
    }

    return Opacity(
      opacity: selectable ? 1 : 0.55,
      child: Padding(
        padding: EdgeInsets.symmetric(vertical: 8.h),
        child: Row(
          children: [
            Checkbox(
              value: selected,
              onChanged: selectable ? (_) => _toggle(id) : null,
              activeColor: _green,
            ),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    "${t['clientName'] ?? ''} (${t['clientCode'] ?? ''})",
                    style: TextStyle(fontSize: 12.sp, fontWeight: FontWeight.w700, color: _darkText),
                  ),
                  Text(
                    'Loan ${t['loanNumber'] ?? '—'}',
                    style: TextStyle(fontSize: 10.5.sp, color: _muted),
                  ),
                  SizedBox(height: 2.h),
                  Container(
                    padding: EdgeInsets.symmetric(horizontal: 6.w, vertical: 2.h),
                    decoration: BoxDecoration(
                      color: badgeColor.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(6.r),
                    ),
                    child: Text(
                      badgeLabel,
                      style: TextStyle(fontSize: 9.sp, fontWeight: FontWeight.w700, color: badgeColor),
                    ),
                  ),
                ],
              ),
            ),
            Text(
              '₹${_amountOf(t).toStringAsFixed(2)}',
              style: TextStyle(fontSize: 12.sp, fontWeight: FontWeight.w700, color: _darkText),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDenominationCard() {
    final balanced = _isBalanced;
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
          Text(
            'Denomination (remaining after revert)',
            style: TextStyle(fontSize: 13.5.sp, fontWeight: FontWeight.w800, color: _darkText),
          ),
          SizedBox(height: 4.h),
          Text(
            'Auto-suggested — adjust if the actual cash breakdown differs.',
            style: TextStyle(fontSize: 10.5.sp, color: _muted),
          ),
          SizedBox(height: 12.h),
          Wrap(
            spacing: 8.w,
            runSpacing: 8.h,
            children: [
              for (final n in _noteValues) _buildNoteField(n),
              _buildUpiField(),
            ],
          ),
          SizedBox(height: 12.h),
          Row(
            children: [
              Expanded(
                child: _totalTile('Entered Total', _enteredTotal, _darkText),
              ),
              SizedBox(width: 8.w),
              Expanded(
                child: _totalTile(
                  'Must Equal',
                  _remainingRequired,
                  balanced ? _green : const Color(0xFFB91C1C),
                ),
              ),
            ],
          ),
          if (!balanced)
            Padding(
              padding: EdgeInsets.only(top: 8.h),
              child: Text(
                'Denomination does not match the remaining collection amount.',
                style: TextStyle(fontSize: 10.5.sp, color: const Color(0xFFB91C1C)),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildNoteField(int note) {
    return SizedBox(
      width: 90.w,
      child: TextField(
        controller: _noteControllers[note],
        keyboardType: TextInputType.number,
        decoration: InputDecoration(
          isDense: true,
          labelText: '₹$note',
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(6.r)),
          contentPadding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 8.h),
        ),
      ),
    );
  }

  Widget _buildUpiField() {
    return SizedBox(
      width: 110.w,
      child: TextField(
        controller: _upiController,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        decoration: InputDecoration(
          isDense: true,
          labelText: 'UPI',
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(6.r)),
          contentPadding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 8.h),
        ),
      ),
    );
  }

  Widget _totalTile(String label, double value, Color color) {
    return Container(
      padding: EdgeInsets.all(10.w),
      decoration: BoxDecoration(
        color: _tableHeaderBg,
        borderRadius: BorderRadius.circular(8.r),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: TextStyle(fontSize: 9.5.sp, color: _muted)),
          Text(
            '₹${value.toStringAsFixed(2)}',
            style: TextStyle(fontSize: 13.sp, fontWeight: FontWeight.w800, color: color),
          ),
        ],
      ),
    );
  }

  Widget _buildRemarksField() {
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
          Text(
            'Remarks (optional)',
            style: TextStyle(fontSize: 12.sp, fontWeight: FontWeight.w700, color: _darkText),
          ),
          SizedBox(height: 8.h),
          TextField(
            controller: _remarksController,
            maxLines: 3,
            decoration: InputDecoration(
              isDense: true,
              hintText: 'Reason for correction...',
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(8.r)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSubmitButton() {
    final canSubmit = _selected.isNotEmpty && _isBalanced;
    return Obx(
      () => SizedBox(
        width: double.infinity,
        child: ElevatedButton(
          onPressed: (canSubmit && !_controller.isLoading.value) ? _submit : null,
          style: ElevatedButton.styleFrom(
            backgroundColor: _green,
            padding: EdgeInsets.symmetric(vertical: 13.h),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8.r)),
          ),
          child: _controller.isLoading.value
              ? SizedBox(
                  width: 16.w,
                  height: 16.w,
                  child: const CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                )
              : Text(
                  'Reverse Selected (${_selected.length})',
                  style: TextStyle(fontSize: 13.sp, fontWeight: FontWeight.w700, color: Colors.white),
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
