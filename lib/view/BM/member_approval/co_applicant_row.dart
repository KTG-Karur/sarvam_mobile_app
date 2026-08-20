import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:sarvam/controller/member_approval_controller.dart';
import 'package:sarvam/view/BM/member_approval/widgets/doc_type_labels.dart';
import 'package:sarvam/view/BM/member_approval/widgets/signed_doc_thumbnail.dart';

const _green = Color(0xFF0D6842);
const _muted = Color(0xFF64748B);

/// One co-applicant queue row — collapsed shows a summary tile; tapping
/// expands it inline (no navigation, matching the web's
/// `CoApplicantApprovalQueue.tsx` single-component list+detail pattern) to
/// show full details, KYC documents, remarks, and Approve/Reject.
class CoApplicantRow extends StatefulWidget {
  const CoApplicantRow({
    super.key,
    required this.controller,
    required this.coApplicant,
  });

  final MemberApprovalController controller;
  final Map<String, dynamic> coApplicant;

  @override
  State<CoApplicantRow> createState() => _CoApplicantRowState();
}

class _CoApplicantRowState extends State<CoApplicantRow> {
  bool _expanded = false;
  final _remarksCtrl = TextEditingController();

  @override
  void dispose() {
    _remarksCtrl.dispose();
    super.dispose();
  }

  String _f(Map data, String key, [String fallback = '—']) {
    final v = data[key];
    return v == null || v.toString().trim().isEmpty ? fallback : v.toString();
  }

  Future<bool> _confirm(String title, String message) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: _green),
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Confirm'),
          ),
        ],
      ),
    );
    return result == true;
  }

  Future<void> _act(String id, String action) async {
    final remarks = _remarksCtrl.text.trim();
    if (action == 'reject' && remarks.isEmpty) {
      Get.snackbar(
        'Remarks required',
        'Enter a remark before rejecting.',
        backgroundColor: Colors.orange,
        colorText: Colors.white,
      );
      return;
    }
    final ok = await _confirm(
      action == 'approve' ? 'Approve Co-Applicant' : 'Reject Co-Applicant',
      action == 'approve'
          ? 'Approve this co-applicant and forward to the next stage?'
          : 'Reject this co-applicant?',
    );
    if (!ok) return;
    await widget.controller.submitCoApplicantAction(
      id,
      action,
      remarks: remarks.isEmpty ? null : remarks,
    );
  }

  @override
  Widget build(BuildContext context) {
    final co = widget.coApplicant;
    final id = co['id']?.toString() ?? '';
    final client = co['client'] is Map ? Map<String, dynamic>.from(co['client'] as Map) : <String, dynamic>{};
    final center = client['center'] is Map ? Map<String, dynamic>.from(client['center'] as Map) : <String, dynamic>{};
    final documents = co['kycDocuments'] is List
        ? (co['kycDocuments'] as List).whereType<Map>().map((d) => Map<String, dynamic>.from(d)).toList()
        : <Map<String, dynamic>>[];
    final economicActivityType = co['economicActivityType'] is Map ? co['economicActivityType']['name'] : null;
    final economicActivity = co['economicActivity'] is Map ? co['economicActivity']['name'] : null;

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: const Color(0xFFE1EEE6)),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            borderRadius: BorderRadius.circular(10),
            onTap: () => setState(() => _expanded = !_expanded),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 16,
                    backgroundColor: const Color(0xFFEAF6EE),
                    child: Text(
                      _f(co, 'name', '?')[0].toUpperCase(),
                      style: const TextStyle(color: _green, fontWeight: FontWeight.w800),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _f(co, 'name'),
                          style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${_f(co, 'relationWithClient')} of ${_f(client, 'firstName', '')} '
                          '${_f(client, 'lastName', '')} (${_f(client, 'clientId')})',
                          style: const TextStyle(fontSize: 11, color: _muted),
                        ),
                      ],
                    ),
                  ),
                  Icon(
                    _expanded ? Icons.expand_less : Icons.expand_more,
                    color: _muted,
                  ),
                ],
              ),
            ),
          ),
          if (_expanded)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Divider(height: 1, color: Color(0xFFF1F5F9)),
                  const SizedBox(height: 10),
                  _row('Mobile', _f(co, 'mobileNumber')),
                  _row('Gender', _f(co, 'gender')),
                  _row('Date of Birth', _f(co, 'dateOfBirth')),
                  _row('Age', _f(co, 'age')),
                  if (economicActivityType != null) _row('Economic Activity Type', '$economicActivityType'),
                  if (economicActivity != null) _row('Economic Activity', '$economicActivity'),
                  _row('PAN Card No', _f(co, 'pancardNo')),
                  _row('Voter ID No', _f(co, 'voterIdNo')),
                  _row('Aadhaar No', _f(co, 'otherIdNo')),
                  const SizedBox(height: 6),
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF7FBF7),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      'For client: ${_f(client, 'clientId')} — ${_f(client, 'firstName', '')} '
                      '${_f(client, 'lastName', '')}, ${_f(center, 'name')}',
                      style: const TextStyle(fontSize: 11, color: Color(0xFF0F172A)),
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    'Documents (${documents.length})',
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12),
                  ),
                  const SizedBox(height: 8),
                  if (documents.isEmpty)
                    const Text('No documents uploaded.', style: TextStyle(fontSize: 12, color: _muted))
                  else
                    Wrap(
                      spacing: 10,
                      runSpacing: 10,
                      children: documents
                          .map(
                            (doc) => SignedDocThumbnail(
                              controller: widget.controller,
                              fileKey: doc['fileUrl']?.toString() ?? '',
                              label: kycDocTypeLabel(doc['documentType']?.toString() ?? ''),
                            ),
                          )
                          .toList(),
                    ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _remarksCtrl,
                    maxLines: 2,
                    decoration: const InputDecoration(
                      hintText: 'Remarks (required to reject)',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Obx(() {
                    final submitting =
                        widget.controller.coApplicantSubmitting[id]?.value ?? false;
                    return Row(
                      children: [
                        Expanded(
                          child: OutlinedButton(
                            onPressed: submitting ? null : () => _act(id, 'reject'),
                            style: OutlinedButton.styleFrom(
                              foregroundColor: const Color(0xFFDC2626),
                              side: const BorderSide(color: Color(0xFFFCA5A5)),
                            ),
                            child: const Text('Reject'),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: FilledButton(
                            onPressed: submitting ? null : () => _act(id, 'approve'),
                            style: FilledButton.styleFrom(backgroundColor: _green),
                            child: submitting
                                ? const SizedBox(
                                    width: 16,
                                    height: 16,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                      color: Colors.white,
                                    ),
                                  )
                                : const Text('Approve'),
                          ),
                        ),
                      ],
                    );
                  }),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _row(String label, String value) => Padding(
    padding: const EdgeInsets.only(bottom: 6),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 130,
          child: Text(label, style: const TextStyle(fontSize: 11, color: _muted)),
        ),
        Expanded(
          child: Text(
            value,
            style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: Color(0xFF0F172A)),
          ),
        ),
      ],
    ),
  );
}
