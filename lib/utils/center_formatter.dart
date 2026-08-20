/// Utility functions for formatting center codes and display labels across the app.
library;

/// Formats a center code string, adding zero padding and prepending branch code if missing.
/// Examples:
/// - formatCenterCode('01', '37') -> '37-01'
/// - formatCenterCode('1', '37') -> '37-01'
/// - formatCenterCode('37-01', '37') -> '37-01'
/// - formatCenterCode('06', '37') -> '37-06'
String formatCenterCode(dynamic code, [String? branchCode]) {
  if (code == null) return '';
  final str = code.toString().trim();
  if (str.isEmpty) return '';
  if (str.contains('-')) return str;
  final padded = str.length == 1 ? '0$str' : str;
  if (branchCode != null && branchCode.trim().isNotEmpty) {
    return '${branchCode.trim()}-$padded';
  }
  return padded;
}

/// Formats a center display title, e.g. "37-01 - Center Name" or "Center Name (37-01)".
String formatCenterDisplay(dynamic name, dynamic code, {String? branchCode, bool parenthetical = false}) {
  final cName = (name ?? '').toString().trim();
  final formattedCode = formatCenterCode(code, branchCode);
  if (formattedCode.isEmpty) return cName;
  if (cName.isEmpty) return formattedCode;
  if (parenthetical) {
    return '$cName ($formattedCode)';
  }
  return '$formattedCode - $cName';
}
