import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

/// Mobile port of the web's Highmark (CRIF / SurepassCrif) CB report views:
/// `components/highmark/parse-report.ts` (parsing), `CreditReportResult`
/// (inline summary: accounts, loan accounts, inquiries) and
/// `HighmarkFullReportDialog` (Full View). View-only — like the web, BM/FDO
/// can see the report but never export it.

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

List<Map<String, dynamic>> cbVariations(Map<String, dynamic> json, String key) {
  final block = _map(json['PERSONAL-INFO-VARIATION'])[key];
  if (block is! Map) return const [];
  return _asMapList(block['VARIATION']);
}

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

bool cbIsMicrofinance(String? type) =>
    type != null &&
    RegExp(r'jlg|micro\s*-?\s*finance|\bmfi\b', caseSensitive: false)
        .hasMatch(type);

class CbLoanTypeRow {
  CbLoanTypeRow(this.type);
  final String type;
  int accounts = 0;
  int overdue = 0;
  double currentBalance = 0;
  double disbursed = 0;
  double instlAmt = 0;
  double overdueAmt = 0;
}

/// Active accounts grouped by ACCT-TYPE, plus a Total row (last).
List<CbLoanTypeRow> cbActiveByType(List<Map<String, dynamic>> loans) {
  final byType = <String, CbLoanTypeRow>{};
  final total = CbLoanTypeRow('Total');
  for (final l in loans.where((l) => l['ACCOUNT-STATUS'] == 'Active')) {
    final type = _str(l['ACCT-TYPE']) ?? 'Other';
    final row = byType.putIfAbsent(type, () => CbLoanTypeRow(type));
    for (final r in [row, total]) {
      r.accounts += 1;
      final od = cbAmount(l['OVERDUE-AMT']);
      if (od > 0) r.overdue += 1;
      r.overdueAmt += od;
      r.currentBalance += cbAmount(l['CURRENT-BAL']);
      r.disbursed += cbAmount(l['DISBURSED-AMT']);
      r.instlAmt += cbAmount('${l['INSTALLMENT-AMT'] ?? ''}'.split('/').first);
    }
  }
  if (byType.isEmpty) return const [];
  return [...byType.values, total];
}

enum CbLoanStatus { active, arrear, closed }

CbLoanStatus cbLoanStatus(Map<String, dynamic> loan) {
  if (loan['ACCOUNT-STATUS'] != 'Active') return CbLoanStatus.closed;
  return cbAmount(loan['OVERDUE-AMT']) > 0
      ? CbLoanStatus.arrear
      : CbLoanStatus.active;
}

int _crifDate(dynamic raw) {
  final s = _str(raw);
  if (s == null) return 0;
  var m = RegExp(r'^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$').firstMatch(s);
  if (m != null) {
    return DateTime(int.parse(m[3]!), int.parse(m[2]!), int.parse(m[1]!))
        .millisecondsSinceEpoch;
  }
  m = RegExp(r'^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$').firstMatch(s);
  if (m != null) {
    return DateTime(int.parse(m[1]!), int.parse(m[2]!), int.parse(m[3]!))
        .millisecondsSinceEpoch;
  }
  return DateTime.tryParse(s)?.millisecondsSinceEpoch ?? 0;
}

/// Loans grouped by ACCT-TYPE (first-seen order); within a type Active, then
/// Arrear, then Closed — each most-recently-disbursed first.
List<MapEntry<String, List<Map<String, dynamic>>>> cbGroupLoans(
  List<Map<String, dynamic>> loans,
) {
  final byType = <String, List<Map<String, dynamic>>>{};
  for (final l in loans) {
    byType.putIfAbsent(_str(l['ACCT-TYPE']) ?? 'Other', () => []).add(l);
  }
  int byDate(Map<String, dynamic> a, Map<String, dynamic> b) =>
      _crifDate(b['DISBURSED-DT']).compareTo(_crifDate(a['DISBURSED-DT']));
  return byType.entries.map((e) {
    List<Map<String, dynamic>> of(CbLoanStatus s) =>
        e.value.where((l) => cbLoanStatus(l) == s).toList()..sort(byDate);
    return MapEntry(e.key, [
      ...of(CbLoanStatus.active),
      ...of(CbLoanStatus.arrear),
      ...of(CbLoanStatus.closed),
    ]);
  }).toList();
}

