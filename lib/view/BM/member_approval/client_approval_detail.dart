import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:sarvam/controller/member_approval_controller.dart';
import 'package:sarvam/view/BM/member_approval/widgets/doc_type_labels.dart';
import 'package:sarvam/view/BM/member_approval/widgets/signed_doc_thumbnail.dart';

const _green = Color(0xFF0D6842);
const _muted = Color(0xFF64748B);
const _border = Color(0xFFE1EEE6);

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

    if ((action == 'BM_SUBMIT_TO_AM' || action == 'AM_APPROVE') && unreviewedDocsCount > 0) {
      Get.snackbar(
        'Document Verification Required',
        '$unreviewedDocsCount document(s) have not been verified yet. Please review and verify each document individually above before approving.',
        backgroundColor: Colors.orange.shade800,
        colorText: Colors.white,
        duration: const Duration(seconds: 4),
      );
      return;
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
        .where((d) => d['bmDecision'] == 'RETAKE_REQUIRED')
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

    return RefreshIndicator(
      color: _green,
      onRefresh: () => controller.loadClientDetail(widget.clientId),
      child: ListView(
        controller: _scrollController,
        padding: const EdgeInsets.all(14),
        children: [
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
                ...kycDocuments.map((doc) {
                  final docId = doc['id']?.toString() ?? '';
                  return _docReviewCard(
                    doc,
                    canAct,
                    key: ValueKey(docId),
                    lat: (detail['latitude'] as num?)?.toDouble(),
                    lng: (detail['longitude'] as num?)?.toDouble(),
                  );
                }),
            ],
          ),
          const SizedBox(height: 12),
          _checklistSection(),
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
                decoration: const InputDecoration(
                  hintText:
                      'Required for Retake / Reject, optional for Submit to AM',
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
              ),
              const SizedBox(height: 12),
              Obx(() {
                final submitting = controller.isSubmittingClientAction.value;
                return Column(
                  children: [
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        onPressed: (submitting || unreviewedDocsCount > 0)
                            ? null
                            : () => _act(
                                  _isAM ? 'AM_APPROVE' : 'BM_SUBMIT_TO_AM',
                                  needsRemarks: false,
                                ),
                        icon: const Icon(Icons.verified_rounded, size: 18),
                        label: Text(
                          _isAM
                              ? 'Approve Member Enrollment'
                              : 'Verify & Submit to AM',
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
      'VERIFIED' => _green,
      'RETAKE_REQUIRED' => const Color(0xFFB45309),
      'DELETED' => Colors.red,
      'REJECTED' => Colors.red,
      _ => _muted,
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
      padding: const EdgeInsets.only(bottom: 2),
      child: RichText(
        text: TextSpan(
          style: const TextStyle(fontSize: 10.5, color: _muted),
          children: [
            TextSpan(
              text: '$stage: ',
              style: const TextStyle(
                fontWeight: FontWeight.w700,
                color: Color(0xFF334155),
              ),
            ),
            TextSpan(
              text: label,
              style: TextStyle(color: color, fontWeight: FontWeight.w700),
            ),
            if (reviewerLine != null && reviewerLine.isNotEmpty)
              TextSpan(text: ' · $reviewerLine'),
          ],
        ),
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
        border: Border.all(color: _border),
        borderRadius: BorderRadius.circular(12),
        boxShadow: [
          BoxShadow(
            color: const Color(0x00000000).withValues(alpha: 0.03),
            blurRadius: 8,
            offset: const Offset(0, 2),
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
                              fontWeight: FontWeight.w700,
                              fontSize: 13,
                            ),
                          ),
                        ),
                        if (isLocationQr)
                          GestureDetector(
                            onTap: () => _openLocationMap(lat, lng),
                            child: Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 10,
                                vertical: 5,
                              ),
                              decoration: BoxDecoration(
                                color: const Color(0xFFEAF6F0),
                                borderRadius: BorderRadius.circular(18),
                                border: Border.all(
                                  color: const Color(0xFFBBE5CE),
                                ),
                              ),
                              child: const Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(
                                    Icons.map_outlined,
                                    size: 14,
                                    color: _green,
                                  ),
                                  SizedBox(width: 4),
                                  Text(
                                    'View on Map',
                                    style: TextStyle(
                                      fontSize: 10.5,
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
            TextField(
              controller: _docRemarkCtrl(docId),
              maxLines: 2,
              style: const TextStyle(fontSize: 12.5),
              decoration: const InputDecoration(
                hintText: 'Remark (required for retake / delete / reject)…',
                isDense: true,
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 10),
            Obx(() {
              final isSubmitting = controller.submittingDocId.value == docId;
              return Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: isSubmitting
                          ? null
                          : () => _actOnDoc(docId, 'VERIFIED'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: _green,
                        side: const BorderSide(color: Color(0xFFBBE5CE)),
                      ),
                      child: const Text(
                        'Verify',
                        style: TextStyle(fontSize: 12),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton(
                      onPressed: isSubmitting
                          ? null
                          : () => _actOnDoc(docId, 'RETAKE_REQUIRED'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: const Color(0xFFB45309),
                        side: const BorderSide(color: Color(0xFFFCD34D)),
                      ),
                      child: const Text(
                        'Retake',
                        style: TextStyle(fontSize: 12),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton(
                      onPressed: isSubmitting
                          ? null
                          : () => _actOnDoc(docId, 'DELETED'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: const Color(0xFFDC2626),
                        side: const BorderSide(color: Color(0xFFFCA5A5)),
                      ),
                      child: isSubmitting
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Text(
                              'Delete',
                              style: TextStyle(fontSize: 12),
                            ),
                    ),
                  ),
                ],
              );
            }),
          ],
        ],
      ),
    );
  }

  Widget _sectionCard(String title, IconData icon, List<Widget> children) =>
      Card(
        margin: EdgeInsets.zero,
        elevation: 1,
        surfaceTintColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(icon, size: 16, color: _green),
                  const SizedBox(width: 8),
                  Text(
                    title,
                    style: const TextStyle(
                      fontWeight: FontWeight.w800,
                      fontSize: 13.5,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              ...children,
            ],
          ),
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
}
