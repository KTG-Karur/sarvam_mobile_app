import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';

class Maf extends StatefulWidget {
  const Maf({super.key});

  @override
  State<Maf> createState() => _MafState();
}

class _MafState extends State<Maf> {
  static const _green = Color(0xFF00843D);
  static const _border = Color(0xFFBFE5CC);
  static const _darkText = Color(0xFF073E23);

  static const _genders = ['Male', 'Female', 'Other'];
  static const _castes = ['General', 'OBC', 'SC', 'ST', 'Minority'];
  static const _communities = ['BC', 'MBC', 'SC/ST', 'FC', 'Others'];
  static const _religions = [
    'Hindu',
    'Muslim',
    'Christian',
    'Sikh',
    'Buddhist',
    'Jain',
    'Others',
  ];
  static const _qualifications = [
    'Illiterate',
    'Primary',
    'Middle School',
    'High School (10th)',
    'Higher Secondary (12th)',
    'Graduate',
    'Post Graduate',
    'Diploma',
  ];
  static const _maritalStatuses = [
    'Single',
    'Married',
    'Widowed',
    'Divorced',
    'Separated',
  ];
  static const _economicActivityTypes = [
    'Agriculture',
    'Dairy & Livestock',
    'Retail Trade',
    'Manufacturing / Production',
    'Service Sector',
    'Others',
  ];
  static const _economicActivities = [
    'Paddy Cultivation',
    'Milch Cow Husbandry',
    'Kirana Shop',
    'Tailoring Unit',
    'Tea Stall',
    'Vegetable Vendor',
    'Auto Rickshaw Driver',
    'Others',
  ];
  static const _bankAccountTypes = ['Savings', 'Current'];
  static const _houseStatuses = ['Own', 'Rented', 'Family Owned', 'Other'];
  static const _relations = [
    'Spouse',
    'Son',
    'Daughter',
    'Father',
    'Mother',
    'Brother',
    'Sister',
    'Grandfather',
    'Grandmother',
  ];
  static const _productTypes = [
    'Income Generating Loan',
    'Micro Business Loan',
    'Agriculture Loan',
    'Livestock Loan',
    'Emergency Loan',
  ];
  static const _frequencies = ['Weekly', 'Bi-weekly', 'Monthly'];
  static const _loanProducts = [
    'Group Loan Weekly',
    'Individual Loan Weekly',
    'Dairy Development Loan',
    'Agri-crop Loan',
    'Business Expansion Loan',
  ];
  static const Map<String, double> _productPrices = {
    'Group Loan Weekly': 30000,
    'Individual Loan Weekly': 40000,
    'Dairy Development Loan': 45000,
    'Agri-crop Loan': 50000,
    'Business Expansion Loan': 60000,
  };

  final _formKey = GlobalKey<FormState>();
  final _picker = ImagePicker();
  int _currentStep = 0;

  final _dobController = TextEditingController();
  final _ageController = TextEditingController();
  final _spouseDobController = TextEditingController();
  final _coDobController = TextEditingController();
  final _coAgeController = TextEditingController();
  final _bankAcController = TextEditingController();
  final _retypeBankAcController = TextEditingController();
  final _loanAmountController = TextEditingController();

  String? _gender;
  String? _caste;
  String? _community;
  String? _economicActivityType;
  String? _economicActivity;
  String? _religion;
  String? _qualification;
  String? _maritalStatus;
  String? _spouseGender;
  String? _spouseEconomicActivityType;
  String? _spouseEconomicActivity;
  String? _bankAccountType;
  String? _houseStatus;

  String? _relationWithMember;
  String? _coGender;
  String? _coEconomicActivityType;
  String? _coEconomicActivity;
  String? _productType;
  String? _frequency = 'Weekly';
  String? _loanProduct;

  final Map<String, XFile?> _uploads = {};

