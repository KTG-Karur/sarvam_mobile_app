import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/controller/centre_controller.dart';
import 'package:sarvam/utils/center_formatter.dart';

class CenterDetails extends StatefulWidget {
  const CenterDetails({super.key, required this.centerId});
  final String centerId;

  @override
  State<CenterDetails> createState() => _CenterDetailsState();
}

class _CenterDetailsState extends State<CenterDetails> {
  static const _green = Color(0xFF075E2E);
  static const _label = Color(0xFF3F7C5A);
  static const _value = Color(0xFF063B20);
  final CentreController _centreController = Get.find<CentreController>();

  String _userRole = '';

  @override
  void initState() {
    super.initState();
    _loadUserRole();
    _centreController.getCenterDetails(widget.centerId);
  }

  Future<void> _loadUserRole() async {
    final prefs = await SharedPreferences.getInstance();
    if (mounted) {
      setState(() => _userRole = prefs.getString('role') ?? '');
    }
  }

  String _formatDateTime(String? isoString) {
    if (isoString == null || isoString.isEmpty) return '—';
    try {
      final dateTime = DateTime.parse(isoString).toLocal();
      final formatted = DateFormat('d/M/yyyy, h:mm:ss a').format(dateTime);
      return formatted.replaceAll('AM', 'am').replaceAll('PM', 'pm');
    } catch (_) {
      return isoString;
    }
  }

  String _formatDateOnly(String? isoString) {
    if (isoString == null || isoString.isEmpty) return '—';
    try {
      final dateTime = DateTime.parse(isoString).toLocal();
      return DateFormat('dd/MM/yyyy').format(dateTime);
    } catch (_) {
      return isoString;
    }
  }

  Future<void> _approve() async {
    final ok = await _centreController.approveCenter(
      widget.centerId,
      'APPROVE',
    );
    if (ok) {
      _centreController.getCenterDetails(widget.centerId);
      _centreController.getCenters();
    }
  }

