import 'package:flutter/material.dart';
import 'package:sarvam/services/enrollment_api_service.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

/// Width CRIF's page is laid out for (its tables are ~1,020 px wide).
const double kCrifPageWidth = 1040;

/// Prepares CRIF's HTML for a phone screen:
///  * scripts are removed — the page doesn't use any, and it comes from a third
///    party (the web also shows it with scripts off);
///  * a viewport is added so the phone scales the wide page down to fit the
///    screen width; the user can then pinch to zoom in.
String prepareCrifHtml(String html) {
  var out = html.replaceAll(
    RegExp(r'<script\b[^>]*>.*?</script\s*>', caseSensitive: false, dotAll: true),
    '',
  );
  if (!RegExp(r'<meta[^>]+name=.?viewport', caseSensitive: false).hasMatch(out)) {
    final viewport =
        '<meta name="viewport" content="width=${kCrifPageWidth.toInt()}, '
        'minimum-scale=0.1, maximum-scale=5, user-scalable=yes">';
    final head = RegExp(r'<head\b[^>]*>', caseSensitive: false);
    final match = head.firstMatch(out);
    out = match == null
        ? '$viewport$out'
        : out.replaceRange(match.end, match.end, viewport);
  }
  return out;
}

/// CRIF's original ("Consumer Base™") credit report for one pull, shown as
/// CRIF produced it — the same page the web's "CRIF Original View" opens.
/// View-only: no print or download.
///
/// A pull without an original (an older pull, or one served by Surepass) shows
/// the web's own message instead.
class CrifOriginalReportPage extends StatefulWidget {
  const CrifOriginalReportPage({
    super.key,
    required this.api,
    required this.reportId,
    this.title = 'CRIF Original Report',
  });

  final EnrollmentApiService api;

  /// The stored report's id (`report['id']`), not the provider reference.
  final String reportId;
  final String title;

  @override
  State<CrifOriginalReportPage> createState() => _CrifOriginalReportPageState();
}

class _CrifOriginalReportPageState extends State<CrifOriginalReportPage> {
  static const _green = Color(0xFF0D6842);
  static const _muted = Color(0xFF64748B);

  bool _loading = true;
  bool _rendering = false; // the page is downloaded, the WebView is drawing it
  bool _firstLoadDone = false;
  String? _error;
  bool _noOriginal = false;
  WebViewController? _web;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
      _noOriginal = false;
    });
    try {
      final html = await widget.api.getHighmarkOriginalHtml(widget.reportId);
      if (!mounted) return;
      if (html == null) {
        setState(() => _noOriginal = true);
      } else {
        _show(prepareCrifHtml(html));
      }
    } catch (e) {
      if (mounted) setState(() => _error = 'Original CRIF report not available: $e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _show(String html) {
    _firstLoadDone = false;
    final controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.disabled)
      ..setBackgroundColor(Colors.white)
      ..enableZoom(true)
      ..setNavigationDelegate(
        NavigationDelegate(
          // Only the report itself is ever shown — never follow a link out of
          // it (it comes from a third party).
          onNavigationRequest: (_) => _firstLoadDone
              ? NavigationDecision.prevent
              : NavigationDecision.navigate,
          onPageFinished: (_) {
            _firstLoadDone = true;
            if (mounted) setState(() => _rendering = false);
          },
        ),
      );

    // Android only scales a wide page to the screen when asked to.
    final platform = controller.platform;
    if (platform is AndroidWebViewController) {
      platform.setUseWideViewPort(true);
    }

    controller.loadHtmlString(html);
    _rendering = true;
    _web = controller;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: _green,
        foregroundColor: Colors.white,
        title: Text(
          widget.title,
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
        ),
      ),
      body: SafeArea(child: _body()),
    );
  }

  Widget _body() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator(color: _green));
    }
    if (_noOriginal) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.description_outlined, size: 42, color: _muted),
              SizedBox(height: 12),
              Text(
                'No original CRIF report for this pull',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
              ),
              SizedBox(height: 8),
              Text(
                'Only new pulls made through CRIF have one. Older pulls and '
                'Surepass pulls do not.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 13, color: _muted, height: 1.4),
              ),
            ],
          ),
        ),
      );
    }
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(_error!, textAlign: TextAlign.center),
              const SizedBox(height: 12),
              OutlinedButton(onPressed: _load, child: const Text('Retry')),
            ],
          ),
        ),
      );
    }
    final web = _web;
    if (web == null) return const SizedBox.shrink();
    return Stack(
      children: [
        WebViewWidget(controller: web),
        if (_rendering)
          const Center(child: CircularProgressIndicator(color: _green)),
      ],
    );
  }
}
