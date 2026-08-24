import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:sarvam/controller/member_approval_controller.dart';
import 'package:sarvam/view/BM/member_approval/widgets/doc_type_labels.dart';
import 'package:sarvam/view/BM/member_approval/widgets/signed_doc_thumbnail.dart';

const _green = Color(0xFF0D6842);
const _muted = Color(0xFF64748B);
const _border = Color(0xFFE2E8F0);

/// Mirrors the web app's ApprovalClientDetail.tsx `docPairs` display order
/// (photo → Aadhaar → voter ID → smart card → house/location → NOC),
/// flattened. The backend always returns `kycDocuments` sorted by
/// `createdAt desc` (newest re-upload first) — the web app never trusts
/// that order for display and re-sorts client-side into this fixed
/// grouping; this mobile screen previously rendered the raw API order
/// directly, which is why the two apps showed documents in different
/// (and, after any retake re-upload, shifting) sequences.
const List<List<String>> _kycDocCanonicalGroups = [
  ['client_photo'],
  ['co_applicant_photo'],
  ['aadhaar_front'],
  ['aadhaar_back'],
  ['co_applicant_other_id', 'co_applicant_aadhaar_front'],
  ['co_applicant_aadhaar_back'],
  ['voter_id'],
  ['co_applicant_voter_id'],
  ['voter_id_back'],
  ['co_applicant_voter_id_back'],
  ['smart_card_front', 'smart_card'],
  ['smart_card_back'],
  ['house_image_1'],
  ['location_qr'],
  ['house_image_2'],
  ['house_image_3'],
  ['gas_bill'],
  ['noc_image_1'],
  ['noc_image_2'],
  ['noc_image_3'],
];

/// Any document type not in the canonical groups above (PAN card, bank
/// passbook, signatures, etc.) falls after them, keeping its original
/// (createdAt desc) relative order — matching the web app's "Other
/// Documents" section, which is likewise never re-sorted.
List<Map<String, dynamic>> _sortedKycDocuments(
  List<Map<String, dynamic>> docs,
) {
  final rank = <String, int>{};
  for (var i = 0; i < _kycDocCanonicalGroups.length; i++) {
    for (final type in _kycDocCanonicalGroups[i]) {
      rank[type] = i;
    }
  }
  final indexed = docs.asMap().entries.toList()
    ..sort((a, b) {
      final rankA = rank[a.value['documentType']?.toString() ?? ''] ??
          _kycDocCanonicalGroups.length;
      final rankB = rank[b.value['documentType']?.toString() ?? ''] ??
          _kycDocCanonicalGroups.length;
      if (rankA != rankB) return rankA.compareTo(rankB);
      return a.key.compareTo(b.key);
    });
  return indexed.map((e) => e.value).toList();
}

/// BM's per-client review screen — a Flutter port of the read-only + BM
/// action portion of the web app's `ApprovalClientDetail.tsx`. Whole-client
/// actions only (Submit to AM / Request Retake / Reject); KYC documents are
/// view-only (no per-document decision in this pass).
class ClientApprovalDetail extends StatefulWidget {
  const ClientApprovalDetail({super.key, required this.clientId});

  final String clientId;

  @override
  State<ClientApprovalDetail> createState() => _ClientApprovalDetailState();
}

class _ClientApprovalDetailState extends State<ClientApprovalDetail> {
  final MemberApprovalController controller =
      Get.isRegistered<MemberApprovalController>()
      ? Get.find<MemberApprovalController>()
      : Get.put(MemberApprovalController());

  final ScrollController _scrollController = ScrollController();
  bool _isBM = false;
  bool _isAM = false;

  final _remarksCtrl = TextEditingController();
  final Map<String, TextEditingController> _docRemarkCtrls = {};

  TextEditingController _docRemarkCtrl(String docId) =>
      _docRemarkCtrls.putIfAbsent(docId, TextEditingController.new);

  @override
  void initState() {
    super.initState();
    controller.loadClientDetail(widget.clientId);
    // determine user role to adapt review UI (BM vs AM)
    controller.isBranchManagerRole().then((v) {
      if (mounted) setState(() => _isBM = v);
    });
    controller.isAreaManagerRole().then((v) {
      if (mounted) setState(() => _isAM = v);
    });
  }

  @override
  void dispose() {
    _scrollController.dispose();
    _remarksCtrl.dispose();
    for (final ctrl in _docRemarkCtrls.values) {
      ctrl.dispose();
    }
    super.dispose();
  }

  String _f(Map data, String key, [String fallback = '—']) {
    final v = data[key];
    return v == null || v.toString().trim().isEmpty ? fallback : v.toString();
  }

  String _extractActivity(Map data, String key) {
    final v = data[key];
    if (v is Map) return v['name']?.toString() ?? '—';
    if (v != null && v.toString().trim().isNotEmpty) return v.toString();
    return '—';
  }

