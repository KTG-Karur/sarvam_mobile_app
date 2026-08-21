import 'package:flutter/material.dart';
import 'package:sarvam/utils/center_formatter.dart';

/// The `id` strings for an API-fetched lookup list (`[{id, name, ...}]`) —
/// use these, never display names, as a dropdown's `value`/`items`, since
/// names aren't guaranteed unique (two different centers/groups can share a
/// display name) but ids always are. `DropdownButtonFormField` throws if two
/// items share a `value`.
List<String> idOptions(List<dynamic> items) => items
    .whereType<Map>()
    .map((e) => e['id']?.toString())
    .whereType<String>()
    .toSet() // defensive de-dup in case the API ever repeats an id
    .toList();

Map? _findItem(List<dynamic> items, String id) {
  for (final e in items) {
    if (e is Map && e['id']?.toString() == id) {
      return e;
    }
  }
  return null;
}

/// Builds a label for an id (from [idOptions]) by looking it up back in
/// [items]. Falls back to a few common name-ish fields.
String idLabel(List<dynamic> items, String id) {
  final match = _findItem(items, id);
  if (match == null) return id;
  return (match['name'] ?? match['centerName'] ?? match['productName'] ?? id)
      .toString();
}

/// Matches the web app's center dropdown label exactly: `"{name} ({code})"`
/// (`GroupAssignClient.tsx` center `SelectItem`s).
String centerLabel(List<dynamic> items, String id) {
  final match = _findItem(items, id);
  if (match == null) return id;
  final name = match['name'] ?? id;
  final code = match['code'];
  return formatCenterDisplay(name, code, parenthetical: true);
}

/// Matches the web app's group dropdown label exactly:
/// `"{name} ({memberCount}/{maxMembersPerGroup})"`.
String groupLabel(List<dynamic> items, String id) {
  final match = _findItem(items, id);
  if (match == null) return id;
  final name = match['name'] ?? id;
  final memberCount = match['memberCount'] ?? '?';
  final maxMembers = match['maxMembersPerGroup'] ?? '?';
  return '$name ($memberCount/$maxMembers)';
}

/// A simple id-backed dropdown for this screen — deliberately plain
/// (unstyled beyond an outline) since this feature doesn't need the
/// enrollment wizard's whole themed field library.
class IdDropdown extends StatelessWidget {
  const IdDropdown({
    super.key,
    required this.label,
    required this.value,
    required this.items,
    required this.onChanged,
    this.enabled = true,
    this.extraOptions = const {},
    this.labelBuilder,
  });

  final String label;
  final String? value;
  final List<dynamic> items;
  final ValueChanged<String?> onChanged;
  final bool enabled;

  /// Extra synthetic `{id: label}` entries to append after the real
  /// options — e.g. a "Remove from Group" choice.
  final Map<String, String> extraOptions;

  /// Overrides the default (bare name) label per id — e.g. [centerLabel]
  /// or [groupLabel] — to match the web app's exact dropdown text.
  final String Function(List<dynamic> items, String id)? labelBuilder;

  @override
  Widget build(BuildContext context) {
    final ids = idOptions(items);
    final allIds = [...ids, ...extraOptions.keys];
    return DropdownButtonFormField<String>(
      initialValue: allIds.contains(value) ? value : null,
      isExpanded: true,
      decoration: InputDecoration(
        labelText: label,
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 10,
          vertical: 10,
        ),
        border: const OutlineInputBorder(),
      ),
      hint: const Text('-- Select --', style: TextStyle(fontSize: 12)),
      items: allIds
          .map(
            (id) => DropdownMenuItem(
              value: id,
              child: Text(
                extraOptions[id] ??
                    (labelBuilder ?? idLabel).call(items, id),
                style: const TextStyle(fontSize: 12.5),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          )
          .toList(),
      onChanged: enabled ? onChanged : null,
    );
  }
}
