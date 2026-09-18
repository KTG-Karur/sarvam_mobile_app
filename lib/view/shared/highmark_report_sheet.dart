import 'package:flutter/material.dart';
import 'package:sarvam/services/enrollment_api_service.dart';

/// Mirrors the web approval workbench's `HighmarkHistoryButton` +
/// `HighmarkFullReportDialog`: fetches this client's Highmark pull history
/// and shows the most recent report. View-only, matching the web app's own
/// rule that Branch Manager and FDO roles can see the report on screen but
/// never export it as a PDF (`HighmarkFullReportDialog.tsx`'s `canDownload`
/// check) — there is no download action in this sheet at all.
///
/// Shared by every BM-facing screen that needs a "Highmark" button next to
/// a client (Member Approval, Loan Index Approval, ...) so the report view
/// only exists in one place.
Future<void> showHighmarkReport(
  BuildContext context, {
  required EnrollmentApiService api,
  required String clientDbId,
  required String clientName,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => HighmarkReportSheet(
      api: api,
      clientDbId: clientDbId,
      clientName: clientName,
    ),
  );
}

class HighmarkReportSheet extends StatefulWidget {
  const HighmarkReportSheet({
    super.key,
    required this.api,
    required this.clientDbId,
    required this.clientName,
  });

  final EnrollmentApiService api;
  final String clientDbId;
  final String clientName;

  @override
  State<HighmarkReportSheet> createState() => _HighmarkReportSheetState();
}

class _HighmarkReportSheetState extends State<HighmarkReportSheet> {
  static const _purple = Color(0xFF7C3AED);

  bool _loading = true;
  String? _error;
  Map<String, dynamic>? _report;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final history = await widget.api.getHighmarkHistory(widget.clientDbId);
      final reports = history.whereType<Map>().toList();
      // History is already newest-first from the API; take the latest pull.
      final latest = reports.isNotEmpty
          ? Map<String, dynamic>.from(reports.first)
          : null;
      if (!mounted) return;
      setState(() => _report = latest);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = 'Unable to load Highmark report: $e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Color _scoreColor(int score) {
    if (score <= 0) return Colors.blueGrey;
    if (score < 550) return Colors.red;
    if (score < 650) return Colors.amber.shade800;
    return Colors.green;
  }

  String _riskLabel(int score) {
    if (score <= 0) return 'No Prior Credit History (NTC)';
    if (score < 550) return 'High Risk (Review Required)';
    if (score < 650) return 'Moderate Risk';
    return 'Low Risk (Eligible)';
  }

  String _formatDate(dynamic value) {
    final parsed = DateTime.tryParse('$value');
    if (parsed == null) return '—';
    final local = parsed.toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(local.day)}-${two(local.month)}-${local.year} '
        '${two(local.hour)}:${two(local.minute)}';
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: 0.7,
      minChildSize: 0.4,
      maxChildSize: 0.92,
      expand: false,
      builder: (context, scrollController) => Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
              child: Row(
                children: [
                  const Icon(Icons.shield_outlined, color: _purple, size: 20),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Highmark Report',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        Text(
                          widget.clientName,
                          style: const TextStyle(
                            fontSize: 12,
                            color: Color(0xFF64748B),
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator(color: _purple))
                  : _error != null
                      ? Center(
                          child: Padding(
                            padding: const EdgeInsets.all(24),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  _error!,
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(color: Colors.redAccent),
                                ),
                                const SizedBox(height: 12),
                                OutlinedButton(
                                  onPressed: _load,
                                  child: const Text('Retry'),
                                ),
                              ],
                            ),
                          ),
                        )
                      : _report == null
                          ? const Center(
                              child: Padding(
                                padding: EdgeInsets.all(24),
                                child: Text(
                                  'No Highmark check has been run for this client yet.',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(color: Color(0xFF64748B)),
                                ),
                              ),
                            )
                          : ListView(
                              controller: scrollController,
                              padding: const EdgeInsets.all(16),
                              children: [_reportCard(_report!)],
                            ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _reportCard(Map<String, dynamic> report) {
    final rawScore = report['creditScore'];
    final score = rawScore is num
        ? rawScore.toInt()
        : int.tryParse('$rawScore') ?? 0;
    final status = (report['status'] ?? 'COMPLETED').toString().toUpperCase();
    final provider = (report['provider'] ?? 'CRIF High Mark').toString();
    final color = _scoreColor(score);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: color.withValues(alpha: 0.4)),
            boxShadow: const [
              BoxShadow(color: Color(0x0A000000), blurRadius: 8, offset: Offset(0, 2)),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    provider,
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
                      color: Color(0xFF073E23),
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: color.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      status,
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w800,
                        color: color,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Container(
                    width: 60,
                    height: 60,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: color.withValues(alpha: 0.1),
                      border: Border.all(color: color, width: 2),
                    ),
                    child: Center(
                      child: Text(
                        score > 0 ? '$score' : 'N/A',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w900,
                          color: color,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _riskLabel(score),
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            color: color,
                          ),
                        ),
                        const SizedBox(height: 4),
                        if (report['fromCache'] == true)
                          const Text(
                            'Reused from a recent pull',
                            style: TextStyle(fontSize: 11, color: Color(0xFF4E8A68)),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _detailRow('Pulled On', _formatDate(report['pulledAt'])),
        _detailRow('Aadhaar', report['aadhaarMasked']?.toString() ?? '—'),
        _detailRow('Phone', report['phone']?.toString() ?? '—'),
        _detailRow('Requested By', _requestedByName(report)),
        _detailRow(
          'Provider Reference',
          report['providerReference']?.toString() ?? '—',
        ),
      ],
    );
  }

  String _requestedByName(Map<String, dynamic> report) {
    final requestedBy = report['requestedBy'];
    if (requestedBy is! Map) return '—';
    final name = [requestedBy['firstName'], requestedBy['lastName']]
        .whereType<String>()
        .join(' ')
        .trim();
    return name.isEmpty ? '—' : name;
  }

  Widget _detailRow(String label, String value) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 120,
          child: Text(
            label,
            style: const TextStyle(fontSize: 12, color: Color(0xFF64748B)),
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: const TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w600,
              color: Color(0xFF073E23),
            ),
          ),
        ),
      ],
    ),
  );
}