/// "Jun:2026,000/XXX|May:2026,000/XXX|..." -> (label, value), newest first.
List<(String, String)> cbPaymentHistory(dynamic raw) {
  final s = _str(raw);
  if (s == null) return const [];
  return s.split('|').where((e) => e.isNotEmpty).map((entry) {
    final parts = entry.split(',');
    final my = parts.first.split(':');
    final label = '${my.first} ${my.length > 1 ? my[1] : ''}'.trim();
    return (label, parts.length > 1 ? parts[1] : '');
  }).toList();
}

// ── Shared styling ────────────────────────────────────────────────────────

const _green = Color(0xFF0D6842);
const _darkGreen = Color(0xFF073E23);
const _muted = Color(0xFF64748B);
const _border = Color(0xFFD2E9DB);

Color cbScoreColor(int score) {
  if (score <= 0) return Colors.blueGrey;
  if (score < 550) return Colors.red;
  if (score < 650) return Colors.amber.shade800;
  return Colors.green;
}

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
              'More in Full View',
              style: TextStyle(fontSize: 11, color: _muted),
            ),
        ],
        if (json.isNotEmpty) ...[
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: () => showHighmarkFullReport(context, report),
            icon: const Icon(Icons.open_in_full, size: 16),
            label: const Text('Full View'),
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

// ── Full View (HighmarkFullReportDialog) ──────────────────────────────────

Future<void> showHighmarkFullReport(
  BuildContext context,
  Map<String, dynamic> report,
) {
  return Navigator.of(context).push(
    MaterialPageRoute(builder: (_) => HighmarkFullReportPage(report: report)),
  );
}

class HighmarkFullReportPage extends StatelessWidget {
  const HighmarkFullReportPage({super.key, required this.report});

  final Map<String, dynamic> report;

  @override
  Widget build(BuildContext context) {
    final json = cbReportJson(report);
    final name = '${report['firstName'] ?? ''} ${report['lastName'] ?? ''}'.trim();
    final header = _map(json['HEADER']);
    final summary = cbAccountSummary(json);
    final derived = _map(_map(json['ACCOUNTS-SUMMARY'])['DERIVED-ATTRIBUTES']);
    final loans = cbLoans(json);
    final micro = cbActiveByType(
      loans.where((l) => cbIsMicrofinance(_str(l['ACCT-TYPE']))).toList(),
    );
    final others = cbActiveByType(
      loans.where((l) => !cbIsMicrofinance(_str(l['ACCT-TYPE']))).toList(),
    );
    final microGroups = cbGroupLoans(
      loans.where((l) => cbIsMicrofinance(_str(l['ACCT-TYPE']))).toList(),
    );
    final otherGroups = cbGroupLoans(
      loans.where((l) => !cbIsMicrofinance(_str(l['ACCT-TYPE']))).toList(),
    );
    final nameVars = cbVariations(json, 'NAME-VARIATIONS');
    final addrVars = cbVariations(json, 'ADDRESS-VARIATIONS');
    final dobVars = cbVariations(json, 'DATE-OF-BIRTH-VARIATIONS');
    final phoneVars = cbVariations(json, 'PHONE-NUMBER-VARIATIONS');
    final ids = <String>[
      for (final (label, key) in const [
        ('Voter ID', 'VOTER-ID-VARIATIONS'),
        ('PAN', 'PAN-VARIATIONS'),
        ('Ration Card', 'RATION-CARD-VARIATIONS'),
        ('UID', 'UID-VARIATIONS'),
      ])
        if (cbVariations(json, key).isNotEmpty)
          '${cbVariations(json, key).first['VALUE']} [$label]',
    ];
    final inquiries = cbInquiries(json);
    final score = _map(_map(json['SCORES'])['SCORE']);
    final factors = '${score['SCORE-FACTORS'] ?? ''}'
        .split('|')
        .where((f) => f.isNotEmpty)
        .toList();
    var loanNo = 0;

    return Scaffold(
      backgroundColor: const Color(0xFFF5FBF7),
      appBar: AppBar(
        backgroundColor: _green,
        foregroundColor: Colors.white,
        title: Text(
          name.isEmpty ? 'Highmark Credit Report' : 'CB Report — $name',
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
        ),
      ),
      body: json.isEmpty
          ? const Center(
              child: Text('Detailed bureau data is not available.',
                  style: TextStyle(color: _muted)),
            )
          : ListView(
              padding: const EdgeInsets.all(12),
              children: [
                _section('Report', [
                  _field('CHM Ref #', _str(report['providerReference'])),
                  _field('Date of Request', _str(header['DATE-OF-REQUEST'])),
                  _field('Date of Issue', _str(header['DATE-OF-ISSUE'])),
                  _field('Status', _str(report['status'])),
                ]),
                _section('Account Summary', [
                  const Text(
                    'Current Balance & Disbursed Amount is considered ONLY for ACTIVE accounts.',
                    style: TextStyle(fontSize: 10.5, color: _muted),
                  ),
                  const SizedBox(height: 8),
                  _field('Number of Account(s)', cbInr(summary.accounts)),
                  _field('Active Account(s)', cbInr(summary.active)),
                  _field('Overdue Account(s)', cbInr(summary.overdue)),
                  _field('Current Balance', '₹${cbInr(summary.currentBalance)}'),
                  _field('Amt Disbd/High Credit', '₹${cbInr(summary.disbursed)}'),
                  const Divider(),
                  _field('Inquiries in last 6 Months',
                      _str(derived['INQURIES-IN-LAST-SIX-MONTHS'])),
                  _field('New Account(s) in last 6 Months',
                      _str(derived['NEW-ACCOUNTS-IN-LAST-SIX-MONTHS'])),
                  _field('New Delinquent Account(s) in last 6 Months',
                      _str(derived['NEW-DELINQ-ACCOUNT-IN-LAST-SIX-MONTHS'])),
                  if (micro.isNotEmpty)
                    _typeTable('Active Accounts by Loan Type — JLG Individual & Micro Finance', micro),
                  if (others.isNotEmpty)
                    _typeTable('Active Accounts by Loan Type — Others', others),
                ]),
                _section('Inquiry Input Information', [
                  _field('Name', name),
                  _field('Phone Numbers',
                      phoneVars.isNotEmpty
                          ? phoneVars.map((v) => v['VALUE']).join(', ')
                          : _str(report['phone'])),
                  _field('ID(s)', ids.join(', ')),
                  _field('DOB', dobVars.isNotEmpty ? _str(dobVars.first['VALUE']) : null),
                  _field('Current Address', addrVars.isNotEmpty ? _str(addrVars.first['VALUE']) : null),
                  _field('Other Address', addrVars.length > 1 ? _str(addrVars[1]['VALUE']) : null),
                ]),
                if (score.isNotEmpty)
                  _section('CRIF HM Score(S)', [
                    Text('${score['SCORE-TYPE'] ?? ''}'.toUpperCase(),
                        style: const TextStyle(fontSize: 10.5, color: _muted)),
                    Text(
                      '${score['SCORE-VALUE'] ?? '—'}',
                      style: TextStyle(
                        fontSize: 34,
                        fontWeight: FontWeight.w900,
                        color: cbScoreColor(cbAmount(score['SCORE-VALUE']).toInt()),
                      ),
                    ),
                    const Text('Score Range: 300-900',
                        style: TextStyle(fontSize: 10.5, color: _muted)),
                    if (factors.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 6,
                        runSpacing: 6,
                        children: factors.map((f) => _badge(f, _green)).toList(),
                      ),
                    ],
                  ]),
                if (nameVars.isNotEmpty || addrVars.isNotEmpty)
                  _section('Personal Information - Variations', [
                    const Text(
                      "Applicant's personal information variations as contributed by various financial institutions.",
                      style: TextStyle(fontSize: 10.5, color: _muted),
                    ),
                    _variations('Name Variations', nameVars),
                    _variations('DOB Variations', dobVars),
                    _variations('Phone Variations', phoneVars),
                    _variations('Address Variations', addrVars),
                  ]),
                if (loans.isNotEmpty)
                  _section('Account Information (${loans.length})', [
                    if (microGroups.isNotEmpty) ...[
                      _band('JLG Individual & Micro Finance Accounts'),
                      for (final g in microGroups) ...[
                        _typeTag(g.key),
                        for (final l in g.value) _loanCard(++loanNo, l),
                      ],
                    ],
                    if (otherGroups.isNotEmpty) ...[
                      _band('Other Loan Accounts'),
                      for (final g in otherGroups) ...[
                        _typeTag(g.key),
                        for (final l in g.value) _loanCard(++loanNo, l),
                      ],
                    ],
                  ]),
                if (inquiries.isNotEmpty)
                  _section('Inquiries (reported for past 24 months)', [
                    for (final inq in inquiries)
                      Container(
                        margin: const EdgeInsets.only(bottom: 6),
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: _border),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _field('Credit Grantor', _str(inq['MEMBER-NAME'])),
                            _field('Date of Inquiry', _str(inq['INQUIRY-DATE'])),
                            _field('Purpose', _str(inq['PURPOSE'])),
                            _field('Amount', _str(inq['AMOUNT'])),
                            _field('Remark', _str(inq['REMARK'])),
                          ],
                        ),
                      ),
                  ]),
              ],
            ),
    );
  }

  Widget _section(String title, List<Widget> children) => Container(
    margin: const EdgeInsets.only(bottom: 12),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(10),
      border: Border.all(color: _border),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: const BoxDecoration(
            color: Color(0xFF0A4D2E),
            borderRadius: BorderRadius.vertical(top: Radius.circular(10)),
          ),
          child: Text(title,
              style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w700)),
        ),
        Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: children,
          ),
        ),
      ],
    ),
  );

  Widget _field(String label, String? value, {bool alert = false}) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 2.5),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 135,
          child: Text(label, style: const TextStyle(fontSize: 11.5, color: _muted)),
        ),
        Expanded(
          child: Text(
            (value == null || value.isEmpty) ? '—' : value,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: alert ? Colors.red : _darkGreen,
            ),
          ),
        ),
      ],
    ),
  );

  Widget _typeTable(String title, List<CbLoanTypeRow> rows) => Padding(
    padding: const EdgeInsets.only(top: 12),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: _darkGreen)),
        const SizedBox(height: 6),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: DataTable(
            headingRowHeight: 34,
            dataRowMinHeight: 30,
            dataRowMaxHeight: 36,
            columnSpacing: 16,
            headingTextStyle: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: _darkGreen),
            dataTextStyle: const TextStyle(fontSize: 11, color: _darkGreen),
            columns: const [
              DataColumn(label: Text('Account Type')),
              DataColumn(label: Text('Accounts'), numeric: true),
              DataColumn(label: Text('Overdue'), numeric: true),
              DataColumn(label: Text('Current Bal'), numeric: true),
              DataColumn(label: Text('Disbd/High Credit'), numeric: true),
              DataColumn(label: Text('InstlAmt'), numeric: true),
              DataColumn(label: Text('Overdue Amt'), numeric: true),
            ],
            rows: rows.map((r) {
              final isTotal = r.type == 'Total';
              TextStyle? s = isTotal ? const TextStyle(fontWeight: FontWeight.w800) : null;
              return DataRow(
                color: isTotal ? WidgetStatePropertyAll(Colors.grey.shade100) : null,
                cells: [
                  DataCell(Text(r.type, style: s)),
                  DataCell(Text('${r.accounts}', style: s)),
                  DataCell(Text('${r.overdue}', style: s)),
                  DataCell(Text(cbInr(r.currentBalance), style: s)),
                  DataCell(Text(cbInr(r.disbursed), style: s)),
                  DataCell(Text(cbInr(r.instlAmt), style: s)),
                  DataCell(Text(cbInr(r.overdueAmt), style: s)),
                ],
              );
            }).toList(),
          ),
        ),
      ],
    ),
  );

  Widget _variations(String title, List<Map<String, dynamic>> rows) {
    if (rows.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title.toUpperCase(),
              style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: _green)),
          ...rows.map(
            (r) => Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(child: Text('${r['VALUE'] ?? '—'}', style: const TextStyle(fontSize: 11.5))),
                  const SizedBox(width: 8),
                  Text('${r['REPORTED-DATE'] ?? ''}',
                      style: const TextStyle(fontSize: 10.5, color: _muted)),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _band(String text) => Container(
    margin: const EdgeInsets.only(top: 4, bottom: 8),
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
    decoration: BoxDecoration(color: _green, borderRadius: BorderRadius.circular(6)),
    child: Text(text.toUpperCase(),
        style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w700)),
  );

  Widget _typeTag(String text) => Container(
    margin: const EdgeInsets.only(bottom: 8),
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
    decoration: BoxDecoration(
      color: const Color(0xFFFEF3C7),
      border: const Border(left: BorderSide(color: Color(0xFFF59E0B), width: 4)),
      borderRadius: BorderRadius.circular(4),
    ),
    child: Text(text.toUpperCase(),
        style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: Color(0xFF78350F))),
  );

  Widget _loanCard(int index, Map<String, dynamic> loan) {
    final status = cbLoanStatus(loan);
    final (border, bg, label) = switch (status) {
      CbLoanStatus.active => (const Color(0xFF6EE7B7), const Color(0xFFECFDF5),
          (_str(loan['ACCOUNT-STATUS']) ?? 'ACTIVE').toUpperCase()),
      CbLoanStatus.arrear => (Colors.red, const Color(0xFFFEE2E2), 'ARREAR / OVERDUE'),
      CbLoanStatus.closed => (const Color(0xFFE2E8F0), const Color(0xFFF8FAFC),
          (_str(loan['ACCOUNT-STATUS']) ?? 'CLOSED').toUpperCase()),
    };
    final history = cbPaymentHistory(loan['COMBINED-PAYMENT-HISTORY']).take(12).toList();
    final creditLimit = cbAmount(loan['CREDIT-LIMIT']);

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            decoration: BoxDecoration(
              color: bg,
              borderRadius: const BorderRadius.vertical(top: Radius.circular(8)),
            ),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 11,
                  backgroundColor: _green,
                  child: Text('$index',
                      style: const TextStyle(fontSize: 10, color: Colors.white, fontWeight: FontWeight.w700)),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(_str(loan['ACCT-TYPE']) ?? '—',
                          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                      Text(_str(loan['CREDIT-GUARANTOR']) ?? '',
                          style: const TextStyle(fontSize: 10.5, color: _muted)),
                    ],
                  ),
                ),
                _badge(label, status == CbLoanStatus.arrear ? Colors.red : _darkGreen),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(10),
            child: Column(
              children: [
                _field('Account #', _str(loan['ACCT-NUMBER'])),
                _field('Ownership', _str(loan['OWNERSHIP-IND'])),
                _field('Credit Limit', creditLimit > 0 ? cbInr(creditLimit) : null),
                _field('InstlAmt/Freq', _str(loan['INSTALLMENT-AMT'])),
                _field('Disbursed Date', _str(loan['DISBURSED-DT'])),
                _field('Last Payment Date', _str(loan['LAST-PAYMENT-DATE'])),
                _field('Closed Date', _str(loan['CLOSED-DATE'])),
                _field('Tenure', _str(loan['REPAYMENT-TENURE'])),
                _field('Disbd Amt/High Credit', _str(loan['DISBURSED-AMT'])),
                _field('Current Balance', _str(loan['CURRENT-BAL'])),
                _field('Overdue Amt', _str(loan['OVERDUE-AMT']),
                    alert: cbAmount(loan['OVERDUE-AMT']) > 0),
                _field('DPD', _str(loan['DPD'])),
                _field('Interest Rate', _str(loan['INTEREST-RATE'])),
                _field('Total Writeoff Amt', _str(loan['WRITE-OFF-AMT'])),
                _field('Settlement Amt', _str(loan['SETTLEMENT-AMT'])),
                _field('Last Paid Amt', _str(loan['LAST-PAID-AMOUNT'])),
              ],
            ),
          ),
          if (history.isNotEmpty)
            Container(
              padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
              decoration: BoxDecoration(border: Border(top: BorderSide(color: border))),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Payment History / Asset Classification (most recent first)',
                      style: TextStyle(fontSize: 10.5, color: _muted)),
                  const SizedBox(height: 6),
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: history
                          .map(
                            (h) => Container(
                              margin: const EdgeInsets.only(right: 4),
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(4),
                                border: Border.all(color: const Color(0xFFE2E8F0)),
                              ),
                              child: Column(
                                children: [
                                  Text(h.$1, style: const TextStyle(fontSize: 9.5, color: _muted)),
                                  Text(h.$2,
                                      style: const TextStyle(fontSize: 10, fontFamily: 'monospace')),
                                ],
                              ),
                            ),
                          )
                          .toList(),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
