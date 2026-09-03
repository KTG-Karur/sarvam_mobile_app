class Api {
  // Uses http://localhost:3320 (working via adb reverse tcp:3320 tcp:3320 for Android emulators/devices)
  static String get baseUrl => "https://sarvam.nidhimfi.com";

  static String get mobileLoginUrl => "$baseUrl/api/mobile/login";
  static String get loginUrl => "$baseUrl/api/mobile/login";
  static String get logoutUrl => "$baseUrl/api/auth/logout";
  static String get mpinSetupUrl => "$baseUrl/api/mobile/mpin/setup";
  static String get mpinVerifyUrl => "$baseUrl/api/mobile/mpin/verify";
  static String get mpinForgotUrl => "$baseUrl/api/mobile/mpin/forgot";
  static String get mpinChangeUrl => "$baseUrl/api/mobile/mpin/change";
  static String get mpinChangeStatusUrl =>
      "$baseUrl/api/mobile/mpin/change-status";
  static String get otpSendUrl => "$baseUrl/api/mobile/otp/send";
  static String get otpVerifyUrl => "$baseUrl/api/mobile/otp/verify";
  static String get faceRegisterUrl => "$baseUrl/api/auth/face/register";
  static String get faceVerifyUrl => "$baseUrl/api/auth/face/verify";
  static String get faceAttendanceStatusUrl =>
      "$baseUrl/api/auth/face/attendance-status";
  // Optional device-biometric (fingerprint / Face unlock) punch. The OS check
  // runs on-device; the server still owns the attendance decision and logs the
  // method. See docs/face_attendance_backend_contract.md.
  static String get deviceBiometricPunchUrl =>
      "$baseUrl/api/auth/attendance/device-biometric";
  // Re-registration / face update needs Admin approval for an already-enrolled
  // user. Request submits the ask; status reports the Admin decision.
  static String get faceReRegisterRequestUrl =>
      "$baseUrl/api/auth/face/re-register/request";
  static String get faceReRegisterStatusUrl =>
      "$baseUrl/api/auth/face/re-register/status";
  static String get deviceAccessRequestUrl =>
      "$baseUrl/api/mobile/device-access/request";
  static String get demandCollectionUrl => "$baseUrl/api/collections/demand";
  static String get centersUrl => "$baseUrl/api/centers";
  static String get demandCentersUrl =>
      "$baseUrl/api/collections/demand/centers";
  static String get arrearCollectionUrl => "$baseUrl/api/collections/arrear";
  static String get clientsUrl => "$baseUrl/api/clients";
  static String get clientLoanTrackerUrl => "$baseUrl/api/clients/tracker";
  static String get singleCollectionUrl =>
      "$baseUrl/api/collections/single-collection";
  static String get bulkCollectionUrl =>
      "$baseUrl/api/collections/bulk-collection";
  static String get reverseMeetingUrl =>
      "$baseUrl/api/collections/client/reverse/meeting";
  static String get nonDemandCollectionUrl =>
      "$baseUrl/api/collections/client/non-demand";
  static String get reverseCollectionUrl =>
      "$baseUrl/api/collections/client/reverse";
  static String get eodAllocationUrl =>
      "$baseUrl/api/collections/eod-allocation";
  static String get eodAllocationLoanAdvanceUrl =>
      "$baseUrl/api/collections/eod-allocation/loan-advance";
  static String get branchesUrl => "$baseUrl/api/branches";
  static String get dashboardStatsUrl => "$baseUrl/api/dashboard/v2";
  static String get taskDetailsUrl =>
      "$baseUrl/api/employee/current/task-details";
  // Client enrollment
  static String get clientEnrollmentUrl => "$baseUrl/api/clients/enrollment";
  static String get clientDraftUrl => "$baseUrl/api/clients/draft";
  static String get checkIdentityUniquenessUrl =>
      "$baseUrl/api/clients/check-identity-uniqueness";
  static String get enrollmentValidationUrl =>
      "$baseUrl/api/enrollment-validation";
  static String get kycUploadUrl => "$baseUrl/api/kyc/aadhaar/upload";
  static String get highmarkCheckUrl => "$baseUrl/api/highmark/check";
  static String get highmarkLatestUrl => "$baseUrl/api/highmark/latest";
  static String get highmarkHistoryUrl => "$baseUrl/api/highmark/history";
  static String get groupsUrl => "$baseUrl/api/groups";
  static String get loanProductTypesUrl => "$baseUrl/api/loan-product-types";
  static String get productsUrl => "$baseUrl/api/products";
  static String get loanPurposeTypesUrl => "$baseUrl/api/loan-purpose-types";
  static String get loanPurposesUrl => "$baseUrl/api/loan-purposes";
  static String get economicActivityTypesUrl =>
      "$baseUrl/api/economic-activity-types";
  static String get economicActivitiesUrl => "$baseUrl/api/economic-activities";
  static String get ifscUrl => "$baseUrl/api/ifsc";

  static String get geoDrivingDistanceUrl =>
      "$baseUrl/api/geo/driving-distance";

  static const String pincodeLookupUrl = "https://api.postalpincode.in/pincode";

  static String get generatePassbookUrl => "$baseUrl/api/generate-passbook";

  static String get centerGroupAssignUrl =>
      "$baseUrl/api/client-operations/center-group-assign";
  static String get groupAssignUrl =>
      "$baseUrl/api/client-operations/group-assign";

  // Loans (Renewal Loan Application — FDO)
  static String get loansUrl => "$baseUrl/api/loans";
  static String get loanEligibleClientsUrl =>
      "$baseUrl/api/loans/eligible-clients";

  // Loan Indexation (BM Loan Index Approval — mirrors
  // components/loan-module/LoanIndexationClient.tsx on the web app)
  static String get loanIndexesUrl => "$baseUrl/api/loan-indexes";
  static String get loanIndexesUnindexedLoansUrl =>
      "$baseUrl/api/loan-indexes/unindexed-loans";
  static String get loanIndexesNextIdUrl => "$baseUrl/api/loan-indexes/next-id";

  // Member Individual (BM post-indexation, pre-disbursement per-loan data
  // collection — mirrors components/loan-module/MemberIndividualClient.tsx /
  // MemberIndividualDetailPage.tsx on the web app). Sub-paths
  // (/{loanId}, /{loanId}/cash-flow, etc.) are built inline in the service.
  static String get memberIndividualUrl => "$baseUrl/api/member-individual";

  // Disbursement — AM Level-2 approval (mirrors
  // components/loan-module/DisbursementClient.tsx) and BM Final
  // Disbursement (mirrors components/loan-module/FinalDisbursementClient.tsx)
  // on the web app.
  static String get disbursementsPendingLevel2DetailsUrl =>
      "$baseUrl/api/disbursements/pending-level2-details";
  static String get disbursementsLevel2ActionUrl =>
      "$baseUrl/api/disbursements/level2-action";
  static String get disbursementsApprovedLevel2Url =>
      "$baseUrl/api/disbursements/approved-level2";
  static String get disbursementsBmDisburseUrl =>
      "$baseUrl/api/disbursements/bm-disburse";
  static String get fundersUrl => "$baseUrl/api/masters/funder";

  // Member Approval (client enrollment approval chain + co-applicant workflow)
  static String get approvalQueueUrl => "$baseUrl/api/approval/queue";
  static String get approvalClientsUrl => "$baseUrl/api/approval/clients";
  static String get coApplicantApprovalQueueUrl =>
      "$baseUrl/api/co-applicants/approval-queue";
  static String get coApplicantsUrl => "$baseUrl/api/co-applicants";
  static String get signedUrlUrl => "$baseUrl/api/storage/signed-url";

  // Foreclosure & Gold Loan approvals (AM / Admin)
  static String get foreclosurePendingUrl =>
      "$baseUrl/api/foreclosures/pending-approval";
  static String get foreclosureBaseUrl => "$baseUrl/api/foreclosures";
  static String get goldTransactionsUrl => "$baseUrl/api/gold-transactions";

  // ── Admin module ─────────────────────────────────────────────────────────
  // Defines the Admin API surface mirrored from the web app's /app/api routes.
  static String get usersUrl => "$baseUrl/api/users";
  static String get userResetPasswordUrl =>
      "$baseUrl/api/users/{id}/reset-password";
  static String get usersWithRoleUrl => "$baseUrl/api/users/{id}";
  static String get superAdminRolesUrl => "$baseUrl/api/admin/roles";
  static String get adminRolesManagementUrl =>
      "$baseUrl/api/admin/roles/{roleId}";
  static String get adminUsersRolesUrl =>
      "$baseUrl/api/admin/users/{userId}/roles";
  static String get glUrl => "$baseUrl/api/masters/gl";

  static String get adminModulesUrl => "$baseUrl/api/admin/modules";

  // Web (read-only) admin endpoints mirrored for parity/reference.
  static String get areasUrl => "$baseUrl/api/areas";
  static String get regionsUrl => "$baseUrl/api/regions";
  static String get divisionsUrl => "$baseUrl/api/divisions";
  static String get branchProductMappingUrl =>
      "$baseUrl/api/branches/product-mapping";
  static String get branchLockUrl => "$baseUrl/api/branches/lock";
  static String get groupAssignmentSettingsUrl =>
      "$baseUrl/api/settings/group-assignment";
  static String get meetingPlacesUrl => "$baseUrl/api/meeting-places";
}
