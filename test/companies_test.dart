import 'package:flutter_test/flutter_test.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/constant/companies.dart';

void main() {
  test('the only company points at the base URL in api.dart', () {
    expect(Companies.defaultUrl, Api.baseUrl);
    expect(Companies.names, [Companies.defaultName]);
  });

  test('any saved or unknown address falls back to the default company', () {
    expect(Companies.nameForUrl(null), Companies.defaultName);
    expect(Companies.nameForUrl(''), Companies.defaultName);
    expect(Companies.nameForUrl('https://example.com'), Companies.defaultName);
  });

  test('urlFor always returns the base URL in api.dart', () {
    expect(Companies.urlFor(null), Api.baseUrl);
    expect(Companies.urlFor('Nope'), Api.baseUrl);
    expect(Companies.urlFor(Companies.defaultName), Api.baseUrl);
  });

  test('the company address is an https address', () {
    expect(Companies.urls.values.every((u) => u.startsWith('https://')), isTrue);
  });
}
