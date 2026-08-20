import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';

class ClientUpdate extends StatefulWidget {
  const ClientUpdate({super.key});

  @override
  State<ClientUpdate> createState() => _ClientUpdateState();
}

class ClientModel {
  final String id;
  String name;
  String phone;
  String center;
  String status;
  Map<String, String> kycDocs; // Document Name -> Status
  String address;
  String dob;
  String coApplicantName;
  String coApplicantRelation;
  String coApplicantPhone;

  ClientModel({
    required this.id,
    required this.name,
    required this.phone,
    required this.center,
    required this.status,
    required this.kycDocs,
    required this.address,
    required this.dob,
    required this.coApplicantName,
    required this.coApplicantRelation,
    required this.coApplicantPhone,
  });
}

class _ClientUpdateState extends State<ClientUpdate> {
  late List<ClientModel> _allClients;
  List<ClientModel> _filteredClients = [];
  ClientModel? _selectedClient;
  String _searchQuery = "";
  int _activeTabIndex = 0;

  // Controllers
  late TextEditingController _searchController;
  late TextEditingController _nameController;
  late TextEditingController _phoneController;
  late TextEditingController _dobController;
  late TextEditingController _addressController;
  late TextEditingController _coNameController;
  late TextEditingController _coPhoneController;
  String _selectedCoRelation = 'Spouse';

  @override
  void initState() {
    super.initState();
    _searchController = TextEditingController();
    _nameController = TextEditingController();
    _phoneController = TextEditingController();
    _dobController = TextEditingController();
    _addressController = TextEditingController();
    _coNameController = TextEditingController();
    _coPhoneController = TextEditingController();

    // Populate mock clients (total 32 to match desktop view count indicator)
    _allClients = _generateMockClients();
    _filteredClients = List.from(_allClients);
  }

  @override
  void dispose() {
    _searchController.dispose();
    _nameController.dispose();
    _phoneController.dispose();
    _dobController.dispose();
    _addressController.dispose();
    _coNameController.dispose();
    _coPhoneController.dispose();
    super.dispose();
  }

  List<ClientModel> _generateMockClients() {
    final names = [
      'Julie M', 'Rahini R', 'Preetha Marimuthu', 'Alaguranjitha S', 'Ragu Ram',
      'Karpagam K', 'Meenakshi Sundaram', 'Priya Dharshini', 'Anjali Devi', 'Kavitha P',
      'Sundari M', 'Kokila S', 'Gayathri R', 'Selvi Kumar', 'Uma Rani',
      'Shanthi G', 'Banumathi A', 'Muthulakshmi K', 'Vijayalakshmi R', 'Lakshmi P',
      'Chitra S', 'Radha Murugan', 'Saradha B', 'Revathi T', 'Jaya Prada',
      'Gowri S', 'Indira Gandhi', 'Bhuvaneshwari K', 'Dhivya M', 'Rajeshwari P',
      'Kanaga V', 'Nithya R'
    ];

    final centers = [
      'No Center', 'FOREST ROAD 2', 'SOKKADEVANPATTI - 1', 'SOKKADEVANPATTI - 2', 'T.V.K. ROAD'
    ];

    return List.generate(32, (index) {
      final name = names[index % names.length];
      final id = index == 0 ? 'DRF-3-5' : (index == 1 ? '3-6-1-1' : '3-5-2-${index + 1}');
      final phone = '${6000000000 + (index * 123456789) % 3999999999}';
      final center = index == 0 ? 'No Center' : (index == 1 ? 'FOREST ROAD 2' : centers[index % centers.length]);
      
      return ClientModel(
        id: id,
        name: name,
        phone: phone,
        center: center,
        status: 'Active',
        kycDocs: {
          'Aadhar Card': index % 5 == 0 ? 'Not Uploaded' : 'Verified',
          'PAN Card': index % 3 == 0 ? 'Pending Review' : 'Verified',
          'Voter ID': index % 4 == 0 ? 'Not Uploaded' : 'Verified',
        },
        address: 'No. ${10 + index}, Gandhi Street, ${center == "No Center" ? "Madurai" : center}',
        dob: '${10 + (index % 18)}-0${(index % 9) + 1}-19${75 + (index % 25)}',
        coApplicantName: '${name.split(" ").first} Husband/Father',
        coApplicantRelation: index % 3 == 0 ? 'Father' : 'Spouse',
        coApplicantPhone: '${9000000000 + (index * 987654321) % 999999999}',
      );
    });
  }

