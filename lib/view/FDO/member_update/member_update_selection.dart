import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/services/api_client.dart';
import 'package:sarvam/services/enrollment_api_service.dart';
import 'package:sarvam/view/FDO/new_member_create/widgets/enrollment_field_widgets.dart';
import 'package:sarvam/view/FDO/member_update/member_update_form.dart';
import 'package:sarvam/controller/member_update/member_update_controller.dart';

class MemberUpdateSelection extends StatefulWidget {
  const MemberUpdateSelection({super.key});

  @override
  State<MemberUpdateSelection> createState() => _MemberUpdateSelectionState();
}

class _MemberUpdateSelectionState extends State<MemberUpdateSelection> {
  final EnrollmentApiService api = EnrollmentApiService(ApiClient());
  
  String? selectedBranchId;
  String? selectedClientId;
  
  List<Map<String, dynamic>> branches = [];
  List<dynamic> clients = [];
  bool isLoadingBranches = true;
  bool isLoadingClients = false;

  @override
  void initState() {
    super.initState();
    _loadAssignedBranches();
  }

  Future<void> _loadAssignedBranches() async {
    setState(() => isLoadingBranches = true);
    final prefs = await SharedPreferences.getInstance();
    final branchId = prefs.getString('branchId');
    final branchName = prefs.getString('branchName');
    final assignedIds = prefs.getStringList('assignedBranchIds') ?? [];
    
    // In many parts of this app, if assignedBranchIds is present, it's the 
    // source of truth for what branches an FDO can see.
    if (assignedIds.isNotEmpty) {
      // We might need to fetch names for these IDs if not available.
      // For now, let's assume we can at least show the current branch.
      branches = assignedIds.map((id) => {'id': id, 'name': id == branchId ? (branchName ?? id) : 'Branch $id'}).toList();
    } else if (branchId != null) {
      branches = [{'id': branchId, 'name': branchName ?? 'Current Branch'}];
    }
    
    if (branches.isNotEmpty) {
      selectedBranchId = branches.first['id'];
      _loadClients();
    }
    
    setState(() => isLoadingBranches = false);
  }

  Future<void> _loadClients() async {
    if (selectedBranchId == null) return;
    setState(() => isLoadingClients = true);
    try {
      final results = await api.getClients();
      debugPrint("Clients API Result (first item): ${results.isNotEmpty ? jsonEncode(results.first) : 'Empty'}");
      setState(() {
        clients = results;
        isLoadingClients = false;
      });
    } catch (e) {
      setState(() => isLoadingClients = false);
      Get.snackbar('Error', 'Failed to load clients: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF4FBF6),
      appBar: AppBar(
        title: const Text('Select Member to Update'),
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF10472A),
        elevation: 0,
      ),
      body: Padding(
        padding: EdgeInsets.all(16.w),
        child: Column(
          children: [
            EnrollmentSelectField(
              label: 'Branch',
              value: selectedBranchId,
              enabled: branches.length > 1,
              options: branches.map((e) => e['id'] as String).toList(),
              labelBuilder: (id) => branches.firstWhere((b) => b['id'] == id)['name'],
              required: true,
              onChanged: (val) {
                setState(() {
                  selectedBranchId = val;
                  selectedClientId = null;
                });
                _loadClients();
              },
            ),
            SizedBox(height: 16.h),
            if (isLoadingClients)
              const Center(child: CircularProgressIndicator())
            else
              EnrollmentSelectField(
                label: 'Client',
                value: selectedClientId,
                required: true,
                // Using clientId (business ID) instead of id (UUID) for the URL
                options: clients.map((e) => (e['clientId'] ?? e['id']).toString()).toList(),
                labelBuilder: (id) {
                  final c = clients.firstWhereOrNull((element) => 
                      (element['clientId']?.toString() == id) || (element['id']?.toString() == id));
                  if (c == null) return "Unknown";
                  
                  final name = c['name'] ?? 
                              "${c['firstName'] ?? ''} ${c['lastName'] ?? ''}".trim();
                  final displayId = c['clientId'] ?? c['id'];
                  
                  return "$displayId - ${name.isEmpty ? 'No Name' : name}";
                },
                onChanged: (val) {
                  setState(() => selectedClientId = val);
                },
              ),
            const Spacer(),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: selectedClientId == null ? null : () {
                  // Ensure fresh controller and data for the selected client
                  if (Get.isRegistered<MemberUpdateController>()) {
                    Get.delete<MemberUpdateController>(force: true);
                  }
                  
                  Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => MemberUpdateForm(clientId: selectedClientId!),
                    ),
                  ).then((_) {
                    // Refresh client list when coming back to reflect any changes
                    if (mounted) {
                      setState(() => selectedClientId = null);
                      _loadClients();
                    }
                  });
                },
                style: FilledButton.styleFrom(
                  backgroundColor: const Color(0xFF00843D),
                  padding: EdgeInsets.symmetric(vertical: 16.h),
                ),
                child: const Text('Proceed to Update'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
