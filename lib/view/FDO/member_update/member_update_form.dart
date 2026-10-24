import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:get/get.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:sarvam/controller/client_enrollment/enrollment_options.dart';
import 'package:sarvam/controller/client_enrollment/enrollment_lookups.dart';
import 'package:sarvam/controller/client_enrollment/enrollment_uploads.dart';
import 'package:sarvam/controller/member_update/member_update_controller.dart';
import 'package:sarvam/services/enrollment_api_service.dart';
import 'package:sarvam/view/FDO/new_member_create/widgets/enrollment_field_widgets.dart';

class _SignedImage extends StatefulWidget {
  const _SignedImage({
    required this.api,
    required this.rawUrlOrKey,
    this.fit = BoxFit.contain,
    this.errorWidget,
  });

  final EnrollmentApiService api;
  final String rawUrlOrKey;
  final BoxFit fit;
  final Widget? errorWidget;

  static final Map<String, Future<String?>> _cache = {};

  @override
  State<_SignedImage> createState() => _SignedImageState();
}

class _SignedImageState extends State<_SignedImage> {
  late Future<String?> _future;

  @override
  void initState() {
    super.initState();
    _future = _SignedImage._cache.putIfAbsent(
      widget.rawUrlOrKey,
      () => widget.api.resolveFileUrl(widget.rawUrlOrKey),
    );
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<String?>(
    future: _future,
    builder: (context, snapshot) {
      if (snapshot.connectionState != ConnectionState.done) {
        return const Center(child: CircularProgressIndicator(strokeWidth: 2));
      }
      final url = snapshot.data;
      if (url == null || url.isEmpty) {
        return widget.errorWidget ??
            const Icon(Icons.broken_image_outlined, color: Color(0xFFA9C9B7));
      }
      return Image.network(
        url,
        fit: widget.fit,
        errorBuilder: (_, __, ___) =>
            widget.errorWidget ??
            const Icon(Icons.broken_image_outlined, color: Color(0xFFA9C9B7)),
        loadingBuilder: (context, child, progress) =>
            progress == null ? child : const Center(child: CircularProgressIndicator(strokeWidth: 2)),
      );
    },
  );
}

class MemberUpdateForm extends StatelessWidget {
  final String clientId;
  final MemberUpdateController controller;

  MemberUpdateForm({super.key, required this.clientId})
      : controller = Get.put(MemberUpdateController(clientId: clientId));

  static const _steps = [
    ('Member Details', Icons.person_outline),
    ('Other Details', Icons.description_outlined),
    ('Co-Applicant', Icons.group_outlined),
    ('Loan Details', Icons.credit_card_outlined),
    ('KYC Documents', Icons.badge_outlined),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF4FBF6),
      appBar: AppBar(
        title: const Text('Update Member'),
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF10472A),
        elevation: 0,
      ),
      body: Obx(() {
        if (controller.isLoading.value) {
          return Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const CircularProgressIndicator(color: Color(0xFF00843D)),
                const SizedBox(height: 16),
                Text(
                  controller.loadingMessage.value,
                  style: const TextStyle(
                    color: Color(0xFF10472A),
                    fontWeight: FontWeight.w700,
                    fontSize: 16,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Please wait while we sync with the server',
                  style: TextStyle(
                    color: Colors.grey.shade600,
                    fontSize: 13,
                  ),
                ),
              ],
            ),
          );
        }

