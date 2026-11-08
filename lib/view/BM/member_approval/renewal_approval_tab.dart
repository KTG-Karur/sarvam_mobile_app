import 'dart:async';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import 'package:sarvam/controller/renewal_approval_controller.dart';
import 'package:sarvam/services/api_client.dart';
import 'package:sarvam/services/enrollment_api_service.dart';
import 'package:sarvam/view/FDO/client_loan_tracker/renewal_loan_detail.dart';
import 'package:sarvam/view/FDO/client_loan_tracker/renewal_status_labels.dart';
import 'package:sarvam/view/shared/highmark_report_sheet.dart';

/// Content of Member Approval's "Renewal Loan Approval" tab: the queue of
/// renewal loans waiting on the current user's approval stage, with a branch
/// filter and search. Tapping a renewal opens it for review.
class RenewalApprovalContent extends StatefulWidget {
  const RenewalApprovalContent({super.key, required this.controller});

  final RenewalApprovalController controller;

  @override
  State<RenewalApprovalContent> createState() => _RenewalApprovalContentState();
}

class _RenewalApprovalContentState extends State<RenewalApprovalContent> {
  static const _primaryGreen = Color(0xFF087B39);
  static const _darkGreen = Color(0xFF044826);
  static const _borderColor = Color(0xFFCBEADA);

  final _searchController = TextEditingController();
  final EnrollmentApiService _highmarkApi = EnrollmentApiService(ApiClient());
  Timer? _debounce;

  RenewalApprovalController get _c => widget.controller;