  void _onSearchChanged(String query) {
    setState(() {
      _searchQuery = query;
      if (query.isEmpty) {
        _filteredClients = List.from(_allClients);
      } else {
        _filteredClients = _allClients.where((client) {
          return client.name.toLowerCase().contains(query.toLowerCase()) ||
              client.id.toLowerCase().contains(query.toLowerCase()) ||
              client.phone.contains(query);
        }).toList();
      }
    });
  }

  void _onClientSelected(ClientModel? client) {
    setState(() {
      _selectedClient = client;
      _activeTabIndex = 0; // Reset tab back to KYC Docs
      if (client != null) {
        _nameController.text = client.name;
        _phoneController.text = client.phone;
        _dobController.text = client.dob;
        _addressController.text = client.address;
        _coNameController.text = client.coApplicantName;
        _selectedCoRelation = client.coApplicantRelation;
        _coPhoneController.text = client.coApplicantPhone;
      }
    });
  }

  List<DropdownMenuItem<ClientModel>> get _dropdownItems {
    final Set<ClientModel> itemsSet = Set.from(_filteredClients);
    if (_selectedClient != null) {
      itemsSet.add(_selectedClient!);
    }
    return itemsSet.map((client) {
      return DropdownMenuItem<ClientModel>(
        value: client,
        child: Text('${client.id} - ${client.name}', style: TextStyle(fontSize: 14.sp)),
      );
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      body: SafeArea(
        child: Column(
          children: [
            // Styled App Header with back navigation
            _buildHeader(),
            
            // Scrollable forms
            Expanded(
              child: SingleChildScrollView(
                padding: EdgeInsets.symmetric(horizontal: 16.w),
                physics: const BouncingScrollPhysics(),
                child: Column(
                  children: [
                    SizedBox(height: 16.h),
                    
                    // Select Client Widget Card
                    _buildSelectClientCard(),
                    
                    SizedBox(height: 18.h),
                    
                    // Conditionally show selection placeholder or forms
                    _buildDetailOptions(),
                    
                    SizedBox(height: 24.h),
                    
                    // Bottom Branding
                    _buildFooter(),
                    
                    SizedBox(height: 20.h),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      color: Colors.white,
      padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 12.h),
      child: Row(
        children: [
          GestureDetector(
            onTap: () => Navigator.maybePop(context),
            child: Container(
              padding: EdgeInsets.all(6.r),
              decoration: BoxDecoration(
                color: const Color(0xFFF1F5F2),
                borderRadius: BorderRadius.circular(8.r),
              ),
              child: Icon(
                Icons.arrow_back,
                color: const Color(0xFF0C5F34),
                size: 20.sp,
              ),
            ),
          ),
          SizedBox(width: 12.w),
          Expanded(
            child: Row(
              children: [
                Container(
                  padding: EdgeInsets.all(8.r),
                  decoration: BoxDecoration(
                    color: const Color(0xFFE5F7EA),
                    borderRadius: BorderRadius.circular(10.r),
                  ),
                  child: Icon(
                    Icons.change_circle_outlined,
                    color: const Color(0xFF0C5F34),
                    size: 22.sp,
                  ),
                ),
                SizedBox(width: 10.w),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Client Update',
                        style: TextStyle(
                          fontSize: 18.sp,
                          fontWeight: FontWeight.w800,
                          color: const Color(0xFF0C5F34),
                        ),
                      ),
                      Text(
                        'Manage KYC, details & co-applicant info',
                        style: TextStyle(
                          fontSize: 10.sp,
                          color: const Color(0xFF4F765E),
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSelectClientCard() {
    return Container(
      padding: EdgeInsets.all(16.r),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18.r),
        border: Border.all(color: const Color(0xFFD7E9DD)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Select Client',
            style: TextStyle(
              fontSize: 15.sp,
              fontWeight: FontWeight.bold,
              color: const Color(0xFF0F172A),
            ),
          ),
          SizedBox(height: 2.h),
          Text(
            'Choose a client to manage their KYC information',
            style: TextStyle(
              fontSize: 11.sp,
              color: const Color(0xFF64748B),
            ),
          ),
          SizedBox(height: 14.h),
          
          // Search Client Field
          Text(
            'Search Client',
            style: TextStyle(
              fontSize: 12.sp,
              fontWeight: FontWeight.bold,
              color: const Color(0xFF4F765E),
            ),
          ),
          SizedBox(height: 6.h),
          TextField(
            controller: _searchController,
            onChanged: _onSearchChanged,
            style: TextStyle(fontSize: 14.sp),
            decoration: InputDecoration(
              hintText: 'Search by name, client ID or phone...',
              hintStyle: const TextStyle(color: Color(0xFF8FA88B)),
              filled: true,
              fillColor: const Color(0xFFF7FBF7),
              prefixIcon: const Icon(Icons.search, color: Color(0xFF729A7D)),
              contentPadding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 10.h),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12.r),
                borderSide: const BorderSide(color: Color(0xFFD7E9DD)),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12.r),
                borderSide: const BorderSide(color: Color(0xFFD7E9DD)),
              ),
            ),
          ),
          SizedBox(height: 14.h),

          // Client Name Dropdown Field
          Text(
            'Client Name *',
            style: TextStyle(
              fontSize: 12.sp,
              fontWeight: FontWeight.bold,
              color: const Color(0xFF4F765E),
            ),
          ),
          SizedBox(height: 6.h),
          DropdownButtonFormField<ClientModel>(
            key: ValueKey(_selectedClient?.id),
            isExpanded: true,
            initialValue: _selectedClient != null && _allClients.contains(_selectedClient)
                ? _selectedClient
                : null,
            hint: Text('-- SELECT --', style: TextStyle(fontSize: 14.sp, color: const Color(0xFF8FA88B))),
            decoration: InputDecoration(
              filled: true,
              fillColor: const Color(0xFFF7FBF7),
              contentPadding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 10.h),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12.r),
                borderSide: const BorderSide(color: Color(0xFFD7E9DD)),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12.r),
                borderSide: const BorderSide(color: Color(0xFFD7E9DD)),
              ),
            ),
            items: _dropdownItems,
            onChanged: _onClientSelected,
          ),
          SizedBox(height: 6.h),
          Text(
            '${_filteredClients.length} clients found',
            style: TextStyle(
              fontSize: 10.sp,
              color: const Color(0xFF729A7D),
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDetailOptions() {
    if (_selectedClient == null) {
      return _buildNoClientSelectedPlaceholder();
    }

    return Column(
      children: [
        // Selected Client Quick Info Banner
        _buildClientOverviewCard(),
        
        SizedBox(height: 16.h),
        
        // Tab selector headers
        _buildTabs(),
        
        SizedBox(height: 16.h),
        
        // Dynamic Tab Content Card
        Container(
          padding: EdgeInsets.all(16.r),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(18.r),
            border: Border.all(color: const Color(0xFFD7E9DD)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_activeTabIndex == 0) _buildKycDocsTab(),
              if (_activeTabIndex == 1) _buildPersonalDetailsTab(),
              if (_activeTabIndex == 2) _buildCoApplicantTab(),
              
              if (_activeTabIndex != 0) ...[
                SizedBox(height: 20.h),
                _buildSaveButton(),
              ],
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildNoClientSelectedPlaceholder() {
    return CustomPaint(
      painter: DashedBorderPainter(
        color: const Color(0xFFD7E9DD),
        borderRadius: 18.r,
      ),
      child: Container(
        width: double.infinity,
        padding: EdgeInsets.symmetric(vertical: 40.h, horizontal: 20.w),
        decoration: BoxDecoration(
          color: Colors.white.withAlpha(128),
          borderRadius: BorderRadius.circular(18.r),
        ),
        child: Column(
          children: [
            Icon(
              Icons.person_off_outlined,
              size: 48.sp,
              color: const Color(0xFF8FA88B),
            ),
            SizedBox(height: 12.h),
            Text(
              'No Client Selected',
              style: TextStyle(
                fontSize: 15.sp,
                fontWeight: FontWeight.bold,
                color: const Color(0xFF0F172A),
              ),
            ),
            SizedBox(height: 6.h),
            Text(
              'Select a client above to view and manage their KYC documents, details, and co-applicant information.',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 11.sp,
                color: const Color(0xFF64748B),
                height: 1.4,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildClientOverviewCard() {
    return Container(
      padding: EdgeInsets.all(14.r),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF0C5F34), Color(0xFF0D6842)],
        ),
        borderRadius: BorderRadius.circular(18.r),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF0C5F34).withAlpha(38),
            blurRadius: 10,
            offset: const Offset(0, 4),
          )
        ],
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 24.r,
            backgroundColor: const Color(0xFFE5F7EA),
            child: Text(
              _selectedClient!.name.isNotEmpty ? _selectedClient!.name[0].toUpperCase() : 'C',
              style: TextStyle(
                color: const Color(0xFF0C5F34),
                fontWeight: FontWeight.bold,
                fontSize: 18.sp,
              ),
            ),
          ),
          SizedBox(width: 12.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        _selectedClient!.name,
                        style: TextStyle(
                          fontSize: 15.sp,
                          fontWeight: FontWeight.bold,
                          color: Colors.white,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    Container(
                      padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 2.h),
                      decoration: BoxDecoration(
                        color: Colors.white24,
                        borderRadius: BorderRadius.circular(6.r),
                      ),
                      child: Text(
                        _selectedClient!.status,
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 9.sp,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ],
                ),
                SizedBox(height: 4.h),
                Text(
                  'ID: ${_selectedClient!.id}  •  ${_selectedClient!.center}',
                  style: TextStyle(
                    fontSize: 11.sp,
                    color: Colors.white.withAlpha(204),
                  ),
                ),
                SizedBox(height: 2.h),
                Text(
                  'Phone: ${_selectedClient!.phone}',
                  style: TextStyle(
                    fontSize: 11.sp,
                    color: Colors.white.withAlpha(204),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTabs() {
    return Row(
      children: [
        _buildTabItem(0, 'KYC Docs', Icons.folder_shared_outlined),
        SizedBox(width: 8.w),
        _buildTabItem(1, 'Details', Icons.person_outline),
        SizedBox(width: 8.w),
        _buildTabItem(2, 'Co-Applicant', Icons.people_outline),
      ],
    );
  }

  Widget _buildTabItem(int index, String label, IconData icon) {
    final isSelected = _activeTabIndex == index;
    return Expanded(
      child: GestureDetector(
        onTap: () {
          setState(() {
            _activeTabIndex = index;
          });
        },
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: EdgeInsets.symmetric(vertical: 10.h),
          decoration: BoxDecoration(
            color: isSelected ? const Color(0xFF0C5F34) : const Color(0xFFF1F5F2),
            borderRadius: BorderRadius.circular(12.r),
            border: Border.all(
              color: isSelected ? const Color(0xFF0C5F34) : const Color(0xFFD7E9DD),
              width: 1,
            ),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                icon,
                size: 18.sp,
                color: isSelected ? Colors.white : const Color(0xFF4F765E),
              ),
              SizedBox(height: 4.h),
              Text(
                label,
                style: TextStyle(
                  fontSize: 10.sp,
                  fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                  color: isSelected ? Colors.white : const Color(0xFF4F765E),
                ),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildKycDocsTab() {
    final docs = _selectedClient!.kycDocs;
    return Column(
      children: docs.entries.map((entry) {
        final docName = entry.key;
        final docStatus = entry.value;
        
        Color statusColor;
        Color statusBg;
        IconData statusIcon;
        
        switch (docStatus) {
          case 'Verified':
            statusColor = const Color(0xFF0D6842);
            statusBg = const Color(0xFFE8F5E9);
            statusIcon = Icons.check_circle_outline;
            break;
          case 'Pending Review':
            statusColor = const Color(0xFFB57000);
            statusBg = const Color(0xFFFFF3E0);
            statusIcon = Icons.info_outline;
            break;
          default: // 'Not Uploaded'
            statusColor = const Color(0xFFC62828);
            statusBg = const Color(0xFFFFEBEE);
            statusIcon = Icons.error_outline;
        }

        return Container(
          margin: EdgeInsets.only(bottom: 12.h),
          padding: EdgeInsets.all(12.r),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14.r),
            border: Border.all(color: const Color(0xFFE0E0E0)),
          ),
          child: Row(
            children: [
              Container(
                padding: EdgeInsets.all(8.r),
                decoration: BoxDecoration(
                  color: const Color(0xFFF1F5F2),
                  borderRadius: BorderRadius.circular(8.r),
                ),
                child: Icon(
                  docName.contains('Aadhar') 
                      ? Icons.badge_outlined 
                      : (docName.contains('PAN') ? Icons.credit_card_outlined : Icons.how_to_vote_outlined),
                  color: const Color(0xFF4F765E),
                  size: 24.sp,
                ),
              ),
              SizedBox(width: 12.w),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      docName,
                      style: TextStyle(
                        fontSize: 14.sp,
                        fontWeight: FontWeight.bold,
                        color: const Color(0xFF0F172A),
                      ),
                    ),
                    SizedBox(height: 4.h),
                    Container(
                      padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 2.h),
                      decoration: BoxDecoration(
                        color: statusBg,
                        borderRadius: BorderRadius.circular(6.r),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(statusIcon, color: statusColor, size: 10.sp),
                          SizedBox(width: 4.w),
                          Text(
                            docStatus,
                            style: TextStyle(
                              color: statusColor,
                              fontSize: 10.sp,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              _buildDocActionButton(docName, docStatus),
            ],
          ),
        );
      }).toList(),
    );
  }

  Widget _buildDocActionButton(String docName, String status) {
    if (status == 'Verified') {
      return TextButton.icon(
        style: TextButton.styleFrom(
          foregroundColor: const Color(0xFF0C5F34),
          backgroundColor: const Color(0xFFE5F7EA),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8.r),
          ),
        ),
        icon: const Icon(Icons.visibility_outlined, size: 14),
        label: Text('View', style: TextStyle(fontSize: 12.sp)),
        onPressed: () => _simulateViewDocument(docName),
      );
    } else if (status == 'Pending Review') {
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextButton(
            style: TextButton.styleFrom(
              foregroundColor: const Color(0xFF0C5F34),
              padding: EdgeInsets.symmetric(horizontal: 6.w),
            ),
            child: Text('View', style: TextStyle(fontSize: 12.sp)),
            onPressed: () => _simulateViewDocument(docName),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFB57000),
              elevation: 0,
              padding: EdgeInsets.symmetric(horizontal: 8.w),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(8.r),
              ),
            ),
            child: Text('Replace', style: TextStyle(fontSize: 11.sp, color: Colors.white)),
            onPressed: () => _simulateUploadDocument(docName),
          ),
        ],
      );
    } else {
      return ElevatedButton.icon(
        style: ElevatedButton.styleFrom(
          backgroundColor: const Color(0xFF0C5F34),
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8.r),
          ),
        ),
        icon: const Icon(Icons.upload_outlined, size: 14, color: Colors.white),
        label: Text('Upload', style: TextStyle(fontSize: 12.sp, color: Colors.white)),
        onPressed: () => _simulateUploadDocument(docName),
      );
    }
  }

  void _simulateViewDocument(String docName) {
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18.r)),
          title: Text('View $docName', style: TextStyle(fontSize: 16.sp, fontWeight: FontWeight.bold)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                height: 160.h,
                width: 280.w,
                padding: EdgeInsets.all(12.r),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [const Color(0xFFE5F7EA), Colors.green.shade50],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(14.r),
                  border: Border.all(color: const Color(0xFFD7E9DD)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          docName.toUpperCase(),
                          style: TextStyle(
                            fontSize: 14.sp,
                            fontWeight: FontWeight.bold,
                            color: const Color(0xFF0C5F34),
                          ),
                        ),
                        Icon(Icons.qr_code_2, size: 36.sp, color: const Color(0xFF4F765E)),
                      ],
                    ),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Name: ${_selectedClient!.name}',
                          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13.sp),
                        ),
                        SizedBox(height: 2.h),
                        Text(
                          'Client ID: ${_selectedClient!.id}',
                          style: TextStyle(fontSize: 11.sp, color: const Color(0xFF4F765E)),
                        ),
                        SizedBox(height: 2.h),
                        Text(
                          'Status: Verified Document',
                          style: TextStyle(fontSize: 11.sp, color: Colors.green.shade700, fontWeight: FontWeight.bold),
                        ),
                      ],
                    )
                  ],
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text('Close', style: TextStyle(color: const Color(0xFF0C5F34), fontSize: 14.sp)),
            )
          ],
        );
      },
    );
  }

