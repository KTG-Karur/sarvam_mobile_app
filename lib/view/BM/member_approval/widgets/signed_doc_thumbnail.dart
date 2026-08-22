import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:sarvam/controller/member_approval_controller.dart';

const _green = Color(0xFF0D6842);

/// Opens [url] in a full-screen, pinch-to-zoom dialog. Used for both the
/// Member Approval detail screen and the Co-Applicant Approval row.
void showFullScreenImage(BuildContext context, String url) {
  showDialog(
    context: context,
    barrierColor: Colors.black87,
    builder: (dialogContext) => Dialog(
      backgroundColor: Colors.transparent,
      insetPadding: const EdgeInsets.all(12),
      child: Stack(
        children: [
          InteractiveViewer(
            child: Image.network(
              url,
              errorBuilder: (_, __, ___) => const Center(
                child: Icon(Icons.broken_image, color: Colors.white, size: 48),
              ),
            ),
          ),
          Positioned(
            top: 4,
            right: 4,
            child: IconButton(
              onPressed: () => Navigator.pop(dialogContext),
              icon: const Icon(Icons.close, color: Colors.white),
            ),
          ),
        ],
      ),
    ),
  );
}

/// A single KYC document thumbnail — resolves its private-bucket [fileKey]
/// to a viewable signed URL on first build, then reacts to
/// `controller.signedUrlCache` as it resolves. Non-image documents (PDFs —
/// bank passbook, smart card, etc.) show a generic file icon instead of
/// attempting to render them as an image.
class SignedDocThumbnail extends StatefulWidget {
  const SignedDocThumbnail({
    super.key,
    required this.controller,
    required this.fileKey,
    required this.label,
    this.mimeType,
  });

  final MemberApprovalController controller;
  final String fileKey;
  final String label;
  final String? mimeType;

  @override
  State<SignedDocThumbnail> createState() => _SignedDocThumbnailState();
}

class _SignedDocThumbnailState extends State<SignedDocThumbnail> {
  @override
  void initState() {
    super.initState();
    if (widget.fileKey.isNotEmpty) {
      widget.controller.resolveSignedUrl(widget.fileKey);
    }
  }

  @override
  void didUpdateWidget(covariant SignedDocThumbnail oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.fileKey.isNotEmpty && widget.fileKey != oldWidget.fileKey) {
      widget.controller.resolveSignedUrl(widget.fileKey);
    }
  }

  bool get _isImage =>
      widget.mimeType == null || widget.mimeType!.startsWith('image/');

  @override
  Widget build(BuildContext context) {
    return Obx(() {
      final url = widget.controller.signedUrlCache[widget.fileKey];
      return SizedBox(
        width: 92,
        child: Column(
          children: [
            GestureDetector(
              onTap: url == null || !_isImage
                  ? null
                  : () => showFullScreenImage(context, url),
              child: Container(
                height: 84,
                width: 84,
                decoration: BoxDecoration(
                  border: Border.all(color: const Color(0xFFE1EEE6)),
                  borderRadius: BorderRadius.circular(8),
                  color: const Color(0xFFF7FBF7),
                ),
                child: url == null
                    ? const Center(
                        child: SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: _green,
                          ),
                        ),
                      )
                    : !_isImage
                    ? const Center(
                        child: Icon(
                          Icons.picture_as_pdf_outlined,
                          color: _green,
                          size: 28,
                        ),
                      )
                    : ClipRRect(
                        borderRadius: BorderRadius.circular(8),
                        child: Image.network(
                          url,
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => const Icon(
                            Icons.broken_image_outlined,
                            color: Color(0xFF94A3B8),
                          ),
                        ),
                      ),
              ),
            ),
            const SizedBox(height: 4),
            Text(
              widget.label,
              style: const TextStyle(fontSize: 9.5, color: Color(0xFF64748B)),
              maxLines: 2,
              textAlign: TextAlign.center,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      );
    });
  }
}