  @override
  void dispose() {
    _dobController.dispose();
    _ageController.dispose();
    _spouseDobController.dispose();
    _coDobController.dispose();
    _coAgeController.dispose();
    _bankAcController.dispose();
    _retypeBankAcController.dispose();
    _loanAmountController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xFFF4FBF6),
    appBar: AppBar(
      elevation: 0,
      backgroundColor: _green,
      foregroundColor: Colors.white,
      automaticallyImplyLeading: false,
      titleSpacing: 12,
      title: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.18),
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Icon(
              Icons.badge_outlined,
              color: Colors.white,
              size: 20,
            ),
          ),
          const SizedBox(width: 11),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'Member Application Form',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
                ),
                Text(
                  'New member enrollment · KYC verification',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 10, color: Color(0xFFDCF3E4)),
                ),
              ],
            ),
          ),
        ],
      ),
      actions: [
        IconButton(
          onPressed: () => Navigator.maybePop(context),
          icon: const Icon(Icons.close, size: 19),
        ),
      ],
      bottom: PreferredSize(
        preferredSize: const Size.fromHeight(76),
        child: _steps(),
      ),
    ),
    body: SafeArea(
      top: false,
      child: Column(
        children: [
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
              child: Form(
                key: _formKey,
                child: AnimatedSwitcher(
                  duration: const Duration(milliseconds: 320),
                  switchInCurve: Curves.easeOut,
                  switchOutCurve: Curves.easeIn,
                  transitionBuilder: (child, animation) => FadeTransition(
                    opacity: animation,
                    child: SlideTransition(
                      position: Tween<Offset>(
                        begin: const Offset(0.03, 0),
                        end: Offset.zero,
                      ).animate(animation),
                      child: child,
                    ),
                  ),
                  child: KeyedSubtree(
                    key: ValueKey(_currentStep),
                    child: _stepContent(),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    ),
    bottomNavigationBar: _actions(),
  );

  Widget _stepContent() {
    switch (_currentStep) {
      case 1:
        return _memberOtherDetails();
      case 2:
        return _coApplicantDetails();
      case 3:
        return _memberDocuments();
      case 4:
        return _coApplicantDocuments();
      default:
        return _memberDetails();
    }
  }

  // ----------------------------------------------------
  // Step 0: Member Details
  // ----------------------------------------------------
  Widget _memberDetails() => _shell(
    'Member Details',
    'Primary identity and contact details',
    Icons.shield_outlined,
    [
      _grid([
        _field(
          'Phone Number',
          'Enter 10-digit mobile number',
          required: true,
          icon: Icons.phone_outlined,
          keyboardType: TextInputType.phone,
          maxLength: 10,
        ),
        _field(
          'Aadhaar Number',
          '12-digit Aadhaar number',
          required: true,
          icon: Icons.badge_outlined,
          keyboardType: TextInputType.number,
          maxLength: 12,
        ),
        _field('First Name', 'Enter first name', required: true),
        _field('Last Name', 'Enter last name', required: true),
        _field('PAN Card Number', 'ABCDE1234F', helper: '(Optional)'),
        _field('Voter ID Number', 'ABC1234567', required: true),
        _dateField(
          'Date of Birth',
          _dobController,
          required: true,
          onChanged: (date) => setState(
            () => _ageController.text = _calculateAge(date).toString(),
          ),
        ),
        _field('Father Name', "Enter father's name", required: true),
        _selectField('Gender', _gender, _genders, (value) {
          setState(() => _gender = value);
        }, required: true),
        _field(
          'Permanent Address',
          'Enter permanent address',
          required: true,
          icon: Icons.location_on_outlined,
        ),
        _field(
          'Pincode',
          '6-digit pincode',
          required: true,
          keyboardType: TextInputType.number,
          maxLength: 6,
        ),
        _field('Post Office', 'Enter post office', required: true),
        _field('State', 'Enter state', required: true),
        _field('City', 'Enter city', helper: '(Optional)'),
        _field('Country', 'India', required: true),
      ]),
    ],
  );

  // ----------------------------------------------------
  // Step 1: Member Other Details
  // ----------------------------------------------------
  Widget _memberOtherDetails() => _shell(
    'Member Details',
    'Additional personal, financial and bank information',
    Icons.description_outlined,
    [
      _grid([
        _field(
          'Email',
          'Enter email',
          helper: '(Optional)',
          keyboardType: TextInputType.emailAddress,
        ),
        _field(
          'Age',
          'Auto-calculated from DOB',
          required: true,
          enabled: false,
          controller: _ageController,
        ),
        _selectField('Caste', _caste, _castes, (value) {
          setState(() => _caste = value);
        }, helper: '(Optional)'),
        _selectField('Community', _community, _communities, (value) {
          setState(() => _community = value);
        }, helper: '(Optional)'),
        _selectField(
          'Economic Activity Type',
          _economicActivityType,
          _economicActivityTypes,
          (value) => setState(() => _economicActivityType = value),
          required: true,
        ),
        _selectField(
          'Economic Activity',
          _economicActivity,
          _economicActivities,
          (value) => setState(() => _economicActivity = value),
          required: true,
        ),
        _selectField('Religion', _religion, _religions, (value) {
          setState(() => _religion = value);
        }, helper: '(Optional)'),
        _selectField('Qualification', _qualification, _qualifications, (value) {
          setState(() => _qualification = value);
        }, helper: '(Optional)'),
        _selectField(
          'Marital Status',
          _maritalStatus,
          _maritalStatuses,
          (value) => setState(() => _maritalStatus = value),
          required: true,
        ),
        _field('Spouse Name', 'Enter spouse name', helper: '(Optional)'),
        _dateField('Spouse DOB', _spouseDobController, helper: '(Optional)'),
        _field(
          'Spouse Mobile Number',
          'Enter spouse mobile number',
          helper: '(Optional)',
          keyboardType: TextInputType.phone,
          maxLength: 10,
        ),
        _selectField('Spouse Gender', _spouseGender, _genders, (value) {
          setState(() => _spouseGender = value);
        }, helper: '(Optional)'),
        _selectField(
          'Spouse Economic Activity Type',
          _spouseEconomicActivityType,
          _economicActivityTypes,
          (value) => setState(() => _spouseEconomicActivityType = value),
          helper: '(Optional)',
        ),
        _selectField(
          'Spouse Economic Activity',
          _spouseEconomicActivity,
          _economicActivities,
          (value) => setState(() => _spouseEconomicActivity = value),
          helper: '(Optional)',
        ),
        _field(
          'No. of Children',
          'Enter number',
          helper: '(Optional)',
          keyboardType: TextInputType.number,
        ),
        _field(
          'Monthly Family Income',
          'Enter amount',
          required: true,
          keyboardType: TextInputType.number,
        ),
        _field(
          'Monthly Family Expense',
          'Enter amount',
          helper: '(Optional)',
          keyboardType: TextInputType.number,
        ),
        _field('IFSC Code', 'SBIN0001234', required: true),
        _field(
          'Bank A/c No',
          'Enter account number',
          required: true,
          keyboardType: TextInputType.number,
          controller: _bankAcController,
        ),
        _field(
          'Retype Bank A/c No',
          'Re-enter account number',
          required: true,
          keyboardType: TextInputType.number,
          controller: _retypeBankAcController,
          validator: (value) {
            if (value == null || value.trim().isEmpty) return 'Required';
            if (value != _bankAcController.text) {
              return 'Account numbers do not match';
            }
            return null;
          },
        ),
        _field('Bank Name', 'Enter bank name', required: true),
        _field('Bank Branch', 'Enter branch name', required: true),
        _selectField(
          'Bank Account Type',
          _bankAccountType,
          _bankAccountTypes,
          (value) => setState(() => _bankAccountType = value),
          helper: '(Optional)',
        ),
        _selectField('House Status', _houseStatus, _houseStatuses, (value) {
          setState(() => _houseStatus = value);
        }, helper: '(Optional)'),
        _field("Mother Name", "Enter mother's name", helper: '(Optional)'),
        _field('Smart Card Number', 'Enter smart card number', required: true),
      ]),
    ],
  );

  // ----------------------------------------------------
  // Step 2: Co-Applicant Details
  // ----------------------------------------------------
  Widget _coApplicantDetails() => _shell(
    'Co-Applicant Details',
    'Enter co-applicant details for this enrollment.',
    Icons.group_outlined,
    [
      _notice('Co-Applicant document uploads are in the KYC Details tab.'),
      _grid([
        _selectField(
          'Relation With Member',
          _relationWithMember,
          _relations,
          (value) => setState(() => _relationWithMember = value),
          required: true,
        ),
        _field('Co-Applicant Name', 'Enter co-applicant name', required: true),
        _field(
          'Phone Number',
          '10-digit mobile number',
          required: true,
          icon: Icons.phone_outlined,
          keyboardType: TextInputType.phone,
          maxLength: 10,
        ),
        _selectField(
          'Gender',
          _coGender,
          _genders,
          (value) => setState(() => _coGender = value),
          required: true,
        ),
        _dateField(
          'Date of Birth',
          _coDobController,
          required: true,
          onChanged: (date) => setState(
            () => _coAgeController.text = _calculateAge(date).toString(),
          ),
        ),
        _field(
          'Age',
          'Auto-calculated',
          required: true,
          enabled: false,
          controller: _coAgeController,
        ),
        _selectField(
          'Co-Applicant Economic Activity Type',
          _coEconomicActivityType,
          _economicActivityTypes,
          (value) => setState(() => _coEconomicActivityType = value),
          helper: '(Optional)',
        ),
        _selectField(
          'Co-Applicant Economic Activity',
          _coEconomicActivity,
          _economicActivities,
          (value) => setState(() => _coEconomicActivity = value),
          helper: '(Optional)',
        ),
        _selectField(
          'Product Type',
          _productType,
          _productTypes,
          (value) => setState(() => _productType = value),
          required: true,
        ),
        _selectField('Frequency', _frequency, _frequencies, (value) {
          setState(() => _frequency = value);
        }, required: true),
        _selectField('Loan Product', _loanProduct, _loanProducts, (value) {
          setState(() {
            _loanProduct = value;
            _loanAmountController.text = value == null
                ? ''
                : (_productPrices[value]?.toStringAsFixed(0) ?? '');
          });
        }, required: true),
        _field(
          'Loan Amount',
          'Auto-filled from product',
          enabled: false,
          controller: _loanAmountController,
        ),
        _field(
          'Co-Applicant PAN Card Number',
          'ABCDE1234F',
          helper: '(Optional)',
        ),
        _field('Co-Applicant Voter ID Number', 'ABC1234567', required: true),
        _field(
          'Co-Applicant Aadhaar Number',
          '12-digit Aadhaar number',
          required: true,
          keyboardType: TextInputType.number,
          maxLength: 12,
        ),
      ]),
    ],
  );

  // ----------------------------------------------------
  // Step 3: Member Documents
  // ----------------------------------------------------
  Widget _memberDocuments() => _docShell(
    'Member Documents',
    'Identify proof uploads',
    Icons.verified_user_outlined,
    [
      _grid([
        _uploadField('Aadhaar Front', required: true),
        _uploadField('Aadhaar Back', required: true),
        _uploadField('Voter ID Front', required: true),
        _uploadField('Voter ID Back', helper: '(Optional)'),
        _uploadField('PAN Card Upload', helper: '(Optional)'),
        _uploadField('Smart Card Front Upload', required: true),
        _uploadField('Smart Card Back Upload', required: true),
        _uploadField('Member Photo', helper: '(Optional)'),
        _uploadField('Bank Passbook', helper: '(Optional)'),
      ], columns: 2),
    ],
  );

  // ----------------------------------------------------
  // Step 4: Co-Applicant Documents
  // ----------------------------------------------------
  Widget _coApplicantDocuments() => _docShell(
    'Co-Applicant Documents',
    'Co-Applicant uploads',
    Icons.group_outlined,
    [
      _grid([
        _uploadField('Co-Applicant Aadhaar Front', required: true),
        _uploadField('CA Aadhaar Back', required: true),
        _uploadField('Co-Applicant Voter ID Front', required: true),
        _uploadField('Co-Applicant Voter ID Back', helper: '(Optional)'),
        _uploadField('Co-Applicant Other ID Front', helper: '(Optional)'),
        _uploadField('Co-Applicant Other ID Back', helper: '(Optional)'),
        _uploadField('Co-Applicant PAN Card Upload', helper: '(Optional)'),
        _uploadField('Co-Applicant Photo', helper: '(Optional)'),
      ], columns: 2),
    ],
  );

  // ----------------------------------------------------
  // Shared building blocks
  // ----------------------------------------------------
  Widget _shell(
    String title,
    String subtitle,
    IconData icon,
    List<Widget> children,
  ) => Container(
    decoration: BoxDecoration(
      color: Colors.white,
      border: Border.all(color: _border),
      borderRadius: BorderRadius.circular(12),
      boxShadow: const [
        BoxShadow(
          color: Color(0x11085430),
          blurRadius: 12,
          offset: Offset(0, 4),
        ),
      ],
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _formTitle(title, subtitle, icon),
        Padding(
          padding: const EdgeInsets.all(16),
          child: Column(children: children),
        ),
      ],
    ),
  );

  Widget _docShell(
    String title,
    String subtitle,
    IconData icon,
    List<Widget> children,
  ) => Container(
    decoration: BoxDecoration(
      color: Colors.white,
      border: Border.all(color: _border),
      borderRadius: BorderRadius.circular(12),
      boxShadow: const [
        BoxShadow(
          color: Color(0x11085430),
          blurRadius: 12,
          offset: Offset(0, 4),
        ),
      ],
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(16),
          decoration: const BoxDecoration(
            color: _green,
            borderRadius: BorderRadius.vertical(top: Radius.circular(11)),
          ),
          child: Row(
            children: [
              Container(
                width: 30,
                height: 30,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.18),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, color: Colors.white, size: 16),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 15,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      subtitle,
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.85),
                        fontSize: 10.5,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(16),
          child: Column(children: children),
        ),
      ],
    ),
  );

  /// Lays fields out in a responsive N-column grid that collapses to fewer
  /// columns as the available width shrinks (phone vs. tablet/web).
  Widget _grid(List<Widget> fields, {int columns = 3}) => LayoutBuilder(
    builder: (context, constraints) {
      final cols = constraints.maxWidth >= 760
          ? columns
          : (constraints.maxWidth >= 520 ? (columns > 2 ? 2 : columns) : 1);
      const spacing = 14.0;
      final itemWidth = cols == 1
          ? constraints.maxWidth
          : (constraints.maxWidth - spacing * (cols - 1)) / cols;
      return Wrap(
        spacing: spacing,
        children: fields
            .map((field) => SizedBox(width: itemWidth, child: field))
            .toList(),
      );
    },
  );

  Widget _notice(String message) => Container(
    width: double.infinity,
    margin: const EdgeInsets.only(bottom: 16),
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: const Color(0xFFF3FCF6),
      border: Border.all(color: const Color(0xFF9CD9B3)),
      borderRadius: BorderRadius.circular(9),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Icon(Icons.info_outline, size: 17, color: _green),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            message,
            style: const TextStyle(fontSize: 12, color: Color(0xFF164A2E)),
          ),
        ),
      ],
    ),
  );

  Widget _field(
    String label,
    String hint, {
    bool required = false,
    String? helper,
    IconData? icon,
    TextInputType? keyboardType,
    TextEditingController? controller,
    int? maxLength,
    bool enabled = true,
    String? Function(String?)? validator,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: 13),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _label(label, required: required, helper: helper),
        const SizedBox(height: 6),
        TextFormField(
          controller: controller,
          enabled: enabled,
          keyboardType: keyboardType,
          maxLength: maxLength,
          validator:
              validator ??
              (required
                  ? (value) => value == null || value.trim().isEmpty
                        ? 'Required'
                        : null
                  : null),
          style: TextStyle(
            fontSize: 13,
            color: enabled ? _darkText : const Color(0xFF6B9D7C),
          ),
          decoration: _decoration(hint, icon: icon),
        ),
      ],
    ),
  );

  Widget _selectField(
    String label,
    String? value,
    List<String> options,
    ValueChanged<String?> onChanged, {
    bool required = false,
    String? helper,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: 13),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _label(label, required: required, helper: helper),
        const SizedBox(height: 6),
        DropdownButtonFormField<String>(
          initialValue: value,
          isExpanded: true,
          hint: const Text(
            '-- SELECT --',
            style: TextStyle(fontSize: 12, color: Color(0xFF6B9D7C)),
          ),
          decoration: _decoration(''),
          items: options
              .map(
                (option) => DropdownMenuItem(
                  value: option,
                  child: Text(option, style: const TextStyle(fontSize: 13)),
                ),
              )
              .toList(),
          onChanged: onChanged,
          validator: required ? (v) => v == null ? 'Required' : null : null,
        ),
      ],
    ),
  );

  Widget _dateField(
    String label,
    TextEditingController controller, {
    bool required = false,
    String? helper,
    ValueChanged<DateTime>? onChanged,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: 13),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _label(label, required: required, helper: helper),
        const SizedBox(height: 6),
        TextFormField(
          controller: controller,
          readOnly: true,
          onTap: () => _pickDate(controller, onChanged),
          validator: required
              ? (value) => value == null || value.isEmpty ? 'Required' : null
              : null,
          style: const TextStyle(fontSize: 13, color: _darkText),
          decoration:
              _decoration(
                'dd-mm-yyyy',
                icon: Icons.calendar_month_outlined,
              ).copyWith(
                suffixIcon: const Icon(
                  Icons.calendar_today_outlined,
                  size: 18,
                  color: Color(0xFF145D35),
                ),
              ),
        ),
      ],
    ),
  );

  Widget _uploadField(String label, {bool required = false, String? helper}) {
    final file = _uploads[label];
    return Padding(
      padding: const EdgeInsets.only(bottom: 13),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _label(label, required: required, helper: helper),
          const SizedBox(height: 6),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Container(
                  height: 46,
                  alignment: Alignment.centerLeft,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF9FFFB),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: _border),
                  ),
                  child: Text(
                    file?.name ?? 'Upload file',
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 12,
                      color: file == null ? const Color(0xFF71A488) : _darkText,
                      fontWeight: file == null
                          ? FontWeight.normal
                          : FontWeight.w600,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 6),
              OutlinedButton.icon(
                onPressed: () => _pickFile(label, ImageSource.gallery),
                icon: const Icon(Icons.attach_file, size: 15),
                label: const Text('Upload'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: _green,
                  side: const BorderSide(color: _border),
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  minimumSize: const Size(0, 46),
                  textStyle: const TextStyle(fontSize: 12),
                ),
              ),
              const SizedBox(width: 6),
              _iconButton(
                Icons.photo_camera_outlined,
                () => _pickFile(label, ImageSource.camera),
              ),
              const SizedBox(width: 6),
              _iconButton(
                Icons.delete_outline,
                file == null
                    ? null
                    : () => setState(() => _uploads[label] = null),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _iconButton(IconData icon, VoidCallback? onPressed) => SizedBox(
    width: 40,
    height: 46,
    child: OutlinedButton(
      onPressed: onPressed,
      style: OutlinedButton.styleFrom(
        foregroundColor: _green,
        side: const BorderSide(color: _border),
        padding: EdgeInsets.zero,
      ),
      child: Icon(icon, size: 17),
    ),
  );

  Widget _label(String label, {bool required = false, String? helper}) =>
      Text.rich(
        TextSpan(
          children: [
            TextSpan(text: label),
            if (helper != null)
              TextSpan(
                text: '  $helper',
                style: const TextStyle(fontSize: 10, color: Color(0xFF4E8A68)),
              ),
            if (required)
              const TextSpan(
                text: ' *',
                style: TextStyle(color: Color(0xFFE11D48)),
              ),
          ],
        ),
        style: const TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: Color(0xFF075E2E),
        ),
      );

  InputDecoration _decoration(String hint, {IconData? icon}) => InputDecoration(
    hintText: hint,
    counterText: '',
    hintStyle: const TextStyle(fontSize: 12, color: Color(0xFF71A488)),
    prefixIcon: icon == null
        ? null
        : Icon(icon, color: const Color(0xFF39845A), size: 19),
    filled: true,
    fillColor: const Color(0xFFF9FFFB),
    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 13),
    border: _fieldBorder,
    enabledBorder: _fieldBorder,
    disabledBorder: _fieldBorder,
    focusedBorder: _fieldBorder.copyWith(
      borderSide: const BorderSide(color: _green, width: 1.5),
    ),
  );

  OutlineInputBorder get _fieldBorder => OutlineInputBorder(
    borderRadius: BorderRadius.circular(8),
    borderSide: const BorderSide(color: _border),
  );

  Widget _steps() {
    const steps = [
      ('Member Details', Icons.shield_outlined),
      ('Other Details', Icons.description_outlined),
      ('Co-Applicant', Icons.group_outlined),
      ('Member Docs', Icons.verified_user_outlined),
      ('CA Docs', Icons.badge_outlined),
    ];
    return Container(
      height: 76,
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 7),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(bottom: BorderSide(color: Color(0xFFC8E5D2))),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: List.generate(steps.length, (index) {
          final isActive = index == _currentStep;
          final isComplete = index < _currentStep;
          return Expanded(
            child: InkWell(
              onTap: () => setState(() => _currentStep = index),
              borderRadius: BorderRadius.circular(10),
              child: Column(
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Container(
                          height: 2,
                          color: index == 0
                              ? Colors.transparent
                              : isComplete || isActive
                              ? _green
                              : const Color(0xFFC8E5D2),
                        ),
                      ),
                      Container(
                        width: 28,
                        height: 28,
                        decoration: BoxDecoration(
                          color: isActive || isComplete
                              ? _green
                              : const Color(0xFFF0FAF4),
                          shape: BoxShape.circle,
                          border: Border.all(
                            color: isActive || isComplete
                                ? _green
                                : const Color(0xFFA9D7B9),
                          ),
                        ),
                        child: Icon(
                          isComplete ? Icons.check_rounded : steps[index].$2,
                          size: 14,
                          color: isActive || isComplete
                              ? Colors.white
                              : const Color(0xFF39845A),
                        ),
                      ),
                      Expanded(
                        child: Container(
                          height: 2,
                          color: index == steps.length - 1
                              ? Colors.transparent
                              : isComplete
                              ? _green
                              : const Color(0xFFC8E5D2),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 5),
                  Text(
                    steps[index].$1,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 9,
                      color: isActive ? _green : const Color(0xFF5A8069),
                      fontWeight: isActive ? FontWeight.w800 : FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),
          );
        }),
      ),
    );
  }

  Widget _formTitle(String title, String subtitle, IconData icon) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(16),
    decoration: const BoxDecoration(
      color: Color(0xFFF0FAF4),
      borderRadius: BorderRadius.vertical(top: Radius.circular(12)),
      border: Border(bottom: BorderSide(color: Color(0xFFBFE5CC))),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(icon, size: 18, color: _green),
            const SizedBox(width: 8),
            Text(
              title,
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w800,
                color: Color(0xFF064524),
              ),
            ),
          ],
        ),
        const SizedBox(height: 5),
        Text(
          subtitle,
          style: const TextStyle(fontSize: 10.5, color: Color(0xFF3D7658)),
        ),
      ],
    ),
  );

  Widget _actions() => Container(
    height: 76,
    padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
    decoration: const BoxDecoration(
      color: Colors.white,
      border: Border(top: BorderSide(color: Color(0xFFBFE5CC))),
      boxShadow: [
        BoxShadow(
          color: Color(0x14000000),
          blurRadius: 10,
          offset: Offset(0, -3),
        ),
      ],
    ),
    child: Row(
      children: [
        SizedBox(
          width: 44,
          height: 44,
          child: OutlinedButton(
            onPressed: _currentStep == 0
                ? () => Navigator.maybePop(context)
                : () => setState(() => _currentStep--),
            style: OutlinedButton.styleFrom(
              foregroundColor: const Color(0xFF14713C),
              side: const BorderSide(color: Color(0xFF9BD5AF)),
              padding: EdgeInsets.zero,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(8),
              ),
            ),
            child: const Icon(Icons.arrow_back, size: 18),
          ),
        ),
        const SizedBox(width: 7),
        Expanded(
          flex: 2,
          child: OutlinedButton.icon(
            onPressed: _saveDraft,
            icon: const Icon(Icons.save_outlined, size: 16),
            label: const Text('Save Draft', overflow: TextOverflow.ellipsis),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(44),
              foregroundColor: const Color(0xFFB87500),
              side: const BorderSide(color: Color(0xFFFFCE5A)),
              textStyle: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(8),
              ),
            ),
          ),
        ),
        const SizedBox(width: 7),
        Expanded(
          child: Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(8),
              gradient: const LinearGradient(
                colors: [Color(0xFF075E2E), _green],
                begin: Alignment.centerLeft,
                end: Alignment.centerRight,
              ),
              boxShadow: [
                BoxShadow(
                  color: _green.withValues(alpha: 0.35),
                  blurRadius: 10,
                  offset: const Offset(0, 3),
                ),
              ],
            ),
            child: FilledButton(
              onPressed: _next,
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(44),
                backgroundColor: Colors.transparent,
                shadowColor: Colors.transparent,
                padding: const EdgeInsets.symmetric(horizontal: 5),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    _currentStep == 4 ? 'Submit' : 'Next',
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(width: 3),
                  Icon(
                    _currentStep == 4
                        ? Icons.check_circle_outline
                        : Icons.arrow_forward,
                    size: 16,
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    ),
  );

  int _calculateAge(DateTime dob) {
    final now = DateTime.now();
    var age = now.year - dob.year;
    if (now.month < dob.month ||
        (now.month == dob.month && now.day < dob.day)) {
      age--;
    }
    return age;
  }

  Future<void> _pickDate(
    TextEditingController controller,
    ValueChanged<DateTime>? onChanged,
  ) async {
    final date = await showDatePicker(
      context: context,
      initialDate: DateTime(1995),
      firstDate: DateTime(1920),
      lastDate: DateTime.now(),
    );
    if (date != null) {
      setState(() => controller.text = DateFormat('dd-MM-yyyy').format(date));
      onChanged?.call(date);
    }
  }

  Future<void> _pickFile(String label, ImageSource source) async {
    final file = await _picker.pickImage(
      source: source,
      maxWidth: 1920,
      maxHeight: 1920,
      imageQuality: 80,
    );
    if (file != null) setState(() => _uploads[label] = file);
  }

  void _saveDraft() => ScaffoldMessenger.of(
    context,
  ).showSnackBar(const SnackBar(content: Text('Draft saved')));

  void _next() {
    if (_currentStep < 4) {
      setState(() => _currentStep++);
      return;
    }
    if (_formKey.currentState?.validate() ?? false) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Member application submitted')),
      );
    }
  }
}
