import 'package:flutter/material.dart';

/// Renewal approval status → label + color, matching the web's
/// `RENEWAL_STATUS_CONFIG`.
const Map<String, (String, MaterialColor)> kRenewalStatusLabels = {
  'SUBMITTED': ('Submitted', Colors.amber),
  'PENDING_BM_REVIEW': ('Pending BM', Colors.green),
  'BM_RETAKE_REQUIRED': ('BM Retake', Colors.orange),
  'PENDING_AM_REVIEW': ('Pending AM', Colors.blue),
  'AM_RETAKE_REQUIRED': ('AM Retake', Colors.pink),
  'PENDING_QC_VERIFICATION': ('Pending QC', Colors.teal),
  'QC_VERIFICATION_RETAKE_REQUIRED': ('QC Retake', Colors.cyan),
  'PENDING_FINAL_REVIEW': ('Pending Admin', Colors.deepPurple),
  'FINAL_RETAKE_REQUIRED': ('Admin Retake', Colors.purple),
  'PENDING_LEVEL_1': ('Level 1 Pending', Colors.green),
  'LEVEL_1_RETAKE_REQUIRED': ('L1 Retake', Colors.orange),
  'PENDING_LEVEL_2': ('Level 2 Pending', Colors.blue),
  'LEVEL_2_RETAKE_REQUIRED': ('L2 Retake', Colors.pink),
  'PENDING_LEVEL_3': ('Level 3 Pending', Colors.teal),
  'LEVEL_3_RETAKE_REQUIRED': ('L3 Retake', Colors.cyan),
  'PENDING_LEVEL_4': ('Level 4 Pending', Colors.deepPurple),
  'LEVEL_4_RETAKE_REQUIRED': ('L4 Retake', Colors.purple),
  'APPROVED': ('Approved', Colors.green),
  'REJECTED': ('Rejected', Colors.red),
};

/// Disbursement status → label + color (web's `DISB_STATUS_CONFIG`).
const Map<String, (String, MaterialColor)> kDisbStatusLabels = {
  'PENDING_LEVEL1': ('Pending AM', Colors.orange),
  'APPROVED_LEVEL1': ('AM Approved', Colors.blue),
  'PENDING_LEVEL2': ('Pending BM', Colors.deepPurple),
  'APPROVED_LEVEL2': ('Ready to Disburse', Colors.green),
  'DISBURSED': ('Disbursed', Colors.teal),
  'REJECTED': ('Rejected', Colors.red),
};

/// What each renewal history action reads as (web's `RENEWAL_ACTION_LABEL`).
const Map<String, String> kRenewalActionLabels = {
  'FDO_SUBMITTED_RENEWAL': 'Submitted',
  'FDO_RESUBMITTED_RENEWAL': 'Resubmitted',
  'BM_COMPLETED_REVIEW': 'Approved & Forwarded',
  'AM_APPROVED_LOAN': 'Approved & Forwarded',
  'QC_VERIFIED_LOAN': 'Verified & Forwarded',
  'FINAL_APPROVED_LOAN': 'Final Approved',
  'RENEWAL_RETAKE_REQUESTED': 'Retake Requested',
  'RENEWAL_REJECTED': 'Rejected',
  'RENEWAL_DOC_VERIFIED': 'Document Verified',
  'RENEWAL_DOC_RETAKE_REQUIRED': 'Document Retake Requested',
};