  /// Opens an in-app map centered on the client's enrolled GPS location —
  /// triggered by the "Location QR" document's "View on Map" chip. Uses
  /// `google_maps_flutter` (already a dependency, used elsewhere for
  /// branch/center distance) rather than launching an external maps app, so
  /// no new package is needed.
  void _openLocationMap(double? lat, double? lng) {
    if (lat == null || lng == null) return;
    final position = LatLng(lat, lng);
    showDialog(
      context: context,
      builder: (dialogContext) => Dialog(
        insetPadding: const EdgeInsets.all(16),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 8, 8),
              child: Row(
                children: [
                  const Icon(Icons.location_on, color: _green, size: 18),
                  const SizedBox(width: 8),
                  const Expanded(
                    child: Text(
                      'Member Location',
                      style: TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 14,
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(dialogContext),
                    icon: const Icon(Icons.close, size: 18),
                  ),
                ],
              ),
            ),
            SizedBox(
              height: 320,
              width: double.maxFinite,
              child: ClipRRect(
                borderRadius: const BorderRadius.vertical(
                  bottom: Radius.circular(16),
                ),
                child: GoogleMap(
                  initialCameraPosition: CameraPosition(
                    target: position,
                    zoom: 16,
                  ),
                  markers: {
                    Marker(
                      markerId: const MarkerId('member_location'),
                      position: position,
                    ),
                  },
                  myLocationButtonEnabled: false,
                  zoomControlsEnabled: false,
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 10),
              child: Text(
                '${lat.toStringAsFixed(6)}, ${lng.toStringAsFixed(6)}',
                style: const TextStyle(fontSize: 11, color: _muted),
              ),
            ),
          ],
        ),
      ),
    );
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

  Future<void> _act(String action, {required bool needsRemarks}) async {
    final remarks = _remarksCtrl.text.trim();
    if (needsRemarks && remarks.isEmpty) {
      Get.snackbar(
        'Remarks required',
        'Enter a remark before requesting a retake or rejecting.',
        backgroundColor: Colors.orange,
        colorText: Colors.white,
      );
      return;
    }

    final detail = controller.clientDetail.value ?? {};
    final hasCenter = detail['centerId'] != null;
    final kycDocuments = detail['kycDocuments'] is List
        ? (detail['kycDocuments'] as List)
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList()
        : <Map<String, dynamic>>[];
    final unreviewedDocsCount = kycDocuments
        .where((d) => _isAM
            ? (d['amDecision'] == null || d['amDecision'] == 'PENDING')
            : (d['bmDecision'] == null || d['bmDecision'] == 'PENDING'))
        .length;

    final retakeFlaggedCount = kycDocuments
        .where((d) =>
            d['bmDecision'] == 'RETAKE_REQUIRED' ||
            d['amDecision'] == 'RETAKE_REQUIRED' ||
            d['qcDecision'] == 'RETAKE_REQUIRED')
        .length;

    if (action == 'BM_SUBMIT_TO_AM' || action == 'AM_APPROVE') {
      if (unreviewedDocsCount > 0) {
        Get.snackbar(
          'Document Verification Required',
          '$unreviewedDocsCount document(s) have not been verified yet. Please review and verify each document individually above before approving.',
          backgroundColor: Colors.orange.shade800,
          colorText: Colors.white,
          duration: const Duration(seconds: 4),
        );
        return;
      }
      if (retakeFlaggedCount > 0) {
        Get.snackbar(
          'Retake Flagged Documents Exist',
          '$retakeFlaggedCount document(s) are flagged for retake. Use "Request Retake" to send the application back to FDO.',
          backgroundColor: Colors.orange.shade800,
          colorText: Colors.white,
          duration: const Duration(seconds: 4),
        );
        return;
      }
    }

    if (action == 'BM_SUBMIT_TO_AM' && !hasCenter) {
      Get.snackbar(
        'Center Assignment Required',
        'Center must be assigned to the client before forwarding to AM. Please assign a center first.',
        backgroundColor: Colors.orange.shade800,
        colorText: Colors.white,
        duration: const Duration(seconds: 4),
      );
      return;
    }

    final label = action == 'BM_SUBMIT_TO_AM'
        ? 'submit this client to AM'
        : action == 'AM_APPROVE'
        ? 'approve this client enrollment'
        : (action == 'BM_RETAKE' || action == 'AM_RETAKE')
        ? 'request a retake for this client'
        : 'reject this client';
    final ok = await _confirm(
      'Confirm Action',
      'Are you sure you want to $label?',
    );
    if (!ok) return;

    final bool success;
    if (action == 'BM_SUBMIT_TO_AM') {
      success = await controller.verifyAndSubmitMember(
        widget.clientId,
        remarks: remarks.isEmpty ? null : remarks,
      );
    } else if (action == 'AM_APPROVE') {
      success = await controller.approveMemberAM(
        widget.clientId,
        remarks: remarks.isEmpty ? null : remarks,
      );
    } else if (action == 'BM_RETAKE') {
      success = await controller.requestMemberRetake(widget.clientId, remarks);
    } else if (action == 'AM_RETAKE') {
      success = await controller.requestMemberRetakeAM(widget.clientId, remarks);
    } else if (action == 'AM_REJECT') {
      success = await controller.rejectMemberAM(widget.clientId, remarks);
    } else {
      success = await controller.rejectMember(widget.clientId, remarks);
    }
    if (success && mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xFFF2FAF5),
    appBar: AppBar(
      elevation: 2, // Added elevation for shadow
      backgroundColor: Colors.white,
      foregroundColor: const Color(0xFF0F172A),
      title: const Text(
        'Client Approval Review',
        style: TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w800,
          color: Color(0xFF0F172A),
        ),
      ),
      leading: IconButton(
        icon: const Icon(Icons.arrow_back, color: Color(0xFF0F172A)),
        onPressed: () => Navigator.of(context).pop(),
      ),
      // Added bottom border for better visibility
      bottom: PreferredSize(
        preferredSize: const Size.fromHeight(1),
        child: Container(height: 1, color: const Color(0xFFE1EEE6)),
      ),
    ),
    body: Obx(() {
      final detail = controller.clientDetail.value;
      // Only the *first* load (no cached detail yet) shows a full-screen
      // spinner. Reloads after a per-document Verify/Retake/Delete action
      // must keep rendering the existing ListView in place — swapping it
      // out for a Center() and back destroys the scroll position, throwing
      // the reviewer back to the top of a (sometimes 20+ document) list
      // every single time they act on one document.
      if (controller.isLoadingDetail.value && detail == null) {
        return const Center(child: CircularProgressIndicator(color: _green));
      }
      if (detail == null) {
        return const Center(child: Text('Client not found.'));
      }
      return _buildBody(detail);
    }),
  );

  Widget _buildBody(Map<String, dynamic> detail) {
    final center = detail['center'] is Map
        ? Map<String, dynamic>.from(detail['center'] as Map)
        : <String, dynamic>{};
    final groupMemberships = detail['groupMemberships'] is List
        ? detail['groupMemberships'] as List
        : const [];
    final groupName =
        groupMemberships.isNotEmpty && groupMemberships.first is Map
        ? (groupMemberships.first['group'] is Map
              ? (groupMemberships.first['group']['name']?.toString() ?? '—')
              : '—')
        : '—';
    final coApplicant = detail['coApplicant'] is Map
        ? Map<String, dynamic>.from(detail['coApplicant'] as Map)
        : null;
    final kycDocuments = detail['kycDocuments'] is List
        ? (detail['kycDocuments'] as List)
              .whereType<Map>()
              .map((d) => Map<String, dynamic>.from(d))
              .toList()
        : <Map<String, dynamic>>[];

    final hasCenter = detail['centerId'] != null;
    final hasGroup = groupMemberships.isNotEmpty;
    final retakeFlaggedCount = kycDocuments
        .where((d) =>
            d['bmDecision'] == 'RETAKE_REQUIRED' ||
            d['amDecision'] == 'RETAKE_REQUIRED' ||
            d['qcDecision'] == 'RETAKE_REQUIRED')
        .length;
    final unreviewedDocsCount = kycDocuments
        .where((d) => _isAM
            ? (d['amDecision'] == null || d['amDecision'] == 'PENDING')
            : (d['bmDecision'] == null || d['bmDecision'] == 'PENDING'))
        .length;
    final approvalStatus = detail['approvalStatus']?.toString() ?? '';
    final canAct =
        (_isBM &&
            (approvalStatus == 'SUBMITTED' ||
                approvalStatus == 'PENDING_BM_REVIEW')) ||
        (_isAM &&
            (approvalStatus.contains('AM') ||
                approvalStatus.contains('PENDING_AM') ||
                approvalStatus == 'APPROVAL_QUEUE'));

    final approvalHistory = detail['approvalHistory'] is List
        ? (detail['approvalHistory'] as List)
        : const [];

    return RefreshIndicator(
      color: _green,
      onRefresh: () => controller.loadClientDetail(widget.clientId),
      child: ListView(
        controller: _scrollController,
        padding: const EdgeInsets.all(14),
        children: [
          _workflowStepperCard(approvalStatus),
          _sectionCard('Overview', Icons.badge_outlined, [
            _row('Client ID', _f(detail, 'clientId')),
            _row(
              'Name',
              '${_f(detail, 'firstName', '')} ${_f(detail, 'lastName', '')}'
                  .trim(),
            ),
            _row('Mobile', _f(detail, 'mobileNumber')),
            _row('Status', approvalStatus.replaceAll('_', ' ')),
            _row('Center', '${_f(center, 'name')} (${_f(center, 'code')})'),
            _row('Group', groupName),
          ]),
          const SizedBox(height: 12),
          _sectionCard('Personal Details', Icons.person_outline, [
            _row('Gender', _f(detail, 'gender')),
            _row('Date of Birth', _f(detail, 'dateOfBirth')),
            _row('Age', _f(detail, 'age')),
            _row('Marital Status', _f(detail, 'maritalStatus')),
            _row('Father Name', _f(detail, 'fatherName')),
            _row('Mother Name', _f(detail, 'motherName')),
            _row('Spouse Name', _f(detail, 'spouseName')),
            _row('No. of Children', _f(detail, 'noOfChildren')),
            _row('Religion', _f(detail, 'religion')),
            _row('Caste', _f(detail, 'caste')),
            _row('Qualification', _f(detail, 'qualification')),
          ]),
          const SizedBox(height: 12),
          _sectionCard('Address & Contact', Icons.location_on_outlined, [
            _row('Permanent Address', _f(detail, 'permanentAddress')),
            _row('Pincode', _f(detail, 'pincode')),
            _row('Post Office', _f(detail, 'postOffice')),
            _row('District', _f(detail, 'district')),
            _row('State', _f(detail, 'state')),
            _row('Country', _f(detail, 'country')),
            _row('Email', _f(detail, 'email')),
          ]),
          const SizedBox(height: 12),
          _sectionCard('Banking Details', Icons.account_balance_outlined, [
            _row('Bank Name', _f(detail, 'bankName')),
            _row('Bank Branch', _f(detail, 'bankBranch')),
            _row('IFSC Code', _f(detail, 'ifscCode')),
            _row('Bank A/c No', _f(detail, 'bankAcNo')),
            _row('PAN Card No', _f(detail, 'pancardNo')),
            _row('Voter ID No', _f(detail, 'votersIdNo')),
          ]),
          if (coApplicant != null) ...[
            const SizedBox(height: 12),
            _sectionCard('Co-Applicant / Nominee', Icons.group_outlined, [
              _row('Name', _f(coApplicant, 'name')),
              _row('Relation', _f(coApplicant, 'relationWithClient')),
              _row('Gender', _f(coApplicant, 'gender')),
              _row('Age', _f(coApplicant, 'age')),
              _row('Mobile', _f(coApplicant, 'mobileNumber')),
              _row(
                'Economic Activity Type',
                _extractActivity(coApplicant, 'economicActivityType'),
              ),
              _row(
                'Economic Activity',
                _extractActivity(coApplicant, 'economicActivity'),
              ),
              _row('PAN Card No', _f(coApplicant, 'caPancardNo', _f(coApplicant, 'pancardNo'))),
              _row('Voter ID No', _f(coApplicant, 'caVoterIdNo', _f(coApplicant, 'voterIdNo'))),
              _row('Aadhaar No', _f(coApplicant, 'caOtherIdNo', _f(coApplicant, 'otherIdNo'))),
            ]),
          ],
          const SizedBox(height: 12),
          _locationSection(detail, center),
          const SizedBox(height: 12),
          _sectionCard(
            'KYC Documents (${kycDocuments.length})',
            Icons.folder_open_outlined,
            [
              if (kycDocuments.isEmpty)
                const Text(
                  'No documents uploaded.',
                  style: TextStyle(fontSize: 12, color: _muted),
                )
              else
                ..._sortedKycDocuments(kycDocuments).map((doc) {
                  final docId = doc['id']?.toString() ?? '';
                  return _docReviewCard(
                    doc,
                    canAct,
                    key: ValueKey(docId),
                    lat: (detail['latitude'] as num?)?.toDouble(),
                    lng: (detail['longitude'] as num?)?.toDouble(),
                    blockVerify: retakeFlaggedCount > 0,
                  );
                }),
            ],
          ),
          const SizedBox(height: 12),
          _checklistSection(),
          _approvalHistorySection(approvalHistory),
          if (canAct) ...[
            const SizedBox(height: 12),
            if (unreviewedDocsCount > 0 || !hasCenter || !hasGroup || retakeFlaggedCount > 0)
              Container(
                width: double.infinity,
                margin: const EdgeInsets.only(bottom: 10),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFFEF3C7),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: const Color(0xFFFDE68A)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (unreviewedDocsCount > 0) ...[
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(
                            Icons.warning_amber_rounded,
                            color: Color(0xFFD97706),
                            size: 18,
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Individual Document Verification Required ($unreviewedDocsCount Pending)',
                                  style: const TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.w800,
                                    color: Color(0xFF92400E),
                                  ),
                                ),
                                const SizedBox(height: 2),
                                const Text(
                                  'All KYC documents must be explicitly inspected and verified individually above before approving the member application.',
                                  style: TextStyle(
                                    fontSize: 11,
                                    color: Color(0xFFB45309),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      if (!hasCenter || !hasGroup || retakeFlaggedCount > 0)
                        const Divider(height: 12, color: Color(0xFFFCD34D)),
                    ],
                    if (!hasCenter || !hasGroup || retakeFlaggedCount > 0)
                      Text(
                        [
                          if (!hasCenter) 'Center is not assigned yet.',
                          if (!hasGroup) 'Group is not assigned yet.',
                          if (retakeFlaggedCount > 0)
                            '$retakeFlaggedCount document(s) still pending retake.',
                        ].join(' '),
                        style: const TextStyle(
                          fontSize: 11.5,
                          color: Color(0xFF92400E),
                        ),
                      ),
                  ],
                ),
              ),
            _sectionCard('Remarks & Action', Icons.rate_review_outlined, [
              TextField(
                controller: _remarksCtrl,
                maxLines: 3,
                decoration: InputDecoration(
                  hintText: retakeFlaggedCount > 0
                      ? 'Describe what needs to be re-captured (required)'
                      : 'Required for Retake / Reject, optional for Submit to AM',
                  border: const OutlineInputBorder(),
                  isDense: true,
                ),
              ),
              const SizedBox(height: 12),
              Obx(() {
                final submitting = controller.isSubmittingClientAction.value;
                // Once any document is flagged for retake, this stage can
                // only go one way — back to the FDO for re-upload. Approving
                // (or rejecting outright) with a known-bad document still
                // attached would be a mistake, so only Request Retake shows
                // until every flagged document is resolved.
                if (retakeFlaggedCount > 0) {
                  return Column(
                    children: [
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton.icon(
                          onPressed: submitting
                              ? null
                              : () {
                                  if (_remarksCtrl.text.trim().isEmpty) {
                                    _remarksCtrl.text =
                                        '$retakeFlaggedCount document(s) flagged for retake. Please re-upload required KYC documents.';
                                  }
                                  _act(
                                    _isAM ? 'AM_RETAKE' : 'BM_RETAKE',
                                    needsRemarks: true,
                                  );
                                },
                          icon: const Icon(Icons.rotate_right_rounded, size: 18),
                          label: Text(
                            'Request Retake ($retakeFlaggedCount Flagged)',
                          ),
                          style: FilledButton.styleFrom(
                            backgroundColor: const Color(0xFFD97706),
                            foregroundColor: Colors.white,
                          ),
                        ),
                      ),
                      if (submitting) ...[
                        const SizedBox(height: 10),
                        const CircularProgressIndicator(color: _green),
                      ],
                    ],
                  );
                }
                return Column(
                  children: [
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        onPressed: (submitting ||
                                unreviewedDocsCount > 0 ||
                                !hasCenter ||
                                !hasGroup)
                            ? null
                            : () => _act(
                                  _isAM ? 'AM_APPROVE' : 'BM_SUBMIT_TO_AM',
                                  needsRemarks: false,
                                ),
                        icon: const Icon(Icons.verified_rounded, size: 18),
                        label: Text(
                          _isAM ? 'Approve Member Enrollment' : 'Submit to AM',
                        ),
                        style: FilledButton.styleFrom(backgroundColor: _green),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton(
                            onPressed: submitting
                                ? null
                                : () => _act(
                                      _isAM ? 'AM_RETAKE' : 'BM_RETAKE',
                                      needsRemarks: true,
                                    ),
                            style: OutlinedButton.styleFrom(
                              foregroundColor: const Color(0xFFB45309),
                              side: const BorderSide(color: Color(0xFFFCD34D)),
                            ),
                            child: const Text('Request Retake'),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: OutlinedButton(
                            onPressed: submitting
                                ? null
                                : () => _act(
                                      _isAM ? 'AM_REJECT' : 'BM_REJECT',
                                      needsRemarks: true,
                                    ),
                            style: OutlinedButton.styleFrom(
                              foregroundColor: const Color(0xFFDC2626),
                              side: const BorderSide(color: Color(0xFFFCA5A5)),
                            ),
                            child: const Text('Reject'),
                          ),
                        ),
                      ],
                    ),
                    if (submitting) ...[
                      const SizedBox(height: 10),
                      const CircularProgressIndicator(color: _green),
                    ],
                  ],
                );
              }),
            ]),
          ],
          const SizedBox(height: 20),
        ],
      ),
    );
  }

  // -------------------------------------------------------------------
  // Member Location — GPS distance from the assigned center, mirroring the
  // web app's haversineDistance()/CENTER_MATCH_RADIUS_METERS (1000m).
  // -------------------------------------------------------------------

  double _haversineMeters(double lat1, double lon1, double lat2, double lon2) {
    const r = 6371000.0;
    double toRad(double d) => d * math.pi / 180;
    final dLat = toRad(lat2 - lat1);
    final dLon = toRad(lon2 - lon1);
    final a =
        math.sin(dLat / 2) * math.sin(dLat / 2) +
        math.cos(toRad(lat1)) *
            math.cos(toRad(lat2)) *
            math.sin(dLon / 2) *
            math.sin(dLon / 2);
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
  }

  Widget _locationSection(
    Map<String, dynamic> detail,
    Map<String, dynamic> center,
  ) {
    final lat = (detail['latitude'] as num?)?.toDouble();
    final lng = (detail['longitude'] as num?)?.toDouble();
    if (lat == null || lng == null) return const SizedBox.shrink();

    final centerLat = (center['latitude'] as num?)?.toDouble();
    final centerLng = (center['longitude'] as num?)?.toDouble();
    double? distanceM;
    if (centerLat != null && centerLng != null) {
      distanceM = _haversineMeters(lat, lng, centerLat, centerLng);
    }
    final withinRange = distanceM != null && distanceM <= 1000;
    final distLabel = distanceM == null
        ? null
        : (distanceM < 1000
              ? '${distanceM.round()} m'
              : '${(distanceM / 1000).toStringAsFixed(2)} km');

    return _sectionCard('Member Location', Icons.location_on_outlined, [
      _row('Latitude', lat.toStringAsFixed(6)),
      _row('Longitude', lng.toStringAsFixed(6)),
      if (distLabel != null)
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Row(
            children: [
              const SizedBox(
                width: 130,
                child: Text(
                  'Distance from Center',
                  style: TextStyle(fontSize: 11, color: _muted),
                ),
              ),
              Icon(
                withinRange ? Icons.check_circle : Icons.error_outline,
                size: 14,
                color: withinRange ? _green : Colors.red,
              ),
              const SizedBox(width: 5),
              Text(
                withinRange
                    ? '$distLabel — within 1.00 km'
                    : '$distLabel — outside range',
                style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                  color: withinRange ? _green : Colors.red,
                ),
              ),
            ],
          ),
        ),
    ]);
  }

  // -------------------------------------------------------------------
  // Approval Checklist — server-computed readiness items from
  // GET /api/approval/clients/{clientId} (`checklist`), ordered failing
  // blockers, then failing warnings, then everything that passed.
  // -------------------------------------------------------------------

  Widget _checklistSection() => Obx(() {
    final items = controller.checklist
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
    if (items.isEmpty) return const SizedBox.shrink();

    final passed = items.where((i) => i['passed'] == true).toList();
    final failingBlockers = items
        .where((i) => i['passed'] != true && i['severity'] == 'blocker')
        .toList();
    final failingWarnings = items
        .where((i) => i['passed'] != true && i['severity'] == 'warning')
        .toList();
    final ordered = [...failingBlockers, ...failingWarnings, ...passed];

    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: _sectionCard('Approval Checklist', Icons.checklist_rounded, [
        Wrap(
          spacing: 8,
          runSpacing: 6,
          children: [
            _chip('${passed.length} Passed', _green, const Color(0xFFE8F5E9)),
            if (failingBlockers.isNotEmpty)
              _chip(
                '${failingBlockers.length} Blocker${failingBlockers.length == 1 ? '' : 's'}',
                Colors.red.shade700,
                Colors.red.shade50,
              ),
            if (failingWarnings.isNotEmpty)
              _chip(
                '${failingWarnings.length} Warning${failingWarnings.length == 1 ? '' : 's'}',
                const Color(0xFFB45309),
                const Color(0xFFFEF3C7),
              ),
          ],
        ),
        const SizedBox(height: 10),
        ...ordered.map(_checklistRow),
      ]),
    );
  });

  Widget _chip(String text, Color fg, Color bg) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(
      color: bg,
      borderRadius: BorderRadius.circular(20),
    ),
    child: Text(
      text,
      style: TextStyle(color: fg, fontSize: 10.5, fontWeight: FontWeight.w700),
    ),
  );

  Widget _checklistRow(Map<String, dynamic> item) {
    final passed = item['passed'] == true;
    final severity = item['severity']?.toString() ?? 'blocker';
    final label = item['label']?.toString() ?? '';
    final color = passed
        ? _green
        : (severity == 'blocker'
              ? Colors.red.shade700
              : const Color(0xFFB45309));
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            passed ? Icons.check_circle : Icons.cancel,
            color: color,
            size: 16,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                fontSize: 11.5,
                color: passed ? const Color(0xFF334155) : color,
                fontWeight: passed ? FontWeight.w500 : FontWeight.w700,
              ),
            ),
          ),
          if (!passed)
            Container(
              margin: const EdgeInsets.only(left: 6),
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                severity.toUpperCase(),
                style: TextStyle(
                  fontSize: 8.5,
                  fontWeight: FontWeight.w700,
                  color: color,
                ),
              ),
            ),
        ],
      ),
    );
  }

  // -------------------------------------------------------------------
  // Per-document review — BM/AM/QC decision status + (for BM, while the
  // document is still PENDING) a remark box and Verify/Retake/Delete —
  // a Flutter port of ApprovalClientDetail.tsx's DocImageCard.
  // -------------------------------------------------------------------

  String? _shortDate(dynamic value) {
    if (value == null) return null;
    final parsed = DateTime.tryParse(value.toString());
    if (parsed == null) return null;
    return '${parsed.day}/${parsed.month}/${parsed.year}';
  }

  Widget _decisionRow(
    String stage,
    String decision,
    dynamic reviewer,
    dynamic reviewedAt,
  ) {
    final label = switch (decision) {
      'VERIFIED' => 'Verified',
      'RETAKE_REQUIRED' => 'Retake Required',
      'DELETED' => 'Deleted',
      'REJECTED' => 'Rejected',
      _ => 'Pending',
    };
    final color = switch (decision) {
      'VERIFIED' => const Color(0xFF0D6842),
      'RETAKE_REQUIRED' => const Color(0xFFB45309),
      'DELETED' => const Color(0xFFDC2626),
      'REJECTED' => const Color(0xFFDC2626),
      _ => const Color(0xFF64748B),
    };
    final bg = switch (decision) {
      'VERIFIED' => const Color(0xFFE8F5E9),
      'RETAKE_REQUIRED' => const Color(0xFFFEF3C7),
      'DELETED' => const Color(0xFFFEE2E2),
      'REJECTED' => const Color(0xFFFEE2E2),
      _ => const Color(0xFFF1F5F9),
    };
    final border = switch (decision) {
      'VERIFIED' => const Color(0xFFA7F3D0),
      'RETAKE_REQUIRED' => const Color(0xFFFDE68A),
      'DELETED' => const Color(0xFFFCA5A5),
      'REJECTED' => const Color(0xFFFCA5A5),
      _ => const Color(0xFFE2E8F0),
    };

    String? reviewerLine;
    if (decision != 'PENDING' && reviewer is Map) {
      final name =
          '${reviewer['firstName'] ?? ''} ${reviewer['lastName'] ?? ''}'.trim();
      final emp = reviewer['employeeId']?.toString();
      final date = _shortDate(reviewedAt);
      reviewerLine = [
        if (name.isNotEmpty) name,
        if (emp != null && emp.isNotEmpty) emp,
        if (date != null) date,
      ].join(' · ');
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          SizedBox(
            width: 32,
            child: Text(
              '$stage:',
              style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w700,
                color: Color(0xFF334155),
              ),
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
            decoration: BoxDecoration(
              color: bg,
              borderRadius: BorderRadius.circular(6),
              border: Border.all(color: border),
            ),
            child: Text(
              label,
              style: TextStyle(
                color: color,
                fontSize: 10,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          if (reviewerLine != null && reviewerLine.isNotEmpty) ...[
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                reviewerLine,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 10.5, color: _muted),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _actOnDoc(String docId, String decision) async {
    final remarkCtrl = _docRemarkCtrl(docId);
    final remark = remarkCtrl.text.trim();
    if (decision != 'VERIFIED' && remark.isEmpty) {
      Get.snackbar(
        'Remark required',
        'Enter a remark before requesting a retake or deleting this document.',
        backgroundColor: Colors.orange,
        colorText: Colors.white,
      );
      return;
    }
    if (decision == 'DELETED') {
      final ok = await _confirm(
        'Delete Document',
        'Are you sure you want to delete this document? This cannot be undone.',
      );
      if (!ok) return;
    }
    final success = await controller.submitDocumentReview(
      widget.clientId,
      docId,
      decision,
      remark: remark.isEmpty ? null : remark,
    );
    if (success) remarkCtrl.clear();
  }

  Widget _docReviewCard(
    Map<String, dynamic> doc,
    bool canAct, {
    Key? key,
    double? lat,
    double? lng,
    bool blockVerify = false,
  }) {
    final docId = doc['id']?.toString() ?? '';
    final documentType = doc['documentType']?.toString() ?? '';
    final label = kycDocTypeLabel(documentType);
    final bmDecision = doc['bmDecision']?.toString() ?? 'PENDING';
    final amDecision = doc['amDecision']?.toString() ?? 'PENDING';
    final qcDecision = doc['qcDecision']?.toString() ?? 'PENDING';
    final canReview =
        (_isBM && bmDecision == 'PENDING') ||
        (_isAM && amDecision == 'PENDING');
    final isLocationQr =
        documentType == 'location_qr' && lat != null && lng != null;

    return Container(
      key: key,
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: const Color(0xFFE2E8F0)),
        borderRadius: BorderRadius.circular(14),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0A000000),
            blurRadius: 8,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SignedDocThumbnail(
                controller: controller,
                fileKey: doc['fileUrl']?.toString() ??
                    doc['fileKey']?.toString() ??
                    doc['url']?.toString() ??
                    doc['path']?.toString() ??
                    '',
                label: label,
                mimeType: doc['mimeType']?.toString(),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            label,
                            style: const TextStyle(
                              fontWeight: FontWeight.w800,
                              fontSize: 13.5,
                              color: Color(0xFF0F172A),
                            ),
                          ),
                        ),
                        if (isLocationQr)
                          GestureDetector(
                            onTap: () => _openLocationMap(lat, lng),
                            child: Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 9,
                                vertical: 4,
                              ),
                              decoration: BoxDecoration(
                                color: const Color(0xFFEAF6F0),
                                borderRadius: BorderRadius.circular(16),
                                border: Border.all(
                                  color: const Color(0xFFBBE5CE),
                                ),
                              ),
                              child: const Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(
                                    Icons.map_outlined,
                                    size: 13,
                                    color: _green,
                                  ),
                                  SizedBox(width: 4),
                                  Text(
                                    'View Map',
                                    style: TextStyle(
                                      fontSize: 10,
                                      fontWeight: FontWeight.w700,
                                      color: _green,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    _decisionRow(
                      'BM',
                      bmDecision,
                      doc['bmReviewer'],
                      doc['bmReviewedAt'],
                    ),
                    _decisionRow(
                      'AM',
                      amDecision,
                      doc['amReviewer'],
                      doc['amReviewedAt'],
                    ),
                    _decisionRow(
                      'QC',
                      qcDecision,
                      doc['qcReviewer'],
                      doc['qcReviewedAt'],
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (canReview) ...[
            const SizedBox(height: 12),
            if (blockVerify) ...[
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: const Color(0xFFFEF3C7),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: const Color(0xFFFDE68A)),
                ),
                child: const Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      Icons.warning_amber_rounded,
                      size: 16,
                      color: Color(0xFFD97706),
                    ),
                    SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'Another document is flagged for retake — use "Request Retake" at the bottom of the page to submit to FDO.',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: Color(0xFF92400E),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ] else ...[
              TextField(
                controller: _docRemarkCtrl(docId),
                maxLines: 2,
                style: const TextStyle(fontSize: 12),
                decoration: InputDecoration(
                  hintText: 'Enter document remark (required for retake / delete)…',
                  hintStyle: const TextStyle(fontSize: 11.5, color: _muted),
                  isDense: true,
                  contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: const BorderSide(color: Color(0xFFCBD5E1)),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: const BorderSide(color: _green),
                  ),
                ),
              ),
              const SizedBox(height: 10),
              Obx(() {
                final isSubmitting = controller.submittingDocId.value == docId;
                return Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: isSubmitting
                            ? null
                            : () => _actOnDoc(docId, 'VERIFIED'),
                        icon: const Icon(Icons.check_circle_outline_rounded, size: 15),
                        style: OutlinedButton.styleFrom(
                          backgroundColor: const Color(0xFFE8F5E9),
                          foregroundColor: _green,
                          side: const BorderSide(color: Color(0xFFA7F3D0)),
                          padding: const EdgeInsets.symmetric(vertical: 8),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(8),
                          ),
                        ),
                        label: const Text(
                          'Verify',
                          style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700),
                        ),
                      ),
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: isSubmitting
                            ? null
                            : () => _actOnDoc(docId, 'RETAKE_REQUIRED'),
                        icon: const Icon(Icons.rotate_right_rounded, size: 15),
                        style: OutlinedButton.styleFrom(
                          backgroundColor: const Color(0xFFFEF3C7),
                          foregroundColor: const Color(0xFFB45309),
                          side: const BorderSide(color: Color(0xFFFDE68A)),
                          padding: const EdgeInsets.symmetric(vertical: 8),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(8),
                          ),
                        ),
                        label: const Text(
                          'Retake',
                          style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700),
                        ),
                      ),
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: isSubmitting
                            ? null
                            : () => _actOnDoc(docId, 'DELETED'),
                        icon: isSubmitting
                            ? const SizedBox(
                                width: 14,
                                height: 14,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Icon(Icons.delete_outline_rounded, size: 15),
                        style: OutlinedButton.styleFrom(
                          backgroundColor: const Color(0xFFFEE2E2),
                          foregroundColor: const Color(0xFFDC2626),
                          side: const BorderSide(color: Color(0xFFFCA5A5)),
                          padding: const EdgeInsets.symmetric(vertical: 8),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(8),
                          ),
                        ),
                        label: const Text(
                          'Delete',
                          style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700),
                        ),
                      ),
                    ),
                  ],
                );
              }),
            ],
          ],
        ],
      ),
    );
  }

  Widget _sectionCard(String title, IconData icon, List<Widget> children) =>
      Container(
        margin: const EdgeInsets.only(bottom: 12),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: _border),
          boxShadow: const [
            BoxShadow(
              color: Color(0x0A000000),
              blurRadius: 8,
              offset: Offset(0, 2),
            ),
          ],
        ),
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(6),
                  decoration: BoxDecoration(
                    color: _green.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(icon, size: 16, color: _green),
                ),
                const SizedBox(width: 10),
                Text(
                  title,
                  style: const TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: 14,
                    color: Color(0xFF0F172A),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            ...children,
          ],
        ),
      );

  Widget _row(String label, String value) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 130,
          child: Text(
            label,
            style: const TextStyle(fontSize: 11, color: _muted),
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: const TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w600,
              color: Color(0xFF0F172A),
            ),
          ),
        ),
      ],
    ),
  );

  Widget _workflowStepperCard(String status) {
    int activeIndex = 1;
    if (status == 'DRAFT' || status == 'ENROLLED') {
      activeIndex = 0;
    } else if (status == 'SUBMITTED' || status == 'PENDING_BM_REVIEW' || status == 'BM_RETAKE_REQUIRED') {
      activeIndex = 1;
    } else if (status == 'PENDING_AM_REVIEW' || status == 'AM_RETAKE_REQUIRED') {
      activeIndex = 2;
    } else if (status == 'PENDING_QC_VERIFICATION' || status == 'QC_VERIFICATION_RETAKE_REQUIRED') {
      activeIndex = 3;
    } else if (status == 'PENDING_FINAL_REVIEW' || status == 'FINAL_RETAKE_REQUIRED') {
      activeIndex = 4;
    } else if (status == 'APPROVED') {
      activeIndex = 5;
    } else if (status == 'REJECTED') {
      activeIndex = -1;
    }

    final stages = [
      {'key': 'FDO', 'label': 'FDO'},
      {'key': 'BM', 'label': 'BM'},
      {'key': 'AM', 'label': 'AM'},
      {'key': 'QC', 'label': 'QC'},
      {'key': 'FINAL', 'label': 'Admin'},
    ];

    final isApproved = activeIndex == 5;
    final isRejected = activeIndex == -1;

    final badgeBg = isApproved
        ? const Color(0xFFE8F5E9)
        : (isRejected ? const Color(0xFFFEE2E2) : const Color(0xFFFEF3C7));
    final badgeFg = isApproved
        ? _green
        : (isRejected ? const Color(0xFFDC2626) : const Color(0xFFB45309));
    final badgeBorder = isApproved
        ? const Color(0xFFA7F3D0)
        : (isRejected ? const Color(0xFFFCA5A5) : const Color(0xFFFDE68A));

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: _border),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0A000000),
            blurRadius: 8,
            offset: Offset(0, 2),
          ),
        ],
      ),
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(6),
                decoration: BoxDecoration(
                  color: _green.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Icon(Icons.account_tree_outlined, size: 16, color: _green),
              ),
              const SizedBox(width: 8),
              const Expanded(
                child: Text(
                  'Workflow Stage',
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: 13.5,
                    color: Color(0xFF0F172A),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Flexible(
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: badgeBg,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: badgeBorder),
                  ),
                  child: Text(
                    status.replaceAll('_', ' '),
                    overflow: TextOverflow.ellipsis,
                    maxLines: 1,
                    style: TextStyle(
                      fontSize: 9.5,
                      fontWeight: FontWeight.w700,
                      color: badgeFg,
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            children: List.generate(stages.length, (stageIdx) {
              final isDone = activeIndex > stageIdx;
              final isActive = activeIndex == stageIdx;
              final isLast = stageIdx == stages.length - 1;

              final circleBg = isDone
                  ? _green
                  : (isActive
                      ? (isRejected ? const Color(0xFFDC2626) : const Color(0xFF0284C7))
                      : const Color(0xFFF1F5F9));
              final circleFg = (isDone || isActive) ? Colors.white : const Color(0xFF64748B);
              final circleBorder = isDone
                  ? _green
                  : (isActive
                      ? (isRejected ? const Color(0xFFDC2626) : const Color(0xFF0284C7))
                      : const Color(0xFFCBD5E1));

              return Expanded(
                child: Column(
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Container(
                            height: 3,
                            color: stageIdx == 0
                                ? Colors.transparent
                                : (isDone || isActive ? _green : const Color(0xFFE2E8F0)),
                          ),
                        ),
                        Container(
                          width: 28,
                          height: 28,
                          decoration: BoxDecoration(
                            color: circleBg,
                            shape: BoxShape.circle,
                            border: Border.all(color: circleBorder, width: 2),
                            boxShadow: isActive
                                ? [
                                    BoxShadow(
                                      color: circleBg.withValues(alpha: 0.3),
                                      blurRadius: 6,
                                      spreadRadius: 1,
                                    ),
                                  ]
                                : null,
                          ),
                          child: Center(
                            child: isDone
                                ? const Icon(Icons.check_rounded, size: 15, color: Colors.white)
                                : Text(
                                    '${stageIdx + 1}',
                                    style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w800,
                                      color: circleFg,
                                    ),
                                  ),
                          ),
                        ),
                        Expanded(
                          child: Container(
                            height: 3,
                            color: isLast
                                ? Colors.transparent
                                : (isDone ? _green : const Color(0xFFE2E8F0)),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      stages[stageIdx]['label']!,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 10.5,
                        fontWeight: isActive ? FontWeight.w800 : FontWeight.w600,
                        color: isActive
                            ? (isRejected ? const Color(0xFFDC2626) : _green)
                            : (isDone ? const Color(0xFF334155) : const Color(0xFF94A3B8)),
                      ),
                    ),
                  ],
                ),
              );
            }),
          ),
        ],
      ),
    );
  }

  Widget _approvalHistorySection(List<dynamic> history) {
    if (history.isEmpty) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: _sectionCard('Approval History & Audit Trail', Icons.history_rounded, [
        ...history.map((item) {
          if (item is! Map) return const SizedBox.shrink();
          final action = item['action']?.toString() ?? '—';
          final remarks = item['remarks']?.toString();
          final dateStr = item['createdAt']?.toString();
          final parsedDate = dateStr != null ? DateTime.tryParse(dateStr) : null;
          final formattedDate = parsedDate != null
              ? '${parsedDate.day}/${parsedDate.month}/${parsedDate.year} ${parsedDate.hour.toString().padLeft(2, '0')}:${parsedDate.minute.toString().padLeft(2, '0')}'
              : dateStr ?? '—';

          final performedBy = item['performedBy'] is Map ? item['performedBy'] as Map : {};
          final name = '${performedBy['firstName'] ?? ''} ${performedBy['lastName'] ?? ''}'.trim();
          final role = performedBy['role']?.toString() ?? '';
          final empId = performedBy['employeeId']?.toString();

          final actorLine = [
            if (name.isNotEmpty) name,
            if (role.isNotEmpty) '($role)',
            if (empId != null && empId.isNotEmpty) '· $empId',
          ].join(' ');

          return Container(
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: const Color(0xFFF8FAFC),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: const Color(0xFFE2E8F0)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Icon(Icons.check_circle_outline, size: 14, color: _green),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        action.replaceAll('_', ' '),
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: Color(0xFF0F172A),
                        ),
                      ),
                    ),
                    Text(
                      formattedDate,
                      style: const TextStyle(fontSize: 10, color: _muted),
                    ),
                  ],
                ),
                if (actorLine.isNotEmpty) ...[
                  const SizedBox(height: 3),
                  Text(
                    actorLine,
                    style: const TextStyle(fontSize: 11, color: Color(0xFF475569)),
                  ),
                ],
                if (remarks != null && remarks.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(6),
                    decoration: BoxDecoration(
                      color: const Color(0xFFEFF6FF),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      'Remark: $remarks',
                      style: const TextStyle(fontSize: 10.5, color: Color(0xFF1E40AF)),
                    ),
                  ),
                ],
              ],
            ),
          );
        }),
      ]),
    );
  }
}
