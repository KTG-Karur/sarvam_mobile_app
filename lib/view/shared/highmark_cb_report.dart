import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:sarvam/services/api_client.dart';
import 'package:sarvam/services/enrollment_api_service.dart';
import 'package:sarvam/view/shared/crif_original_report_page.dart';

/// Mobile port of the web's Highmark (CRIF / SurepassCrif) CB report views:
/// `components/highmark/parse-report.ts` (parsing) and `CreditReportResult`
/// (the inline summary: accounts, loan accounts, inquiries). The full report is
/// CRIF's own original page, opened by [showHighmarkFullReport] in
/// `CrifOriginalReportPage`. View-only — like the web, BM/FDO can see the
/// report but never export it.

// ── Parsing (parse-report.ts) ─────────────────────────────────────────────

/// `report['reportJson']` as a map (Prisma Json may also arrive as a string).
Map<String, dynamic> cbReportJson(Map<String, dynamic> report) {
  final raw = report['reportJson'];
  if (raw is Map) return Map<String, dynamic>.from(raw);
  if (raw is String && raw.trim().isNotEmpty) {
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map) return Map<String, dynamic>.from(decoded);
    } catch (_) {}
  }
  return const {};
}

List<Map<String, dynamic>> _asMapList(dynamic v) {
  if (v == null) return const [];
  final list = v is List ? v : [v];
  return list
      .whereType<Map>()
      .map((m) => Map<String, dynamic>.from(m))
      .toList();
}

Map<String, dynamic> _map(dynamic v) =>
    v is Map ? Map<String, dynamic>.from(v) : const {};

String? _str(dynamic v) {
  if (v == null) return null;
  final s = v.toString().trim();
  return s.isEmpty ? null : s;
}

double cbAmount(dynamic value) {
  final s = _str(value);
  if (s == null) return 0;
  return double.tryParse(s.replaceAll(',', '')) ?? 0;
}

final _inr = NumberFormat.decimalPattern('en_IN');
String cbInr(num value) => _inr.format(value.round());

List<Map<String, dynamic>> cbLoans(Map<String, dynamic> json) =>
    _asMapList(_map(json['RESPONSES'])['RESPONSE'])
        .map((r) => _map(r['LOAN-DETAILS']))
        .where((l) => l.isNotEmpty)
        .toList();

List<Map<String, dynamic>> cbInquiries(Map<String, dynamic> json) =>
    _asMapList(_map(json['INQUIRY-HISTORY'])['HISTORY']);

class CbAccountSummary {
  const CbAccountSummary(
    this.accounts,
    this.active,
    this.overdue,
    this.currentBalance,
    this.disbursed,
  );
  final double accounts;
  final double active;
  final double overdue;
  final double currentBalance;
  final double disbursed;
}

CbAccountSummary cbAccountSummary(Map<String, dynamic> json) {
  final primary = _map(_map(json['ACCOUNTS-SUMMARY'])['PRIMARY-ACCOUNTS-SUMMARY']);
  final loans = cbLoans(json);
  if (primary.isNotEmpty) {
    final disbursed = cbAmount(primary['PRIMARY-DISBURSED-AMOUNT']);
    return CbAccountSummary(
      cbAmount(primary['PRIMARY-NUMBER-OF-ACCOUNTS']),
      cbAmount(primary['PRIMARY-ACTIVE-NUMBER-OF-ACCOUNTS']),
      cbAmount(primary['PRIMARY-OVERDUE-NUMBER-OF-ACCOUNTS']),
      cbAmount(primary['PRIMARY-CURRENT-BALANCE']),
      disbursed != 0
          ? disbursed
          : loans.fold(0.0, (s, l) => s + cbAmount(l['DISBURSED-AMT'])),
    );
  }
  final active = loans.where((l) => l['ACCOUNT-STATUS'] == 'Active');
  return CbAccountSummary(
    loans.length.toDouble(),
    active.length.toDouble(),
    loans.where((l) => cbAmount(l['OVERDUE-AMT']) > 0).length.toDouble(),
    active.fold(0.0, (s, l) => s + cbAmount(l['CURRENT-BAL'])),
    loans.fold(0.0, (s, l) => s + cbAmount(l['DISBURSED-AMT'])),
  );
}

enum CbLoanStatus { active, arrear, closed }

