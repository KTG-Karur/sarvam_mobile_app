import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';

/// True when [workingDate] (the branch's actual current EOD working date,
/// resolved server-side — see `LiveCollectionController.fetchEodWorkingDate`)
/// is not today's calendar date. That only happens when a prior day's EOD
/// hasn't been closed yet, so the branch is still operating on a back-dated
/// working date — mirrors the software's `BranchLock.currentWorkingDate`
/// lagging behind calendar-today.
bool isEodWorkingDatePending(DateTime workingDate) {
  final now = DateTime.now();
  return workingDate.year != now.year ||
      workingDate.month != now.month ||
      workingDate.day != now.day;
}

/// Bold red warning shown under a Collection Date field whenever the
/// resolved branch working date isn't today — tells the FDO/BM they're
/// recording against a pending working date, not calendar-today, and why
/// the date shown/locked on screen doesn't match the phone's actual date.
/// Renders nothing when the branch is caught up (working date == today).
class EodPendingBanner extends StatelessWidget {
  const EodPendingBanner({super.key, required this.workingDate});

  final DateTime workingDate;

  String get _formatted =>
      '${workingDate.day.toString().padLeft(2, '0')}-${workingDate.month.toString().padLeft(2, '0')}-${workingDate.year}';

  @override
  Widget build(BuildContext context) {
    if (!isEodWorkingDatePending(workingDate)) return const SizedBox.shrink();
    return Padding(
      padding: EdgeInsets.only(top: 8.h),
      child: Container(
        width: double.infinity,
        padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 8.h),
        decoration: BoxDecoration(
          color: const Color(0xFFFDECEC),
          border: Border.all(color: const Color(0xFFF5B5B5)),
          borderRadius: BorderRadius.circular(8.r),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.warning_amber_rounded, size: 16.sp, color: Colors.red),
            SizedBox(width: 6.w),
            Expanded(
              child: Text(
                'EOD not completed for $_formatted — this is the pending working date, not today.',
                style: TextStyle(
                  fontSize: 10.5.sp,
                  fontWeight: FontWeight.w800,
                  color: Colors.red,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
