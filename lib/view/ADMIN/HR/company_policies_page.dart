import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import 'package:sarvam/services/hr_api_service.dart';

// ─────────────────────────────────────────────────────────────────────────────
// Company Policies — the policy documents HR has published (the same list the
// web Policy Library shows employees: GET /api/hr/policies/published). Tapping
// a policy opens the file through a short-lived signed link.
// ─────────────────────────────────────────────────────────────────────────────

const _green = Color(0xFF0D6842);
const _navy = Color(0xFF0F172A);
const _muted = Color(0xFF64748B);
const _border = Color(0xFFE2E8F0);
const _bg = Color(0xFFF8FAFC);

class PolicyItem {
  final String id;
  final String title;
  final String? category;
  final String fileKey;
  final String fileName;
  final String? mimeType;
  final DateTime? publishedAt;

  const PolicyItem({
    required this.id,
    required this.title,
    required this.fileKey,
    required this.fileName,
    this.category,
    this.mimeType,
    this.publishedAt,
  });

  factory PolicyItem.fromJson(Map<String, dynamic> json) => PolicyItem(
        id: json['id']?.toString() ?? '',
        title: json['title']?.toString() ?? 'Policy',
        category: (json['category']?.toString().trim().isEmpty ?? true) ? null : json['category'].toString().trim(),
        fileKey: json['fileUrl']?.toString() ?? '',
        fileName: json['fileName']?.toString() ?? '',
        mimeType: json['mimeType']?.toString(),
        publishedAt: DateTime.tryParse(json['publishedAt']?.toString() ?? '')?.toLocal(),
      );

  String get _ext => fileName.contains('.') ? fileName.split('.').last.toLowerCase() : '';

  IconData get icon {
    final mime = (mimeType ?? '').toLowerCase();
    if (mime.contains('pdf') || _ext == 'pdf') return Icons.picture_as_pdf_rounded;
    if (mime.startsWith('image/') || const ['png', 'jpg', 'jpeg', 'webp'].contains(_ext)) return Icons.image_rounded;
    if (const ['doc', 'docx'].contains(_ext)) return Icons.description_rounded;
    if (const ['xls', 'xlsx', 'csv'].contains(_ext)) return Icons.table_chart_rounded;
    return Icons.insert_drive_file_rounded;
  }

  Color get iconColor {
    final mime = (mimeType ?? '').toLowerCase();
    if (mime.contains('pdf') || _ext == 'pdf') return const Color(0xFFDC2626);
    if (const ['doc', 'docx'].contains(_ext)) return const Color(0xFF2563EB);
    if (const ['xls', 'xlsx', 'csv'].contains(_ext)) return const Color(0xFF16A34A);
    return _green;
  }
}

class CompanyPoliciesPage extends StatefulWidget {
  const CompanyPoliciesPage({super.key});

  @override
  State<CompanyPoliciesPage> createState() => _CompanyPoliciesPageState();
}

