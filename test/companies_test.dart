import 'package:flutter_test/flutter_test.dart';
import 'package:sarvam/constant/companies.dart';

void main() {
  test('Sarvam is the default company', () {
    expect(Companies.defaultName, 'Sarvam');
    expect(Companies.defaultUrl, 'https://sarvam.nidhimfi.com');
    expect(Companies.names, containsAll(['Sarvam', 'GCPL']));
  });

  test('a saved address maps back to its company', () {
    expect(Companies.nameForUrl('https://sarvam.nidhimfi.com'), 'Sarvam');
    expect(Companies.nameForUrl('https://gcpl.nidhimfi.com'), 'GCPL');
  });

  test('nothing saved, or an unknown address, falls back to Sarvam', () {
    expect(Companies.nameForUrl(null), 'Sarvam');
    expect(Companies.nameForUrl(''), 'Sarvam');
    // e.g. the old test server, or a company that has been removed
    expect(Companies.nameForUrl('https://ktg.nidhimfi.com'), 'Sarvam');
  });

  test('urlFor returns the company address, or the default for unknown', () {
    expect(Companies.urlFor('GCPL'), 'https://gcpl.nidhimfi.com');
    expect(Companies.urlFor('Sarvam'), 'https://sarvam.nidhimfi.com');
    expect(Companies.urlFor('Nope'), 'https://sarvam.nidhimfi.com');
    expect(Companies.urlFor(null), 'https://sarvam.nidhimfi.com');
  });

  test('every company address is a distinct https address', () {
    final urls = Companies.urls.values.toList();
    expect(urls.toSet().length, urls.length);
    expect(urls.every((u) => u.startsWith('https://')), isTrue);
  });
}