  @override
  void initState() {
    super.initState();
    _searchController.text = _c.search.value;
    // Opening the tab always shows fresh data.
    _c.load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  void _onSearchChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 500), () {
      _c.search.value = value.trim();
      _c.load();
    });
    setState(() {});
  }

  Future<void> _open(Map<String, dynamic> item) async {
    await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) =>
            RenewalLoanDetail(loanId: '${item['id']}', actionable: true),
      ),
    );
    // Whatever happened in there, show the queue as it is now.
    if (mounted) await _c.load(silent: true);
  }

  String _money(dynamic v) {
    final n = num.tryParse('${v ?? ''}');
    return n == null ? '—' : '₹${NumberFormat('#,##,##0', 'en_IN').format(n)}';
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      color: _primaryGreen,
      onRefresh: _c.load,
      child: ListView(
        key: const ValueKey('renewal_content'),
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 16),
        physics: const AlwaysScrollableScrollPhysics(
          parent: BouncingScrollPhysics(),
        ),
        children: [
          Text(
            'Renewal loan applications from Member Enrollment — review before '
            'Loan Indexation.',
            style: GoogleFonts.poppins(
              fontSize: 12,
              color: const Color(0xFF437A5A),
            ),
          ),
          const SizedBox(height: 14),
          _branchDropdown(),
          const SizedBox(height: 10),
          _searchField(),
          const SizedBox(height: 14),
          Obx(() {
            if (_c.isLoading.value && _c.items.isEmpty) {
              return const Padding(
                padding: EdgeInsets.symmetric(vertical: 48),
                child: Center(
                  child: CircularProgressIndicator(color: _primaryGreen),
                ),
              );
            }
            if (_c.items.isEmpty) return _empty();
            return Column(children: _c.items.map(_card).toList());
          }),
        ],
      ),
    );
  }

  Widget _branchDropdown() {
    return Obx(() {
      final branches = _c.branches;
      final ids = branches.map((b) => '${b['id']}').toSet();
      final current = ids.contains(_c.branchId.value) ? _c.branchId.value : '';
      return DropdownButtonFormField<String>(
        key: ValueKey('renewal-branch-$current-${branches.length}'),
        isExpanded: true,
        initialValue: current,
        decoration: _decoration(prefix: Icons.location_city),
        style: GoogleFonts.poppins(fontSize: 13, color: Colors.black87),
        items: [
          const DropdownMenuItem(value: '', child: Text('All Branches')),
          ...branches.map(
            (b) => DropdownMenuItem(
              value: '${b['id']}',
              child: Text(
                '${b['name']} (${b['code']}) — ${b['count']}',
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ),
        ],
        onChanged: (v) {
          if (v == null) return;
          _c.branchId.value = v;
          _c.load();
        },
      );
    });
  }

  Widget _searchField() {
    return TextField(
      controller: _searchController,
      onChanged: _onSearchChanged,
      style: GoogleFonts.poppins(fontSize: 13),
      decoration: _decoration(prefix: Icons.search).copyWith(
        hintText: 'Search by member, ID or loan number…',
        hintStyle: GoogleFonts.poppins(
          fontSize: 12.5,
          color: const Color(0xFF8FA88B),
        ),
        suffixIcon: _searchController.text.isEmpty
            ? null
            : IconButton(
                icon: const Icon(Icons.close, size: 18),
                onPressed: () {
                  _searchController.clear();
                  _onSearchChanged('');
                },
              ),
      ),
    );
  }

  InputDecoration _decoration({required IconData prefix}) => InputDecoration(
    isDense: true,
    filled: true,
    fillColor: Colors.white,
    prefixIcon: Icon(prefix, color: const Color(0xFF729A7D), size: 20),
    contentPadding: const EdgeInsets.symmetric(vertical: 13, horizontal: 12),
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(12),
      borderSide: const BorderSide(color: _borderColor, width: 1.5),
    ),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(12),
      borderSide: const BorderSide(color: _borderColor, width: 1.5),
    ),
  );

  Widget _empty() => Container(
    padding: const EdgeInsets.symmetric(vertical: 44, horizontal: 20),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: _borderColor),
    ),
    child: Column(
      children: [
        const Icon(Icons.autorenew_rounded, size: 34, color: Color(0xFF94A3B8)),
        const SizedBox(height: 10),
        Text(
          'No renewal loans pending',
          style: GoogleFonts.poppins(
            fontSize: 14.5,
            fontWeight: FontWeight.w700,
            color: _darkGreen,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          'Nothing awaiting your review at this stage.',
          textAlign: TextAlign.center,
          style: GoogleFonts.poppins(
            fontSize: 12,
            color: const Color(0xFF64748B),
          ),
        ),
      ],
    ),
  );

  Widget _card(Map<String, dynamic> it) {
    final name = '${it['clientName'] ?? ''}'.trim();
    final status = '${it['renewalApprovalStatus'] ?? ''}';
    final cfg = kRenewalStatusLabels[status];
    final color = cfg?.$2 ?? Colors.grey;
    final facts = <String>[
      '🧾 ${it['loanNumber'] ?? '—'}',
      _money(it['amount']),
      if ('${it['productName'] ?? ''}'.isNotEmpty) '${it['productName']}',
      if ('${it['centerName'] ?? ''}'.isNotEmpty) '🏠 ${it['centerName']}',
      '📄 ${it['kycDocCount'] ?? 0} docs',
      if ('${it['fdoName'] ?? ''}'.isNotEmpty) 'FDO: ${it['fdoName']}',
    ];

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _borderColor, width: 1.3),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0A043A20),
            blurRadius: 8,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () => _open(it),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    CircleAvatar(
                      radius: 21,
                      backgroundColor: const Color(0xFF0D9488),
                      child: Text(
                        name.isEmpty ? '?' : name[0].toUpperCase(),
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            name.isEmpty ? '${it['clientDisplayId']}' : name,
                            style: GoogleFonts.poppins(
                              fontSize: 14.5,
                              fontWeight: FontWeight.w700,
                              color: const Color(0xFF0F172A),
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          Text(
                            '${it['clientDisplayId'] ?? ''}',
                            style: GoogleFonts.poppins(
                              fontSize: 11.5,
                              fontWeight: FontWeight.w600,
                              color: _primaryGreen,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: color.shade50,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        (cfg?.$1 ?? status).toUpperCase(),
                        style: TextStyle(
                          color: color.shade700,
                          fontSize: 9.5,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Text(
                  facts.join('   '),
                  style: GoogleFonts.poppins(
                    fontSize: 11.5,
                    color: const Color(0xFF475569),
                    height: 1.5,
                  ),
                ),
                const SizedBox(height: 10),
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    OutlinedButton.icon(
                      onPressed: () {
                        final dbId = '${it['clientId'] ?? ''}';
                        if (dbId.isEmpty) return;
                        showHighmarkReport(
                          context,
                          api: _highmarkApi,
                          clientDbId: dbId,
                          clientName: name,
                        );
                      },
                      icon: const Icon(
                        Icons.shield_outlined,
                        size: 15,
                        color: Color(0xFF7C3AED),
                      ),
                      label: Text(
                        'Highmark',
                        style: GoogleFonts.poppins(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w600,
                          color: const Color(0xFF7C3AED),
                        ),
                      ),
                      style: OutlinedButton.styleFrom(
                        side: const BorderSide(color: Color(0xFFDDD6FE)),
                        padding: const EdgeInsets.symmetric(horizontal: 10),
                        minimumSize: const Size(0, 34),
                      ),
                    ),
                    const SizedBox(width: 8),
                    ElevatedButton.icon(
                      onPressed: () => _open(it),
                      icon: const Icon(Icons.chevron_right_rounded, size: 18),
                      label: Text(
                        'Review',
                        style: GoogleFonts.poppins(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: _primaryGreen,
                        foregroundColor: Colors.white,
                        elevation: 0,
                        minimumSize: const Size(0, 34),
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