CbLoanStatus cbLoanStatus(Map<String, dynamic> loan) {
  if (loan['ACCOUNT-STATUS'] != 'Active') return CbLoanStatus.closed;
  return cbAmount(loan['OVERDUE-AMT']) > 0
      ? CbLoanStatus.arrear
      : CbLoanStatus.active;
}

// ── Shared styling ────────────────────────────────────────────────────────

const _green = Color(0xFF0D6842);
const _darkGreen = Color(0xFF073E23);
const _muted = Color(0xFF64748B);
const _border = Color(0xFFD2E9DB);

int cbScore(Map<String, dynamic> report) {
  final raw = report['creditScore'] ?? report['score'];
  return raw is num ? raw.toInt() : int.tryParse('$raw') ?? 0;
}

// ── Inline summary (CreditReportResult) ───────────────────────────────────

/// Accounts summary, loan accounts and recent inquiries from the CB report,
/// with a "Full View" button — shown under the score card.
class HighmarkCbSummary extends StatelessWidget {
  const HighmarkCbSummary({super.key, required this.report});

  final Map<String, dynamic> report;

  @override
  Widget build(BuildContext context) {
    final json = cbReportJson(report);
    final status = '${report['status'] ?? ''}';
    final error = status.toLowerCase() != 'completed'
        ? _str(json['error'])
        : null;
    final summary = cbAccountSummary(json);
    final derived = _map(_map(json['ACCOUNTS-SUMMARY'])['DERIVED-ATTRIBUTES']);
    final loans = cbLoans(json);
    final inquiries = cbInquiries(json);
    final hasPrimary =
        _map(_map(json['ACCOUNTS-SUMMARY'])['PRIMARY-ACCOUNTS-SUMMARY'])
            .isNotEmpty;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _metaLine(report),
        if (error != null) ...[
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: Colors.red.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: Colors.red.withValues(alpha: 0.3)),
            ),
            child: Text(error, style: const TextStyle(fontSize: 12, color: Colors.red)),
          ),
        ],
        if (json.isEmpty && error == null)
          const Padding(
            padding: EdgeInsets.only(top: 10),
            child: Text(
              'Detailed bureau data is not available for this report.',
              style: TextStyle(fontSize: 12, color: _muted),
            ),
          ),
        if (hasPrimary || loans.isNotEmpty) ...[
          const SizedBox(height: 12),
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            childAspectRatio: 2.6,
            mainAxisSpacing: 8,
            crossAxisSpacing: 8,
            children: [
              _stat('Total accounts', cbInr(summary.accounts)),
              _stat('Active accounts', cbInr(summary.active)),
              _stat('Overdue accounts', cbInr(summary.overdue),
                  alert: summary.overdue > 0),
              _stat('Inquiries (6mo)',
                  _str(derived['INQURIES-IN-LAST-SIX-MONTHS']) ?? '—'),
            ],
          ),
        ],
        if (loans.isNotEmpty) ...[
          const SizedBox(height: 14),
          _heading('Loan accounts (${loans.length})'),
          ...loans.map(_loanRow),
        ],
        if (inquiries.isNotEmpty) ...[
          const SizedBox(height: 14),
          _heading('Recent inquiries (${inquiries.length})'),
          ...inquiries.take(5).map(_inquiryRow),
          if (inquiries.length > 5)
            const Text(
              'More in the CRIF Original View',
              style: TextStyle(fontSize: 11, color: _muted),
            ),
        ],
        // Like the web's "CRIF Original View": offered for a Completed pull.
        if ('${report['status']}' == 'Completed' &&
            '${report['id'] ?? ''}'.isNotEmpty) ...[
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: () => showHighmarkFullReport(context, report),
            icon: const Icon(Icons.description_outlined, size: 16),
            label: const Text('CRIF Original View'),
            style: OutlinedButton.styleFrom(
              foregroundColor: _green,
              side: const BorderSide(color: _green),
            ),
          ),
        ],
      ],
    );
  }

  Widget _metaLine(Map<String, dynamic> report) {
    final reused = report['fromCache'] == true;
    final charged = cbAmount(report['creditsCharged']);
    final pulled = DateTime.tryParse('${report['pulledAt']}')?.toLocal();
    return Wrap(
      spacing: 8,
      runSpacing: 6,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(
            color: reused ? const Color(0xFFF1F5F9) : const Color(0xFFE6F5EC),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Text(
            reused
                ? 'Reused recent report — no charge'
                : 'Charged ₹${charged.toStringAsFixed(2)}',
            style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: _darkGreen),
          ),
        ),
        if (pulled != null)
          Text(
            'Pulled ${DateFormat('dd-MM-yyyy hh:mm a').format(pulled)}'
            '${_str(report['providerReference']) != null ? ' · ${report['providerReference']}' : ''}',
            style: const TextStyle(fontSize: 10.5, color: _muted),
          ),
      ],
    );
  }

  Widget _stat(String label, String value, {bool alert = false}) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
    decoration: BoxDecoration(
      color: const Color(0xFFF7FBF8),
      borderRadius: BorderRadius.circular(8),
      border: Border.all(color: _border),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Text(label.toUpperCase(),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 9.5, color: _muted, letterSpacing: .4)),
        Text(value,
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w800,
              color: alert ? Colors.red : _darkGreen,
            )),
      ],
    ),
  );

  Widget _loanRow(Map<String, dynamic> loan) {
    final status = cbLoanStatus(loan);
    final color = switch (status) {
      CbLoanStatus.active => Colors.green,
      CbLoanStatus.arrear => Colors.red,
      CbLoanStatus.closed => Colors.blueGrey,
    };
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withValues(alpha: 0.35)),
        color: color.withValues(alpha: 0.04),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  _str(loan['CREDIT-GUARANTOR']) ?? '—',
                  style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: _darkGreen),
                ),
              ),
              _badge(
                status == CbLoanStatus.arrear
                    ? 'OVERDUE'
                    : (_str(loan['ACCOUNT-STATUS']) ?? 'Unknown').toUpperCase(),
                color,
              ),
            ],
          ),
          const SizedBox(height: 2),
          Text(_str(loan['ACCT-TYPE']) ?? '—',
              style: const TextStyle(fontSize: 11, color: _muted)),
          const SizedBox(height: 6),
          Row(
            children: [
              Expanded(child: _kv('Disbursed', '₹${_str(loan['DISBURSED-AMT']) ?? '0'}')),
              Expanded(child: _kv('Current bal.', '₹${_str(loan['CURRENT-BAL']) ?? '0'}')),
              if (cbAmount(loan['OVERDUE-AMT']) > 0)
                Expanded(child: _kv('Overdue', '₹${loan['OVERDUE-AMT']}', alert: true)),
            ],
          ),
        ],
      ),
    );
  }

  Widget _inquiryRow(Map<String, dynamic> inq) => Padding(
    padding: const EdgeInsets.only(bottom: 6),
    child: Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(_str(inq['MEMBER-NAME']) ?? '—',
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: _darkGreen)),
              Text(
                '${_str(inq['PURPOSE']) ?? '—'} · ${_str(inq['INQUIRY-DATE']) ?? '—'}',
                style: const TextStyle(fontSize: 10.5, color: _muted),
              ),
            ],
          ),
        ),
        Text('₹${_str(inq['AMOUNT']) ?? '0'}',
            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: _darkGreen)),
      ],
    ),
  );
}

