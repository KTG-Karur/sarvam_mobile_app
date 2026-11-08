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
///
/// With [actionable] (opened from Member Approval's Renewal Loan Approval
/// queue) it becomes the review screen: each image can be approved or sent
/// back for a retake, the product can be changed while the renewal is still in
/// the chain, and the stage can approve & forward, request a retake or reject
/// — the same rules as the web's `RenewalLoanDetail`. The server re-checks
/// that the user really holds the stage, so a wrong button can only fail, not
/// do harm.
class RenewalLoanDetail extends StatefulWidget {
  const RenewalLoanDetail({
    super.key,
    required this.loanId,
    this.actionable = false,
  });

  final String loanId;

  /// Show the review controls (queue use) instead of the read-only view.
  final bool actionable;

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
  bool _busy = false; // an approve / retake / reject / product call is running
  String? _reviewingDocId; // the image whose review call is running
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

  /// [silent] refreshes in place — no full-screen spinner, and a failure keeps
  /// the data already on screen (used after a review or product change).
  Future<void> _load({bool silent = false}) async {
    if (!silent) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    String? failure;
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
        failure = _apiMessage(body) ?? 'Could not load this renewal.';
      }
    } catch (_) {
      failure = 'Could not load this renewal.';
    } finally {
      if (mounted) {
        if (!silent) setState(() => _loading = false);
        if (failure != null) {
          if (silent) {
            _snack(failure, error: true);
          } else {
            setState(() => _error = failure);
          }
        }
      }
    }
  }

  String? _apiMessage(dynamic body) {
    if (body is! Map) return null;
    final m = (body['message'] ?? body['error'])?.toString();
    return m == null || m.isEmpty ? null : m;
  }

  void _snack(String message, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: error ? Colors.red.shade700 : _green,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  // ── review actions (actionable mode) ────────────────────────────────────

  /// The verbs for the stage the renewal is waiting on (the server re-checks
  /// that the user holds it). Null when it isn't waiting on a stage.
  ({String approve, String retake, String reject, String label})?
  _stageActions() {
    if (_workflow.isEmpty) return null;
    if (_workflow['isFinalReview'] == true) {
      return (
        approve: 'FINAL_APPROVE',
        retake: 'FINAL_RETAKE',
        reject: 'FINAL_REJECT',
        label: 'Give final approval',
      );
    }
    if (_map(_workflow['currentStage']).isNotEmpty) {
      return (
        approve: 'LEVEL_APPROVE',
        retake: 'LEVEL_RETAKE',
        reject: 'LEVEL_REJECT',
        label: 'Approve & forward to ${_s(_workflow['nextStageName'], 'Admin')}',
      );
    }
    return null;
  }

  List<Map<String, dynamic>> get _allDocs =>
      _list(_loan['renewalKycDocuments']);

  List<Map<String, dynamic>> _docsAtDecision(String decision) => _allDocs
      .where((d) => _s(d['currentStageDecision'], '') == decision)
      .toList();

  /// Every image must be approved at this stage before the renewal can be
  /// forwarded — the server enforces the same.
  bool get _docsBlockForward =>
      _docsAtDecision('PENDING').isNotEmpty ||
      _docsAtDecision('RETAKE_REQUIRED').isNotEmpty;

  bool get _canChangeProduct {
    final status = _s(_loan['renewalApprovalStatus'], '');
    return widget.actionable &&
        _loan.isNotEmpty &&
        status != 'APPROVED' &&
        status != 'REJECTED';
  }

  Future<void> _reviewDoc(Map<String, dynamic> doc, String decision) async {
    if (_busy || _reviewingDocId != null) return;
    final docId = _s(doc['id'], '');
    if (docId.isEmpty) return;

    String? remark;
    if (decision == 'RETAKE_REQUIRED') {
      remark = await showDialog<String>(
        context: context,
        barrierDismissible: false,
        builder: (_) => _RemarksDialog(
          title: 'Retake ${kycDocTypeLabel(_s(doc['documentType'], ''))}',
          message: 'Tell the FDO why this image needs to be taken again.',
          confirmLabel: 'Request Retake',
          color: Colors.orange.shade800,
          remarksRequired: true,
        ),
      );
      if (remark == null || !mounted) return;
    }

    setState(() => _reviewingDocId = docId);
    try {
      final response = await _api.post(
        '${Api.baseUrl}/api/approval/loans/${Uri.encodeComponent(widget.loanId)}'
        '/renewal-kyc-documents/${Uri.encodeComponent(docId)}/review',
        {
          'decision': decision,
          if (remark != null && remark.isNotEmpty) 'remarks': remark,
        },
      );
      final body = response.body;
      if (body is Map && body['success'] == true) {
        await _load(silent: true);
      } else {
        _snack(_apiMessage(body) ?? 'Failed to review document', error: true);
      }
    } catch (_) {
      _snack('Failed to review document', error: true);
    } finally {
      if (mounted) setState(() => _reviewingDocId = null);
    }
  }

  Future<void> _runAction(
    String action, {
    required String title,
    required String message,
    required String confirmLabel,
    required Color color,
    required bool remarksRequired,
  }) async {
    if (_busy) return;
    final remarks = await showDialog<String>(
      context: context,
      barrierDismissible: false,
      builder: (_) => _RemarksDialog(
        title: title,
        message: message,
        confirmLabel: confirmLabel,
        color: color,
        remarksRequired: remarksRequired,
      ),
    );
    if (remarks == null || !mounted) return;

    setState(() => _busy = true);
    try {
      final response = await _api.post(
        '${Api.baseUrl}/api/approval/loans/${Uri.encodeComponent(widget.loanId)}'
        '/renewal-action',
        {'action': action, if (remarks.isNotEmpty) 'remarks': remarks},
      );
      final body = response.body;
      if (body is Map && body['success'] == true) {
        if (!mounted) return;
        Navigator.pop(context, true); // back to the queue, which refreshes
        return;
      }
      _snack(_apiMessage(body) ?? 'Action failed', error: true);
    } catch (_) {
      _snack('Action failed', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _changeProduct() async {
    if (_busy) return;
    final currentId = _s(_loan['loanProductId'], '');
    final selected = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      builder: (_) => _ProductSheet(
        api: _api,
        branchId: _s(_loan['branchId'], ''),
        currentProductId: currentId,
        currentSummary:
            '${_s(_map(_loan['loanProduct'])['productName'])} · '
            '${_money(_loan['amount'])}',
      ),
    );
    if (selected == null || selected == currentId || !mounted) return;

    setState(() => _busy = true);
    try {
      final response = await _api.patch(
        '${Api.baseUrl}/api/approval/loans/${Uri.encodeComponent(widget.loanId)}'
        '/renewal-product',
        {'loanProductId': selected},
      );
      final body = response.body;
      if (body is Map && body['success'] == true) {
        _snack('Loan product updated');
        await _load(silent: true);
      } else {
        _snack(_apiMessage(body) ?? 'Failed to update loan product', error: true);
      }
    } catch (_) {
      _snack('Failed to update loan product', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
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
          if (_canChangeProduct)
            Align(
              alignment: Alignment.centerRight,
              child: OutlinedButton.icon(
                onPressed: _busy ? null : _changeProduct,
                icon: const Icon(Icons.edit_rounded, size: 16),
                label: const Text('Change Product'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: _green,
                  side: const BorderSide(color: _green),
                  visualDensity: VisualDensity.compact,
                ),
              ),
            ),
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
                if (widget.actionable &&
                    _s(doc['currentStageDecision'], '') == 'PENDING')
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: _docReviewButtons(doc),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Approve / Retake for one image at the current stage. Retake asks for the
  /// reason in a pop-up; Approve goes straight through.
  Widget _docReviewButtons(Map<String, dynamic> doc) {
    final working = _reviewingDocId == _s(doc['id'], '');
    final disabled = _busy || _reviewingDocId != null;
    if (working) {
      return const SizedBox(
        height: 30,
        child: Align(
          alignment: Alignment.centerLeft,
          child: SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(strokeWidth: 2, color: _green),
          ),
        ),
      );
    }
    return Wrap(
      spacing: 8,
      runSpacing: 6,
      children: [
        ElevatedButton.icon(
          onPressed: disabled ? null : () => _reviewDoc(doc, 'VERIFIED'),
          icon: const Icon(Icons.check_circle_outline, size: 15),
          label: const Text('Approve'),
          style: ElevatedButton.styleFrom(
            backgroundColor: Colors.green.shade600,
            foregroundColor: Colors.white,
            elevation: 0,
            visualDensity: VisualDensity.compact,
            textStyle: const TextStyle(fontSize: 11.5),
          ),
        ),
        OutlinedButton.icon(
          onPressed: disabled ? null : () => _reviewDoc(doc, 'RETAKE_REQUIRED'),
          icon: const Icon(Icons.replay_rounded, size: 15),
          label: const Text('Retake'),
          style: OutlinedButton.styleFrom(
            foregroundColor: Colors.orange.shade800,
            side: BorderSide(color: Colors.orange.shade300),
            visualDensity: VisualDensity.compact,
            textStyle: const TextStyle(fontSize: 11.5),
          ),
        ),
      ],
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

  Widget _blockBanner() {
    String labels(List<Map<String, dynamic>> docs) => docs
        .map((d) => kycDocTypeLabel(_s(d['documentType'], '')))
        .join(', ');
    final retake = _docsAtDecision('RETAKE_REQUIRED');
    final pending = _docsAtDecision('PENDING');
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFFFFBEB),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFFCD34D)),
      ),
      child: Text(
        [
          if (retake.isNotEmpty) 'Retake requested: ${labels(retake)}.',
          if (pending.isNotEmpty)
            'Awaiting your approval — this can\'t move to the next stage '
                'until every renewal image is approved: ${labels(pending)}.',
        ].join(' '),
        style: const TextStyle(
          fontSize: 12,
          color: Color(0xFF92400E),
          height: 1.35,
        ),
      ),
    );
  }

  /// The stage action bar: approve & forward, request a retake, reject. Each
  /// asks for remarks in a pop-up (required for retake / reject).
  Widget? _actionBar() {
    if (!widget.actionable || _loading || _error != null) return null;
    final acts = _stageActions();
    if (acts == null) return null;
    final status = _s(_loan['renewalApprovalStatus'], '');
    final blocked = _docsBlockForward;

    return SafeArea(
      child: Container(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
        decoration: const BoxDecoration(
          color: Colors.white,
          border: Border(top: BorderSide(color: Color(0xFFE2E8F0))),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: _busy || blocked
                    ? null
                    : () => _runAction(
                        acts.approve,
                        title: acts.label,
                        message: 'You can add a remark for this approval.',
                        confirmLabel: 'Approve',
                        color: Colors.green.shade700,
                        remarksRequired: false,
                      ),
                icon: _busy
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.check_circle_outline, size: 18),
                label: Text(acts.label),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.green.shade600,
                  foregroundColor: Colors.white,
                  disabledBackgroundColor: const Color(0xFFA7D1B8),
                  padding: const EdgeInsets.symmetric(vertical: 12),
                ),
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                if (status != 'FINAL_RETAKE_REQUIRED') ...[
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _busy
                          ? null
                          : () => _runAction(
                              acts.retake,
                              title: 'Request Retake',
                              message:
                                  'Send this renewal back to the FDO. '
                                  'Tell them what needs to be corrected.',
                              confirmLabel: 'Request Retake',
                              color: Colors.orange.shade800,
                              remarksRequired: true,
                            ),
                      icon: const Icon(Icons.replay_rounded, size: 17),
                      label: const Text('Retake'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: Colors.orange.shade800,
                        side: BorderSide(color: Colors.orange.shade300),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                ],
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _busy
                        ? null
                        : () => _runAction(
                            acts.reject,
                            title: 'Reject Renewal',
                            message:
                                'This rejects the renewal loan. Give the reason.',
                            confirmLabel: 'Reject',
                            color: Colors.red.shade700,
                            remarksRequired: true,
                          ),
                    icon: const Icon(Icons.cancel_outlined, size: 17),
                    label: const Text('Reject'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.red.shade700,
                      side: BorderSide(color: Colors.red.shade300),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
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
          if (widget.actionable && _docsBlockForward) _blockBanner(),
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
        title: Text(
          widget.actionable ? 'Review Renewal' : 'Renewal Loan',
          style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17),
        ),
      ),
      body: SafeArea(child: _body()),
      bottomNavigationBar: _actionBar(),
    );
  }
}


/// Remarks pop-up for an approve / retake / reject. It owns its text
/// controller so the controller is disposed with the dialog (disposing it from
/// the caller while the dialog animates out trips a framework assertion).
/// Pops the trimmed remarks, or null when cancelled.
class _RemarksDialog extends StatefulWidget {
  const _RemarksDialog({
    required this.title,
    required this.message,
    required this.confirmLabel,
    required this.color,
    required this.remarksRequired,
  });

  final String title;
  final String message;
  final String confirmLabel;
  final Color color;
  final bool remarksRequired;

  @override
  State<_RemarksDialog> createState() => _RemarksDialogState();
}

class _RemarksDialogState extends State<_RemarksDialog> {
  final TextEditingController _remarks = TextEditingController();

  @override
  void dispose() {
    _remarks.dispose();
    super.dispose();
  }

  bool get _canConfirm =>
      !widget.remarksRequired || _remarks.text.trim().isNotEmpty;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      title: Text(
        widget.title,
        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(widget.message, style: const TextStyle(fontSize: 12.5)),
          const SizedBox(height: 12),
          TextField(
            controller: _remarks,
            minLines: 3,
            maxLines: 4,
            autofocus: true,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              labelText: widget.remarksRequired ? 'Remarks *' : 'Remarks',
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
            ),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        ElevatedButton(
          style: ElevatedButton.styleFrom(
            backgroundColor: widget.color,
            foregroundColor: Colors.white,
          ),
          onPressed: _canConfirm
              ? () => Navigator.pop(context, _remarks.text.trim())
              : null,
          child: Text(widget.confirmLabel),
        ),
      ],
    );
  }
}