  void _simulateUploadDocument(String docName) {
    showModalBottomSheet(
      context: context,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20.r)),
      ),
      builder: (context) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: EdgeInsets.all(16.r),
                child: Text(
                  'Upload $docName',
                  style: TextStyle(fontSize: 16.sp, fontWeight: FontWeight.bold),
                ),
              ),
              ListTile(
                leading: const Icon(Icons.camera_alt_outlined, color: Color(0xFF0C5F34)),
                title: const Text('Take Photo'),
                onTap: () {
                  Navigator.pop(context);
                  _uploadDocMock(docName);
                },
              ),
              ListTile(
                leading: const Icon(Icons.photo_library_outlined, color: Color(0xFF0C5F34)),
                title: const Text('Choose from Gallery'),
                onTap: () {
                  Navigator.pop(context);
                  _uploadDocMock(docName);
                },
              ),
              ListTile(
                leading: const Icon(Icons.file_present_outlined, color: Color(0xFF0C5F34)),
                title: const Text('Choose Document (PDF/JPG)'),
                onTap: () {
                  Navigator.pop(context);
                  _uploadDocMock(docName);
                },
              ),
              SizedBox(height: 12.h),
            ],
          ),
        );
      },
    );
  }

  void _uploadDocMock(String docName) {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14.r)),
        content: const Row(
          children: [
            CircularProgressIndicator(color: Color(0xFF0C5F34)),
            SizedBox(width: 20),
            Text('Uploading document...'),
          ],
        ),
      ),
    );

    final navigator = Navigator.of(context);
    final scaffoldMessenger = ScaffoldMessenger.of(context);

    Future.delayed(const Duration(milliseconds: 1200), () {
      navigator.pop(); // Close loading dialog
      setState(() {
        _selectedClient!.kycDocs[docName] = 'Pending Review';
      });
      scaffoldMessenger.showSnackBar(
        SnackBar(
          content: Text('$docName uploaded successfully. Sent for review!'),
          backgroundColor: const Color(0xFF0C5F34),
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10.r)),
        ),
      );
    });
  }

  Widget _buildPersonalDetailsTab() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _buildTextField(
          label: 'Full Name',
          controller: _nameController,
          hint: 'Enter client full name',
        ),
        SizedBox(height: 12.h),
        _buildTextField(
          label: 'Phone Number',
          controller: _phoneController,
          hint: 'Enter 10-digit phone number',
          keyboardType: TextInputType.phone,
        ),
        SizedBox(height: 12.h),
        _buildTextField(
          label: 'Date of Birth',
          controller: _dobController,
          hint: 'DD-MM-YYYY',
          keyboardType: TextInputType.datetime,
        ),
        SizedBox(height: 12.h),
        _buildTextField(
          label: 'Residential Address',
          controller: _addressController,
          hint: 'Enter full address',
          maxLines: 3,
        ),
      ],
    );
  }

  Widget _buildCoApplicantTab() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _buildTextField(
          label: 'Co-applicant Name',
          controller: _coNameController,
          hint: 'Enter co-applicant name',
        ),
        SizedBox(height: 12.h),
        _buildDropdownField(
          label: 'Relationship',
          value: _selectedCoRelation,
          items: const ['Spouse', 'Father', 'Mother', 'Brother', 'Sister', 'Son', 'Daughter'],
          onChanged: (val) {
            if (val != null) {
              setState(() {
                _selectedCoRelation = val;
              });
            }
          },
        ),
        SizedBox(height: 12.h),
        _buildTextField(
          label: 'Co-applicant Phone',
          controller: _coPhoneController,
          hint: 'Enter 10-digit phone number',
          keyboardType: TextInputType.phone,
        ),
      ],
    );
  }

  Widget _buildTextField({
    required String label,
    required TextEditingController controller,
    required String hint,
    TextInputType keyboardType = TextInputType.text,
    int maxLines = 1,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize: 12.sp,
            fontWeight: FontWeight.bold,
            color: const Color(0xFF4F765E),
          ),
        ),
        SizedBox(height: 6.h),
        TextField(
          controller: controller,
          keyboardType: keyboardType,
          maxLines: maxLines,
          style: TextStyle(fontSize: 14.sp),
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: const TextStyle(color: Color(0xFF8FA88B)),
            filled: true,
            fillColor: const Color(0xFFF7FBF7),
            contentPadding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 10.h),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12.r),
              borderSide: const BorderSide(color: Color(0xFFD7E9DD)),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12.r),
              borderSide: const BorderSide(color: Color(0xFF0C5F34), width: 1.5),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12.r),
              borderSide: const BorderSide(color: Color(0xFFD7E9DD)),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildDropdownField({
    required String label,
    required String value,
    required List<String> items,
    required ValueChanged<String?> onChanged,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize: 12.sp,
            fontWeight: FontWeight.bold,
            color: const Color(0xFF4F765E),
          ),
        ),
        SizedBox(height: 6.h),
        DropdownButtonFormField<String>(
          key: ValueKey(value),
          isExpanded: true,
          initialValue: value,
          style: TextStyle(fontSize: 14.sp, color: Colors.black),
          decoration: InputDecoration(
            filled: true,
            fillColor: const Color(0xFFF7FBF7),
            contentPadding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 10.h),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12.r),
              borderSide: const BorderSide(color: Color(0xFFD7E9DD)),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12.r),
              borderSide: const BorderSide(color: Color(0xFF0C5F34)),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12.r),
              borderSide: const BorderSide(color: Color(0xFFD7E9DD)),
            ),
          ),
          items: items.map((item) {
            return DropdownMenuItem<String>(
              value: item,
              child: Text(item),
            );
          }).toList(),
          onChanged: onChanged,
        ),
      ],
    );
  }

  Widget _buildSaveButton() {
    return SizedBox(
      width: double.infinity,
      child: ElevatedButton(
        style: ElevatedButton.styleFrom(
          backgroundColor: const Color(0xFF0C5F34),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12.r),
          ),
          padding: EdgeInsets.symmetric(vertical: 14.h),
          elevation: 0,
        ),
        child: Text(
          'Save Changes',
          style: TextStyle(
            fontSize: 14.sp,
            fontWeight: FontWeight.bold,
            color: Colors.white,
          ),
        ),
        onPressed: () {
          // Input Validation
          if (_nameController.text.trim().isEmpty) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Please enter client name')),
            );
            return;
          }
          if (_phoneController.text.trim().isEmpty) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Please enter phone number')),
            );
            return;
          }

          // Persist changes in local state
          setState(() {
            _selectedClient!.name = _nameController.text.trim();
            _selectedClient!.phone = _phoneController.text.trim();
            _selectedClient!.dob = _dobController.text.trim();
            _selectedClient!.address = _addressController.text.trim();
            _selectedClient!.coApplicantName = _coNameController.text.trim();
            _selectedClient!.coApplicantRelation = _selectedCoRelation;
            _selectedClient!.coApplicantPhone = _coPhoneController.text.trim();
            
            // Re-apply search matching in case client info changes and affects current search filter
            _onSearchChanged(_searchQuery);
          });

          // Show Success SnackBar
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Client details for ${_selectedClient!.name} updated successfully!'),
              backgroundColor: const Color(0xFF0C5F34),
              behavior: SnackBarBehavior.floating,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10.r)),
            ),
          );
        },
      ),
    );
  }

  Widget _buildFooter() {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(
          Icons.energy_savings_leaf_outlined,
          color: const Color(0xFF729A7D),
          size: 14.sp,
        ),
        SizedBox(width: 6.w),
        Text(
          'Sarvam Charitable Trust Management System',
          style: TextStyle(
            fontSize: 9.sp,
            color: const Color(0xFF729A7D),
            fontWeight: FontWeight.w500,
          ),
        ),
      ],
    );
  }
}

