import 'package:flutter/material.dart';

enum MemberApprovalActionType {
  approve,
  retake,
  reject,
  verifyDoc,
  deleteDoc,
}

/// Rich, color-coded confirmation dialog for Member Approval & Document Review actions.
Future<bool> showMemberApprovalDialog(
  BuildContext context, {
  required String title,
  required String message,
  String? memberName,
  String? clientId,
  String? remarks,
  MemberApprovalActionType actionType = MemberApprovalActionType.approve,
  String? confirmLabel,
  String cancelLabel = 'Cancel',
}) async {
  // Determine Theme Colors based on Action Type
  Color primaryColor;
  Color bgLight;
  Color borderColor;
  IconData headerIcon;

  switch (actionType) {
    case MemberApprovalActionType.approve:
    case MemberApprovalActionType.verifyDoc:
      primaryColor = const Color(0xFF0D6842);
      bgLight = const Color(0xFFF0FAF4);
      borderColor = const Color(0xFFBFE5CC);
      headerIcon = Icons.verified_user_rounded;
      confirmLabel ??= actionType == MemberApprovalActionType.verifyDoc
          ? 'Verify Document'
          : 'Approve & Submit';
      break;

    case MemberApprovalActionType.retake:
      primaryColor = const Color(0xFFB45309);
      bgLight = const Color(0xFFFEF3C7);
      borderColor = const Color(0xFFFDE68A);
      headerIcon = Icons.replay_rounded;
      confirmLabel ??= 'Request Retake';
      break;

    case MemberApprovalActionType.reject:
    case MemberApprovalActionType.deleteDoc:
      primaryColor = const Color(0xFFDC2626);
      bgLight = const Color(0xFFFEE2E2);
      borderColor = const Color(0xFFFCA5A5);
      headerIcon = actionType == MemberApprovalActionType.deleteDoc
          ? Icons.delete_forever_rounded
          : Icons.gavel_rounded;
      confirmLabel ??= actionType == MemberApprovalActionType.deleteDoc
          ? 'Delete Document'
          : 'Confirm Rejection';
      break;
  }

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
            // Header Row with Color-coded Icon Badge
            Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: bgLight,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: borderColor, width: 1.2),
                  ),
                  child: Icon(
                    headerIcon,
                    color: primaryColor,
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
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w800,
                          color: Colors.grey.shade900,
                          height: 1.2,
                        ),
                      ),
                      if (memberName != null && memberName.isNotEmpty) ...[
                        const SizedBox(height: 3),
                        Text(
                          '$memberName ${clientId != null ? "($clientId)" : ""}',
                          style: TextStyle(
                            fontSize: 11.5,
                            fontWeight: FontWeight.w600,
                            color: Colors.grey.shade600,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),

            const SizedBox(height: 16),

            // Main Message Text
            Text(
              message,
              style: TextStyle(
                fontSize: 13,
                color: Colors.grey.shade800,
                height: 1.4,
              ),
            ),

            // Remarks Box (if provided)
            if (remarks != null && remarks.trim().isNotEmpty) ...[
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: Colors.grey.shade50,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: Colors.grey.shade200),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Entered Remarks:',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: Colors.grey,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      '"${remarks.trim()}"',
                      style: TextStyle(
                        fontSize: 12,
                        fontStyle: FontStyle.italic,
                        fontWeight: FontWeight.w600,
                        color: Colors.grey.shade800,
                      ),
                    ),
                  ],
                ),
              ),
            ],

            const SizedBox(height: 14),

            // Action Info Notice
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(11),
              decoration: BoxDecoration(
                color: bgLight,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: borderColor),
              ),
              child: Row(
                children: [
                  Icon(
                    Icons.info_outline_rounded,
                    size: 15,
                    color: primaryColor,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _getActionNotice(actionType),
                      style: TextStyle(
                        fontSize: 11.5,
                        fontWeight: FontWeight.w600,
                        color: primaryColor,
                      ),
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 20),

            // Action Buttons
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
                  child: ElevatedButton(
                    onPressed: () => Navigator.pop(dialogContext, true),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: primaryColor,
                      foregroundColor: Colors.white,
                      elevation: 0,
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                    child: Text(
                      confirmLabel ?? 'Confirm',
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                      ),
                      textAlign: TextAlign.center,
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

String _getActionNotice(MemberApprovalActionType type) {
  switch (type) {
    case MemberApprovalActionType.approve:
      return 'Member will advance to the next approval stage.';
    case MemberApprovalActionType.verifyDoc:
      return 'Document will be marked as verified.';
    case MemberApprovalActionType.retake:
      return 'FDO will be requested to re-upload flagged document(s).';
    case MemberApprovalActionType.reject:
      return 'Member application will be rejected.';
    case MemberApprovalActionType.deleteDoc:
      return 'Document will be soft-deleted from application.';
  }
}
