'use client';

import { useState, useEffect, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Search, ChevronLeft, ChevronRight, Calendar, Banknote, Scale, Wallet, RefreshCw, Users } from 'lucide-react';
import { cn } from '@/app/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { format, isValid } from 'date-fns';
import { normalizeMeetingTime } from '@/app/lib/utils/meeting-time';
import * as XLSX from 'xlsx-js-style';
import { reportHeaderRows, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { formatReportAmount } from '@/app/lib/utils/format-amount';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { PageLoader } from '@/components/ui/page-loader';
import { usePermission } from '@/app/hooks/usePermission';
import { useLoanAdvanceEnabled } from '@/app/hooks/useLoanAdvanceEnabled';
import { DateInput } from '@/components/ui/date-input';

interface Branch { id: string; name: string; code: string; }
interface Center { id: string; name: string; code: string; }
interface Funder { id: string; funderName: string; }
interface LoanProductType { id: string; typeId: string; name: string; }

interface SummaryTotals {
    loanAmountPrincipal: number;
    loanAmountInterest: number;
    osPrincipal: number;
    osInterest: number;
    collectedPrincipal: number;
    collectedInterest: number;
    memberCount: number;
    membersWithLoan: number;
    membersWithoutLoan: number;
}

const LOAN_STATUS_OPTIONS: { value: string; label: string }[] = [
    { value: 'DISBURSED', label: 'Disbursed' },
    { value: 'REJECTED', label: 'Rejected' },
    { value: 'CLOSED', label: 'Closed' },
];

interface MemberReportRow {
    sNo: number;
    memberId: string;
    loanId: string;
    loanStatus: string;
    name: string;
    phone: string;
    email: string;
    dob: string | null;
    age: number | null;
    gender: string;
    economicActivityName: string;
    branch: string;
    center: string;
    group: string;
    officerName: string;
    address: string;
    localArea: string;
    state: string;
    country: string;
    district: string;
    pinCode: string;
    houseLatitude: number | null;
    houseLongitude: number | null;
    permanentAddress: string;
    centerLocation: string;
    meetingDay: string;
    meetingTime: string;
    meetingCenterName: string;
    panCard: string;
    idProof: string;
    idProofNo: string;
    caste: string;
    spouseName: string;
    spouseDob: string | null;
    memberStatus: string;
    memberActive: string;
    insurance: string;
    insurancePolicyType: string;
    insuranceCoverageAmount: number | null;
    insurancePremiumAmount: number | null;
    insuranceStartDate: string | null;
    insuranceEndDate: string | null;
    memberIsVerified: string;
    loanCycleNo: number;
    purposeOfLoan: string;
    productType: string;
    productName: string;
    productAmount: number;
    rateOfInterest: number;
    noOfInstallments: number;
    loanDisbursementDate: string | null;
    loanStartDate: string | null;
    loanEndDate: string | null;
    collectionDay: string;
    loanPrincipal: number;
    loanInterest: number;
    totalAmount: number;
    actualOutstandingPrincipal: number;
    actualOutstandingInterest: number;
    actualOutstandingTotal: number;
    outstandingPrincipal: number;
    outstandingInterest: number;
    outstandingAsOnDate: string | null;
    arrearCollectionPrincipal: number;
    arrearCollectionInterest: number;
    arrearCollectionAsOnDate: string | null;
    fundingLine: string;
    lastRepayDate: string | null;
    lastRepayPrincipal: number | null;
    lastRepayInterest: number | null;
    lastRepayDueAmount: number | null;
    collectedBy: string;
    approvedBy: string;
    pattern: string;
    memberRemark: string;
    accountNumber: string;
    ifscCode: string;
    bankName: string;
    bankBranchName: string;
    accountType: string;
    closedDate: string | null;
    centerID: string;
    deadMember: string;
    loanClosureReason: string;

    admissionFees: number | null;
    loanAdvance: number | null;
    requestedAmount: number | null;
    requestedLoanProductType: string;
    requestedLoanPurpose: string;
    requestedLoanFrequency: string;

    monthlyFamilyIncome: number | null;
    monthlyFamilyExpense: number | null;
    fatherName: string;
    motherName: string;
    maritalStatus: string;
    qualification: string;
    religion: string;
    community: string;
    noOfChildren: number | null;
    houseStatus: string;
    postOffice: string;
    spouseMobileNumber: string;
    spouseEconomicActivity: string;
    votersIdNo: string;
    otherIdNo: string;
    smartCardNo: string;
    inactiveDate: string | null;
    dropoutReason: string;

    appliedAmount: number | null;
    tenureMonths: number;
    interestPaid: number;
    penaltiesPaid: number;
    loanRejectionReason: string;
    loanCreatedBy: string;
    loanVerifiedBy: string;
    loanVerifiedAt: string | null;

    loanMemberId: string;

    alternatePhone: string;
    city: string;

    groupAddress: string;
    memberLeadName: string;

    joiningDate: string | null;
    aadharNumber: string;
    addressProof: string;
    addressProofNo: string;

    processingFee: number | null;
    walletAmount: number;

    collectionStaff: string;
    accountName: string;
    annualIncome: number | null;

    coApplicantName: string;
    coApplicantRelation: string;
    coApplicantGender: string;
    coApplicantDob: string | null;
    coApplicantAge: number | null;
    coApplicantMobile: string;
    coApplicantOccupation: string;
    coApplicantPanCard: string;
    coApplicantVoterId: string;
}

interface ApiResponse {
    data: MemberReportRow[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    summary: SummaryTotals;
}

const fmtDate = (d: string | Date | null | undefined) => {
    if (!d) return '-';
    const dt = typeof d === 'string' ? new Date(d) : d;
    return isValid(dt) ? format(dt, 'dd/MM/yyyy') : '-';
};

const fmtNum = (n: number | null | undefined) =>
    n == null ? '-' : formatReportAmount(n);

const orDash = (v: string | number | null | undefined) =>
    v === '' || v == null ? '-' : v;

function escapeCsvValue(value: string | number): string {
    const str = String(value);
    if (/[",\n]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

interface Column {
    key: string;
    header: string;
    value: (r: MemberReportRow) => string | number;
}

const COLUMNS: Column[] = [
    { key: 'sNo', header: 'S.No.', value: (r) => r.sNo },
    { key: 'memberId', header: 'MemberID', value: (r) => r.memberId },
    { key: 'loanId', header: 'Loan ID', value: (r) => r.loanId },
    { key: 'loanStatus', header: 'Loan Status', value: (r) => r.loanStatus },
    { key: 'name', header: 'Name', value: (r) => r.name },
    { key: 'phone', header: 'Phone', value: (r) => orDash(r.phone) },
    { key: 'email', header: 'Email', value: (r) => orDash(r.email) },
    { key: 'dob', header: 'DOB', value: (r) => fmtDate(r.dob) },
    { key: 'age', header: 'Age', value: (r) => r.age ?? '-' },
    { key: 'gender', header: 'Gender', value: (r) => orDash(r.gender) },
    { key: 'economicActivityName', header: 'Economic Activity Name', value: (r) => orDash(r.economicActivityName) },
    { key: 'branch', header: 'Branch', value: (r) => r.branch },
    { key: 'center', header: 'Center', value: (r) => r.center },
    { key: 'group', header: 'Group', value: (r) => r.group },
    { key: 'officerName', header: 'Officer Name', value: (r) => r.officerName },
    { key: 'address', header: 'Address', value: (r) => r.address },
    { key: 'localArea', header: 'Local Area', value: (r) => r.localArea },
    { key: 'state', header: 'Rate of State', value: (r) => r.state },
    { key: 'country', header: 'Country', value: (r) => r.country },
    { key: 'district', header: 'District', value: (r) => r.district },
    { key: 'pinCode', header: 'PinCode', value: (r) => r.pinCode },
    { key: 'houseLatitude', header: 'House Latitude', value: (r) => r.houseLatitude ?? '' },
    { key: 'houseLongitude', header: 'House Longitude', value: (r) => r.houseLongitude ?? '' },
    { key: 'permanentAddress', header: 'Premanent Address', value: (r) => r.permanentAddress },
    { key: 'centerLocation', header: 'Center Location', value: (r) => r.centerLocation },
    { key: 'meetingDay', header: 'Meeting Day', value: (r) => r.meetingDay },
    { key: 'meetingTime', header: 'Meeting Time', value: (r) => r.meetingTime ? normalizeMeetingTime(r.meetingTime) : r.meetingTime },
    { key: 'meetingCenterName', header: 'Meeting Center Name', value: (r) => r.meetingCenterName },
    { key: 'panCard', header: 'PanCard', value: (r) => r.panCard },
    { key: 'idProof', header: 'ID Proof', value: (r) => r.idProof },
    { key: 'idProofNo', header: 'ID Proof No.', value: (r) => r.idProofNo },
    { key: 'caste', header: 'Caste', value: (r) => r.caste },
    { key: 'spouseName', header: 'Spouse Name', value: (r) => r.spouseName },
    { key: 'spouseDob', header: 'Spouse DOB', value: (r) => fmtDate(r.spouseDob) },
    { key: 'memberStatus', header: 'Member Status', value: (r) => r.memberStatus },
    { key: 'memberActive', header: 'Member Active', value: (r) => r.memberActive },
    { key: 'insurance', header: 'Insurance', value: (r) => orDash(r.insurance) },
    { key: 'insurancePolicyType', header: 'Insurance Policy Type', value: (r) => orDash(r.insurancePolicyType) },
    { key: 'insuranceCoverageAmount', header: 'Insurance Coverage Amount', value: (r) => fmtNum(r.insuranceCoverageAmount) },
    { key: 'insurancePremiumAmount', header: 'Insurance Premium Amount', value: (r) => fmtNum(r.insurancePremiumAmount) },
    { key: 'insuranceStartDate', header: 'Insurance Start Date', value: (r) => fmtDate(r.insuranceStartDate) },
    { key: 'insuranceEndDate', header: 'Insurance End Date', value: (r) => fmtDate(r.insuranceEndDate) },
    { key: 'memberIsVerified', header: 'MemberisVerified', value: (r) => r.memberIsVerified },
    { key: 'loanCycleNo', header: 'Loan Cycle', value: (r) => r.loanCycleNo },
    { key: 'purposeOfLoan', header: 'Purpose of Loan', value: (r) => orDash(r.purposeOfLoan) },
    { key: 'productType', header: 'Product Type', value: (r) => orDash(r.productType) },
    { key: 'productName', header: 'Product Name', value: (r) => orDash(r.productName) },
    { key: 'productAmount', header: 'Product Amount', value: (r) => fmtNum(r.productAmount) },
    { key: 'rateOfInterest', header: 'Rate of Interest', value: (r) => r.rateOfInterest },
    { key: 'noOfInstallments', header: 'No.Of Installments', value: (r) => r.noOfInstallments },
    { key: 'loanDisbursementDate', header: 'Loan Disbursement Date', value: (r) => fmtDate(r.loanDisbursementDate) },
    { key: 'loanStartDate', header: 'Loan Start Date', value: (r) => fmtDate(r.loanStartDate) },
    { key: 'loanEndDate', header: 'Loan End Date', value: (r) => fmtDate(r.loanEndDate) },
    { key: 'collectionDay', header: 'Collection Day', value: (r) => orDash(r.collectionDay) },
    { key: 'loanPrincipal', header: 'Loan Principal', value: (r) => fmtNum(r.loanPrincipal) },
    { key: 'loanInterest', header: 'Loan Interest', value: (r) => fmtNum(r.loanInterest) },
    { key: 'totalAmount', header: 'Total Amount', value: (r) => fmtNum(r.totalAmount) },
    { key: 'actualOutstandingPrincipal', header: 'Actual OutStanding Principal', value: (r) => fmtNum(r.actualOutstandingPrincipal) },
    { key: 'actualOutstandingInterest', header: 'Actual OutStanding Interest', value: (r) => fmtNum(r.actualOutstandingInterest) },
    { key: 'actualOutstandingTotal', header: 'Actual OutStanding Total Amount', value: (r) => fmtNum(r.actualOutstandingTotal) },
    { key: 'outstandingPrincipal', header: 'Outstanding Principal', value: (r) => fmtNum(r.outstandingPrincipal) },
    { key: 'outstandingInterest', header: 'Outstanding Interest', value: (r) => fmtNum(r.outstandingInterest) },
    { key: 'outstandingAsOnDate', header: 'OutStanding As On Date', value: (r) => fmtDate(r.outstandingAsOnDate) },
    { key: 'arrearCollectionPrincipal', header: 'Arrear Collection Principal', value: (r) => fmtNum(r.arrearCollectionPrincipal) },
    { key: 'arrearCollectionInterest', header: 'Arrear Collection Interest', value: (r) => fmtNum(r.arrearCollectionInterest) },
    { key: 'arrearCollectionAsOnDate', header: 'Arrear Collection As On Date', value: (r) => fmtDate(r.arrearCollectionAsOnDate) },
    { key: 'fundingLine', header: 'Funding Line', value: (r) => orDash(r.fundingLine) },
    { key: 'lastRepayDate', header: 'Last RepayDate', value: (r) => fmtDate(r.lastRepayDate) },
    { key: 'lastRepayPrincipal', header: 'LastRepay Principal', value: (r) => fmtNum(r.lastRepayPrincipal) },
    { key: 'lastRepayInterest', header: 'LastRepay Interest', value: (r) => fmtNum(r.lastRepayInterest) },
    { key: 'lastRepayDueAmount', header: 'LastRepay DueAmount', value: (r) => fmtNum(r.lastRepayDueAmount) },
    { key: 'collectedBy', header: 'Collected By', value: (r) => orDash(r.collectedBy) },
    { key: 'approvedBy', header: 'approved by', value: (r) => orDash(r.approvedBy) },
    { key: 'pattern', header: 'Pattern', value: (r) => orDash(r.pattern) },
    { key: 'memberRemark', header: 'Member Remark', value: (r) => orDash(r.memberRemark) },
    { key: 'accountNumber', header: 'Account Number', value: (r) => orDash(r.accountNumber) },
    { key: 'ifscCode', header: 'IFSC code', value: (r) => orDash(r.ifscCode) },
    { key: 'bankName', header: 'Bank Name', value: (r) => orDash(r.bankName) },
    { key: 'bankBranchName', header: 'Bank Branch Name', value: (r) => orDash(r.bankBranchName) },
    { key: 'accountType', header: 'Account Type', value: (r) => orDash(r.accountType) },
    { key: 'closedDate', header: 'Closed Date', value: (r) => fmtDate(r.closedDate) },
    { key: 'centerID', header: 'CenterID', value: (r) => r.centerID },
    { key: 'deadMember', header: 'Dead Member', value: (r) => r.deadMember },
    { key: 'loanClosureReason', header: 'Loan Closure Reason', value: (r) => orDash(r.loanClosureReason) },

    // Requested-loan / admission fields
    { key: 'admissionFees', header: 'Admission Fees', value: (r) => fmtNum(r.admissionFees) },
    { key: 'loanAdvance', header: 'Loan Advance', value: (r) => fmtNum(r.loanAdvance) },
    { key: 'requestedAmount', header: 'Requested Amount', value: (r) => fmtNum(r.requestedAmount) },
    { key: 'requestedLoanProductType', header: 'Requested Product Type', value: (r) => orDash(r.requestedLoanProductType) },
    { key: 'requestedLoanPurpose', header: 'Requested Purpose', value: (r) => orDash(r.requestedLoanPurpose) },
    { key: 'requestedLoanFrequency', header: 'Requested Frequency', value: (r) => orDash(r.requestedLoanFrequency) },

    // Family / demographic fields
    { key: 'monthlyFamilyIncome', header: 'Monthly Family Income', value: (r) => fmtNum(r.monthlyFamilyIncome) },
    { key: 'monthlyFamilyExpense', header: 'Monthly Family Expense', value: (r) => fmtNum(r.monthlyFamilyExpense) },
    { key: 'fatherName', header: 'Father Name', value: (r) => orDash(r.fatherName) },
    { key: 'motherName', header: 'Mother Name', value: (r) => orDash(r.motherName) },
    { key: 'maritalStatus', header: 'Marital Status', value: (r) => orDash(r.maritalStatus) },
    { key: 'qualification', header: 'Qualification', value: (r) => orDash(r.qualification) },
    { key: 'religion', header: 'Religion', value: (r) => orDash(r.religion) },
    { key: 'community', header: 'Community', value: (r) => orDash(r.community) },
    { key: 'noOfChildren', header: 'No. Of Children', value: (r) => r.noOfChildren ?? '-' },
    { key: 'houseStatus', header: 'House Status', value: (r) => orDash(r.houseStatus) },
    { key: 'postOffice', header: 'Post Office', value: (r) => orDash(r.postOffice) },
    { key: 'spouseMobileNumber', header: 'Spouse Mobile Number', value: (r) => orDash(r.spouseMobileNumber) },
    { key: 'spouseEconomicActivity', header: 'Spouse Economic Activity', value: (r) => orDash(r.spouseEconomicActivity) },
    { key: 'votersIdNo', header: 'Voter ID No.', value: (r) => orDash(r.votersIdNo) },
    { key: 'otherIdNo', header: 'Other ID No.', value: (r) => orDash(r.otherIdNo) },
    { key: 'smartCardNo', header: 'Smart Card No.', value: (r) => orDash(r.smartCardNo) },
    { key: 'inactiveDate', header: 'Inactive Date', value: (r) => fmtDate(r.inactiveDate) },
    { key: 'dropoutReason', header: 'Dropout Reason', value: (r) => orDash(r.dropoutReason) },

    // Loan financial detail
    { key: 'appliedAmount', header: 'Applied Amount', value: (r) => fmtNum(r.appliedAmount) },
    { key: 'tenureMonths', header: 'Tenure (Months)', value: (r) => r.tenureMonths },
    { key: 'interestPaid', header: 'Interest Paid', value: (r) => fmtNum(r.interestPaid) },
    { key: 'penaltiesPaid', header: 'Penalties Paid', value: (r) => fmtNum(r.penaltiesPaid) },
    { key: 'loanRejectionReason', header: 'Loan Rejection Reason', value: (r) => orDash(r.loanRejectionReason) },
    { key: 'loanCreatedBy', header: 'Loan Created By', value: (r) => orDash(r.loanCreatedBy) },
    { key: 'loanVerifiedBy', header: 'Loan Verified By', value: (r) => orDash(r.loanVerifiedBy) },
    { key: 'loanVerifiedAt', header: 'Loan Verified At', value: (r) => fmtDate(r.loanVerifiedAt) },

    // Loan-related
    { key: 'loanMemberId', header: 'Loan MemberID', value: (r) => r.loanMemberId },

    // Personal/contact
    { key: 'alternatePhone', header: 'Alternative Phone', value: (r) => orDash(r.alternatePhone) },
    { key: 'city', header: 'City', value: (r) => orDash(r.city) },

    // Center/group
    { key: 'groupAddress', header: 'Group Address', value: (r) => orDash(r.groupAddress) },
    { key: 'memberLeadName', header: 'MemberLead Name', value: (r) => orDash(r.memberLeadName) },

    // KYC/identity
    { key: 'joiningDate', header: 'Joining Date', value: (r) => fmtDate(r.joiningDate) },
    { key: 'aadharNumber', header: 'Aadhar Number', value: (r) => orDash(r.aadharNumber) },
    { key: 'addressProof', header: 'Address Proof', value: (r) => orDash(r.addressProof) },
    { key: 'addressProofNo', header: 'Address Proof No.', value: (r) => orDash(r.addressProofNo) },

    // Financial/fees
    { key: 'processingFee', header: 'Processing Fee', value: (r) => fmtNum(r.processingFee) },
    { key: 'walletAmount', header: 'Wallet Amount', value: (r) => fmtNum(r.walletAmount) },

    // Staff/banking
    { key: 'collectionStaff', header: 'Collection Staff', value: (r) => orDash(r.collectionStaff) },
    { key: 'accountName', header: 'Account Name', value: (r) => orDash(r.accountName) },
    { key: 'annualIncome', header: 'Annual Income', value: (r) => fmtNum(r.annualIncome) },

    // Co-Applicant
    { key: 'coApplicantName', header: 'Co-Applicant Name', value: (r) => orDash(r.coApplicantName) },
    { key: 'coApplicantRelation', header: 'Co-Applicant Relation', value: (r) => orDash(r.coApplicantRelation) },
    { key: 'coApplicantGender', header: 'Co-Applicant Gender', value: (r) => orDash(r.coApplicantGender) },
    { key: 'coApplicantDob', header: 'Co-Applicant DOB', value: (r) => fmtDate(r.coApplicantDob) },
    { key: 'coApplicantAge', header: 'Co-Applicant Age', value: (r) => r.coApplicantAge ?? '-' },
    { key: 'coApplicantMobile', header: 'Co-Applicant Mobile', value: (r) => orDash(r.coApplicantMobile) },
    { key: 'coApplicantOccupation', header: 'Co-Applicant Occupation', value: (r) => orDash(r.coApplicantOccupation) },
    { key: 'coApplicantPanCard', header: 'Co-Applicant PAN Card', value: (r) => orDash(r.coApplicantPanCard) },
    { key: 'coApplicantVoterId', header: 'Co-Applicant Voter ID No.', value: (r) => orDash(r.coApplicantVoterId) },
];

const PAGE_SIZE = 20;

export function MemberReportClient() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const { enabled: loanAdvanceEnabled } = useLoanAdvanceEnabled();
    const visibleColumns = loanAdvanceEnabled ? COLUMNS : COLUMNS.filter((c) => c.key !== 'loanAdvance');

    const [branches, setBranches] = useState<Branch[]>([]);
    const [centers, setCenters] = useState<Center[]>([]);
    const [selectedBranch, setSelectedBranch] = useState('all');
    const [selectedCenter, setSelectedCenter] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');

    const [loanStatus, setLoanStatus] = useState('all');
    const [loanProductTypes, setLoanProductTypes] = useState<LoanProductType[]>([]);
    const [loanTypeId, setLoanTypeId] = useState('all');
    const [groupFilter, setGroupFilter] = useState<'all' | 'WITH' | 'WITHOUT'>('all');
    const [funders, setFunders] = useState<Funder[]>([]);
    const [selectedFunder, setSelectedFunder] = useState('all');
    // Draft date state — bound to the date inputs below. Editing these alone must never
    // trigger a fetch; only Submit (handleSubmit) copies them into the "submitted" snapshot
    // that buildParams actually reads, so pagination/exports keep using the last-submitted
    // dates even if the user edits these afterward without clicking Submit again.
    const [dateMode, setDateMode] = useState<'AS_ON' | 'RANGE'>('AS_ON');
    const [asOnDate, setAsOnDate] = useState(() => new Date().toISOString().split('T')[0]);
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    // Submitted (applied) date snapshot — frozen until the next Submit click. This, not the
    // draft state above, is what buildParams/fetchReport/pagination/exports actually use.
    const [submittedDateMode, setSubmittedDateMode] = useState<'AS_ON' | 'RANGE'>(dateMode);
    const [submittedAsOnDate, setSubmittedAsOnDate] = useState(asOnDate);
    const [submittedFromDate, setSubmittedFromDate] = useState(fromDate);
    const [submittedToDate, setSubmittedToDate] = useState(toDate);
    const [summary, setSummary] = useState<SummaryTotals | null>(null);

    const [rows, setRows] = useState<MemberReportRow[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);

    useEffect(() => {
        apiClient.get<Branch[]>('/branches').then((res) => {
            if (res.success && res.data) setBranches(res.data);
        });
        apiClient.get<Funder[]>('/masters/funder').then((res) => {
            if (res.success && res.data) setFunders(res.data);
        });
        apiClient.get<LoanProductType[]>('/loan-product-types').then((res) => {
            if (res.success && res.data) setLoanProductTypes(res.data);
        });
    }, []);

    const handleBranchChange = async (branchId: string) => {
        setSelectedBranch(branchId);
        setSelectedCenter('all');
        setCenters([]);
        if (branchId === 'all') return;
        const res = await apiClient.get<Center[]>(`/centers?branchId=${branchId}`);
        if (res.success && res.data) setCenters(res.data);
    };

    // `dateOverride` lets handleSubmit pass the just-read draft values straight through on the
    // same click — reading submittedDateMode/etc. here would otherwise use the pre-update
    // (stale) state, since the setSubmitted* calls in handleSubmit haven't re-rendered yet.
    // Callers other than handleSubmit omit it and get the last-submitted snapshot, which is
    // exactly the frozen-until-next-Submit behavior pagination/export are supposed to see.
    const buildParams = useCallback(
        (overrides: Record<string, string> = {}, dateOverride?: { mode: 'AS_ON' | 'RANGE'; asOnDate: string; fromDate: string; toDate: string }) => {
            const params = new URLSearchParams(overrides);
            if (selectedBranch !== 'all') params.set('branchId', selectedBranch);
            if (selectedCenter !== 'all') params.set('centerId', selectedCenter);
            if (searchQuery.trim()) params.set('search', searchQuery.trim());
            if (loanStatus !== 'all') params.set('loanStatus', loanStatus);
            if (loanTypeId !== 'all') params.set('loanTypeId', loanTypeId);
            if (groupFilter !== 'all') params.set('groupFilter', groupFilter);
            if (selectedFunder !== 'all') params.set('funderId', selectedFunder);
            const mode = dateOverride?.mode ?? submittedDateMode;
            const effAsOnDate = dateOverride?.asOnDate ?? submittedAsOnDate;
            const effFromDate = dateOverride?.fromDate ?? submittedFromDate;
            const effToDate = dateOverride?.toDate ?? submittedToDate;
            params.set('dateMode', mode);
            if (mode === 'AS_ON' && effAsOnDate) params.set('asOnDate', effAsOnDate);
            if (mode === 'RANGE' && effFromDate && effToDate) {
                params.set('fromDate', effFromDate);
                params.set('toDate', effToDate);
            }
            return params;
        },
        [selectedBranch, selectedCenter, searchQuery, loanStatus, loanTypeId, groupFilter, selectedFunder, submittedDateMode, submittedAsOnDate, submittedFromDate, submittedToDate]
    );

    const fetchReport = useCallback(
        async (pageArg: number, dateOverride?: { mode: 'AS_ON' | 'RANGE'; asOnDate: string; fromDate: string; toDate: string }) => {
            setIsLoading(true);
            try {
                const params = buildParams({ page: String(pageArg), pageSize: String(PAGE_SIZE) }, dateOverride);
                const res = await apiClient.get<ApiResponse>(`/reports/client/member-report?${params}`);
                if (res.success && res.data) {
                    setRows(res.data.data);
                    setTotalCount(res.data.total);
                    setTotalPages(res.data.totalPages || 1);
                    setPage(res.data.page ?? pageArg);
                    setSummary(res.data.summary ?? null);
                } else {
                    setRows([]);
                    setTotalCount(0);
                    setTotalPages(1);
                    setSummary(null);
                }
            } catch {
                toast({ title: 'Error', description: 'Failed to fetch member report.', variant: 'destructive' });
            } finally {
                setIsLoading(false);
            }
        },
        [buildParams, toast]
    );

    const handleSubmit = () => {
        // Freeze the current draft date selection as the "submitted" snapshot — buildParams
        // (and therefore pagination/exports afterward) reads from this state, not the live
        // draft state, so further edits to the date inputs have no effect until Submit is
        // clicked again. The fetch below passes the same values directly as an override rather
        // than waiting for these setState calls to land, since state updates aren't visible
        // until the next render.
        const snapshot = { mode: dateMode, asOnDate, fromDate, toDate };
        setSubmittedDateMode(dateMode);
        setSubmittedAsOnDate(asOnDate);
        setSubmittedFromDate(fromDate);
        setSubmittedToDate(toDate);
        setShowReport(true);
        fetchReport(1, snapshot);
    };

    const handlePageChange = (p: number) => fetchReport(p);

    const fetchAllForExport = useCallback(async (): Promise<MemberReportRow[] | null> => {
        setIsExporting(true);
        try {
            const params = buildParams({ exportAll: 'true' });
            const res = await apiClient.get<ApiResponse>(`/reports/client/member-report?${params}`);
            if (res.success && res.data) return res.data.data;
            toast({ title: 'Export Failed', description: res.error || 'No data to export.', variant: 'destructive' });
            return null;
        } catch {
            toast({ title: 'Export Failed', description: 'Failed to fetch export data.', variant: 'destructive' });
            return null;
        } finally {
            setIsExporting(false);
        }
    }, [buildParams, toast]);

    const handleExportCSV = async () => {
        const data = await fetchAllForExport();
        if (!data || data.length === 0) return;
        const headers = visibleColumns.map((c) => c.header);
        const csvRows = data.map((r) => visibleColumns.map((c) => escapeCsvValue(c.value(r))).join(','));
        const csv = [headers.join(','), ...csvRows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const downloadLink = document.createElement('a');
        downloadLink.href = url;
        downloadLink.download = 'Member_Report.csv';
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        URL.revokeObjectURL(url);
        toast({ title: 'Export Successful', description: 'Member report exported as CSV.' });
    };

    const handleExportExcel = async () => {
        const data = await fetchAllForExport();
        if (!data || data.length === 0) return;
        const headers = visibleColumns.map((c) => c.header);
        const exportRows = data.map((r) => visibleColumns.map((c) => c.value(r)));
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([...reportHeaderRows('MEMBER REPORT'), headers, ...exportRows]);
        autoSizeColumns(ws);
        applyExcelReportFont(ws);
        XLSX.utils.book_append_sheet(wb, ws, 'Member Report');
        XLSX.writeFile(wb, 'Member_Report.xlsx');
        toast({ title: 'Export Successful', description: 'Member report exported as Excel.' });
    };

    return (
        <Card className="border-2 border-primary/20 dark:border-sidebar-accent shadow-sm">
            <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <CardTitle>Member Report</CardTitle>
                        <CardDescription>
                            {showReport ? `${totalCount} record${totalCount !== 1 ? 's' : ''} found` : 'Select filters and click Submit to generate the report'}
                        </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => fetchReport(1)}
                            disabled={isLoading || !showReport}
                            title={!showReport ? 'Submit filters first to generate the report' : undefined}
                            className="h-10"
                        >
                            <RefreshCw className={cn('mr-2 h-4 w-4', isLoading && 'animate-spin')} />
                            Refresh
                        </Button>
                        <ExportDropdown
                            onExportExcel={handleExportExcel}
                            onExportCSV={handleExportCSV}
                            reportSlug={getReportExportMode('member-report') === 'REQUEST_QUEUE' ? 'member-report' : undefined}
                            canExport={canExportReport('member-report')}
                            hidePdf
                            exportParams={{
                                branchIds: selectedBranch === 'all' ? 'ALL' : [selectedBranch],
                                filters: {
                                    ...(selectedCenter !== 'all' ? { centerId: selectedCenter } : {}),
                                    ...(searchQuery.trim() ? { search: searchQuery.trim() } : {}),
                                    ...(loanStatus !== 'all' ? { loanStatus } : {}),
                                    ...(loanTypeId !== 'all' ? { loanTypeId } : {}),
                                    ...(groupFilter !== 'all' ? { groupFilter } : {}),
                                    ...(selectedFunder !== 'all' ? { funderId: selectedFunder } : {}),
                                    ...(submittedDateMode === 'AS_ON' && submittedAsOnDate ? { dateMode: submittedDateMode, asOnDate: submittedAsOnDate } : {}),
                                    ...(submittedDateMode === 'RANGE' && submittedFromDate && submittedToDate ? { dateMode: submittedDateMode, fromDate: submittedFromDate, toDate: submittedToDate } : {}),
                                },
                            }}
                            className="h-10"
                            label={isExporting ? 'Exporting...' : 'Export'}
                        />
                    </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center w-full pt-2">
                    <Select value={selectedBranch} onValueChange={handleBranchChange}>
                        <SelectTrigger className="w-full sm:w-[200px]">
                            <SelectValue placeholder="All Branches" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Branches</SelectItem>
                            {branches.map((b) => (
                                <SelectItem key={b.id} value={b.id}>{b.code} — {b.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select value={selectedCenter} onValueChange={setSelectedCenter} disabled={selectedBranch === 'all'}>
                        <SelectTrigger className="w-full sm:w-[200px]">
                            <SelectValue placeholder="All Centers" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Centers</SelectItem>
                            {centers.map((c) => (
                                <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <div className="relative w-full sm:w-64">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                            placeholder="Search member ID, name, Aadhaar, mobile, loan ID..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9"
                        />
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-2">
                    <Select value={loanStatus} onValueChange={setLoanStatus}>
                        <SelectTrigger className="w-full sm:w-[180px]">
                            <SelectValue placeholder="Loan Status" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Statuses</SelectItem>
                            {LOAN_STATUS_OPTIONS.map((s) => (
                                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select value={selectedFunder} onValueChange={setSelectedFunder}>
                        <SelectTrigger className="w-full sm:w-[180px]">
                            <SelectValue placeholder="Funder" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Funders</SelectItem>
                            {funders.map((f) => (
                                <SelectItem key={f.id} value={f.id}>{f.funderName}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Select value={loanTypeId} onValueChange={setLoanTypeId}>
                        <SelectTrigger className="w-full sm:w-[180px]">
                            <SelectValue placeholder="Loan Type" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Loan Types</SelectItem>
                            {loanProductTypes.map((t) => (
                                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <div className="flex items-center rounded-md border border-input p-0.5">
                        {(['all', 'WITH', 'WITHOUT'] as const).map((opt) => (
                            <button
                                key={opt}
                                type="button"
                                onClick={() => setGroupFilter(opt)}
                                className={cn(
                                    'rounded px-2.5 py-1.5 text-xs font-medium transition-colors',
                                    groupFilter === opt ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
                                )}
                            >
                                {opt === 'all' ? 'All' : opt === 'WITH' ? 'With Group' : 'Without Group'}
                            </button>
                        ))}
                    </div>

                    <Select value={dateMode} onValueChange={(v) => setDateMode(v as 'AS_ON' | 'RANGE')}>
                        <SelectTrigger className="w-full sm:w-[160px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="AS_ON">As On Date</SelectItem>
                            <SelectItem value="RANGE">From Date - To Date</SelectItem>
                        </SelectContent>
                    </Select>

                    {dateMode === 'AS_ON' ? (
                        <div className="relative w-full sm:w-[170px]">
                            <DateInput value={asOnDate} onChange={(e) => setAsOnDate(e.target.value)} className="pl-9" />
                            <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        </div>
                    ) : (
                        <>
                            <div className="relative w-full sm:w-[170px]">
                                <DateInput value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="pl-9" />
                                <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            </div>
                            <div className="relative w-full sm:w-[170px]">
                                <DateInput value={toDate} onChange={(e) => setToDate(e.target.value)} className="pl-9" />
                                <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            </div>
                        </>
                    )}

                    <Button
                        onClick={handleSubmit}
                        disabled={isLoading}
                        className="ml-auto bg-sidebar-accent text-white hover:bg-brand-green-darker dark:bg-sidebar-accent dark:hover:bg-sidebar-accent/80"
                    >
                        {isLoading ? 'Loading...' : 'Submit'}
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="p-0">
                {isLoading ? (
                    <PageLoader label="Loading member report..." fullScreen={false} />
                ) : !showReport ? (
                    <div className="p-12 text-center text-sm text-muted-foreground">
                        Select filters and click Submit to generate the Member Report
                    </div>
                ) : (
                    <>
                        {summary && (
                            <div className="grid grid-cols-1 gap-4 border-b p-4 sm:grid-cols-2 sm:p-6 xl:grid-cols-4">
                                <Card className="border-2 border-purple-200 bg-gradient-to-br from-purple-50 to-purple-50/50 dark:border-purple-800/50 dark:from-purple-950/20 dark:to-purple-950/20">
                                    <CardContent className="pt-6">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-sm font-medium text-purple-700 dark:text-purple-300">Member Count</p>
                                                <p className="mt-2 text-2xl font-bold text-foreground dark:text-purple-100">{(summary.memberCount ?? 0).toLocaleString('en-IN')}</p>
                                                <p className="mt-1 text-xs text-muted-foreground">
                                                    With Loan: {(summary.membersWithLoan ?? 0).toLocaleString('en-IN')} · No Loan: {(summary.membersWithoutLoan ?? 0).toLocaleString('en-IN')}
                                                </p>
                                            </div>
                                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-900/50">
                                                <Users className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                                <Card className="border-2 border-primary/20 bg-gradient-to-br from-green-50 to-green-50/50 dark:border-sidebar-accent/50 dark:from-brand-green-darker/20 dark:to-brand-green-darker/20">
                                    <CardContent className="pt-6">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-sm font-medium text-sidebar-accent dark:text-green-300">Loan Amount</p>
                                                <p className="mt-2 text-2xl font-bold text-foreground dark:text-green-100">{fmtNum(summary.loanAmountPrincipal)}</p>
                                                <p className="mt-1 text-xs text-muted-foreground">
                                                    Principal: {fmtNum(summary.loanAmountPrincipal)} · Interest: {fmtNum(summary.loanAmountInterest)}
                                                </p>
                                            </div>
                                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-green-tint dark:bg-brand-green-darker/50">
                                                <Banknote className="h-6 w-6 text-primary" />
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                                <Card className="border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-amber-50/50 dark:border-amber-800/50 dark:from-amber-950/20 dark:to-amber-950/20">
                                    <CardContent className="pt-6">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-sm font-medium text-amber-700 dark:text-amber-300">OS Balance Amount</p>
                                                <p className="mt-2 text-2xl font-bold text-foreground dark:text-amber-100">{fmtNum(summary.osPrincipal)}</p>
                                                <p className="mt-1 text-xs text-muted-foreground">
                                                    Principal: {fmtNum(summary.osPrincipal)} · Interest: {fmtNum(summary.osInterest)}
                                                </p>
                                            </div>
                                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-900/50">
                                                <Scale className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                                <Card className="border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-blue-50/50 dark:border-blue-800/50 dark:from-blue-950/20 dark:to-blue-950/20">
                                    <CardContent className="pt-6">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-sm font-medium text-blue-700 dark:text-blue-300">Collected Amount</p>
                                                <p className="mt-2 text-2xl font-bold text-foreground dark:text-blue-100">{fmtNum(summary.collectedPrincipal)}</p>
                                                <p className="mt-1 text-xs text-muted-foreground">
                                                    Principal: {fmtNum(summary.collectedPrincipal)} · Interest: {fmtNum(summary.collectedInterest)}
                                                </p>
                                            </div>
                                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-900/50">
                                                <Wallet className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        )}
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        {visibleColumns.map((c) => (
                                            <TableHead key={c.key} className="whitespace-nowrap text-xs font-bold">
                                                {c.header}
                                            </TableHead>
                                        ))}
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {rows.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={visibleColumns.length} className="h-32 text-center text-muted-foreground">
                                                No records found.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        rows.map((r) => (
                                            <TableRow key={`${r.loanId}-${r.sNo}`}>
                                                {visibleColumns.map((c) => (
                                                    <TableCell key={c.key} className="whitespace-nowrap text-xs">
                                                        {c.value(r)}
                                                    </TableCell>
                                                ))}
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                        {totalPages > 1 && (
                            <div className="flex items-center justify-between border-t px-4 py-3">
                                <p className="text-xs font-medium text-muted-foreground">
                                    Page {page} of {totalPages} · {totalCount} record{totalCount !== 1 ? 's' : ''}
                                </p>
                                <div className="flex gap-1">
                                    <Button variant="ghost" size="icon" onClick={() => handlePageChange(Math.max(1, page - 1))} disabled={page === 1} className="h-8 w-8">
                                        <ChevronLeft className="h-4 w-4" />
                                    </Button>
                                    <Button variant="ghost" size="icon" onClick={() => handlePageChange(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="h-8 w-8">
                                        <ChevronRight className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    );
}
