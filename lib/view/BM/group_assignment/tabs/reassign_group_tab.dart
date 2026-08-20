import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:sarvam/controller/group_assignment_controller.dart';
import 'package:sarvam/view/BM/group_assignment/widgets/id_dropdown.dart';

const _green = Color(0xFF0D6842);
const _removeFromGroupValue = '';

class ReassignGroupTab extends StatefulWidget {
  const ReassignGroupTab({super.key, required this.controller});

  final GroupAssignmentController controller;

  @override
  State<ReassignGroupTab> createState() => _ReassignGroupTabState();
}

class _ReassignGroupTabState extends State<ReassignGroupTab> {
  String _field(Map client, String key, [String fallback = '—']) {
    final v = client[key];
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

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: Obx(() {
            // `.toList()` forces a synchronous read inside Obx's own
            // builder — see the matching comment in assign_center_tab.dart
            // for why passing the RxList straight into a child widget's
            // `items` param isn't enough for it to react to later updates.
            final centersList = controller.approvedCenters.toList();
            return IdDropdown(
              label: 'Center Name',
              value: controller.reassignCenterId.value,
              items: centersList,
              labelBuilder: centerLabel,
              onChanged: controller.loadReassignCenter,
            );
          }),
        ),
        Expanded(
          child: Obx(() {
            if (controller.reassignCenterId.value == null) {
              return const Center(
                child: Text('Select a center to view its clients.'),
              );
            }
            if (controller.isLoadingReassignCenter.value) {
              return const Center(
                child: CircularProgressIndicator(color: _green),
              );
            }
            if (controller.clientsInReassignCenter.isEmpty) {
              return const Center(
                child: Text('No clients found in this center.'),
              );
            }
            return ListView.separated(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              itemCount: controller.clientsInReassignCenter.length,
              separatorBuilder: (_, __) => const SizedBox(height: 10),
              itemBuilder: (context, index) => _buildRow(
                Map<String, dynamic>.from(
                  controller.clientsInReassignCenter[index] as Map,
                ),
              ),
            );
          }),
        ),
        _buildActionBar(context),
      ],
    );
  }

  Widget _buildRow(Map<String, dynamic> client) {
    final controller = widget.controller;
    final clientId = client['id']?.toString() ?? '';
    final currentGroupId = client['groupId']?.toString();
    final name =
        '${_field(client, 'firstName', '')} ${_field(client, 'lastName', '')}'
            .trim();

    final hasLoan = client['hasLoan'] == true;
    final personLabel = hasLoan ? 'CLIENT' : 'MEMBER';

    return Obx(() {
      final staged = controller.pendingReassignments[clientId];
      final currentGroupName = currentGroupId == null
          ? 'Not assigned'
          : idLabel(controller.groupsForReassignCenter, currentGroupId);

      // Options: every group in the center except the client's current one,
      // filtered to spare capacity — but always keep whichever group is
      // already staged for this row selectable, even if another row's
      // staged pick has since filled it, so the dropdown never shows a
      // blank/invalid selection for a choice the user just made.
      final selectableGroups = controller.groupsForReassignCenter
          .whereType<Map>()
          .where((g) {
            final id = g['id']?.toString();
            if (id == currentGroupId) return false;
            if (id == staged) return true;
            final memberCount = g['memberCount'] is int ? g['memberCount'] as int : 0;
            final maxMembers =
                g['maxMembersPerGroup'] is int ? g['maxMembersPerGroup'] as int : 5;
            return memberCount < maxMembers;
          })
          .toList();

      return Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(color: const Color(0xFFE1EEE6)),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Flexible(
                  child: Text(
                    name.isEmpty ? 'Unnamed Client' : name,
                    style: const TextStyle(
                      fontWeight: FontWeight.w800,
                      fontSize: 13.5,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                const SizedBox(width: 6),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                  decoration: BoxDecoration(
                    color: const Color(0xFF037F35).withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    personLabel,
                    style: const TextStyle(
                      fontSize: 9,
                      fontWeight: FontWeight.w700,
                      color: Color(0xFF037F35),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 2),
            Text(
              'ID: ${_field(client, 'clientId')} • ${_field(client, 'mobileNumber')}',
              style: const TextStyle(fontSize: 11, color: Color(0xFF64748B)),
            ),
            if (client['spouseName'] != null) ...[
              const SizedBox(height: 2),
              Text(
                'Spouse: ${_field(client, 'spouseName')}',
                style: const TextStyle(fontSize: 11, color: Color(0xFF64748B)),
              ),
            ],
            const SizedBox(height: 6),
            Row(
              children: [
                const Text(
                  'Current Group: ',
                  style: TextStyle(fontSize: 11, color: Color(0xFF64748B)),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: currentGroupId == null
                        ? const Color(0xFFF1F5F9)
                        : const Color(0xFFFEF3C7),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    currentGroupName,
                    style: TextStyle(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w600,
                      color: currentGroupId == null
                          ? const Color(0xFF64748B)
                          : const Color(0xFFB45309),
                    ),
                  ),
                ),
                if (staged != null) ...[
                  const SizedBox(width: 6),
                  const Text(
                    '(pending change)',
                    style: TextStyle(fontSize: 10, color: Color(0xFFB45309)),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 10),
            IdDropdown(
              label: 'Assign to Group',
              value: staged,
              items: selectableGroups,
              labelBuilder: groupLabel,
              extraOptions: currentGroupId != null
                  ? const {_removeFromGroupValue: 'Remove from Group'}
                  : const {},
              onChanged: (v) => controller.stageReassignment(clientId, v),
            ),
          ],
        ),
      );
    });
  }

  Widget _buildActionBar(BuildContext context) {
    final controller = widget.controller;
    return Obx(() {
      final count = controller.pendingReassignments.length;
      if (controller.reassignCenterId.value == null) {
        return const SizedBox.shrink();
      }
      return Container(
        padding: const EdgeInsets.all(12),
        decoration: const BoxDecoration(
          color: Colors.white,
          border: Border(top: BorderSide(color: Color(0xFFE1EEE6))),
        ),
        child: Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: count == 0 ? null : controller.discardReassignments,
                child: const Text('Discard Changes'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              flex: 2,
              child: FilledButton(
                onPressed: count == 0 || controller.isSubmittingReassignments.value
                    ? null
                    : () async {
                        final ok = await _confirm(
                          'Save Changes',
                          'Save $count pending group change(s) for this center?',
                        );
                        if (ok) await controller.submitReassignments();
                      },
                style: FilledButton.styleFrom(backgroundColor: _green),
                child: controller.isSubmittingReassignments.value
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : Text('Save Changes ($count)'),
              ),
            ),
          ],
        ),
      );
    });
  }
}
