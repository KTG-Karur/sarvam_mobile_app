import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:sarvam/controller/group_assignment_controller.dart';
import 'package:sarvam/view/BM/group_assignment/tabs/assign_center_tab.dart';
import 'package:sarvam/view/BM/group_assignment/tabs/reassign_group_tab.dart';

const _green = Color(0xFF0D6842);

/// BM-only "Center & Group Assignment" screen — a Flutter port of the web
/// app's `GroupAssignClient.tsx` ("Assign Center" + "Reassign Group" tabs).
class GroupAssignment extends StatefulWidget {
  const GroupAssignment({super.key});

  @override
  State<GroupAssignment> createState() => _GroupAssignmentState();
}

class _GroupAssignmentState extends State<GroupAssignment> {
  final GroupAssignmentController controller =
      Get.isRegistered<GroupAssignmentController>()
      ? Get.find<GroupAssignmentController>()
      : Get.put(GroupAssignmentController());

  @override
  Widget build(BuildContext context) => DefaultTabController(
    length: 2,
    child: Scaffold(
      backgroundColor: const Color(0xFFF2FAF5),
      appBar: AppBar(
        elevation: 0,
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF0F172A),
        title: const Text(
          'Center & Group Assignment',
          style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
        ),
        bottom: TabBar(
          labelColor: _green,
          unselectedLabelColor: const Color(0xFF64748B),
          indicatorColor: _green,
          tabs: [
            Tab(
              child: Obx(() {
                final count = controller.unassignedClients.length;
                return Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text('Assign Center'),
                    if (count > 0) ...[
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 1,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.red.shade600,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Text(
                          '$count',
                          style: const TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.bold,
                            color: Colors.white,
                          ),
                        ),
                      ),
                    ],
                  ],
                );
              }),
            ),
            const Tab(text: 'Reassign Group'),
          ],
        ),
      ),
      body: TabBarView(
        children: [
          AssignCenterTab(controller: controller),
          ReassignGroupTab(controller: controller),
        ],
      ),
    ),
  );
}
