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

/// A searchable id-backed dropdown widget for BM/AM screens.
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

  String _getOptionLabel(String id) {
    if (extraOptions.containsKey(id)) {
      return extraOptions[id]!;
    }
    return (labelBuilder ?? idLabel).call(items, id);
  }

  void _openSearchablePicker(BuildContext context, List<String> allIds) {
    if (!enabled) return;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => _SearchablePickerSheet(
        label: label,
        selectedValue: value,
        allIds: allIds,
        getLabel: _getOptionLabel,
        onSelected: (selectedId) {
          Navigator.of(ctx).pop();
          onChanged(selectedId);
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final ids = idOptions(items);
    final allIds = [...extraOptions.keys, ...ids];
    final hasValue = value != null && allIds.contains(value);
    final selectedText = hasValue ? _getOptionLabel(value!) : '-- Select --';

    return InkWell(
      onTap: enabled && allIds.isNotEmpty ? () => _openSearchablePicker(context, allIds) : null,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          border: Border.all(
            color: enabled ? const Color(0xFFCBD5E1) : const Color(0xFFE2E8F0),
          ),
          borderRadius: BorderRadius.circular(8),
          color: enabled ? Colors.white : const Color(0xFFF8FAFC),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    label,
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: enabled ? const Color(0xFF64748B) : const Color(0xFF94A3B8),
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    selectedText,
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: hasValue ? FontWeight.w700 : FontWeight.w400,
                      color: hasValue
                          ? const Color(0xFF1E293B)
                          : const Color(0xFF94A3B8),
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Icon(
              Icons.search_rounded,
              size: 18,
              color: enabled ? const Color(0xFF0D6842) : const Color(0xFF94A3B8),
            ),
            const SizedBox(width: 4),
            Icon(
              Icons.arrow_drop_down_rounded,
              size: 22,
              color: enabled ? const Color(0xFF64748B) : const Color(0xFFCBD5E1),
            ),
          ],
        ),
      ),
    );
  }
}

class _SearchablePickerSheet extends StatefulWidget {
  const _SearchablePickerSheet({
    required this.label,
    required this.selectedValue,
    required this.allIds,
    required this.getLabel,
    required this.onSelected,
  });

  final String label;
  final String? selectedValue;
  final List<String> allIds;
  final String Function(String id) getLabel;
  final ValueChanged<String> onSelected;

  @override
  State<_SearchablePickerSheet> createState() => _SearchablePickerSheetState();
}

class _SearchablePickerSheetState extends State<_SearchablePickerSheet> {
  final TextEditingController _searchCtrl = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final mediaQuery = MediaQuery.of(context);
    final filtered = widget.allIds.where((id) {
      if (_query.trim().isEmpty) return true;
      final label = widget.getLabel(id).toLowerCase();
      return label.contains(_query.trim().toLowerCase());
    }).toList();

    return Container(
      constraints: BoxConstraints(
        maxHeight: mediaQuery.size.height * 0.75,
      ),
      margin: EdgeInsets.only(bottom: mediaQuery.viewInsets.bottom),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Drag handle
          const SizedBox(height: 10),
          Container(
            width: 36,
            height: 4,
            decoration: BoxDecoration(
              color: const Color(0xFFE2E8F0),
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(height: 10),

          // Header
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    'Select ${widget.label}',
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                      color: Color(0xFF0F172A),
                    ),
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close, color: Color(0xFF64748B)),
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),

          // Search Box
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: TextField(
              controller: _searchCtrl,
              autofocus: widget.allIds.length > 5,
              onChanged: (val) => setState(() => _query = val),
              decoration: InputDecoration(
                hintText: 'Search ${widget.label.toLowerCase()}...',
                hintStyle: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13),
                prefixIcon: const Icon(Icons.search_rounded, color: Color(0xFF0D6842), size: 20),
                suffixIcon: _query.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear, size: 18, color: Color(0xFF64748B)),
                        onPressed: () {
                          _searchCtrl.clear();
                          setState(() => _query = '');
                        },
                      )
                    : null,
                contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                isDense: true,
                filled: true,
                fillColor: const Color(0xFFF8FAFC),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                  borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                  borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                  borderSide: const BorderSide(color: Color(0xFF0D6842), width: 1.5),
                ),
              ),
            ),
          ),
          const SizedBox(height: 8),

          // List options
          Flexible(
            child: filtered.isEmpty
                ? Padding(
                    padding: const EdgeInsets.symmetric(vertical: 32, horizontal: 16),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.search_off_rounded, size: 36, color: Color(0xFF94A3B8)),
                        const SizedBox(height: 8),
                        Text(
                          'No ${widget.label.toLowerCase()} matching "${_query.trim()}"',
                          style: const TextStyle(color: Color(0xFF64748B), fontSize: 13),
                          textAlign: TextAlign.center,
                        ),
                      ],
                    ),
                  )
                : ListView.separated(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    shrinkWrap: true,
                    itemCount: filtered.length,
                    separatorBuilder: (_, __) => const Divider(height: 1, color: Color(0xFFF1F5F9)),
                    itemBuilder: (context, index) {
                      final id = filtered[index];
                      final isSelected = id == widget.selectedValue;
                      final labelText = widget.getLabel(id);

                      return Material(
                        color: isSelected ? const Color(0xFFE6F5EC) : Colors.transparent,
                        borderRadius: BorderRadius.circular(8),
                        child: InkWell(
                          onTap: () => widget.onSelected(id),
                          borderRadius: BorderRadius.circular(8),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                            child: Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    labelText,
                                    style: TextStyle(
                                      fontSize: 13,
                                      fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                                      color: isSelected ? const Color(0xFF0D6842) : const Color(0xFF1E293B),
                                    ),
                                  ),
                                ),
                                if (isSelected)
                                  const Icon(
                                    Icons.check_circle_rounded,
                                    color: Color(0xFF0D6842),
                                    size: 18,
                                  ),
                              ],
                            ),
                          ),
                        ),
                      );
                    },
                  ),
          ),
          const SizedBox(height: 12),
        ],
      ),
    );
  }
}
