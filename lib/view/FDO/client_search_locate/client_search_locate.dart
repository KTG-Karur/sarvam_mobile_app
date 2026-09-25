import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:http/http.dart' as http;
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/secure_session_service.dart';
import 'package:sarvam/view/FDO/client_search_locate/location_navigation_screen.dart';

class ClientSearchLocate extends StatefulWidget {
  const ClientSearchLocate({super.key});

  @override
  State<ClientSearchLocate> createState() => _ClientSearchLocateState();
}

class ClientSearchItem {
  const ClientSearchItem({
    required this.accountId,
    required this.name,
    required this.center,
    required this.phone,
    required this.status,
    this.branchName = '',
    this.member,
    this.centerPoint,
    this.branchPoint,
  });

  factory ClientSearchItem.fromJson(Map<String, dynamic> json) {
    LatLng? point(String lat, String lng) {
      final la = json[lat], ln = json[lng];
      if (la is! num || ln is! num) return null;
      if (la == 0 && ln == 0) return null;
      return LatLng(la.toDouble(), ln.toDouble());
    }

    final center = json['centerName']?.toString() ?? '';
    return ClientSearchItem(
      accountId: (json['displayAccountId'] ?? json['accountId'] ?? '')
          .toString(),
      name: json['clientName']?.toString() ?? '',
      center: center.isEmpty ? 'No Center' : center,
      phone: json['phone']?.toString() ?? '',
      status: json['status']?.toString() ?? 'Active',
      branchName: json['branchName']?.toString() ?? '',
      member: point('memberLatitude', 'memberLongitude'),
      centerPoint:
          point('centerLatitude', 'centerLongitude') ??
          point('latitude', 'longitude'),
      branchPoint: point('branchLatitude', 'branchLongitude'),
    );
  }

  final String accountId;
  final String name;
  final String center;
  final String phone;
  final String status;
  final String branchName;
  final LatLng? member;
  final LatLng? centerPoint;
  final LatLng? branchPoint;
}

class _ClientSearchLocateState extends State<ClientSearchLocate> {
  static const _green = Color(0xFF008A3D);
  static const _darkGreen = Color(0xFF10472A);
  static const _mutedGreen = Color(0xFF4B8A68);
  static const _border = Color(0xFFD2E9DB);
  static const _lightGreen = Color(0xFFE4F5EB);
  static const _fill = Color(0xFFF7FBF7);

  List<ClientSearchItem> _allClients = const [];
  bool _loading = false;
  bool _searched = false;
  String? _error;
  final _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  final List<String> _searchTypes = const [
    'Search All (ID / Name / Phone)',
    'Search by ID',
    'Search by Name',
    'Search by Phone',
  ];

  List<String> get _centers => [
    'All Centers',
    ...{for (final c in _allClients) c.center},
  ];

  final List<String> _statuses = const [
    'All Status',
    'Active',
    'Inactive',
    'Pending',
  ];

  String _selectedSearchType = 'Search All (ID / Name / Phone)';
  String _selectedCenter = 'All Centers';
  String _selectedStatus = 'All Status';
  String _searchValue = '';

  List<ClientSearchItem> get _filteredClients {
    return _allClients.where((client) {
      final matchesCenter =
          _selectedCenter == 'All Centers' || client.center == _selectedCenter;
      final matchesStatus =
          _selectedStatus == 'All Status' || client.status == _selectedStatus;
      final query = _searchValue.toLowerCase();
      final matchesSearch =
          query.isEmpty ||
          client.accountId.toLowerCase().contains(query) ||
          client.name.toLowerCase().contains(query) ||
          client.phone.contains(query);
      return matchesCenter && matchesStatus && matchesSearch;
    }).toList();
  }

  String get _apiSearchType {
    switch (_searchTypes.indexOf(_selectedSearchType)) {
      case 1:
        return 'clientId';
      case 2:
        return 'clientName';
      case 3:
        return 'phone';
      default:
        return 'searchAll';
    }
  }