class _CompanyPoliciesPageState extends State<CompanyPoliciesPage> {
  final _searchCtrl = TextEditingController();
  List<PolicyItem> _items = const [];
  bool _loading = true;
  String? _error;
  String _category = 'All';
  String? _openingId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final raw = await HrApiService.publishedPolicies();
      final items = raw.whereType<Map>().map((e) => PolicyItem.fromJson(Map<String, dynamic>.from(e))).toList();
      if (!mounted) return;
      setState(() {
        _items = items;
        _error = null;
        _loading = false;
        if (_category != 'All' && !items.any((p) => p.category == _category)) _category = 'All';
      });
    } on HrApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    } catch (_) {
      if (mounted) setState(() { _error = 'Could not load the policies. Pull down to retry.'; _loading = false; });
    }
  }

  List<String> get _categories {
    final names = _items.map((p) => p.category).whereType<String>().toSet().toList()..sort();
    return ['All', ...names];
  }

  List<PolicyItem> get _visible {
    final q = _searchCtrl.text.trim().toLowerCase();
    return _items.where((p) {
      if (_category != 'All' && p.category != _category) return false;
      if (q.isEmpty) return true;
      return p.title.toLowerCase().contains(q) || (p.category ?? '').toLowerCase().contains(q) || p.fileName.toLowerCase().contains(q);
    }).toList();
  }

  Future<void> _open(PolicyItem policy) async {
    if (policy.fileKey.isEmpty) {
      _toast('This policy has no file attached.', error: true);
      return;
    }
    setState(() => _openingId = policy.id);
    try {
      final link = await HrApiService.fileLink(policy.fileKey);
      final opened = await launchUrl(Uri.parse(link), mode: LaunchMode.externalApplication);
      if (!opened && mounted) _toast('No app on this phone can open this file.', error: true);
    } on HrApiException catch (e) {
      if (mounted) _toast(e.message, error: true);
    } catch (_) {
      if (mounted) _toast('Could not open the file. Please try again.', error: true);
    } finally {
      if (mounted) setState(() => _openingId = null);
    }
  }

  void _toast(String text, {bool error = false}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(text), backgroundColor: error ? const Color(0xFFDC2626) : _green, behavior: SnackBarBehavior.floating),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _bg,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        surfaceTintColor: Colors.white,
        leading: IconButton(
          icon: Icon(Icons.arrow_back_ios_new_rounded, size: 20.sp, color: _navy),
          onPressed: () => Navigator.of(context).maybePop(),
        ),
        titleSpacing: 0,
        title: Text('Company Policies', style: TextStyle(fontSize: 18.sp, fontWeight: FontWeight.w800, color: _navy)),
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: double.infinity,
            color: Colors.white,
            padding: EdgeInsets.fromLTRB(16.w, 0, 16.w, 12.h),
            child: Text('Policies and documents published by HR', style: TextStyle(fontSize: 13.sp, color: _muted, fontWeight: FontWeight.w500)),
          ),
          Padding(
            padding: EdgeInsets.fromLTRB(16.w, 12.h, 16.w, 0),
            child: Container(
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12.r), border: Border.all(color: _border)),
              child: TextField(
                controller: _searchCtrl,
                onChanged: (_) => setState(() {}),
                style: TextStyle(fontSize: 13.sp, color: _navy),
                decoration: InputDecoration(
                  hintText: 'Search policies',
                  hintStyle: TextStyle(fontSize: 13.sp, color: _muted),
                  prefixIcon: Icon(Icons.search_rounded, size: 20.sp, color: _muted),
                  suffixIcon: _searchCtrl.text.isEmpty
                      ? null
                      : IconButton(
                          icon: Icon(Icons.close_rounded, size: 18.sp, color: _muted),
                          onPressed: () => setState(_searchCtrl.clear),
                        ),
                  border: InputBorder.none,
                  contentPadding: EdgeInsets.symmetric(vertical: 12.h),
                ),
              ),
            ),
          ),
          if (_categories.length > 1) ...[
            SizedBox(height: 10.h),
            SizedBox(
              height: 36.h,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: EdgeInsets.symmetric(horizontal: 16.w),
                itemCount: _categories.length,
                separatorBuilder: (_, __) => SizedBox(width: 8.w),
                itemBuilder: (_, i) => _chip(_categories[i]),
              ),
            ),
          ],
          SizedBox(height: 10.h),
          Expanded(child: _body()),
        ],
      ),
    );
  }

  Widget _chip(String label) {
    final selected = _category == label;
    return GestureDetector(
      onTap: () => setState(() => _category = label),
      child: Container(
        alignment: Alignment.center,
        padding: EdgeInsets.symmetric(horizontal: 14.w),
        decoration: BoxDecoration(
          color: selected ? _green : Colors.white,
          borderRadius: BorderRadius.circular(20.r),
          border: Border.all(color: selected ? _green : _border),
        ),
        child: Text(label, style: TextStyle(fontSize: 12.5.sp, fontWeight: FontWeight.w700, color: selected ? Colors.white : _muted)),
      ),
    );
  }

  Widget _body() {
    if (_loading) return const Center(child: CircularProgressIndicator(color: _green));
    if (_error != null && _items.isEmpty) return _message(Icons.cloud_off_rounded, _error!);
    final items = _visible;
    if (items.isEmpty) {
      return _message(
        Icons.folder_off_rounded,
        _items.isEmpty ? 'No policies have been published yet' : 'No policies match your search',
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      color: _green,
      child: ListView.separated(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: EdgeInsets.fromLTRB(16.w, 2.h, 16.w, 24.h),
        itemCount: items.length,
        separatorBuilder: (_, __) => SizedBox(height: 10.h),
        itemBuilder: (_, i) => _card(items[i]),
      ),
    );
  }

  Widget _message(IconData icon, String text) {
    return RefreshIndicator(
      onRefresh: _load,
      color: _green,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          SizedBox(height: 110.h),
          Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 48.sp, color: const Color(0xFFCBD5E1)),
                SizedBox(height: 10.h),
                Padding(
                  padding: EdgeInsets.symmetric(horizontal: 32.w),
                  child: Text(text, textAlign: TextAlign.center, style: TextStyle(fontSize: 14.sp, fontWeight: FontWeight.w600, color: _muted)),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _card(PolicyItem p) {
    final opening = _openingId == p.id;
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(14.r),
      child: InkWell(
        borderRadius: BorderRadius.circular(14.r),
        onTap: opening ? null : () => _open(p),
        child: Container(
          padding: EdgeInsets.all(12.w),
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(14.r), border: Border.all(color: _border)),
          child: Row(
            children: [
              Container(
                width: 44.w,
                height: 44.w,
                decoration: BoxDecoration(color: p.iconColor.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(12.r)),
                child: Icon(p.icon, color: p.iconColor, size: 24.sp),
              ),
              SizedBox(width: 12.w),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(p.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 13.5.sp, fontWeight: FontWeight.w800, color: _navy)),
                    SizedBox(height: 4.h),
                    Text(
                      [
                        if (p.category != null) p.category!,
                        if (p.publishedAt != null) DateFormat('dd MMM yyyy').format(p.publishedAt!),
                      ].join(' · '),
                      style: TextStyle(fontSize: 11.sp, color: _muted),
                    ),
                  ],
                ),
              ),
              SizedBox(width: 8.w),
              opening
                  ? SizedBox(width: 20.w, height: 20.w, child: const CircularProgressIndicator(strokeWidth: 2.2, color: _green))
                  : Icon(Icons.open_in_new_rounded, size: 20.sp, color: _green),
            ],
          ),
        ),
      ),
    );
  }
}