/// Bottom sheet to pick a different loan product for the renewal. Lists the
/// branch's products (`/products?branchId=`); pops the chosen product id.
class _ProductSheet extends StatefulWidget {
  const _ProductSheet({
    required this.api,
    required this.branchId,
    required this.currentProductId,
    required this.currentSummary,
  });

  final ApiClient api;
  final String branchId;
  final String currentProductId;
  final String currentSummary;

  @override
  State<_ProductSheet> createState() => _ProductSheetState();
}

class _ProductSheetState extends State<_ProductSheet> {
  static const _green = Color(0xFF0C5F34);

  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _products = [];
  late String _selected = widget.currentProductId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final response = await widget.api.get(
        '${Api.productsUrl}?branchId=${Uri.encodeQueryComponent(widget.branchId)}',
      );
      final body = response.body;
      final data = body is Map && body['success'] == true ? body['data'] : null;
      if (data is List && mounted) {
        setState(() {
          _products = data
              .whereType<Map>()
              .map((e) => Map<String, dynamic>.from(e))
              .toList();
        });
      } else if (mounted) {
        setState(() => _error = 'Could not load loan products.');
      }
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not load loan products.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _money(dynamic v) {
    final n = num.tryParse('${v ?? ''}');
    return n == null ? '—' : '₹${NumberFormat('#,##,##0', 'en_IN').format(n)}';
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          16,
          16,
          16,
          16 + MediaQuery.of(context).viewInsets.bottom,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Change Loan Product',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 4),
            Text(
              'Current: ${widget.currentSummary}',
              style: const TextStyle(fontSize: 12, color: Color(0xFF64748B)),
            ),
            const SizedBox(height: 4),
            const Text(
              'Changing the product also updates the amount, interest rate, '
              'tenure and frequency to match it.',
              style: TextStyle(fontSize: 11.5, color: Color(0xFF64748B)),
            ),
            const SizedBox(height: 10),
            Flexible(
              child: _loading
                  ? const Padding(
                      padding: EdgeInsets.all(24),
                      child: Center(
                        child: CircularProgressIndicator(color: _green),
                      ),
                    )
                  : _error != null
                  ? Padding(
                      padding: const EdgeInsets.all(16),
                      child: Text(_error!),
                    )
                  : ListView(
                      shrinkWrap: true,
                      children: [
                        for (final p in _products)
                          RadioListTile<String>(
                            value: '${p['id']}',
                            groupValue: _selected,
                            activeColor: _green,
                            dense: true,
                            onChanged: (v) {
                              if (v != null) setState(() => _selected = v);
                            },
                            title: Text(
                              '${p['productName']}',
                              style: const TextStyle(fontSize: 13),
                            ),
                            subtitle: Text(
                              '${_money(p['loanAmount'])} · ${p['frequency'] ?? ''}',
                              style: const TextStyle(fontSize: 11.5),
                            ),
                          ),
                      ],
                    ),
            ),
            const SizedBox(height: 10),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Cancel'),
                ),
                const SizedBox(width: 8),
                ElevatedButton(
                  onPressed: _selected.isEmpty ||
                          _selected == widget.currentProductId
                      ? null
                      : () => Navigator.pop(context, _selected),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _green,
                    foregroundColor: Colors.white,
                  ),
                  child: const Text('Save'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