Widget _heading(String text) => Padding(
  padding: const EdgeInsets.only(bottom: 6),
  child: Text(
    text,
    style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: _darkGreen),
  ),
);

Widget _badge(String text, Color color) => Container(
  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
  decoration: BoxDecoration(
    color: color.withValues(alpha: 0.12),
    borderRadius: BorderRadius.circular(10),
  ),
  child: Text(text, style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w800, color: color)),
);

Widget _kv(String label, String value, {bool alert = false}) => Column(
  crossAxisAlignment: CrossAxisAlignment.start,
  children: [
    Text(label, style: const TextStyle(fontSize: 10, color: _muted)),
    Text(value,
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w700,
          color: alert ? Colors.red : _darkGreen,
        )),
  ],
);

// ── Full View ─────────────────────────────────────────────────────────────

/// Opens CRIF's original report for [report] — the same page the web's
/// "CRIF Original View" shows. (A pull without an original shows the web's
/// "No original CRIF report for this pull" message there.)
Future<void> showHighmarkFullReport(
  BuildContext context,
  Map<String, dynamic> report,
) {
  return Navigator.of(context).push(
    MaterialPageRoute(
      builder: (_) => CrifOriginalReportPage(
        api: EnrollmentApiService(ApiClient()),
        reportId: '${report['id']}',
      ),
    ),
  );
}