        return GestureDetector(
          onTap: () => FocusScope.of(context).unfocus(),
          child: Column(
            children: [
              _stepsBar(),
              Expanded(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.all(16),
                  child: _stepContent(),
                ),
              ),
            ],
          ),
        );
      }),
      bottomNavigationBar: Obx(() => controller.isLoading.value ? const SizedBox.shrink() : _actions(context)),
    );
  }

  Widget _stepContent() {
    switch (controller.currentStep.value) {
      case 0:
        return _memberDetailsTab();
      case 1:
        return _otherDetailsTab();
      case 2:
        return _coApplicantTab();
      case 3:
        return _loanDetailsTab();
      case 4:
        return _kycDocumentsTab();
      default:
        return const Center(child: Text('Unknown Step'));
    }
  }

  Widget _memberDetailsTab() => EnrollmentSectionShell(
    title: 'Member Details',
    subtitle: 'Primary identity and contact details',
    icon: Icons.person_outline,
    children: [
      EnrollmentTextField(
        label: 'Phone Number',
        hint: 'Enter 10-digit mobile number',
        controller: controller.mobileNumberCtrl,
        icon: Icons.phone_outlined,
        keyboardType: TextInputType.phone,
        maxLength: 10,
        required: true,
      ),
      EnrollmentTextField(
        label: 'Aadhaar Number',
        hint: '12-digit Aadhaar number',
        controller: controller.otherIdNoCtrl,
        keyboardType: TextInputType.number,
        maxLength: 12,
        required: true,
      ),
      EnrollmentTextField(
        label: 'First Name',
        hint: 'Enter first name',
        controller: controller.clientNameCtrl,
        required: true,
      ),
      EnrollmentTextField(
        label: 'Last Name',
        hint: 'Enter last name',
        controller: controller.lastNameCtrl,
        required: false,
      ),
      EnrollmentTextField(
        label: 'PAN Card Number',
        hint: 'ABCDE1234F',
        controller: controller.pancardNoCtrl,
        maxLength: 10,
        required: false,
      ),
      EnrollmentTextField(
        label: 'Voter ID Number',
        hint: 'ABC1234567',
        controller: controller.votersIdNoCtrl,
        maxLength: 30,
        required: true,
      ),
      EnrollmentDateField(
        label: 'Date of Birth',
        controller: controller.dobCtrl,
        required: true,
        lastDate: DateTime.now(),
      ),
      EnrollmentTextField(
        label: "Father Name",
        hint: "Enter father's name",
        controller: controller.fatherNameCtrl,
        required: true,
      ),
      EnrollmentSelectField(
        label: 'Gender',
        value: controller.gender.value,
        options: EnrollmentOptions.genders,
        onChanged: (v) => controller.gender.value = v,
        required: true,
      ),
      EnrollmentTextField(
        label: 'Permanent Address',
        hint: 'Enter permanent address',
        controller: controller.permanentAddressCtrl,
        icon: Icons.location_on_outlined,
        required: true,
      ),
      Focus(
        onFocusChange: (hasFocus) {
          if (!hasFocus) {
            final pincode = controller.pincodeCtrl.text;
            if (pincode.length == 6) {
              controller.onPincodeChanged(pincode);
            }
          }
        },
        child: EnrollmentTextField(
          label: 'Pincode',
          hint: '6-digit pincode',
          controller: controller.pincodeCtrl,
          keyboardType: TextInputType.number,
          maxLength: 6,
          required: true,
        ),
      ),
      EnrollmentTextField(
        label: 'Post Office',
        hint: 'Enter post office',
        controller: controller.postOfficeCtrl,
        required: true,
      ),
      EnrollmentTextField(
        label: 'State',
        hint: 'Enter state',
        controller: controller.stateCtrl,
        required: true,
      ),
      EnrollmentTextField(
        label: 'City/District',
        hint: 'Enter city/district',
        controller: controller.districtCtrl,
        required: false,
      ),
    ],
  );

  Widget _otherDetailsTab() => Column(
    children: [
      EnrollmentSectionShell(
        title: 'Personal & Social',
        subtitle: 'Social status and family background',
        icon: Icons.people_outline,
        children: [
          EnrollmentTextField(
            label: 'Email',
            hint: 'Enter email',
            controller: controller.emailCtrl,
            keyboardType: TextInputType.emailAddress,
            required: false,
          ),
          EnrollmentTextField(
            label: 'Age',
            hint: 'Auto-calculated from DOB',
            controller: controller.ageCtrl,
            readOnly: true,
          ),
          EnrollmentSelectField(
            label: 'Caste',
            value: controller.caste.value,
            options: EnrollmentOptions.castes,
            onChanged: (v) => controller.caste.value = v,
            required: false,
          ),
          EnrollmentSelectField(
            label: 'Community',
            value: controller.community.value,
            options: EnrollmentOptions.communities,
            onChanged: (v) => controller.community.value = v,
            required: false,
          ),
          EnrollmentSelectField(
            label: 'Religion',
            value: controller.religion.value,
            options: EnrollmentOptions.religions,
            onChanged: (v) => controller.religion.value = v,
            required: false,
          ),
          EnrollmentSelectField(
            label: 'Economic Activity Type',
            value: controller.economicActivityTypeId.value,
            options: enrollmentIdOptions(controller.economicActivityTypes),
            labelBuilder: enrollmentIdLabelBuilder(controller.economicActivityTypes),
            onChanged: (v) => controller.onEconomicActivityTypeChanged(v, scope: EaScope.client),
            required: true,
          ),
          EnrollmentSelectField(
            label: 'Economic Activity',
            value: controller.economicActivityId.value,
            options: enrollmentIdOptions(controller.economicActivitiesForType),
            labelBuilder: enrollmentIdLabelBuilder(controller.economicActivitiesForType),
            onChanged: (v) => controller.economicActivityId.value = v,
            required: true,
            enabled: controller.economicActivityTypeId.value != null,
          ),
          EnrollmentSelectField(
            label: 'Qualification',
            value: controller.qualification.value,
            options: EnrollmentOptions.qualifications.map((q) => q['value']!).toList(),
            labelBuilder: (v) => EnrollmentOptions.qualifications.firstWhereOrNull((q) => q['value'] == v)?['label'] ?? v,
            onChanged: (v) => controller.qualification.value = v,
            required: false,
          ),
          EnrollmentSelectField(
            label: 'Marital Status',
            value: controller.maritalStatus.value,
            options: EnrollmentOptions.maritalStatuses,
            onChanged: (v) => controller.maritalStatus.value = v,
            required: true,
          ),
          EnrollmentTextField(
            label: 'Spouse Name',
            hint: 'Enter spouse name',
            controller: controller.spouseNameCtrl,
            required: false,
          ),
          EnrollmentDateField(
            label: 'Spouse Date of Birth',
            controller: controller.spouseDobCtrl,
            lastDate: DateTime.now(),
            required: false,
          ),
          EnrollmentTextField(
            label: 'Spouse Mobile',
            hint: '10-digit mobile number',
            controller: controller.spouseMobileNumberCtrl,
            keyboardType: TextInputType.phone,
            maxLength: 10,
            required: false,
          ),
          EnrollmentSelectField(
            label: 'Spouse Gender',
            value: controller.spouseGender.value,
            options: EnrollmentOptions.genders,
            onChanged: (v) => controller.spouseGender.value = v,
            required: false,
          ),
          EnrollmentSelectField(
            label: 'Spouse Economic Activity Type',
            value: controller.spouseEconomicActivityTypeId.value,
            options: enrollmentIdOptions(controller.economicActivityTypes),
            labelBuilder: enrollmentIdLabelBuilder(controller.economicActivityTypes),
            onChanged: (v) => controller.onEconomicActivityTypeChanged(v, scope: EaScope.spouse),
            required: false,
          ),
          EnrollmentSelectField(
            label: 'Spouse Economic Activity',
            value: controller.spouseEconomicActivityId.value,
            options: enrollmentIdOptions(controller.spouseEconomicActivitiesForType),
            labelBuilder: enrollmentIdLabelBuilder(controller.spouseEconomicActivitiesForType),
            onChanged: (v) => controller.spouseEconomicActivityId.value = v,
            enabled: controller.spouseEconomicActivityTypeId.value != null,
            required: false,
          ),
          EnrollmentTextField(
            label: 'Number of Children',
            hint: 'Enter number of children',
            controller: controller.noOfChildrenCtrl,
            keyboardType: TextInputType.number,
            required: false,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          ),
          EnrollmentTextField(
            label: 'Monthly Family Income',
            hint: 'Enter amount',
            controller: controller.monthlyFamilyIncomeCtrl,
            keyboardType: TextInputType.number,
            required: true,
          ),
          EnrollmentTextField(
            label: 'Monthly Family Expense',
            hint: 'Enter amount',
            controller: controller.monthlyFamilyExpenseCtrl,
            keyboardType: TextInputType.number,
            required: false,
          ),
        ],
      ),
      const SizedBox(height: 24),
      EnrollmentSectionShell(
        title: 'Bank & Identity',
        subtitle: 'Bank account and identity proof details',
        icon: Icons.account_balance_outlined,
        children: [
          EnrollmentTextField(
            label: 'Bank IFSC',
            hint: 'SBIN0001234',
            controller: controller.ifscCodeCtrl,
            maxLength: 11,
            required: true,
            suffixIcon: controller.isFetchingIfsc.value
                ? const SizedBox(width: 20, height: 20, child: Padding(padding: EdgeInsets.all(8), child: CircularProgressIndicator(strokeWidth: 2)))
                : TextButton(
                    onPressed: () => controller.onIfscChanged(controller.ifscCodeCtrl.text),
                    child: const Text('Verify', style: TextStyle(color: enrollmentGreen, fontWeight: FontWeight.bold)),
                  ),
          ),
          if (controller.ifscLookupAddress.value.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 12, left: 4),
              child: Text(
                controller.ifscLookupAddress.value,
                style: const TextStyle(fontSize: 10, color: enrollmentHelperColor, fontWeight: FontWeight.w500),
              ),
            ),
          EnrollmentTextField(
            label: 'Bank Name',
            hint: 'Enter bank name',
            controller: controller.bankNameCtrl,
            required: true,
            readOnly: controller.ifscLocked.value,
          ),
          EnrollmentTextField(
            label: 'Bank Branch',
            hint: 'Enter branch name',
            controller: controller.bankBranchCtrl,
            required: false,
            readOnly: controller.ifscLocked.value,
          ),
          EnrollmentSelectField(
            label: 'Bank Account Type',
            value: controller.bankAccountType.value,
            options: EnrollmentOptions.bankAccountTypes,
            onChanged: (v) => controller.bankAccountType.value = v,
            required: false,
          ),
          EnrollmentTextField(
            label: 'Account / Passbook Number',
            hint: 'Enter account number',
            controller: controller.bankAcNoCtrl,
            keyboardType: TextInputType.number,
            required: true,
          ),
          EnrollmentTextField(
            label: 'Retype Account Number',
            hint: 'Confirm account number',
            controller: controller.retypeBankAcNoCtrl,
            keyboardType: TextInputType.number,
            required: true,
          ),
          EnrollmentTextField(
            label: "Mother's Name",
            hint: "Enter mother's name",
            controller: controller.motherNameCtrl,
            required: false,
          ),
          EnrollmentTextField(
            label: 'Smart Card Number',
            hint: 'Enter smart card number',
            controller: controller.smartCardNoCtrl,
            required: true,
          ),
          EnrollmentSelectField(
            label: 'House Status',
            value: controller.houseStatus.value,
            options: EnrollmentOptions.houseStatuses,
            onChanged: (v) => controller.houseStatus.value = v,
            required: false,
          ),
        ],
      ),
    ],
  );

  Widget _coApplicantTab() => EnrollmentSectionShell(
    title: 'Co-Applicant Details',
    subtitle: 'Enter co-applicant details',
    icon: Icons.group_outlined,
    children: [
      EnrollmentSelectField(
        label: 'Relation with Client',
        value: controller.nomineeRelation.value,
        options: EnrollmentOptions.nomineeRelations,
        onChanged: (v) => controller.nomineeRelation.value = v,
        required: true,
      ),
      EnrollmentTextField(
        label: 'Co-Applicant Name',
        hint: 'Enter co-applicant name',
        controller: controller.nomineeNameCtrl,
        required: true,
      ),
      EnrollmentTextField(
        label: 'Mobile Number',
        hint: '9360081754',
        controller: controller.nomineePhoneNumberCtrl,
        icon: Icons.phone_outlined,
        keyboardType: TextInputType.phone,
        maxLength: 10,
        required: true,
      ),
      EnrollmentSelectField(
        label: 'Gender',
        value: controller.nomineeGender.value,
        options: EnrollmentOptions.genders,
        onChanged: (v) => controller.nomineeGender.value = v,
        required: true,
      ),
      EnrollmentDateField(
        label: 'Date of Birth',
        controller: controller.nomineeDateOfBirthCtrl,
        lastDate: DateTime.now(),
        required: true,
      ),
      EnrollmentTextField(
        label: 'Age',
        hint: 'Auto-calculated',
        controller: controller.nomineeAgeCtrl,
        readOnly: true,
        required: true,
      ),
      EnrollmentSelectField(
        label: 'Economic Activity Type',
        value: controller.coApplicantEconomicActivityTypeId.value,
        options: enrollmentIdOptions(controller.economicActivityTypes),
        labelBuilder: enrollmentIdLabelBuilder(controller.economicActivityTypes),
        onChanged: (v) => controller.onEconomicActivityTypeChanged(v, scope: EaScope.coApplicant),
        required: false,
      ),
      EnrollmentSelectField(
        label: 'Economic Activity',
        value: controller.coApplicantEconomicActivityId.value,
        options: enrollmentIdOptions(controller.coApplicantEconomicActivitiesForType),
        labelBuilder: enrollmentIdLabelBuilder(controller.coApplicantEconomicActivitiesForType),
        onChanged: (v) => controller.coApplicantEconomicActivityId.value = v,
        enabled: controller.coApplicantEconomicActivityTypeId.value != null,
        required: false,
      ),
      EnrollmentTextField(
        label: 'Voter ID No.',
        hint: 'FFT4374567',
        controller: controller.caVoterIdNoCtrl,
        maxLength: 30,
        required: false,
      ),
      EnrollmentTextField(
        label: 'PAN Card No.',
        hint: 'ABCDE1234F',
        controller: controller.caPancardNoCtrl,
        maxLength: 10,
        required: false,
      ),
      EnrollmentTextField(
        label: 'Aadhaar ID No.',
        hint: '12-digit Aadhaar number',
        controller: controller.caOtherIdNoCtrl,
        keyboardType: TextInputType.number,
        maxLength: 12,
        required: true,
      ),
    ],
  );

  Widget _loanDetailsTab() => Column(
    children: [
      EnrollmentSectionShell(
        title: 'Ongoing Loan',
        subtitle: 'This client is approved — showing their ongoing (approved/active) loan below, read-only.',
        icon: Icons.account_balance_wallet_outlined,
        children: [
          Obx(() {
            if (controller.isLoadingOngoingLoans.value) {
              return const Center(child: Padding(padding: EdgeInsets.all(20), child: CircularProgressIndicator()));
            }
            if (controller.ongoingLoans.isEmpty) {
              return const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Center(
                  child: Text(
                    'No ongoing loan for this client yet.',
                    style: TextStyle(color: Color(0xFF64748B), fontSize: 13),
                  ),
                ),
              );
            }
            return Column(
              children: controller.ongoingLoans.map((loan) => _ongoingLoanCard(loan)).toList(),
            );
          }),
        ],
      ),
      const SizedBox(height: 24),
      EnrollmentSectionShell(
        title: 'Member Group Status',
        subtitle: 'This client already has a center/group assignment — managed from Client Operations → Assign Center & Group.',
        icon: Icons.people_outline,
        children: [
          Obx(() {
            final centerId = controller.requestedCenterId.value;
            if (centerId == null || centerId.isEmpty) {
              return const Padding(
                padding: EdgeInsets.symmetric(vertical: 16),
                child: Text('No center/group assigned.', style: TextStyle(color: Color(0xFF64748B), fontSize: 13)),
              );
            }
            final centerName = controller.centerName.value ?? centerId;
            final centerCode = controller.centerCode.value ?? '';
            return Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: const Color(0xFFF8FAFC),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: const Color(0xFFE2E8F0)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.corporate_fare_outlined, size: 16, color: Color(0xFF64748B)),
                  const SizedBox(width: 8),
                  Text(
                    centerName.toUpperCase(),
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Color(0xFF1E293B)),
                  ),
                  if (centerCode.isNotEmpty) ...[
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF59E0B),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        centerCode,
                        style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold),
                      ),
                    ),
                  ],
                ],
              ),
            );
          }),
        ],
      ),
      const SizedBox(height: 24),
    ],
  );

  Widget _ongoingLoanCard(Map<String, dynamic> loan) {
    final loanNo = loan['loanAccount'] ?? loan['loanNumber'] ?? loan['id']?.toString() ?? '---';
    final amount = loan['loanAmount'] ?? 0;
    final duesPaid = loan['completedDues'] ?? loan['duesPaid'] ?? 0;
    final totalDues = loan['totalDues'] ?? loan['numberOfDues'] ?? 0;
    final collectedCount = loan['completedDues'] ?? 0;
    final closingAr = (loan['closingArrPrincipal'] ?? 0) + (loan['closingArrInterest'] ?? 0);

    DateTime? parseLoanDate(dynamic v) {
      if (v == null || v.toString().isEmpty) return null;
      try {
        return DateTime.parse(v.toString());
      } catch (_) {
        try {
          // Handle "02 Sep 2026"
          return DateFormat('dd MMM yyyy').parse(v.toString());
        } catch (_) {
          try {
            // Handle "02/09/2026"
            return DateFormat('dd/MM/yyyy').parse(v.toString());
          } catch (_) {
            return null;
          }
        }
      }
    }

    // Dates
    final dDate = parseLoanDate(loan['disbursementDate']);
    final disbursementDate = dDate != null ? DateFormat('dd/MM/yyyy').format(dDate) : '---';
    final mDate = parseLoanDate(loan['maturityDate']);
    final maturityDate = mDate != null ? DateFormat('dd/MM/yyyy').format(mDate) : '---';
    final dsDate = parseLoanDate(loan['dueStartDate']);
    final dueStartDate = dsDate != null ? DateFormat('dd/MM/yyyy').format(dsDate) : '---';

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  const Icon(Icons.wallet_travel_outlined, size: 16, color: Color(0xFF64748B)),
                  const SizedBox(width: 4),
                  Text(loanNo, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFF64748B))),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: const Color(0xFFF1F5F9),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: const Text('ONGOING', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: Color(0xFF475569))),
              ),
            ],
          ),
          const Divider(height: 16, color: Color(0xFFF1F5F9)),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(
                '₹ ${NumberFormat('#,##,###').format(amount)}',
                style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: Color(0xFF166534)),
              ),
              const SizedBox(width: 8),
              Text(
                'Dues: $duesPaid/$totalDues · Collected $collectedCount',
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFF64748B)),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('DATES', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: Color(0xFF94A3B8), letterSpacing: 0.5)),
                    const SizedBox(height: 4),
                    _dateRow(Icons.calendar_today_outlined, 'Disb: $disbursementDate'),
                    _dateRow(Icons.event_available_outlined, 'Due Start: $dueStartDate'),
                    _dateRow(Icons.event_note_outlined, 'Maturity: $maturityDate'),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('BALANCES', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: Color(0xFF94A3B8), letterSpacing: 0.5)),
                    const SizedBox(height: 4),
                    _balanceRow('Pri. Bal: ', loan['principalBalance'] ?? '---'),
                    _balanceRow('Int. Bal: ', loan['interestBalance'] ?? '---'),
                    _balanceRow('Closing Arr: ', closingAr),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _dateRow(IconData icon, String text) => Padding(
    padding: const EdgeInsets.only(bottom: 2),
    child: Row(
      children: [
        Icon(icon, size: 12, color: const Color(0xFF94A3B8)),
        const SizedBox(width: 4),
        Text(text, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w500, color: Color(0xFF475569))),
      ],
    ),
  );

  Widget _balanceRow(String label, dynamic value) => Padding(
    padding: const EdgeInsets.only(bottom: 2),
    child: RichText(
      text: TextSpan(
        style: const TextStyle(fontSize: 11, color: Color(0xFF475569)),
        children: [
          TextSpan(text: label),
          TextSpan(text: value.toString(), style: const TextStyle(fontWeight: FontWeight.w700)),
        ],
      ),
    ),
  );

  static const _clientDocLabels = {
    EnrollmentOptions.docClientPhoto: 'Member / Client Photo',
    EnrollmentOptions.docAadhaarFront: 'Aadhaar Front',
    EnrollmentOptions.docAadhaarBack: 'Aadhaar Back',
    EnrollmentOptions.docPanCard: 'PAN Card',
    EnrollmentOptions.docVoterId: 'Voter ID Front',
    EnrollmentOptions.docVoterIdBack: 'Voter ID Back',
    EnrollmentOptions.docBankPassbook: 'Bank Passbook',
    EnrollmentOptions.docSmartCardFront: 'Smart Card Front',
    EnrollmentOptions.docSmartCardBack: 'Smart Card Back',
  };

  static const _coApplicantDocLabels = {
    EnrollmentOptions.docCoApplicantPhoto: 'Co-Applicant Photo',
    EnrollmentOptions.docCoApplicantAadhaarFront: 'Co-Applicant Aadhaar Front',
    EnrollmentOptions.docCoApplicantAadhaarBack: 'Co-Applicant Aadhaar Back',
    EnrollmentOptions.docCoApplicantPanCard: 'Co-Applicant PAN Card',
    EnrollmentOptions.docCoApplicantVoterId: 'Co-Applicant Voter ID Front',
    EnrollmentOptions.docCoApplicantVoterIdBack: 'Co-Applicant Voter ID Back',
    EnrollmentOptions.docCoApplicantOtherIdFront: 'Co-Applicant Other ID Front',
    EnrollmentOptions.docCoApplicantOtherIdBack: 'Co-Applicant Other ID Back',
  };

  static const _residenceDocLabels = {
    EnrollmentOptions.docHouseImage1: 'House Image 1',
    EnrollmentOptions.docHouseImage2: 'House Image 2',
    EnrollmentOptions.docHouseImage3: 'House Image 3',
    EnrollmentOptions.docGasBill: 'NOC (Gas Bill)',
    EnrollmentOptions.docNocImage1: 'NOC Image 1',
    EnrollmentOptions.docNocImage2: 'NOC Image 2',
    EnrollmentOptions.docNocImage3: 'NOC Image 3',
    EnrollmentOptions.docLocationQr: 'Location QR',
  };

  Widget _kycDocumentsTab() => EnrollmentSectionShell(
    title: 'KYC & Verification',
    subtitle: 'Upload required documents for client and co-applicant verification.',
    icon: Icons.badge_outlined,
    children: [
      _uploadGroup('Client Documents', _clientDocLabels, owner: 'client'),
      const SizedBox(height: 16),
      _uploadGroup('Co-Applicant Documents', _coApplicantDocLabels, owner: 'coApplicant'),
      const SizedBox(height: 16),
      _uploadGroup(
        'Residence Verification',
        _residenceDocLabels,
        owner: 'client',
        subtitle: 'House Image 1 (Mandatory), lat/long & QR required',
      ),
      const SizedBox(height: 16),
      Row(
        children: [
          Expanded(
            child: EnrollmentTextField(
              label: 'Latitude',
              hint: 'Auto-filled',
              controller: TextEditingController(text: controller.latitude.value),
              readOnly: true,
              required: true,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: EnrollmentTextField(
              label: 'Longitude',
              hint: 'Auto-filled',
              controller: TextEditingController(text: controller.longitude.value),
              readOnly: true,
              required: true,
            ),
          ),
        ],
      ),
      SizedBox(
        width: double.infinity,
        child: FilledButton.icon(
          onPressed: controller.isLocating.value ? null : controller.fetchLocation,
          icon: controller.isLocating.value
              ? const SizedBox(
                  width: 14,
                  height: 14,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                )
              : const Icon(Icons.my_location_outlined, size: 17),
          label: const Text('Use Current Location'),
          style: FilledButton.styleFrom(backgroundColor: enrollmentGreen),
        ),
      ),
      if (controller.docState(EnrollmentOptions.docLocationQr)?.isUploading == true)
        const Padding(
          padding: EdgeInsets.only(top: 8),
          child: Text(
            'Generating location QR…',
            style: TextStyle(fontSize: 11, color: Color(0xFF64748B)),
          ),
        )
      else if (controller.docState(EnrollmentOptions.docLocationQr)?.isUploaded == true)
        _qrPreviewPanel(),
    ],
  );

  Widget _qrPreviewPanel() => Obx(() {
    final state = controller.docState(EnrollmentOptions.docLocationQr);
    final url = state?.fileUrl;
    if (url == null || url.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Builder(
        builder: (ctx) => InkWell(
          borderRadius: BorderRadius.circular(10),
          onTap: () => _previewDocument(ctx, state!, 'Location QR'),
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: const Color(0xFFF1F8F4),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: const Color(0xFFCFE9DA)),
            ),
            child: Row(
              children: [
                SizedBox(
                  width: 56,
                  height: 56,
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(6),
                    child: _SignedImage(
                      api: controller.api,
                      rawUrlOrKey: url,
                      fit: BoxFit.cover,
                      errorWidget: const Icon(Icons.qr_code_2_rounded, size: 40, color: enrollmentGreen),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                const Expanded(
                  child: Text(
                    'Tap or scan to open this location in Google Maps.',
                    style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Color(0xFF164A2E)),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  });

  Widget _uploadGroup(
    String title,
    Map<String, String> docs, {
    required String owner,
    String? subtitle,
  }) => Container(
    width: double.infinity,
    decoration: BoxDecoration(
      border: Border.all(color: const Color(0xFF8ED0A6)),
      borderRadius: BorderRadius.circular(9),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: const BoxDecoration(
            color: enrollmentGreen,
            borderRadius: BorderRadius.vertical(top: Radius.circular(8)),
          ),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w700),
                ),
              ),
              if (subtitle != null)
                Flexible(
                  child: Text(
                    subtitle,
                    textAlign: TextAlign.right,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: Colors.white70, fontSize: 9.5, fontWeight: FontWeight.w600),
                  ),
                ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(10),
          child: Wrap(
            spacing: 10,
            runSpacing: 10,
            children: docs.entries
                .map((entry) => _docCard(entry.key, entry.value, owner: owner))
                .toList(),
          ),
        ),
      ],
    ),
  );

  Widget _docCard(String documentType, String label, {required String owner}) => Obx(() {
    final state = controller.docState(documentType);
    final allowPdf = EnrollmentOptions.pdfEligibleDocumentTypes.contains(documentType);
    final isPdf = (state?.mimeType ?? '').toLowerCase().contains('pdf');
    final uploaded = state?.isUploaded == true;
    final uploading = state?.isUploading == true;
    final isRetake = state?.isRetakeRequired == true;

    return SizedBox(
      width: 100,
      child: Column(
        children: [
          Builder(
            builder: (ctx) => InkWell(
              borderRadius: BorderRadius.circular(8),
              onTap: uploading
                  ? null
                  : uploaded
                      ? () => _previewDocument(ctx, state!, label)
                      : () => _showUploadSourceSheet(ctx, documentType, label, owner: owner, allowPdf: allowPdf),
              child: Stack(
                children: [
                  Container(
                    width: 100,
                    height: 90,
                    decoration: BoxDecoration(
                      color: isRetake ? const Color(0xFFFEF2F2) : const Color(0xFFF1F8F4),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: isRetake ? const Color(0xFFFCA5A5) : const Color(0xFFCFE9DA),
                        width: isRetake ? 2 : 1,
                      ),
                    ),
                    clipBehavior: Clip.antiAlias,
                    child: uploading
                        ? const Center(child: CircularProgressIndicator(strokeWidth: 2))
                        : !uploaded
                            ? const Icon(Icons.image_outlined, size: 30, color: Color(0xFFA9C9B7))
                            : isPdf
                                ? const Icon(Icons.picture_as_pdf_rounded, size: 30, color: Color(0xFFB91C1C))
                                : _SignedImage(
                                    api: controller.api,
                                    rawUrlOrKey: state!.fileUrl!,
                                    fit: BoxFit.cover,
                                    errorWidget: const Icon(Icons.broken_image_outlined, size: 28, color: Color(0xFFA9C9B7)),
                                  ),
                  ),
                  if (isRetake)
                    Positioned(
                      top: 4,
                      right: 4,
                      child: Container(
                        padding: const EdgeInsets.all(2),
                        decoration: const BoxDecoration(
                          color: Color(0xFFB91C1C),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.warning_rounded, color: Colors.white, size: 12),
                      ),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 4),
          Text(
            label,
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w600,
              color: isRetake ? const Color(0xFFB91C1C) : const Color(0xFF164A2E),
            ),
          ),
          if (isRetake && state?.reviewRemark != null)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(
                state!.reviewRemark!,
                textAlign: TextAlign.center,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 8, color: Color(0xFFB91C1C), fontWeight: FontWeight.w500),
              ),
            ),
          const SizedBox(height: 4),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Builder(
                builder: (ctx) => _cardIconButton(
                  icon: uploaded ? Icons.refresh_rounded : Icons.upload_rounded,
                  onTap: () => _showUploadSourceSheet(ctx, documentType, label, owner: owner, allowPdf: allowPdf),
                ),
              ),
              if (uploaded) ...[
                const SizedBox(width: 4),
                Builder(
                  builder: (ctx) => _cardIconButton(
                    icon: Icons.visibility_outlined,
                    onTap: () => _previewDocument(ctx, state!, label),
                  ),
                ),
                const SizedBox(width: 4),
                _cardIconButton(
                  icon: Icons.delete_outline_rounded,
                  color: const Color(0xFFB91C1C),
                  onTap: () => controller.removeDocument(documentType),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  });


  Widget _cardIconButton({required IconData icon, required VoidCallback onTap, Color? color}) => InkWell(
    borderRadius: BorderRadius.circular(6),
    onTap: onTap,
    child: Padding(
      padding: const EdgeInsets.all(3),
      child: Icon(icon, size: 15, color: color ?? enrollmentGreen),
    ),
  );

  void _showUploadSourceSheet(
    BuildContext context,
    String documentType,
    String label, {
    required String owner,
    required bool allowPdf,
  }) {
    showModalBottomSheet<void>(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (bottomContext) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 18),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Upload $label',
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: Color(0xFF063B20),
                ),
              ),
              const SizedBox(height: 14),
              ListTile(
                leading: const Icon(Icons.camera_alt_outlined, color: enrollmentGreen),
                title: const Text('Take Photo (Camera)', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                onTap: () {
                  Navigator.pop(bottomContext);
                  controller.pickAndUploadDocument(
                    documentType,
                    owner: owner,
                    source: ImageSource.camera,
                  );
                },
              ),
              const Divider(height: 1),
              ListTile(
                leading: const Icon(Icons.photo_library_outlined, color: enrollmentGreen),
                title: const Text('Choose from Photo Gallery', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                onTap: () {
                  Navigator.pop(bottomContext);
                  controller.pickAndUploadDocument(
                    documentType,
                    owner: owner,
                    source: ImageSource.gallery,
                  );
                },
              ),
              if (allowPdf) ...[
                const Divider(height: 1),
                ListTile(
                  leading: const Icon(Icons.picture_as_pdf_outlined, color: enrollmentGreen),
                  title: const Text('Choose PDF / Document File', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                  onTap: () {
                    Navigator.pop(bottomContext);
                    controller.pickAndUploadDocument(
                      documentType,
                      owner: owner,
                      allowPdf: true,
                    );
                  },
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  void _previewDocument(BuildContext context, EnrollmentDocState state, String label) {
    final isPdf = (state.mimeType ?? '').toLowerCase().contains('pdf');
    final url = state.fileUrl;
    if (url == null || url.isEmpty) return;
    if (isPdf) {
      Get.snackbar(
        label,
        'This is a PDF document — use "Replace" to re-upload if needed.',
        backgroundColor: const Color(0xFF334155),
        colorText: Colors.white,
      );
      return;
    }
    showDialog<void>(
      context: context,
      builder: (ctx) => Dialog(
        insetPadding: const EdgeInsets.symmetric(horizontal: 48, vertical: 24),
        backgroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      label,
                      style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
                    ),
                  ),
                  IconButton(
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                    onPressed: () => Navigator.pop(ctx),
                    icon: const Icon(Icons.close, size: 20),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(
                    minWidth: 280,
                    minHeight: 280,
                    maxWidth: 320,
                    maxHeight: 450,
                  ),
                  child: InteractiveViewer(
                    minScale: 0.5,
                    maxScale: 4.0,
                    child: _SignedImage(
                      api: controller.api,
                      rawUrlOrKey: url,
                      errorWidget: Container(
                        color: Colors.white,
                        padding: const EdgeInsets.all(24),
                        child: const Text('Could not load this document.'),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _stepsBar() => Obx(() => Container(
    height: 80,
    color: Colors.white,
    child: Row(
      children: List.generate(_steps.length, (index) {
        final isActive = controller.currentStep.value == index;
        return Expanded(
          child: InkWell(
            onTap: () => controller.currentStep.value = index,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(_steps[index].$2, color: isActive ? const Color(0xFF00843D) : Colors.grey),
                Text(
                  _steps[index].$1,
                  style: TextStyle(
                    fontSize: 10,
                    color: isActive ? const Color(0xFF00843D) : Colors.grey,
                    fontWeight: isActive ? FontWeight.bold : FontWeight.normal,
                  ),
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
        );
      }),
    ),
  ));

  Widget _actions(BuildContext context) => Obx(() => Container(
    padding: const EdgeInsets.all(16),
    decoration: const BoxDecoration(
      color: Colors.white,
      border: Border(top: BorderSide(color: Color(0xFFE5E5E5))),
    ),
    child: Row(
      children: [
        if (controller.currentStep.value > 0)
          Expanded(
            child: OutlinedButton(
              onPressed: () => controller.currentStep.value--,
              child: const Text('Previous'),
            ),
          ),
        if (controller.currentStep.value > 0) const SizedBox(width: 16),
        Expanded(
          flex: 2,
          child: FilledButton(
            onPressed: () {
              if (controller.currentStep.value < _steps.length - 1) {
                controller.currentStep.value++;
              } else {
                controller.submitUpdate();
              }
            },
            style: FilledButton.styleFrom(backgroundColor: const Color(0xFF00843D)),
            child: Text(controller.currentStep.value == _steps.length - 1 ? 'Update Member' : 'Next'),
          ),
        ),
      ],
    ),
  ));
}