  Future<void> _reject() async {
    final reasonCtrl = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Reject Center'),
        content: TextField(
          controller: reasonCtrl,
          autofocus: true,
          maxLines: 3,
          decoration: const InputDecoration(
            labelText: 'Rejection reason',
            hintText: 'Enter a reason for rejecting this center',
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFDC2626),
            ),
            onPressed: () {
              final trimmed = reasonCtrl.text.trim();
              if (trimmed.isEmpty) {
                Get.snackbar(
                  'Reason required',
                  'Please enter a rejection reason.',
                  snackPosition: SnackPosition.BOTTOM,
                  backgroundColor: Colors.redAccent,
                  colorText: Colors.white,
                );
                return;
              }
              Navigator.pop(context, trimmed);
            },
            child: const Text('Reject'),
          ),
        ],
      ),
    );
    if (reason == null || reason.isEmpty) return;

    final ok = await _centreController.approveCenter(
      widget.centerId,
      'REJECT',
      rejectionReason: reason,
    );
    if (ok) {
      _centreController.getCenterDetails(widget.centerId);
      _centreController.getCenters();
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xFFF1FBF5),
    body: SafeArea(
      child: Obx(() {
        if (_centreController.isDetailLoading.value) {
          return const Center(child: CircularProgressIndicator(color: _green));
        }
        final detail = _centreController.centerDetails;
        if (detail.isEmpty) {
          return Column(
            children: [
              _closeBar(),
              const Expanded(
                child: Center(
                  child: Text(
                    'No center details found.',
                    style: TextStyle(color: Color(0xFF28543E)),
                  ),
                ),
              ),
            ],
          );
        }

        final code = detail['code'] ?? '';
        final name = detail['name'] ?? '';
        final displayName = formatCenterDisplay(name, code);

        final address = "${detail['address'] ?? '—'}";
        final localArea = "${detail['localArea'] ?? '—'}";

        final branchRaw = detail['branchName'] ?? detail['branch'];
        final branch = branchRaw is Map
            ? "${branchRaw['name'] ?? '—'}"
            : "${branchRaw ?? '—'}";

        final String fdo =
            detail['fdoName'] ??
            (detail['fdo'] != null
                ? "${detail['fdo']['firstName'] ?? ''} ${detail['fdo']['lastName'] ?? ''}"
                      .trim()
                : '—');

        final status = "${detail['status'] ?? 'PENDING_APPROVAL'}";
        final String displayStatus = status == 'APPROVED'
            ? 'Approved'
            : (status == 'PENDING_APPROVAL' ? 'Pending Approval' : 'Rejected');

        final latitude = detail['latitude'] != null
            ? "${detail['latitude']}"
            : '—';
        final longitude = detail['longitude'] != null
            ? "${detail['longitude']}"
            : '—';
        final kmVal = detail['kmFromBranch'] ?? detail['distanceFromBranch'];
        final km = (kmVal != null && kmVal.toString().isNotEmpty && kmVal.toString() != '—')
            ? "${kmVal} km"
            : '—';

        final contactPerson = (detail['contactPerson']?.toString().trim().isNotEmpty == true)
            ? detail['contactPerson'].toString().trim()
            : '—';
        final rawNum = detail['contactNumber'] ?? detail['contactPersonNumber'] ?? detail['contactPhone'] ?? detail['mobileNumber'];
        final contactNumber = (rawNum?.toString().trim().isNotEmpty == true)
            ? rawNum.toString().trim()
            : '—';

        final formationDate = _formatDateOnly(
          detail['formationDate']?.toString(),
        );
        final nextMeetingDate = _formatDateOnly(
          detail['nextMeetingDate']?.toString(),
        );
        final meetingDay = "${detail['meetingDay'] ?? '—'}";
        final meetingTime = "${detail['meetingTime'] ?? '—'}";
        final meetingPlace = "${detail['meetingPlace'] ?? '—'}";

        final createdByRaw = detail['createdBy'];
        final createdBy = createdByRaw is Map
            ? "${createdByRaw['firstName'] ?? ''} ${createdByRaw['lastName'] ?? ''}"
                  .trim()
            : fdo;
        final createdAt = _formatDateTime(detail['createdAt']);

        final hasApproval = detail['approvedBy'] != null;
        final approvedBy = hasApproval
            ? "${detail['approvedBy']['firstName'] ?? ''} ${detail['approvedBy']['lastName'] ?? ''}"
                  .trim()
            : '—';
        final approvedAt = _formatDateTime(detail['approvedAt']);
        final isPending = status == 'PENDING_APPROVAL';
        final isRejected = status == 'REJECTED';

        return SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: RichText(
                      text: TextSpan(
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                        ),
                        children: [
                          const TextSpan(
                            text: 'Center Details — ',
                            style: TextStyle(color: _green),
                          ),
                          TextSpan(
                            text: displayName,
                            style: const TextStyle(color: Color(0xFF063B20)),
                          ),
                        ],
                      ),
                    ),
                  ),
                  _closeButton(),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                'Center ID: ${widget.centerId}',
                style: const TextStyle(fontSize: 12, color: _label),
              ),
              const SizedBox(height: 18),
              _detailGrid([
                _Detail('Branch', branch),
                _Detail(
                  'Status',
                  displayStatus,
                  isStatus: true,
                  statusCode: status,
                ),
                _Detail('FDO (Creator)', fdo),
                _Detail('Formation Date', formationDate),
                _Detail('Contact Person', contactPerson),
                _Detail('Contact Number', contactNumber),
                _Detail('KM from Branch', km),
                _Detail('Latitude', latitude),
                _Detail('Longitude', longitude),
                _Detail('Address', address),
                _Detail('Local Area', localArea),
              ]),
              const SizedBox(height: 18),
              const Divider(height: 1, color: Color(0xFFD9EEE0)),
              const SizedBox(height: 16),
              const Text(
                'MEETING DETAILS',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: _green,
                  letterSpacing: 0.4,
                ),
              ),
              const SizedBox(height: 14),
              _detailGrid([
                _Detail('Next Meeting Date', nextMeetingDate),
                _Detail('Meeting Day', meetingDay),
                _Detail('Meeting Time', meetingTime),
                _Detail('Meeting Place', meetingPlace),
              ]),
              const SizedBox(height: 18),
              const Divider(height: 1, color: Color(0xFFD9EEE0)),
              const SizedBox(height: 16),
              const Text(
                'AUDIT TRAIL',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: _green,
                  letterSpacing: 0.4,
                ),
              ),
              const SizedBox(height: 14),
              _detailGrid([
                _Detail('Created By', createdBy.isNotEmpty ? createdBy : '—'),
                _Detail('Created At', createdAt),
              ]),
              if (hasApproval) ...[
                const SizedBox(height: 16),
                _detailGrid([
                  _Detail(
                    isRejected ? 'Rejected By' : 'Approved By',
                    approvedBy,
                  ),
                  _Detail(
                    isRejected ? 'Rejected At' : 'Approved At',
                    approvedAt,
                  ),
                ]),
              ] else if (isPending &&
                  (_userRole == 'BRANCH_MANAGER' ||
                      _userRole == 'AREA_MANAGER' ||
                      _userRole == 'ADMIN' ||
                      _userRole == 'SUPER_ADMIN' ||
                      _userRole == 'ADMIN_NON_HO_BRANCH_SWITCH')) ...[
                const SizedBox(height: 18),
                _approveRejectButtons(),
              ],
            ],
          ),
        );
      }),
    ),
  );

  Widget _closeBar() => Padding(
    padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
    child: Row(
      mainAxisAlignment: MainAxisAlignment.end,
      children: [_closeButton()],
    ),
  );

  Widget _closeButton() => InkWell(
    onTap: () => Navigator.maybePop(context),
    borderRadius: BorderRadius.circular(8),
    child: Container(
      width: 30,
      height: 30,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: const Color(0xFFCDE7D6)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.04),
            blurRadius: 4,
            offset: const Offset(0, 1),
          ),
        ],
      ),
      child: const Icon(Icons.close, size: 17, color: Color(0xFF28543E)),
    ),
  );

  Widget _detailGrid(List<_Detail> details) => LayoutBuilder(
    builder: (context, constraints) => Wrap(
      runSpacing: 14,
      children: details
          .map(
            (detail) => SizedBox(
              width: constraints.maxWidth / 2,
              child: _detail(detail),
            ),
          )
          .toList(),
    ),
  );

  Widget _detail(_Detail item) => Padding(
    padding: const EdgeInsets.only(right: 8),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          item.label.toUpperCase(),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            fontSize: 10,
            color: _label,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.2,
          ),
        ),
        const SizedBox(height: 4),
        item.isStatus
            ? _statusBadge(item.value, item.statusCode ?? '')
            : Text(
                item.value,
                style: const TextStyle(
                  fontSize: 13,
                  color: _value,
                  fontWeight: FontWeight.w700,
                ),
              ),
      ],
    ),
  );

  Widget _statusBadge(String label, String status) {
    final isApproved = status == 'APPROVED';
    final isPending = status == 'PENDING_APPROVAL';

    final Color bgColor = isApproved
        ? const Color(0xFFE1F5E7)
        : (isPending ? const Color(0xFFFDEDD3) : const Color(0xFFFEF2F2));

    final Color textColor = isApproved
        ? const Color(0xFF08753A)
        : (isPending ? const Color(0xFFB45309) : const Color(0xFFB91C1C));

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 10.5,
          color: textColor,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }

  Widget _approveRejectButtons() => Obx(
    () => Row(
      children: [
        Expanded(
          child: ElevatedButton.icon(
            onPressed: _centreController.isUpdatingStatus.value
                ? null
                : _approve,
            icon: const Icon(Icons.thumb_up_alt_outlined, size: 16),
            label: const Text(
              'Approve',
              style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
            ),
            style: ElevatedButton.styleFrom(
              backgroundColor: _green,
              foregroundColor: Colors.white,
              elevation: 0,
              padding: const EdgeInsets.symmetric(vertical: 12),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(8),
              ),
            ),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: OutlinedButton.icon(
            onPressed: _centreController.isUpdatingStatus.value
                ? null
                : _reject,
            icon: const Icon(
              Icons.thumb_down_alt_outlined,
              size: 16,
              color: Color(0xFFDC2626),
            ),
            label: const Text(
              'Reject',
              style: TextStyle(
                fontWeight: FontWeight.w700,
                fontSize: 13,
                color: Color(0xFFDC2626),
              ),
            ),
            style: OutlinedButton.styleFrom(
              side: const BorderSide(color: Color(0xFFFCA5A5)),
              padding: const EdgeInsets.symmetric(vertical: 12),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(8),
              ),
            ),
          ),
        ),
      ],
    ),
  );
}

class _Detail {
  final String label;
  final String value;
  final bool isStatus;
  final String? statusCode;
  const _Detail(
    this.label,
    this.value, {
    this.isStatus = false,
    this.statusCode,
  });
}
