import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:sarvam/view/FDO/client_search_locate/tabs/locate_client_tab.dart';
import 'package:sarvam/view/FDO/client_search_locate/tabs/locate_center_tab.dart';

class ClientSearchLocate extends StatefulWidget {
  const ClientSearchLocate({super.key});

  @override
  State<ClientSearchLocate> createState() => _ClientSearchLocateState();
}

class _ClientSearchLocateState extends State<ClientSearchLocate> with SingleTickerProviderStateMixin {
  static const _green = Color(0xFF008A3D);
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5FBF7),
      appBar: AppBar(
        backgroundColor: _green,
        foregroundColor: Colors.white,
        elevation: 0,
        title: Text(
          'Client & Center Search',
          style: TextStyle(fontSize: 18.sp, fontWeight: FontWeight.w800),
        ),
        bottom: PreferredSize(
          preferredSize: Size.fromHeight(50.h),
          child: Container(
            color: Colors.white,
            child: TabBar(
              controller: _tabController,
              labelColor: _green,
              unselectedLabelColor: const Color(0xFF64748B),
              indicatorColor: _green,
              indicatorWeight: 3,
              labelStyle: TextStyle(fontSize: 13.sp, fontWeight: FontWeight.w700),
              tabs: const [
                Tab(text: 'Locate Client'),
                Tab(text: 'Locate Center'),
              ],
            ),
          ),
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: const [
          LocateClientTab(),
          LocateCenterTab(),
        ],
      ),
    );
  }
}
