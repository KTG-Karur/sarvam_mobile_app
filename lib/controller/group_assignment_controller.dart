import 'dart:async';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:sarvam/services/api_client.dart';
import 'package:sarvam/services/enrollment_api_service.dart';

/// Drives the BM-only "Center & Group Assignment" screen — a Flutter port
/// of the web app's `GroupAssignClient.tsx`. Two independent halves:
/// Tab 1 "Assign Center" (clients with no center yet) and Tab 2 "Reassign
/// Group" (moving/removing clients already in a center between its groups).
class GroupAssignmentController extends GetxController {
  final EnrollmentApiService api = EnrollmentApiService(ApiClient());

  final approvedCenters = <dynamic>[].obs;
  final isLoadingCenters = false.obs;

  @override
  void onInit() {
    super.onInit();
    loadApprovedCenters();
  }

  Future<void> loadApprovedCenters() async {
    isLoadingCenters.value = true;
    try {
      approvedCenters.assignAll(await api.getApprovedCenters());
    } catch (e) {
      debugPrint('Failed to load centers: $e');
    } finally {
      isLoadingCenters.value = false;
    }
  }

  // ---------------------------------------------------------------------
  // Tab 1 — Assign Center
  // ---------------------------------------------------------------------

  final unassignedClients = <dynamic>[].obs;
  final isLoadingUnassigned = false.obs;

  /// Per-row reactive state, keyed by the client's DB id (`client['id']`).
  final Map<String, Rxn<String>> rowCenterId = {};
  final Map<String, Rxn<String>> rowGroupId = {};
  final Map<String, RxList<dynamic>> rowGroups = {};
  final Map<String, RxBool> rowSubmitting = {};

  void _ensureRowState(String clientDbId, Map<String, dynamic> client) {
    rowCenterId.putIfAbsent(
      clientDbId,
      () => Rxn<String>(client['requestedCenterId']?.toString()),
    );
    rowGroupId.putIfAbsent(
      clientDbId,
      () => Rxn<String>(client['requestedGroupId']?.toString()),
    );
    rowGroups.putIfAbsent(clientDbId, () => <dynamic>[].obs);
    rowSubmitting.putIfAbsent(clientDbId, () => false.obs);
  }

