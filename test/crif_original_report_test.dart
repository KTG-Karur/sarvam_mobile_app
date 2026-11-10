import 'package:flutter_test/flutter_test.dart';
import 'package:sarvam/view/shared/crif_original_report_page.dart';

void main() {
  group('prepareCrifHtml', () {
    test('adds a viewport so the wide page fits a phone screen', () {
      const html =
          '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>T</title></head>'
          '<body>Report</body></html>';
      final out = prepareCrifHtml(html);

      expect(out, contains('name="viewport"'));
      expect(out, contains('width=${kCrifPageWidth.toInt()}'));
      // inserted inside <head>, before the existing content
      expect(out.indexOf('name="viewport"'), lessThan(out.indexOf('<title>')));
      expect(out, contains('<body>Report</body>'));
    });

    test('keeps a viewport the page already has', () {
      const html =
          '<html><head><meta name="viewport" content="width=500"></head></html>';
      final out = prepareCrifHtml(html);
      expect('name="viewport"'.allMatches(out).length, 1);
      expect(out, contains('width=500'));
    });

    test('still works when the page has no <head>', () {
      final out = prepareCrifHtml('<body>Report</body>');
      expect(out.startsWith('<meta name="viewport"'), isTrue);
      expect(out, contains('Report'));
    });

    test('removes scripts, since the page comes from a third party', () {
      const html = '<html><head><script type="text/javascript">alert(1)</script>'
          '</head><body>Hello<SCRIPT>steal()</SCRIPT> world</body></html>';
      final out = prepareCrifHtml(html);

      expect(out.toLowerCase(), isNot(contains('<script')));
      expect(out, isNot(contains('alert(1)')));
      expect(out, isNot(contains('steal()')));
      expect(out, contains('Hello'));
      expect(out, contains('world'));
    });

    test('leaves the report content untouched', () {
      const html = '<html><head></head><body><table><tr><td>CRIF HM Score(S)'
          '</td><td>510</td></tr></table></body></html>';
      final out = prepareCrifHtml(html);
      expect(out, contains('<table><tr><td>CRIF HM Score(S)</td><td>510</td>'));
    });
  });
}