  Future<void> _search() async {
    FocusScope.of(context).unfocus();
    final value = _searchValue.trim();
    if (value.isEmpty) {
      setState(() => _error = 'Enter an ID, name or phone number to search.');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final token = await SecureSessionService.readAccessToken() ?? '';
      final uri = Uri.parse(Api.clientSearchUrl).replace(
        queryParameters: {
          'searchType': _apiSearchType,
          'searchValue': value,
          'page': '1',
          'pageSize': '50',
        },
      );
      final response = await http
          .get(
            uri,
            headers: {
              'Authorization': 'Bearer $token',
              'Content-Type': 'application/json',
            },
          )
          .timeout(const Duration(seconds: 20));
      final body = jsonDecode(response.body);
      if (response.statusCode != 200 ||
          body is! Map ||
          body['success'] != true) {
        final message = body is Map ? (body['message'] ?? body['error']) : null;
        throw Exception(message ?? 'Search failed (${response.statusCode})');
      }
      final list = (body['data'] as Map?)?['clients'];
      if (!mounted) return;
      setState(() {
        _allClients = list is List
            ? list
                  .whereType<Map>()
                  .map(
                    (m) =>
                        ClientSearchItem.fromJson(Map<String, dynamic>.from(m)),
                  )
                  .toList()
            : const [];
        _selectedCenter = _centers.first;
        _searched = true;
      });
    } catch (e) {
      if (!mounted) return;
      setState(
        () => _error = e is Exception
            ? e.toString().replaceFirst('Exception: ', '')
            : 'Unable to search clients. Check your connection.',
      );
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _openLocate(ClientSearchItem client) {
    final memberName = client.name.contains(' - ')
        ? client.name.split(' - ').last
        : client.name;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => LocationNavigationScreen(
          title: client.name,
          targets: [
            NavTarget(
              label: 'Member',
              name: memberName,
              icon: Icons.home_outlined,
              hue: BitmapDescriptor.hueRed,
              point: client.member,
            ),
            NavTarget(
              label: 'Centre',
              name: client.center,
              icon: Icons.groups_outlined,
              hue: BitmapDescriptor.hueGreen,
              point: client.centerPoint,
            ),
            NavTarget(
              label: 'Branch',
              name: client.branchName.isEmpty ? 'Branch' : client.branchName,
              icon: Icons.account_balance_outlined,
              hue: BitmapDescriptor.hueOrange,
              point: client.branchPoint,
            ),
          ],
        ),
      ),
    );
  }

