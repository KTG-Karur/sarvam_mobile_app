import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:intl/intl.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/controller/member_approval_controller.dart';
import 'package:sarvam/services/api_client.dart';
import 'package:sarvam/view/BM/member_approval/widgets/doc_type_labels.dart';
import 'package:sarvam/view/BM/member_approval/widgets/signed_doc_thumbnail.dart';
import 'package:sarvam/view/FDO/client_loan_tracker/renewal_status_labels.dart';

/// Read-only detail of one renewal loan application, opened from the tracker's
/// Renewal Loan tab. Mirrors the web's `RenewalLoanDetail` in read-only mode
/// (`/loans/renewal-application?loanId=`): the member, the loan being renewed,
/// the co-applicant, the images uploaded for this renewal with each stage's
/// decision, and the approval trail with every stage's remarks. Nothing here
/// can be approved, changed or re-uploaded.
class RenewalLoanDetail extends StatefulWidget {
  const RenewalLoanDetail({super.key, required this.loanId});

  final String loanId;

  @override
  State<RenewalLoanDetail> createState() => _RenewalLoanDetailState();
}

class _RenewalLoanDetailState extends State<RenewalLoanDetail> {
  static const _green = Color(0xFF0C5F34);
  static const _ink = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);

  final ApiClient _api = ApiClient();
  // Only used to turn private-bucket file keys into viewable image URLs.
  late final MemberApprovalController _urls =
      Get.isRegistered<MemberApprovalController>()
      ? Get.find<MemberApprovalController>()
      : Get.put(MemberApprovalController());

  bool _loading = true;
  String? _error;
  Map<String, dynamic> _loan = {};
  Map<String, dynamic>? _coApplicant;
  String? _coApplicantMode;
  Map<String, dynamic> _workflow = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Map<String, dynamic> _map(dynamic v) =>
      v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};

  List<Map<String, dynamic>> _list(dynamic v) => v is List
      ? v.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
      : <Map<String, dynamic>>[];

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final url =
          '${Api.baseUrl}/api/loans/renewal-application'
          '?loanId=${Uri.encodeQueryComponent(widget.loanId)}';
      final response = await _api.get(url);
      final body = response.body;
      if (body is Map && body['success'] == true && body['data'] is Map) {
        final data = Map<String, dynamic>.from(body['data'] as Map);
        if (!mounted) return;
        setState(() {
          _loan = _map(data['loan']);
          _coApplicant = data['coApplicant'] is Map
              ? _map(data['coApplicant'])
              : null;
          _coApplicantMode = data['coApplicantMode']?.toString();
          _workflow = _map(data['workflow']);
        });
      } else {
        final message = body is Map
            ? (body['message'] ?? body['error'])?.toString()
            : null;
        if (mounted) {
          setState(() => _error = message ?? 'Could not load this renewal.');
        }
      }
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not load this renewal.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  // ── formatting helpers ─────────────────────────────────────────────────

  String _s(dynamic v, [String fallback = '—']) {
    final t = v?.toString().trim();
    return t == null || t.isEmpty || t == 'null' ? fallback : t;
  }

  String _money(dynamic v) {
    final n = num.tryParse('${v ?? ''}');
    return n == null ? '—' : '₹${NumberFormat('#,##,##0', 'en_IN').format(n)}';
  }

  String _dateTime(dynamic v) {
    final d = DateTime.tryParse('${v ?? ''}')?.toLocal();
    return d == null ? '—' : DateFormat('dd MMM yyyy, hh:mm a').format(d);
  }

  String _person(dynamic user) {
    final u = _map(user);
    final name = '${u['firstName'] ?? ''} ${u['lastName'] ?? ''}'.trim();
    final emp = _s(u['employeeId'], '');
    if (name.isEmpty) return '';
    return emp.isEmpty ? name : '$name ($emp)';
  }

  // ── building blocks ────────────────────────────────────────────────────

  Widget _card({required String title, IconData? icon, required Widget child}) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (icon != null) ...[
                Icon(icon, size: 16, color: _green),
                const SizedBox(width: 6),
              ],
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: _ink,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          child,
        ],
      ),
    );
  }

  Widget _kv(String label, String value) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 112,
          child: Text(
            label,
            style: const TextStyle(fontSize: 12, color: _muted),
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: const TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w600,
              color: _ink,
            ),
          ),
        ),
      ],
    ),
  );

  Widget _pill(String text, Color color, Color bg) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(
      color: bg,
      borderRadius: BorderRadius.circular(6),
    ),
    child: Text(
      text,
      style: TextStyle(
        color: color,
        fontSize: 10.5,
        fontWeight: FontWeight.bold,
      ),
    ),
  );

  // ── sections ───────────────────────────────────────────────────────────

  Widget _memberCard() {
    final client = _map(_loan['client']);
    final center = _map(_loan['center']);
    // The renewal may propose a new address; otherwise it's the member's own.
    final proposed = _map(_map(_loan['renewalProposedData'])['address']);
    final addr = proposed.values.any((v) => _s(v, '').isNotEmpty)
        ? proposed
        : client;
    final address = [
      addr['permanentAddress'],
      addr['postOffice'],
      addr['district'],
      addr['state'],
      addr['pincode'],
      addr['country'],
    ].map((v) => _s(v, '')).where((v) => v.isNotEmpty).join(', ');

    final name = '${client['firstName'] ?? ''} ${client['lastName'] ?? ''}'
        .trim();
    return _card(
      title: 'Member',
      icon: Icons.person_outline_rounded,
      child: Column(
        children: [
          _kv('Name', _s(name)),
          _kv('Client ID', _s(client['clientId'])),
          _kv(
            'Center',
            center.isEmpty
                ? '—'
                : '${_s(center['code'], '')} - ${_s(center['name'], '')}',
          ),
          _kv('Address', address.isEmpty ? '—' : address),
        ],
      ),
    );
  }

  Widget _loanCard() {
    final purpose = _map(_loan['loanPurpose']);
    final purposeType = _map(purpose['loanPurposeType']);
    final purposeText = purpose.isEmpty
        ? '—'
        : [
            _s(purposeType['name'], ''),
            _s(purpose['name'], ''),
          ].where((e) => e.isNotEmpty).join(' · ');
    return _card(
      title: 'Loan being renewed',
      icon: Icons.account_balance_wallet_outlined,
      child: Column(
        children: [
          _kv('Loan number', _s(_loan['loanNumber'])),
          _kv('Product', _s(_map(_loan['loanProduct'])['productName'])),
          _kv('Amount', _money(_loan['amount'])),
          _kv(
            'Interest rate',
            _loan['interestRate'] == null ? '—' : '${_loan['interestRate']}%',
          ),
          _kv(
            'Tenure',
            _loan['tenureMonths'] == null
                ? '—'
                : '${_loan['tenureMonths']} months',
          ),
          _kv('Frequency', _s(_loan['frequency'])),
          _kv('Purpose', purposeText.isEmpty ? '—' : purposeText),
        ],
      ),
    );
  }

  Widget _coApplicantCard() {
    final co = _coApplicant;
    final mode = _coApplicantMode == 'new'
        ? 'New — needs review'
        : _coApplicantMode == 'existing'
        ? 'Existing'
        : null;
    return _card(
      title: mode == null ? 'Co-Applicant' : 'Co-Applicant ($mode)',
      icon: Icons.group_add_outlined,
      child: co == null || co.isEmpty
          ? const Text(
              'No co-applicant on this application.',
              style: TextStyle(fontSize: 12, color: _muted),
            )
          : Column(
              children: [
                _kv('Name', _s(co['name'])),
                _kv('Relation', _s(co['relationWithClient'])),
                _kv('Mobile', _s(co['mobileNumber'])),
                _kv('Status', _s(co['status'])),
              ],
            ),
    );
  }

  Color _decisionColor(String d) {
    switch (d) {
      case 'VERIFIED':
        return Colors.green.shade700;
      case 'RETAKE_REQUIRED':
        return Colors.orange.shade800;
      default:
        return _muted;
    }
  }

  String _decisionLabel(String d) {
    switch (d) {
      case 'VERIFIED':
        return 'Approved';
      case 'RETAKE_REQUIRED':
        return 'Retake';
      case 'PENDING':
        return 'Pending';
      default:
        return d.replaceAll('_', ' ');
    }
  }

  Widget _docTile(Map<String, dynamic> doc) {
    final type = _s(doc['documentType'], '');
    final fileName = _s(doc['fileName'], '').toLowerCase();
    final stages = _list(doc['stageDecisions']);
    final retakeReason = _s(doc['retakeReason'], '');
    final forCo = _s(doc['coApplicantId'], '').isNotEmpty;

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SignedDocThumbnail(
            controller: _urls,
            fileKey: _s(doc['fileUrl'], ''),
            label: kycDocTypeLabel(type),
            mimeType: fileName.endsWith('.pdf') ? 'application/pdf' : null,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  forCo ? 'Co-applicant document' : 'Member document',
                  style: const TextStyle(fontSize: 11, color: _muted),
                ),
                const SizedBox(height: 6),
                if (stages.isEmpty)
                  const Text(
                    'No stage has reviewed this yet.',
                    style: TextStyle(fontSize: 11.5, color: _muted),
                  ),
                for (final st in stages)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 5),
                    child: _stageDecisionRow(st),
                  ),
                if (retakeReason.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      '⟳ $retakeReason',
                      style: TextStyle(
                        fontSize: 11.5,
                        color: Colors.orange.shade800,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _stageDecisionRow(Map<String, dynamic> st) {
    final decision = _s(st['decision'], 'PENDING');
    final reviewer = _person(st['reviewer']);
    final remark = _s(st['remark'], '');
    final when = _s(st['reviewedAt'], '').isEmpty
        ? ''
        : _dateTime(st['reviewedAt']);
    final detail = [
      if (reviewer.isNotEmpty) 'by $reviewer',
      if (when.isNotEmpty) when,
    ].join(' · ');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Flexible(
              child: Text(
                _s(st['stageName']),
                style: const TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w700,
                  color: _ink,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(width: 6),
            Text(
              _decisionLabel(decision),
              style: TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w700,
                color: _decisionColor(decision),
              ),
            ),
          ],
        ),
        if (detail.isNotEmpty)
          Text(detail, style: const TextStyle(fontSize: 10.5, color: _muted)),
        if (remark.isNotEmpty)
          Text(
            '"$remark"',
            style: const TextStyle(
              fontSize: 11,
              fontStyle: FontStyle.italic,
              color: _muted,
            ),
          ),
      ],
    );
  }

  Widget _docsCard(List<Map<String, dynamic>> docs) {
    return _card(
      title: 'Uploaded for this renewal',
      icon: Icons.photo_library_outlined,
      child: docs.isEmpty
          ? const Text(
              'Nothing re-uploaded for this renewal.',
              style: TextStyle(fontSize: 12, color: _muted),
            )
          : Column(children: docs.map(_docTile).toList()),
    );
  }

  Map<String, dynamic> _stateOf(dynamic raw) {
    final text = raw?.toString();
    if (text == null || text.isEmpty) return {};
    try {
      final decoded = jsonDecode(text);
      return decoded is Map ? Map<String, dynamic>.from(decoded) : {};
    } catch (_) {
      return {};
    }
  }

  Widget _trailCard(
    List<Map<String, dynamic>> history,
    Map<String, String> docTypeById,
  ) {
    // The API returns newest first; a trail reads oldest first.
    final entries = history.reversed.toList();
    return _card(
      title: 'Approval trail & remarks',
      icon: Icons.timeline_rounded,
      child: entries.isEmpty
          ? const Text(
              'No activity yet.',
              style: TextStyle(fontSize: 12, color: _muted),
            )
          : Column(
              children: [
                for (var i = 0; i < entries.length; i++)
                  _trailRow(
                    entries[i],
                    docTypeById,
                    isLast: i == entries.length - 1,
                  ),
              ],
            ),
    );
  }

  Widget _trailRow(
    Map<String, dynamic> h,
    Map<String, String> docTypeById, {
    required bool isLast,
  }) {
    final action = _s(h['action'], '');
    final label =
        kRenewalActionLabels[action] ??
        action
            .replaceAll('_', ' ')
            .toLowerCase()
            .replaceAllMapped(
              RegExp(r'\b\w'),
              (m) => m.group(0)!.toUpperCase(),
            );
    final state = _stateOf(h['newState']);
    final docId = state['documentId']?.toString();
    final docType = docId == null ? null : docTypeById[docId];
    final stageName = _s(_map(state['stage'])['stageName'], '');
    final who = _person(h['performedBy']);
    final remark = _s(h['remarks'], '');
    final isBad = action.contains('REJECT') || action.contains('RETAKE');

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Column(
            children: [
              Container(
                width: 10,
                height: 10,
                margin: const EdgeInsets.only(top: 4),
                decoration: BoxDecoration(
                  color: isBad ? Colors.red.shade400 : _green,
                  shape: BoxShape.circle,
                ),
              ),
              if (!isLast)
                Expanded(
                  child: Container(width: 2, color: const Color(0xFFE2E8F0)),
                ),
            ],
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    [
                      if (stageName.isNotEmpty) stageName,
                      label,
                      if (docType != null) '· ${kycDocTypeLabel(docType)}',
                    ].join(' '),
                    style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700,
                      color: isBad ? Colors.red.shade800 : _ink,
                    ),
                  ),
                  Text(
                    [
                      if (who.isNotEmpty) who,
                      _dateTime(h['createdAt']),
                    ].join(' · '),
                    style: const TextStyle(fontSize: 10.5, color: _muted),
                  ),
                  if (remark.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 3),
                      child: Text(
                        '"$remark"',
                        style: const TextStyle(
                          fontSize: 11.5,
                          fontStyle: FontStyle.italic,
                          color: Color(0xFF475569),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _body() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator(color: _green));
    }
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(_error!, textAlign: TextAlign.center),
              const SizedBox(height: 12),
              OutlinedButton(onPressed: _load, child: const Text('Retry')),
            ],
          ),
        ),
      );
    }

    final status = _s(_loan['renewalApprovalStatus'], '');
    final cfg = kRenewalStatusLabels[status];
    final color = (cfg?.$2 ?? Colors.grey);
    final currentStage = _s(_map(_workflow['currentStage'])['stageName'], '');
    final docs = _list(_loan['renewalKycDocuments']);
    // Member-level documents first, then the co-applicant's.
    docs.sort((a, b) {
      int rank(Map<String, dynamic> d) =>
          _s(d['coApplicantId'], '').isEmpty ? 0 : 1;
      return rank(a).compareTo(rank(b));
    });
    final docTypeById = {
      for (final d in docs) '${d['id']}': '${d['documentType']}',
    };

    return RefreshIndicator(
      color: _green,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Loan ${_s(_loan['loanNumber'])}',
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                    color: _ink,
                  ),
                ),
              ),
              _pill(
                (cfg?.$1 ?? status).toUpperCase(),
                color.shade700,
                color.shade50,
              ),
            ],
          ),
          if (currentStage.isNotEmpty &&
              status != 'APPROVED' &&
              status != 'REJECTED')
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                'Currently with $currentStage',
                style: const TextStyle(fontSize: 11.5, color: _muted),
              ),
            ),
          const SizedBox(height: 12),
          _memberCard(),
          _loanCard(),
          _coApplicantCard(),
          _docsCard(docs),
          _trailCard(_list(_loan['renewalHistory']), docTypeById),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        backgroundColor: Colors.white,
        foregroundColor: _green,
        elevation: 0,
        title: const Text(
          'Renewal Loan',
          style: TextStyle(fontWeight: FontWeight.w800, fontSize: 17),
        ),
      ),
      body: SafeArea(child: _body()),
    );
  }
}