class DashedBorderPainter extends CustomPainter {
  final Color color;
  final double strokeWidth;
  final double gap;
  final double dash;
  final double borderRadius;

  DashedBorderPainter({
    this.color = const Color(0xFFD7E9DD),
    this.strokeWidth = 1.5,
    this.gap = 5.0,
    this.dash = 5.0,
    this.borderRadius = 14.0,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = strokeWidth
      ..style = PaintingStyle.stroke;

    final path = Path()
      ..addRRect(RRect.fromRectAndRadius(
        Rect.fromLTWH(0, 0, size.width, size.height),
        Radius.circular(borderRadius),
      ));

    final dashPath = _buildDashPath(path, dash, gap);
    canvas.drawPath(dashPath, paint);
  }

  Path _buildDashPath(Path source, double dashWidth, double gapWidth) {
    final Path dest = Path();
    for (final PathMetric metric in source.computeMetrics()) {
      double distance = 0.0;
      bool draw = true;
      while (distance < metric.length) {
        final double len = draw ? dashWidth : gapWidth;
        if (draw) {
          dest.addPath(
            metric.extractPath(distance, distance + len),
            Offset.zero,
          );
        }
        distance += len;
        draw = !draw;
      }
    }
    return dest;
  }

  @override
  bool shouldRepaint(covariant DashedBorderPainter oldDelegate) {
    return oldDelegate.color != color ||
        oldDelegate.strokeWidth != strokeWidth ||
        oldDelegate.gap != gap ||
        oldDelegate.dash != dash ||
        oldDelegate.borderRadius != borderRadius;
  }
}