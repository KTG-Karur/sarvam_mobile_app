class Api {
  
  static const String baseUrl = "https://sarvam.nidhimfi.com";

  static const String mobileLoginUrl = "$baseUrl/api/mobile/login";
  static const String loginUrl = "$baseUrl/api/mobile/login";
  static const String logoutUrl = "$baseUrl/api/auth/logout";
  static const String mpinSetupUrl = "$baseUrl/api/mobile/mpin/setup";
  static const String mpinVerifyUrl = "$baseUrl/api/mobile/mpin/verify";
  static const String mpinForgotUrl = "$baseUrl/api/mobile/mpin/forgot";
  static const String mpinChangeUrl = "$baseUrl/api/mobile/mpin/change";
  static const String mpinChangeStatusUrl =
      "$baseUrl/api/mobile/mpin/change-status";
  static const String otpSendUrl = "$baseUrl/api/mobile/otp/send";
  static const String otpVerifyUrl = "$baseUrl/api/mobile/otp/verify";
  static const String faceRegisterUrl = "$baseUrl/api/auth/face/register";
  static const String faceVerifyUrl = "$baseUrl/api/auth/face/verify";
  static const String faceAttendanceStatusUrl =
      "$baseUrl/api/auth/face/attendance-status";
  static const String deviceAccessRequestUrl =
      "$baseUrl/api/mobile/device-access/request";
  static const String demandCollectionUrl = "$baseUrl/api/collections/demand";
  static const String centersUrl = "$baseUrl/api/centers";
  static const String demandCentersUrl =
      "$baseUrl/api/collections/demand/centers";
  static const String arrearCollectionUrl = "$baseUrl/api/collections/arrear";
  static const String clientsUrl = "$baseUrl/api/clients";
  static const String clientLoanTrackerUrl = "$baseUrl/api/clients/tracker";
  static const String singleCollectionUrl =
      "$baseUrl/api/collections/single-collection";
  static const String bulkCollectionUrl =
      "$baseUrl/api/collections/bulk-collection";
  static const String reverseMeetingUrl =
      "$baseUrl/api/collections/client/reverse/meeting";
  static const String nonDemandCollectionUrl =
      "$baseUrl/api/collections/client/non-demand";
  static const String reverseCollectionUrl =
      "$baseUrl/api/collections/client/reverse";
  static const String eodAllocationUrl =
      "$baseUrl/api/collections/eod-allocation";
  static const String eodAllocationLoanAdvanceUrl =
      "$baseUrl/api/collections/eod-allocation/loan-advance";
  static const String branchesUrl = "$baseUrl/api/branches";
  static const String dashboardStatsUrl = "$baseUrl/api/dashboard/v2";
  static const String taskDetailsUrl =
      "$baseUrl/api/employee/current/task-details";
  // Client enrollment
  static const String clientEnrollmentUrl = "$baseUrl/api/clients/enrollment";
  static const String clientDraftUrl = "$baseUrl/api/clients/draft";
  static const String checkIdentityUniquenessUrl =
      "$baseUrl/api/clients/check-identity-uniqueness";
  static const String enrollmentValidationUrl =
      "$baseUrl/api/enrollment-validation";
  static const String kycUploadUrl = "$baseUrl/api/kyc/aadhaar/upload";
  static const String highmarkCheckUrl = "$baseUrl/api/highmark/check";
  static const String highmarkLatestUrl = "$baseUrl/api/highmark/latest";
  static const String highmarkHistoryUrl = "$baseUrl/api/highmark/history";
  static const String groupsUrl = "$baseUrl/api/groups";
  static const String loanProductTypesUrl = "$baseUrl/api/loan-product-types";
  static const String productsUrl = "$baseUrl/api/products";
  static const String loanPurposeTypesUrl = "$baseUrl/api/loan-purpose-types";
  static const String loanPurposesUrl = "$baseUrl/api/loan-purposes";
  static const String economicActivityTypesUrl =
      "$baseUrl/api/economic-activity-types";
  static const String economicActivitiesUrl =
      "$baseUrl/api/economic-activities";
  static const String ifscUrl = "$baseUrl/api/ifsc";

  static const String geoDrivingDistanceUrl =
      "$baseUrl/api/geo/driving-distance";

  static const String pincodeLookupUrl = "https://api.postalpincode.in/pincode";

  static const String generatePassbookUrl = "$baseUrl/api/generate-passbook";

  static const String centerGroupAssignUrl =
      "$baseUrl/api/client-operations/center-group-assign";
  static const String groupAssignUrl =
      "$baseUrl/api/client-operations/group-assign";

  // Loans (Renewal Loan Application — FDO)
  static const String loansUrl = "$baseUrl/api/loans";
  static const String loanEligibleClientsUrl =
      "$baseUrl/api/loans/eligible-clients";

  // Loan Indexation (BM Loan Index Approval — mirrors
  // components/loan-module/LoanIndexationClient.tsx on the web app)
  static const String loanIndexesUrl = "$baseUrl/api/loan-indexes";
  static const String loanIndexesUnindexedLoansUrl =
      "$baseUrl/api/loan-indexes/unindexed-loans";
  static const String loanIndexesNextIdUrl =
      "$baseUrl/api/loan-indexes/next-id";

  // Member Individual (BM post-indexation, pre-disbursement per-loan data
  // collection — mirrors components/loan-module/MemberIndividualClient.tsx /
  // MemberIndividualDetailPage.tsx on the web app). Sub-paths
  // (/{loanId}, /{loanId}/cash-flow, etc.) are built inline in the service.
  static const String memberIndividualUrl = "$baseUrl/api/member-individual";

  // Disbursement — AM Level-2 approval (mirrors
  // components/loan-module/DisbursementClient.tsx) and BM Final
  // Disbursement (mirrors components/loan-module/FinalDisbursementClient.tsx)
  // on the web app.
  static const String disbursementsPendingLevel2DetailsUrl =
      "$baseUrl/api/disbursements/pending-level2-details";
  static const String disbursementsLevel2ActionUrl =
      "$baseUrl/api/disbursements/level2-action";
  static const String disbursementsApprovedLevel2Url =
      "$baseUrl/api/disbursements/approved-level2";
  static const String disbursementsBmDisburseUrl =
      "$baseUrl/api/disbursements/bm-disburse";
  static const String fundersUrl = "$baseUrl/api/masters/funder";

  // Member Approval (client enrollment approval chain + co-applicant workflow)
  static const String approvalQueueUrl = "$baseUrl/api/approval/queue";
  static const String approvalClientsUrl = "$baseUrl/api/approval/clients";
  static const String coApplicantApprovalQueueUrl =
      "$baseUrl/api/co-applicants/approval-queue";
  static const String coApplicantsUrl = "$baseUrl/api/co-applicants";
  static const String signedUrlUrl = "$baseUrl/api/storage/signed-url";

  // Foreclosure & Gold Loan approvals (AM / Admin)
  static const String foreclosurePendingUrl =
      "$baseUrl/api/foreclosures/pending-approval";
  static const String foreclosureBaseUrl = "$baseUrl/api/foreclosures";
  static const String goldTransactionsUrl = "$baseUrl/api/gold-transactions";

  // ── Admin module ─────────────────────────────────────────────────────────
  // Defines the Admin API surface mirrored from the web app's /app/api routes.
  static const String usersUrl = "$baseUrl/api/users";
  static const String userResetPasswordUrl =
      "$baseUrl/api/users/{id}/reset-password";
  static const String usersWithRoleUrl = "$baseUrl/api/users/{id}";
  static const String superAdminRolesUrl = "$baseUrl/api/admin/roles";
  static const String adminRolesManagementUrl =
      "$baseUrl/api/admin/roles/{roleId}";
  static const String adminUsersRolesUrl =
      "$baseUrl/api/admin/users/{userId}/roles";
  static const String glUrl = "$baseUrl/api/masters/gl";

  static const String adminModulesUrl = "$baseUrl/api/admin/modules";

  // Web (read-only) admin endpoints mirrored for parity/reference.
  static const String areasUrl = "$baseUrl/api/areas";
  static const String regionsUrl = "$baseUrl/api/regions";
  static const String divisionsUrl = "$baseUrl/api/divisions";
  static const String branchProductMappingUrl =
      "$baseUrl/api/branches/product-mapping";
  static const String branchLockUrl = "$baseUrl/api/branches/lock";
  static const String groupAssignmentSettingsUrl =
      "$baseUrl/api/settings/group-assignment";
  static const String meetingPlacesUrl = "$baseUrl/api/meeting-places";
}