  Future<void> loadUnassignedClients() async {
    isLoadingUnassigned.value = true;
    try {
      final clients = await api.getClients(noCenter: true);
      unassignedClients.assignAll(clients);
      for (final raw in clients) {
        if (raw is! Map) continue;
        final client = Map<String, dynamic>.from(raw);
        final clientDbId = client['id']?.toString();
        if (clientDbId == null) continue;
        _ensureRowState(clientDbId, client);
        // Prefill the row's group dropdown if the FDO's requested center is
        // already known, matching the web app's default-then-overridable
        // behavior.
        final requestedCenterId = client['requestedCenterId']?.toString();
        if (requestedCenterId != null && rowGroups[clientDbId]!.isEmpty) {
          unawaited(onRowCenterChanged(clientDbId, requestedCenterId));
        }
      }
    } catch (e) {
      Get.snackbar(
        'Error',
        'Failed to load unassigned clients: $e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
    } finally {
      isLoadingUnassigned.value = false;
    }
  }

  Future<void> onRowCenterChanged(String clientDbId, String? centerId) async {
    rowCenterId[clientDbId]?.value = centerId;
    rowGroupId[clientDbId]?.value = null;
    rowGroups[clientDbId]?.clear();
    if (centerId == null || centerId.isEmpty) return;
    try {
      final groups = await api.getGroupsForCenter(centerId);
      rowGroups[clientDbId]?.assignAll(groups);
    } catch (e) {
      debugPrint('Failed to load groups for row $clientDbId: $e');
    }
  }

  void onRowGroupChanged(String clientDbId, String? groupId) {
    rowGroupId[clientDbId]?.value = groupId;
  }

  void _removeUnassignedClient(String clientDbId) {
    unassignedClients.removeWhere(
      (c) => c is Map && c['id']?.toString() == clientDbId,
    );
    rowCenterId.remove(clientDbId);
    rowGroupId.remove(clientDbId);
    rowGroups.remove(clientDbId);
    rowSubmitting.remove(clientDbId);
  }

  /// Rows with both a center and group picked — what "Save Assignments (N)"
  /// would submit.
  List<String> get readyRowClientDbIds => unassignedClients
      .whereType<Map>()
      .map((c) => c['id']?.toString())
      .whereType<String>()
      .where(
        (id) =>
            rowCenterId[id]?.value != null && rowGroupId[id]?.value != null,
      )
      .toList();

  Future<bool> submitBulkAssignments() async {
    final ids = readyRowClientDbIds;
    if (ids.isEmpty) return false;
    try {
      final result = await api.submitCenterGroupAssignments(
        ids
            .map(
              (id) => {
                'clientDbId': id,
                'centerId': rowCenterId[id]!.value,
                'groupId': rowGroupId[id]!.value,
              },
            )
            .toList(),
      );
      for (final id in ids) {
        _removeUnassignedClient(id);
      }
      Get.snackbar(
        'Assigned',
        result['message']?.toString() ??
            'Assigned ${ids.length} client(s) successfully.',
        backgroundColor: const Color(0xFF008A3D),
        colorText: Colors.white,
      );
      return true;
    } catch (e) {
      Get.snackbar(
        'Assignment Failed',
        '$e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
        duration: const Duration(seconds: 5),
      );
      return false;
    }
  }

  Future<bool> submitIndividualAssignment(String clientDbId) async {
    final centerId = rowCenterId[clientDbId]?.value;
    final groupId = rowGroupId[clientDbId]?.value;
    if (centerId == null || groupId == null) return false;

    rowSubmitting[clientDbId]?.value = true;
    try {
      final result = await api.submitCenterGroupAssignments([
        {'clientDbId': clientDbId, 'centerId': centerId, 'groupId': groupId},
      ]);
      _removeUnassignedClient(clientDbId);
      Get.snackbar(
        'Assigned',
        result['message']?.toString() ?? 'Client assigned successfully.',
        backgroundColor: const Color(0xFF008A3D),
        colorText: Colors.white,
      );
      return true;
    } catch (e) {
      Get.snackbar(
        'Assignment Failed',
        '$e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
        duration: const Duration(seconds: 5),
      );
      return false;
    } finally {
      rowSubmitting[clientDbId]?.value = false;
    }
  }

  // ---------------------------------------------------------------------
  // Tab 2 — Reassign Group
  // ---------------------------------------------------------------------

  final Rxn<String> reassignCenterId = Rxn<String>();
  final groupsForReassignCenter = <dynamic>[].obs;
  final clientsInReassignCenter = <dynamic>[].obs;
  final isLoadingReassignCenter = false.obs;
  final isSubmittingReassignments = false.obs;

  /// clientId -> staged new groupId, or `''` to mean "remove from group".
  /// A client with no entry here has no pending change.
  final RxMap<String, String> pendingReassignments = <String, String>{}.obs;

  Future<void> loadReassignCenter(String? centerId) async {
    reassignCenterId.value = centerId;
    groupsForReassignCenter.clear();
    clientsInReassignCenter.clear();
    pendingReassignments.clear();
    if (centerId == null || centerId.isEmpty) return;

    isLoadingReassignCenter.value = true;
    try {
      final results = await Future.wait([
        api.getGroupsForCenter(centerId, availableOnly: false),
        api.getClients(centerId: centerId),
      ]);
      groupsForReassignCenter.assignAll(results[0]);
      clientsInReassignCenter.assignAll(results[1]);
    } catch (e) {
      Get.snackbar(
        'Error',
        'Failed to load center groups/clients: $e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
    } finally {
      isLoadingReassignCenter.value = false;
    }
  }

  /// [groupId] is `null` to clear a staged change (revert to current),
  /// or `''` to stage "remove from group".
  void stageReassignment(String clientId, String? groupId) {
    if (groupId == null) {
      pendingReassignments.remove(clientId);
    } else {
      pendingReassignments[clientId] = groupId;
    }
  }

  void discardReassignments() {
    pendingReassignments.clear();
  }

  Future<bool> submitReassignments() async {
    final centerId = reassignCenterId.value;
    if (centerId == null || pendingReassignments.isEmpty) return false;

    isSubmittingReassignments.value = true;
    try {
      final assignments = pendingReassignments.entries
          .map((e) => {'clientId': e.key, 'groupId': e.value})
          .toList();
      final result = await api.submitGroupReassignments(
        centerId,
        assignments,
      );
      pendingReassignments.clear();
      await loadReassignCenter(centerId);
      Get.snackbar(
        'Saved',
        result['message']?.toString() ?? 'Group assignments updated.',
        backgroundColor: const Color(0xFF008A3D),
        colorText: Colors.white,
      );
      return true;
    } catch (e) {
      Get.snackbar(
        'Save Failed',
        '$e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
        duration: const Duration(seconds: 5),
      );
      return false;
    } finally {
      isSubmittingReassignments.value = false;
    }
  }
}
