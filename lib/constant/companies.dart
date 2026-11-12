/// The companies a user can sign in to, each with its own server. This is the
/// one place the list lives — the Login screen (dropdown), the splash screen
/// and logout all read it, so the addresses can't drift apart.
///
/// It is part of the app, not fetched from a server: adding a company or
/// changing an address means editing it here and releasing a new version.
class Companies {
  Companies._();

  /// Company shown when none has been chosen yet.
  static const String defaultName = 'Sarvam';

  /// Company name → server address.
  static const Map<String, String> urls = {
    // 'Sarvam': 'https://ktg.nidhimfi.com',
    'Sarvam': 'https://sarvam.nidhimfi.com',
    'GCPL': 'https://gcpl.nidhimfi.com',
  };

  /// Company name → logo shown on the splash and sign-in screens.
  static const Map<String, String> logos = {
    'Sarvam': 'assets/icon/Sarvam_01.png',
    'GCPL': 'assets/icon/GCPL.png',
  };

  /// The logo for [name], or the default company's when [name] isn't known.
  static String logoFor(String? name) => logos[name] ?? logos[defaultName]!;

  /// The logo for the company whose server is [url].
  static String logoForUrl(String? url) => logoFor(nameForUrl(url));

  static List<String> get names => urls.keys.toList();

  static String get defaultUrl => urls[defaultName]!;

  /// The server address for [name], or the default company's when [name] isn't
  /// a known company.
  static String urlFor(String? name) => urls[name] ?? defaultUrl;

  /// The company that uses [url], or the default company when [url] is empty
  /// or doesn't match any company (e.g. a company that has since been removed).
  static String nameForUrl(String? url) {
    if (url != null && url.isNotEmpty) {
      for (final entry in urls.entries) {
        if (entry.value == url) return entry.key;
      }
    }
    return defaultName;
  }
}
