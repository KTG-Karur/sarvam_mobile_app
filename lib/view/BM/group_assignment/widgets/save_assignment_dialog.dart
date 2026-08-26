import 'package:flutter/material.dart';

const Color _dialogGreen = Color(0xFF0D6842);
const Color _dialogDarkText = Color(0xFF064524);
const Color _dialogBgLight = Color(0xFFF2F9F5);
const Color _dialogBorderColor = Color(0xFFCBE8D5);

/// Modern, visually rich confirmation dialog for Center & Group Assignments in the mobile app.
Future<bool> showSaveAssignmentsDialog(
  BuildContext context, {
  required String title,
  required String message,
  int? count,
  List<String>? bulletPoints,
  String confirmLabel = 'Confirm & Save',
  String cancelLabel = 'Cancel',
}) async {
  final result = await showDialog<bool>(
    context: context,
    barrierDismissible: true,
    builder: (dialogContext) => Dialog(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
      ),
      elevation: 8,
      backgroundColor: Colors.white,
      child: Container(
        padding: const EdgeInsets.all(20),
        constraints: const BoxConstraints(maxWidth: 400),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Top Header Row with Icon Badge
            Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: _dialogBgLight,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: _dialogBorderColor, width: 1.2),
                  ),
                  child: const Icon(
                    Icons.assignment_turned_in_rounded,
                    color: _dialogGreen,
                    size: 24,
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w800,
                          color: _dialogDarkText,
                          height: 1.2,
                        ),
                      ),
                      if (count != null && count > 0) ...[
                        const SizedBox(height: 4),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: const Color(0xFFE2F3E8),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Text(
                            '$count Member${count > 1 ? 's' : ''} Selected',
                            style: const TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                              color: _dialogGreen,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),

            const SizedBox(height: 16),

            // Message Description
            Text(
              message,
              style: TextStyle(
                fontSize: 13,
                color: Colors.grey.shade800,
                height: 1.4,
              ),
            ),

            const SizedBox(height: 14),

            // Highlights / What Will Happen Card
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: _dialogBgLight,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: _dialogBorderColor),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Row(
                    children: [
                      Icon(
                        Icons.info_outline_rounded,
                        size: 15,
                        color: _dialogGreen,
                      ),
                      SizedBox(width: 6),
                      Text(
                        'What will happen:',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: _dialogDarkText,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  ...(bulletPoints ??
                          [
                            'Members will be linked to the selected center & group.',
                            'A new center-based Member ID will be generated.',
                            'If a group becomes full concurrently, that assignment will be rejected.',
                          ])
                      .map(
                        (pt) => Padding(
                          padding: const EdgeInsets.only(bottom: 5),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Padding(
                                padding: EdgeInsets.only(top: 2, right: 6),
                                child: Icon(
                                  Icons.check_circle_rounded,
                                  size: 13,
                                  color: _dialogGreen,
                                ),
                              ),
                              Expanded(
                                child: Text(
                                  pt,
                                  style: TextStyle(
                                    fontSize: 11.5,
                                    color: Colors.grey.shade700,
                                    height: 1.3,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                ],
              ),
            ),

            const SizedBox(height: 20),

            // Action Buttons Row
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.pop(dialogContext, false),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.grey.shade700,
                      side: BorderSide(color: Colors.grey.shade300),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                    child: Text(
                      cancelLabel,
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  flex: 1,
                  child: ElevatedButton.icon(
                    onPressed: () => Navigator.pop(dialogContext, true),
                    icon: const Icon(
                      Icons.check_circle_outline_rounded,
                      size: 17,
                    ),
                    label: Text(
                      confirmLabel,
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: _dialogGreen,
                      foregroundColor: Colors.white,
                      elevation: 0,
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    ),
  );
  return result == true;
}