  void _clearSearch() {
    _searchController.clear();
    setState(() {
      _allClients = const [];
      _searched = false;
      _error = null;
      _searchValue = '';
      _selectedSearchType = _searchTypes.first;
      _selectedCenter = _centers.first;
      _selectedStatus = _statuses.first;
    });
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'Active':
        return _green;
      case 'Pending':
        return const Color(0xFFC98A00);
      default:
        return const Color(0xFF64748B);
    }
  }

  Color _statusBg(String status) {
    switch (status) {
      case 'Active':
        return _lightGreen;
      case 'Pending':
        return const Color(0xFFFFF3E0);
      default:
        return const Color(0xFFF1F5F9);
    }
  }

  String _initials(String name) {
    final cleaned = name.contains(' - ') ? name.split(' - ').last : name;
    final parts = cleaned.trim().split(RegExp(r'\s+'));
    final letters = parts.where((p) => p.isNotEmpty).map((p) => p[0]).take(2);
    final initials = letters.join().toUpperCase();
    return initials.isEmpty ? '?' : initials;
  }

  Widget _actionChip(IconData icon, String label, VoidCallback onTap) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8.r),
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 7.h),
        decoration: BoxDecoration(
          color: _lightGreen,
          borderRadius: BorderRadius.circular(8.r),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 14.sp, color: _darkGreen),
            SizedBox(width: 5.w),
            Text(
              label,
              style: TextStyle(
                fontSize: 11.sp,
                fontWeight: FontWeight.w700,
                color: _darkGreen,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildClientCard(ClientSearchItem client) {
    return Padding(
      padding: EdgeInsets.only(bottom: 12.h),
      child: Container(
        width: double.infinity,
        padding: EdgeInsets.all(15.w),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16.r),
          border: Border.all(color: _border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  radius: 20.r,
                  backgroundColor: _lightGreen,
                  child: Text(
                    _initials(client.name),
                    style: TextStyle(
                      fontSize: 12.sp,
                      fontWeight: FontWeight.w800,
                      color: _darkGreen,
                    ),
                  ),
                ),
                SizedBox(width: 10.w),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        client.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 14.sp,
                          fontWeight: FontWeight.w800,
                          color: _darkGreen,
                        ),
                      ),
                      SizedBox(height: 2.h),
                      Text(
                        client.accountId,
                        style: TextStyle(fontSize: 11.sp, color: _mutedGreen),
                      ),
                    ],
                  ),
                ),
                Container(
                  padding: EdgeInsets.symmetric(
                    horizontal: 10.w,
                    vertical: 5.h,
                  ),
                  decoration: BoxDecoration(
                    color: _statusBg(client.status),
                    borderRadius: BorderRadius.circular(20.r),
                  ),
                  child: Text(
                    client.status,
                    style: TextStyle(
                      fontSize: 10.sp,
                      fontWeight: FontWeight.w700,
                      color: _statusColor(client.status),
                    ),
                  ),
                ),
              ],
            ),
            Divider(height: 22.h, color: const Color(0xFFE2F1E8)),
            Row(
              children: [
                Icon(Icons.map_outlined, size: 15.sp, color: _mutedGreen),
                SizedBox(width: 6.w),
                Expanded(
                  child: Text(
                    client.center,
                    style: TextStyle(fontSize: 12.sp, color: _mutedGreen),
                  ),
                ),
                Icon(Icons.call_outlined, size: 14.sp, color: _mutedGreen),
                SizedBox(width: 6.w),
                Text(
                  client.phone,
                  style: TextStyle(
                    fontSize: 12.sp,
                    fontWeight: FontWeight.w600,
                    color: _darkGreen,
                  ),
                ),
              ],
            ),
            SizedBox(height: 12.h),
            Wrap(
              spacing: 8.w,
              runSpacing: 8.h,
              children: [
                _actionChip(
                  Icons.location_on_outlined,
                  'Locate',
                  () => _openLocate(client),
                ),
                _actionChip(Icons.remove_red_eye_outlined, 'KYC', () {}),
                _actionChip(Icons.receipt_long_outlined, 'Loans', () {}),
                _actionChip(Icons.trending_up_outlined, 'Advance', () {}),
                _actionChip(Icons.shield_outlined, 'Highmark', () {}),
              ],
            ),
          ],
        ),
      ),
    );
  }

  InputDecoration _dropdownDecoration() => InputDecoration(
    isDense: true,
    filled: true,
    fillColor: _fill,
    contentPadding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 12.h),
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(10.r),
      borderSide: const BorderSide(color: _border),
    ),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(10.r),
      borderSide: const BorderSide(color: _border),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(10.r),
      borderSide: const BorderSide(color: _green, width: 1.5),
    ),
  );

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5FBF7),
      appBar: AppBar(
        backgroundColor: _green,
        foregroundColor: Colors.white,
        elevation: 0,
        title: Text(
          'Client Search & Locate',
          style: TextStyle(fontSize: 18.sp, fontWeight: FontWeight.w800),
        ),
      ),
      body: SafeArea(
        top: false,
        child: ListView(
          padding: EdgeInsets.fromLTRB(16.w, 16.h, 16.w, 24.h),
          children: [
            Text(
              'Search for clients and view their location on the map',
              style: TextStyle(fontSize: 12.sp, color: _mutedGreen),
            ),
            SizedBox(height: 16.h),
            Container(
              padding: EdgeInsets.all(15.w),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16.r),
                border: Border.all(color: _border),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  DropdownButtonFormField<String>(
                    isExpanded: true,
                    initialValue: _selectedSearchType,
                    decoration: _dropdownDecoration(),
                    items: _searchTypes
                        .map(
                          (type) => DropdownMenuItem(
                            value: type,
                            child: Text(type, style: TextStyle(fontSize: 12.sp)),
                          ),
                        )
                        .toList(),
                    onChanged: (value) {
                      if (value != null) {
                        setState(() => _selectedSearchType = value);
                      }
                    },
                  ),
                  SizedBox(height: 12.h),
                  TextField(
                    controller: _searchController,
                    textInputAction: TextInputAction.search,
                    onSubmitted: (_) => _search(),
                    style: TextStyle(fontSize: 13.sp),
                    decoration: InputDecoration(
                      hintText: 'Enter value to search',
                      hintStyle: TextStyle(
                        color: const Color(0xFF86A897),
                        fontSize: 12.sp,
                      ),
                      filled: true,
                      fillColor: _fill,
                      prefixIcon: Icon(
                        Icons.search,
                        color: _mutedGreen,
                        size: 20.sp,
                      ),
                      contentPadding: EdgeInsets.symmetric(vertical: 12.h),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10.r),
                        borderSide: const BorderSide(color: _border),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10.r),
                        borderSide: const BorderSide(color: _border),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10.r),
                        borderSide: const BorderSide(color: _green, width: 1.5),
                      ),
                    ),
                    onChanged: (value) => setState(() => _searchValue = value),
                  ),
                  SizedBox(height: 12.h),
                  Row(
                    children: [
                      Expanded(
                        child: DropdownButtonFormField<String>(
                          isExpanded: true,
                          initialValue: _selectedCenter,
                          decoration: _dropdownDecoration(),
                          items: _centers
                              .map(
                                (center) => DropdownMenuItem(
                                  value: center,
                                  child: Text(
                                    center,
                                    style: TextStyle(fontSize: 12.sp),
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              )
                              .toList(),
                          onChanged: (value) {
                            if (value != null) {
                              setState(() => _selectedCenter = value);
                            }
                          },
                        ),
                      ),
                      SizedBox(width: 10.w),
                      Expanded(
                        child: DropdownButtonFormField<String>(
                          isExpanded: true,
                          initialValue: _selectedStatus,
                          decoration: _dropdownDecoration(),
                          items: _statuses
                              .map(
                                (status) => DropdownMenuItem(
                                  value: status,
                                  child: Text(
                                    status,
                                    style: TextStyle(fontSize: 12.sp),
                                  ),
                                ),
                              )
                              .toList(),
                          onChanged: (value) {
                            if (value != null) {
                              setState(() => _selectedStatus = value);
                            }
                          },
                        ),
                      ),
                    ],
                  ),
                  SizedBox(height: 14.h),
                  Row(
                    children: [
                      Expanded(
                        child: SizedBox(
                          height: 47.h,
                          child: ElevatedButton.icon(
                            style: ElevatedButton.styleFrom(
                              backgroundColor: _green,
                              foregroundColor: Colors.white,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(10.r),
                              ),
                            ),
                            icon: _loading
                                ? SizedBox(
                                    width: 16.w,
                                    height: 16.w,
                                    child: const CircularProgressIndicator(
                                      strokeWidth: 2,
                                      color: Colors.white,
                                    ),
                                  )
                                : Icon(Icons.search, size: 18.sp),
                            label: Text(
                              _loading ? 'Searching…' : 'Search',
                              style: TextStyle(
                                fontSize: 13.sp,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            onPressed: _loading ? null : _search,
                          ),
                        ),
                      ),
                      SizedBox(width: 10.w),
                      SizedBox(
                        height: 47.h,
                        width: 47.h,
                        child: IconButton(
                          onPressed: _clearSearch,
                          icon: Icon(Icons.refresh, color: _green, size: 20.sp),
                          style: IconButton.styleFrom(
                            backgroundColor: _lightGreen,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10.r),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            if (_error != null) ...[
              SizedBox(height: 12.h),
              Text(
                _error!,
                style: TextStyle(fontSize: 12.sp, color: Colors.redAccent),
              ),
            ],
            SizedBox(height: 18.h),
            if (_searched)
              Text(
                'Showing ${_filteredClients.length} of ${_allClients.length} clients',
                style: TextStyle(
                  fontSize: 13.sp,
                  fontWeight: FontWeight.w800,
                  color: _darkGreen,
                ),
              ),
            SizedBox(height: 12.h),
            ..._filteredClients.map(_buildClientCard),
            if (_searched && _filteredClients.isEmpty)
              Container(
                width: double.infinity,
                padding: EdgeInsets.all(24.w),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(16.r),
                  border: Border.all(color: _border),
                ),
                child: Column(
                  children: [
                    Icon(
                      Icons.person_search_outlined,
                      size: 34.sp,
                      color: _mutedGreen,
                    ),
                    SizedBox(height: 10.h),
                    Text(
                      'No clients match your search.',
                      style: TextStyle(
                        fontSize: 13.sp,
                        fontWeight: FontWeight.w700,
                        color: _darkGreen,
                      ),
                    ),
                    SizedBox(height: 4.h),
                    Text(
                      'Update filters or search text and try again.',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 11.sp, color: _mutedGreen),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}
