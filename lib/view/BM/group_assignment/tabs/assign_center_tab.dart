import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:sarvam/controller/group_assignment_controller.dart';
import 'package:sarvam/view/BM/group_assignment/widgets/id_dropdown.dart';
import 'package:sarvam/view/BM/group_assignment/widgets/save_assignment_dialog.dart';

const _green = Color(0xFF0D6842);

class AssignCenterTab extends StatefulWidget {
  const AssignCenterTab({super.key, required this.controller});

  final GroupAssignmentController controller;

  @override
  State<AssignCenterTab> createState() => _AssignCenterTabState();
}

class _AssignCenterTabState extends State<AssignCenterTab> {
  bool _bulkMode = true;
  final _searchCtrl = TextEditingController();
  String _search = '';

  @override
  void initState() {
    super.initState();
    widget.controller.loadUnassignedClients();
    _searchCtrl.addListener(
      () => setState(() => _search = _searchCtrl.text.trim().toLowerCase()),
    );
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  String _field(Map client, String key, [String fallback = '—']) {
    final v = client[key];
    return v == null || v.toString().trim().isEmpty ? fallback : v.toString();
  }

  List<dynamic> _filtered(List<dynamic> clients) {
    if (_search.isEmpty) return clients;
    return clients.where((raw) {
      final c = raw as Map;
      final haystack = [
        _field(c, 'firstName', ''),
        _field(c, 'lastName', ''),
        _field(c, 'clientId', ''),
        _field(c, 'mobileNumber', ''),
      ].join(' ').toLowerCase();
      return haystack.contains(_search);
    }).toList();
  }

  Future<bool> _confirm(String title, String message, {int? count}) async {
    return showSaveAssignmentsDialog(
      context,
      title: title,
      message: message,
      count: count,
    );
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            children: [
              Row(
                children: [
                  Expanded(
                    child: ChoiceChip(
                      label: const Text('Bulk Assign'),
                      selected: _bulkMode,
                      onSelected: (_) => setState(() => _bulkMode = true),
                      selectedColor: _green,
                      labelStyle: TextStyle(
                        color: _bulkMode ? Colors.white : Colors.black87,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: ChoiceChip(
                      label: const Text('Individual Assign'),
                      selected: !_bulkMode,
                      onSelected: (_) => setState(() => _bulkMode = false),
                      selectedColor: _green,
                      labelStyle: TextStyle(
                        color: !_bulkMode ? Colors.white : Colors.black87,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _searchCtrl,
                decoration: const InputDecoration(
                  isDense: true,
                  prefixIcon: Icon(Icons.search, size: 18),
                  hintText: 'Search by member ID, name or mobile...',
                  border: OutlineInputBorder(),
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: Obx(() {
            if (controller.isLoadingUnassigned.value) {
              return const Center(child: CircularProgressIndicator(color: _green));
            }
            final clients = _filtered(controller.unassignedClients);
            if (clients.isEmpty) {
              return const Center(child: Text('No unassigned clients found.'));
            }
            return RefreshIndicator(
              color: _green,
              onRefresh: controller.loadUnassignedClients,
              child: ListView.separated(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                itemCount: clients.length,
                separatorBuilder: (_, __) => const SizedBox(height: 10),
                itemBuilder: (context, index) =>
                    _buildRow(context, Map<String, dynamic>.from(clients[index])),
              ),
            );
          }),
        ),
        if (_bulkMode) _buildBulkBar(context),
      ],
    );
  }

  Widget _buildRow(BuildContext context, Map<String, dynamic> client) {
    final controller = widget.controller;
    final clientDbId = client['id']?.toString() ?? '';
    final name = '${_field(client, 'firstName', '')} ${_field(client, 'lastName', '')}'
        .trim();

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
          Text(
            name.isEmpty ? 'Unnamed Client' : name,
            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5),
          ),
          const SizedBox(height: 2),
          Text(
            'ID: ${_field(client, 'clientId')} • ${_field(client, 'mobileNumber')}',
            style: const TextStyle(fontSize: 11, color: Color(0xFF64748B)),
          ),
          if (client['memberGroupStatus'] != null) ...[
            const SizedBox(height: 4),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: const Color(0xFFEAF6EE),
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(
                client['memberGroupStatus'] == 'NEW_CENTER_NEW_MEMBER'
                    ? 'New Center New Member'
                    : 'Existing Center New Member',
                style: const TextStyle(fontSize: 9.5, color: _green),
              ),
            ),
          ],
          if (client['requestedCenterName'] != null ||
              client['requestedGroupName'] != null) ...[
            const SizedBox(height: 6),
            Text(
              'Requested: ${_field(client, 'requestedCenterName')} / '
              '${_field(client, 'requestedGroupName')}',
              style: const TextStyle(fontSize: 10.5, color: Color(0xFF64748B)),
            ),
          ],
          const SizedBox(height: 10),
          Obx(() {
            final selectedCenterId = controller.rowCenterId[clientDbId]?.value;
            // `.toList()` forces a synchronous read of these RxLists here,
            // inside Obx's own builder — Obx only tracks reads that happen
            // in this exact call frame, not ones made later inside a child
            // widget's own build() (which is where IdDropdown would
            // otherwise read `items`), so without this the dropdown never
            // refreshes once groups finish loading for this row.
            final centersList = controller.approvedCenters.toList();
            final groupsList =
                controller.rowGroups[clientDbId]?.toList() ?? const [];
            return Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: IdDropdown(
                    label: 'Assign Center',
                    value: selectedCenterId,
                    items: centersList,
                    labelBuilder: centerLabel,
                    onChanged: (v) => controller.onRowCenterChanged(clientDbId, v),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: IdDropdown(
                    label: 'Assign Group',
                    value: controller.rowGroupId[clientDbId]?.value,
                    items: groupsList,
                    enabled: selectedCenterId != null,
                    labelBuilder: groupLabel,
                    onChanged: (v) =>
                        controller.onRowGroupChanged(clientDbId, v),
                  ),
                ),
              ],
            );
          }),
          if (!_bulkMode) ...[
            const SizedBox(height: 10),
            Obx(() {
              final ready = controller.rowCenterId[clientDbId]?.value != null &&
                  controller.rowGroupId[clientDbId]?.value != null;
              final submitting = controller.rowSubmitting[clientDbId]?.value ?? false;
              return SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: ready && !submitting
                      ? () async {
                          final ok = await _confirm(
                            'Assign Client',
                            'Assign this client to the selected center and group? '
                                'A new center-based Member ID will be generated.',
                          );
                          if (ok) {
                            await controller.submitIndividualAssignment(clientDbId);
                          }
                        }
                      : null,
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
                      : const Text('Assign'),
                ),
              );
            }),
          ],
        ],
      ),
    );
  }

  Widget _buildBulkBar(BuildContext context) {
    final controller = widget.controller;
    return Obx(() {
      final count = controller.readyRowClientDbIds.length;
      return Container(
        padding: const EdgeInsets.all(12),
        decoration: const BoxDecoration(
          color: Colors.white,
          border: Border(top: BorderSide(color: Color(0xFFE1EEE6))),
        ),
        child: SizedBox(
          width: double.infinity,
          child: FilledButton(
            onPressed: count == 0
                ? null
                : () async {
                    final ok = await _confirm(
                      'Confirm Center & Group Assignment',
                      'You are about to assign $count member(s) to their selected center and group.',
                      count: count,
                    );
                    if (ok) await controller.submitBulkAssignments();
                  },
            style: FilledButton.styleFrom(backgroundColor: _green),
            child: Text('Save Assignments ($count)'),
          ),
        ),
      );
    });
  }
}
