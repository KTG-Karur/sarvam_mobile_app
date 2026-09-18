import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:get/get.dart';
import 'package:sarvam/services/admin_api_service.dart';

class AccountsOverview extends StatefulWidget {
  const AccountsOverview({super.key});

  @override
  State<AccountsOverview> createState() => _AccountsOverviewState();
}

class _AccountsOverviewState extends State<AccountsOverview> {
  final AdminApiService _apiService = AdminApiService();
  bool _isLoading = true;
  List<Map<String, dynamic>> _ledgerAccounts = [];
  List<Map<String, dynamic>> _selfAccounts = [];

  static const _primaryGreen = Color(0xFF0D6842);
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);
  static const _lightBg = Color(0xFFF8FAFC);

  @override
  void initState() {
    super.initState();
    _fetchAccountsData();
  }

  Future<void> _fetchAccountsData() async {
    setState(() => _isLoading = true);
    try {
      final resLedger = await _apiService.getAccountsLedger();
      final resSelf = await _apiService.getSelfAccounts();

      if (resLedger.statusCode == 200 && resLedger.body != null) {
        final data = resLedger.body['data'] ?? resLedger.body;
        if (data is List) {
          _ledgerAccounts = List<Map<String, dynamic>>.from(data);
        }
      }

      if (resSelf.statusCode == 200 && resSelf.body != null) {
        final data = resSelf.body['data'] ?? resSelf.body;
        if (data is List) {
          _selfAccounts = List<Map<String, dynamic>>.from(data);
        }
      }
    } catch (e) {
      debugPrint("Error fetching accounts: $e");
    } finally {
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _lightBg,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: _darkText, size: 20),
          onPressed: () => Get.back(),
        ),
        title: Text(
          'Financial Accounts & Ledger',
          style: GoogleFonts.inter(
            fontSize: 18.sp,
            fontWeight: FontWeight.w700,
            color: _darkText,
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded, color: _primaryGreen),
            onPressed: _fetchAccountsData,
          ),
        ],
      ),
      body: SafeArea(
        child: _isLoading
            ? const Center(child: CircularProgressIndicator(color: _primaryGreen))
            : SingleChildScrollView(
                padding: EdgeInsets.all(16.w),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildSelfAccountsSection(),
                    SizedBox(height: 20.h),
                    _buildLedgerSection(),
                  ],
                ),
              ),
      ),
    );
  }

  Widget _buildSelfAccountsSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'ORGANIZATION SELF ACCOUNTS',
          style: GoogleFonts.inter(
            fontSize: 11.sp,
            fontWeight: FontWeight.w700,
            color: _muted,
            letterSpacing: 0.8,
          ),
        ),
        SizedBox(height: 10.h),
        SizedBox(
          height: 110.h,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: _selfAccounts.isNotEmpty ? _selfAccounts.length : 3,
            separatorBuilder: (context, index) => SizedBox(width: 12.w),
            itemBuilder: (context, index) {
              final acc = _selfAccounts.isNotEmpty
                  ? _selfAccounts[index]
                  : {
                      'accountName': index == 0 ? 'Main Bank (HDFC)' : (index == 1 ? 'Cash Vault' : 'Collection Account'),
                      'accountType': index == 1 ? 'Cash' : 'Bank',
                      'balance': index == 0 ? 1245000.0 : (index == 1 ? 85000.0 : 450000.0),
                    };
              return _buildSelfAccountCard(acc);
            },
          ),
        ),
      ],
    );
  }

  Widget _buildSelfAccountCard(Map<String, dynamic> acc) {
    final isBank = '${acc['accountType']}'.toLowerCase() == 'bank';
    return Container(
      width: 180.w,
      padding: EdgeInsets.all(14.w),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: isBank
              ? [const Color(0xFF1E3A8A), const Color(0xFF3B5FBF)]
              : [const Color(0xFF0D6842), const Color(0xFF1A8A5A)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16.r),
        boxShadow: [
          BoxShadow(
            color: (isBank ? const Color(0xFF1E3A8A) : _primaryGreen).withOpacity(0.3),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Icon(
                isBank ? Icons.account_balance_rounded : Icons.payments_rounded,
                color: Colors.white,
                size: 20.sp,
              ),
              Text(
                '${acc['accountType'] ?? 'Account'}'.toUpperCase(),
                style: GoogleFonts.inter(
                  fontSize: 9.sp,
                  color: Colors.white.withOpacity(0.8),
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '${acc['accountName'] ?? 'Self Account'}',
                style: GoogleFonts.inter(
                  fontSize: 12.sp,
                  color: Colors.white.withOpacity(0.9),
                  fontWeight: FontWeight.w600,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              SizedBox(height: 2.h),
              Text(
                '₹${(acc['balance'] as num?)?.toStringAsFixed(2) ?? '0.00'}',
                style: GoogleFonts.inter(
                  fontSize: 16.sp,
                  color: Colors.white,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildLedgerSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'GENERAL LEDGER ACCOUNTS',
          style: GoogleFonts.inter(
            fontSize: 11.sp,
            fontWeight: FontWeight.w700,
            color: _muted,
            letterSpacing: 0.8,
          ),
        ),
        SizedBox(height: 10.h),
        ListView.separated(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: _ledgerAccounts.isNotEmpty ? _ledgerAccounts.length : 4,
          separatorBuilder: (context, index) => SizedBox(height: 10.h),
          itemBuilder: (context, index) {
            final acc = _ledgerAccounts.isNotEmpty
                ? _ledgerAccounts[index]
                : {
                    'glName': index == 0 ? 'Interest Received' : (index == 1 ? 'Principal Portfolio' : (index == 2 ? 'Processing Fee Income' : 'Bank Charges')),
                    'glType': index == 0 || index == 2 ? 'Income' : (index == 1 ? 'Asset' : 'Expense'),
                    'code': 'GL-100${index + 1}',
                  };
            return _buildLedgerTile(acc);
          },
        ),
      ],
    );
  }

  Widget _buildLedgerTile(Map<String, dynamic> acc) {
    return Container(
      padding: EdgeInsets.all(14.w),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14.r),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.04),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            padding: EdgeInsets.all(10.w),
            decoration: BoxDecoration(
              color: const Color(0xFF1E3A8A).withOpacity(0.1),
              borderRadius: BorderRadius.circular(12.r),
            ),
            child: Icon(Icons.menu_book_rounded, color: const Color(0xFF1E3A8A), size: 20.sp),
          ),
          SizedBox(width: 12.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${acc['glName'] ?? 'GL Account'}',
                  style: GoogleFonts.inter(
                    fontSize: 14.sp,
                    fontWeight: FontWeight.w700,
                    color: _darkText,
                  ),
                ),
                SizedBox(height: 2.h),
                Text(
                  'Code: ${acc['code'] ?? acc['glId'] ?? 'GL'} • Group: ${acc['glType'] ?? 'Ledger'}',
                  style: GoogleFonts.inter(
                    fontSize: 11.sp,
                    color: _muted,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
          const Icon(Icons.arrow_forward_ios_rounded, color: _muted, size: 14),
        ],
      ),
    );
  }
}
