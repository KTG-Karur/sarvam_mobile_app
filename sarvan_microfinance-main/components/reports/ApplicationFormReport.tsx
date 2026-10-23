'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  FileText,
  Printer,
  Search,
  RotateCcw,
  Download,
  Eye,
  Loader2,
  FileSpreadsheet,
  FileType,
  FileOutput,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { cn } from '@/lib/utils';
import { apiClient } from '@/app/lib/api-client';
import { getPersonLabel } from '@/app/lib/person-label';
import { tokenStorage } from '@/app/lib/token-storage';
import { getCentersForDropdown, CenterOption } from '@/app/lib/actions/centers';
import { useEffect, useRef } from 'react';
import * as XLSX from 'xlsx-js-style';
import type { ApplicationFormRecord } from '@/app/lib/reports/application-form-data';
import {
  buildApplicationFormHTML,
  formatDate,
  maskAadhar,
} from '@/app/lib/reports/application-form-template';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { truncateReportAmount } from '@/app/lib/utils/format-amount';
import { applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { toDisplayDate } from '@/app/lib/date-format';

// Types
type BranchOption = { id: string; name: string; code: string };

type ClientAppRecord = ApplicationFormRecord;

export function ApplicationFormReport() {
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [selectedBranch, setSelectedBranch] = useState('all');
  const [centers, setCenters] = useState<CenterOption[]>([]);
  const [selectedCenter, setSelectedCenter] = useState('');

  const filteredCenters = selectedBranch === 'all'
    ? centers
    : centers.filter((c) => c.branchId === selectedBranch);
  const [filteredClients, setFilteredClients] = useState<ClientAppRecord[]>([]);
  const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(filteredClients);
  const [isLoadingCenters, setIsLoadingCenters] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [printData, setPrintData] = useState<ClientAppRecord[] | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { toast } = useToast();
  const { canExportReport, getReportExportMode } = usePermission();

  useEffect(() => {
    fetchCenters();
  }, []);

  const fetchCenters = async () => {
    setIsLoadingCenters(true);
    try {
      const centerList = await getCentersForDropdown();
      setCenters(centerList);
      if (centerList.length === 1 && !selectedCenter) {
        setSelectedCenter(centerList[0].id);
      }

      fetch('/api/branches')
        .then((r) => r.json())
        .then((d) => setBranches(Array.isArray(d) ? d : (d.data ?? [])))
        .catch(() => {});
    } catch (error) {
      console.error('Error fetching centers:', error);
      toast({
        title: 'Error',
        description: 'Failed to load centers.',
        variant: 'destructive',
      });
    } finally {
      setIsLoadingCenters(false);
    }
  };

  const handleShow = async () => {
    if (!selectedCenter) {
      toast({
        title: 'Center Required',
        description: 'Please select a center to view applications',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    try {
      const result = await apiClient.get<ClientAppRecord[]>(
        `/reports/client/application-form?centerId=${selectedCenter}`
      );

      if (result.success && result.data) {
        setFilteredClients(result.data);
        if (result.data.length === 0) {
          toast({
            title: 'No Data',
            description: 'No applications found.',
          });
        } else {
          toast({
            title: 'Data Loaded',
            description: `Found ${result.data.length} client(s)`,
          });
        }
      } else {
        toast({
          title: 'Error',
          description: result.error || 'Failed to fetch applications.',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('App Form fetch error:', error);
      toast({
        title: 'Error',
        description: 'Communication with server failed.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setSelectedBranch('all');
    setSelectedCenter('');
    setFilteredClients([]);
    toast({
      title: 'Reset Complete',
      description: 'All filters have been cleared',
    });
  };

  const prepareExcelData = (clients: ClientAppRecord[]) => {
    return clients.map((client) => ({
      'Client Account Number': client.account || 'NEW',
      'Branch': client.branchName || 'N/A',
      'Center': client.centerName || 'N/A',
      'Center Code': client.centerCode || 'N/A',
      'Name': client.clientName || 'N/A',
      'Member / Client': getPersonLabel(!!client.hasLoan).singular,
      'ID': client.clientId || 'N/A',
      'Nominee': client.nomineeName || 'N/A',
      'Nominee Relation': client.nomineeRelation || 'N/A',
      'Father Name': client.fatherName || 'N/A',
      'Mother Name': client.motherName || 'N/A',
      'Spouse Name': client.spouseName || 'N/A',
      'Spouse DOB': client.spouseDob ? formatDate(client.spouseDob) : 'N/A',
      'Spouse Gender': client.spouseGender || '',
      'Age': client.age || '',
      'Gender': client.gender || '',
      'Marital Status': client.maritalStatus || '',
      'Date of Joining': formatDate(client.dateOfJoining),
      'Permanent Address': client.permanentAddress || '',
      'Phone 1': client.phone || '',
      'Phone 2': client.mobile2 || '',
      'Voter ID': client.voterId || '',
      'PAN Card': client.panCard || '',
      'Smart Card No': client.smartCard || '',
      'Unique ID (Aadhar Masked)': maskAadhar(client.voterId),
      'Nominee UID (Masked)': client.coOtherId ? maskAadhar(client.coOtherId) : '',
      'Nominee VID': client.coApplicantVoterId || '',
      'Nominee PAN': client.coApplicantPanCard || '',
      'Nominee DOB': client.nomineeDob ? formatDate(client.nomineeDob) : '',
      'Nominee Age': client.nomineeAge || '',
      'Nominee Gender': client.nomineeGender || '',
      'Qualification': client.qualification || '',
      'Occupation': client.occupation || '',
      'Economic Activity Type': client.economicActivityType || '',
      'Economic Activity': client.economicActivity || '',
      'Spouse Economic Activity Type': client.spouseEconomicActivityType || '',
      'Spouse Economic Activity': client.spouseEconomicActivity || '',
      'Monthly Income': client.monthlyIncome != null ? truncateReportAmount(client.monthlyIncome) : '',
      'Monthly Expense': client.monthlyExpense != null ? truncateReportAmount(client.monthlyExpense) : '',
      'Requested Loan Amount': client.requestedAmount != null ? truncateReportAmount(client.requestedAmount) : '',
      'Loan Tenure (Weeks)': client.loanTenure || '',
      'Loan Frequency': client.loanFrequency || '',
      'Loan Product Type': client.loanProductTypeName || '',
      'Loan Product': client.loanProductName || '',
      'Loan Product Amount': client.loanProductAmount != null ? truncateReportAmount(client.loanProductAmount) : '',
      'House Status': client.houseStatus || '',
      'Bank Account No': client.bankAcNo || '',
      'Bank Account Type': client.bankAccountType || '',
      'Bank Name': client.bankName || '',
      'Bank Branch': client.bankBranch || '',
      'IFSC Code': client.ifscCode || '',
      'Co-Applicant Name': client.coApplicantName || '',
      'Co-Applicant Age': client.coApplicantAge || '',
      'Co-Applicant Relation': client.coApplicantRelation || '',
      'Co-Applicant Phone': client.coApplicantPhone || '',
      'Co-Applicant DOB': client.nomineeDob ? formatDate(client.nomineeDob) : '',
      'Co-Applicant Gender': client.nomineeGender || '',
      'Co-Applicant Economic Activity Type': client.coApplicantEconomicActivityType || '',
      'Co-Applicant Economic Activity': client.coApplicantEconomicActivity || '',
      'Religion': client.religion || '',
      'Caste': client.caste || '',
      'Purpose of Loan': client.occupation || '',
    }));
  };

  const handleExportExcel = () => {
    if (filteredClients.length === 0) {
      toast({
        title: 'No Data',
        description: 'No applications to export',
        variant: 'destructive',
      });
      return;
    }

    setIsExportingExcel(true);
    
    try {
      const excelData = prepareExcelData(searchedRows);
      
      // Create worksheet
      const worksheet = XLSX.utils.json_to_sheet(excelData);
      
      // Auto-size columns (set column widths)
      const maxWidth = 25;
      const colWidths = Object.keys(excelData[0] || {}).map(key => ({
        wch: Math.min(Math.max(key.length, 12), maxWidth)
      }));
      worksheet['!cols'] = colWidths;
      applyExcelReportFont(worksheet);

      // Create workbook
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Application Forms');
      
      // Generate filename with date
      const date = new Date();
      const dateStr = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
      const centerName = centers.find(c => c.id === selectedCenter)?.name || 'All';
      const fileName = `Application_Forms_${centerName}_${dateStr}.xlsx`;
      
      // Export file
      XLSX.writeFile(workbook, fileName);
      
      toast({
        title: 'Export Successful',
        description: `${searchedRows.length} application(s) exported to Excel`,
      });
    } catch (error) {
      console.error('Excel export error:', error);
      toast({
        title: 'Export Failed',
        description: 'Failed to export data to Excel',
        variant: 'destructive',
      });
    } finally {
      setIsExportingExcel(false);
    }
  };

  // CSV / Word export — reuses the existing prepareExcelData() helper above
  // (already a reusable object-array function), converted to headers+rows.
  const buildApplicationFormExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
    const excelData = prepareExcelData(searchedRows);
    if (excelData.length === 0) return { headers: [], rows: [] };
    const headers = Object.keys(excelData[0]);
    const rows: (string | number)[][] = excelData.map((obj) => headers.map((h) => (obj as Record<string, string | number>)[h] ?? ''));
    return { headers, rows };
  };

  const handleExportCSV = () => {
    if (filteredClients.length === 0) {
      toast({ title: 'No Data', description: 'No applications to export', variant: 'destructive' });
      return;
    }
    const { headers, rows } = buildApplicationFormExportRows();
    const centerName = centers.find((c) => c.id === selectedCenter)?.name || 'All';
    exportToCSV(`Application_Forms_${centerName}_${formatDate(new Date().toISOString())}`, 'APPLICATION FORMS', headers, rows);
  };

  // Word-only presentation: same rows as CSV above (headers are derived dynamically from
  // prepareExcelData()'s field order — this grouping assumes that exact, current order).
  // No totals row exists in this report (a KYC/application dump, not a financial
  // roll-up). At 62 columns — by far the widest report in the app — this genuinely
  // needs grouped headers and A3 landscape; groups only cover contiguous, truly related
  // fields (e.g. Spouse info, Nominee info in its two separate blocks, Bank details,
  // Co-Applicant info), leaving one-off fields (Age, Religion, Caste, ...) standalone.
  const wordOptions: WordExportOptions = {
    groupHeaders: [
      { label: 'Client Account Number', span: 1 }, { label: 'BRANCH & CENTER', span: 3 },
      { label: 'IDENTITY', span: 3 }, { label: 'NOMINEE', span: 2 }, { label: 'PARENTS', span: 2 },
      { label: 'SPOUSE', span: 3 }, { label: 'Age', span: 1 }, { label: 'Gender', span: 1 },
      { label: 'Marital Status', span: 1 }, { label: 'Date of Joining', span: 1 }, { label: 'Permanent Address', span: 1 },
      { label: 'PHONE', span: 2 }, { label: 'ID DOCS', span: 3 }, { label: 'Unique ID (Aadhar Masked)', span: 1 },
      { label: 'NOMINEE ID', span: 3 }, { label: 'NOMINEE DETAILS', span: 3 }, { label: 'Qualification', span: 1 },
      { label: 'Occupation', span: 1 }, { label: 'ECONOMIC ACTIVITY', span: 2 }, { label: 'SPOUSE ECONOMIC ACTIVITY', span: 2 },
      { label: 'INCOME', span: 2 }, { label: 'LOAN REQUEST', span: 3 }, { label: 'LOAN PRODUCT', span: 3 },
      { label: 'House Status', span: 1 }, { label: 'BANK DETAILS', span: 5 }, { label: 'CO-APPLICANT', span: 8 },
      { label: 'Religion', span: 1 }, { label: 'Caste', span: 1 }, { label: 'Purpose of Loan', span: 1 },
    ],
    subHeaders: ['Branch', 'Center', 'Center Code', 'Name', 'Member/Client', 'ID', 'Nominee', 'Relation', 'Father Name', 'Mother Name', 'Name', 'DOB', 'Gender', 'Phone 1', 'Phone 2', 'Voter ID', 'PAN Card', 'Smart Card No', 'UID (Masked)', 'VID', 'PAN', 'DOB', 'Age', 'Gender', 'Type', 'Activity', 'Type', 'Activity', 'Monthly Income', 'Monthly Expense', 'Amount', 'Tenure (Weeks)', 'Frequency', 'Type', 'Product', 'Amount', 'A/c No', 'A/c Type', 'Bank Name', 'Branch', 'IFSC', 'Name', 'Age', 'Relation', 'Phone', 'DOB', 'Gender', 'Eco. Type', 'Eco. Activity'],
    columnAlignments: ['center', 'left', 'left', 'center', 'left', 'center', 'center', 'left', 'left', 'left', 'left', 'left', 'center', 'center', 'center', 'center', 'center', 'center', 'left', 'center', 'center', 'center', 'center', 'center', 'center', 'center', 'center', 'center', 'center', 'center', 'center', 'left', 'left', 'left', 'left', 'left', 'left', 'right', 'right', 'right', 'right', 'center', 'left', 'left', 'right', 'center', 'center', 'center', 'left', 'left', 'center', 'left', 'center', 'left', 'center', 'center', 'center', 'left', 'left'],
    columnWidthWeights: [8, 9, 9, 7, 12, 8, 8, 10, 8, 10, 10, 10, 7, 6, 4, 6, 7, 8, 16, 8, 8, 8, 8, 8, 9, 9, 8, 8, 7, 5, 6, 8, 8, 9, 9, 9, 9, 8, 8, 8, 7, 7, 8, 9, 7, 7, 9, 7, 9, 8, 8, 10, 5, 8, 8, 7, 6, 8, 8, 7, 7, 10],
    pageSize: { widthMm: 297, heightMm: 420 },
  };

  const handleExportWord = async () => {
    if (filteredClients.length === 0) {
      toast({ title: 'No Data', description: 'No applications to export', variant: 'destructive' });
      return;
    }
    const { headers, rows } = buildApplicationFormExportRows();
    const centerName = centers.find((c) => c.id === selectedCenter)?.name || 'All';
    await exportToWord(`Application_Forms_${centerName}_${formatDate(new Date().toISOString())}`, 'APPLICATION FORMS', headers, rows, wordOptions);
  };

  const handlePrint = () => {
    if (!printData) return;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      toast({
        title: 'Error',
        description: 'Failed to access print sandbox.',
        variant: 'destructive',
      });
      return;
    }

    doc.open();
    doc.write(buildApplicationFormHTML(printData));
    doc.close();

    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => {
        document.body.removeChild(iframe);
      }, 1000);
    }, 800);
  };

  const handleDownloadPDF = async () => {
    if (!printData) return;

    setIsDownloading(true);
    toast({
      title: 'Generating PDF',
      description: 'Please wait while we prepare your high-quality document...',
    });

    try {
      const ids = printData.map((c) => c.id).join(',');
      const fileName =
        printData.length === 1
          ? `Application_${printData[0].clientName.replace(/\s+/g, '_')}.pdf`
          : `Applications_Batch_${new Date().getTime()}.pdf`;

      const downloadUrl = `/api/reports/client/application-form/download?ids=${ids}`;
      const token = tokenStorage.getAccessToken();

      const response = await fetch(downloadUrl, {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', fileName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);

      toast({
        title: 'Download Started',
        description: 'Your PDF is being downloaded.',
      });
    } catch (error) {
      console.error('PDF Download error:', error);
      toast({
        title: 'Download Failed',
        description: 'PDF generation failed. Opening print preview instead.',
        variant: 'destructive',
      });
      handlePrint();
    } finally {
      setIsDownloading(false);
    }
  };

  const handlePreview = (client: ClientAppRecord) => {
    toast({
      title: 'Generating Preview',
      description: `Preparing view for ${client.clientName}`,
    });
    setPrintData([client]);
  };

  const handlePreviewAll = () => {
    if (filteredClients.length === 0) {
      toast({
        title: 'No Data',
        description: 'No applications to preview',
        variant: 'destructive',
      });
      return;
    }
    toast({
      title: 'Generating Previews',
      description: `Preparing view for ${filteredClients.length} application(s)`,
    });
    setPrintData(filteredClients);
  };

  return (
    <div className="space-y-6">
      <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-lg">
        <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 dark:bg-brand-green-darker/30">
              <Search className="h-5 w-5 text-primary dark:text-primary" />
            </div>
            <CardTitle className="text-lg">Filter Options</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="flex-1 space-y-2">
              <label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                Branch
              </label>
              <Select
                value={selectedBranch}
                onValueChange={(v) => { setSelectedBranch(v); setSelectedCenter(''); }}
                disabled={isLoadingCenters}
              >
                <SelectTrigger className="h-11 w-full border border-primary/30 text-sm font-medium bg-green-50 hover:border-primary focus:border-primary dark:bg-brand-green-darker dark:border-sidebar-accent">
                  <SelectValue placeholder="-- ALL BRANCHES --" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">-- ALL BRANCHES --</SelectItem>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.code} - {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 space-y-2">
              <label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                Center Name <span className="text-red-500">*</span>
              </label>
              <Select
                value={selectedCenter}
                onValueChange={setSelectedCenter}
                disabled={isLoadingCenters}
              >
                <SelectTrigger className="h-11 w-full border border-primary/30 text-sm font-medium bg-green-50 hover:border-primary focus:border-primary dark:bg-brand-green-darker dark:border-sidebar-accent">
                  <SelectValue
                    placeholder={isLoadingCenters ? 'Loading...' : '-- SELECT --'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {filteredCenters.map((center) => (
                    <SelectItem key={center.id} value={center.id}>
                      {center.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-3">
              <Button
                onClick={handleShow}
                disabled={isLoading}
                className="h-11 px-6 bg-primary hover:bg-sidebar-accent"
              >
                <Search className="h-4 w-4 mr-2" />
                Show
              </Button>
              <Button
                onClick={handleReset}
                variant="outline"
                className="h-11 px-6"
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {searchedRows.length > 0 && (
        <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-lg overflow-hidden">
          <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-primary" />
          <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 dark:bg-brand-green-darker/30">
                  <FileText className="h-5 w-5 text-primary dark:text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">Application Forms</CardTitle>
                  <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-0.5">
                    {searchedRows.length} client(s) found
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <ExportDropdown
                  onExportExcel={handleExportExcel}
                  onExportCSV={handleExportCSV}
                  onExportWord={handleExportWord}
                  hidePdf
                  reportSlug={getReportExportMode('application-form') === 'REQUEST_QUEUE' ? 'application-form' : undefined}
                  canExport={canExportReport('application-form')}
                  exportParams={{ filters: { centerId: selectedCenter } }}
                  className="h-10 px-4 border-green-500 text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-400 dark:hover:bg-green-950"
                />
                <Button
                  onClick={handlePreviewAll}
                  variant="outline"
                  className="h-10 px-4 border-primary text-primary hover:bg-green-50 dark:border-primary dark:text-primary dark:hover:bg-brand-green-darker"
                >
                  <Eye className="h-4 w-4 mr-2" />
                  Preview All
                </Button>
              </div>
            </div>
          </CardHeader>
          <div className="flex flex-wrap items-center gap-4 px-6 pt-4">
            <TableSearchInput
              value={tableSearchQuery}
              onChange={setTableSearchQuery}
              placeholder="Search applications..."
              className="ml-auto"
            />
          </div>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-green-50 dark:bg-brand-green-darker/50">
                    <TableHead>Account</TableHead>
                    <TableHead>ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Date of Joining</TableHead>
                    <TableHead className="text-center">Print</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {searchedRows.map((client, index) => (
                    <TableRow
                      key={client.id}
                      className={cn(
                        'transition-colors',
                        index % 2 === 0
                          ? 'bg-white dark:bg-green-950'
                          : 'bg-green-50/50 dark:bg-brand-green-darker/30'
                      )}
                    >
                      <TableCell className="font-medium">{client.account}</TableCell>
                      <TableCell>{client.clientId}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span>{client.clientName}</span>
                          <span className="inline-flex rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary dark:bg-primary/20 dark:text-emerald-400">
                            {getPersonLabel(!!client.hasLoan).singular}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {toDisplayDate(new Date(client.dateOfJoining))}
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          onClick={() => handlePreview(client)}
                          size="sm"
                          className="h-8 px-4 bg-primary hover:bg-sidebar-accent"
                        >
                          <Eye className="h-3.5 w-3.5 mr-1.5" />
                          Preview
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {!isLoading && filteredClients.length === 0 && selectedCenter && (
        <Card className="border-2 border-dashed border-primary/30 dark:border-sidebar-accent">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <FileText className="h-16 w-16 text-slate-400 dark:text-sidebar-accent mb-4" />
            <h3 className="text-lg font-semibold text-foreground dark:text-slate-100 mb-2">
              No Applications Found
            </h3>
            <p className="text-sm text-sidebar-accent dark:text-slate-400 text-center max-w-md">
              No client applications found for the selected center.
            </p>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={!!printData}
        onOpenChange={(open) => !open && setPrintData(null)}
      >
        <DialogContent className="max-w-[1400px]! w-[95vw]! h-[95vh]! flex flex-col p-0 gap-0 bg-brand-green-tint overflow-hidden border-none shadow-2xl">
          <DialogHeader className="flex px-6 py-4 flex-row items-center justify-between border-b bg-white dark:bg-brand-green-darker border-primary/20 dark:border-sidebar-accent shadow-sm z-10">
            <div>
              <DialogTitle className="text-xl font-bold flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary dark:text-primary" />
                Application Preview
              </DialogTitle>
              <p className="text-sm text-slate-500 mt-1">
                Review the generated application template before exporting
              </p>
            </div>
            <div className="flex gap-3 pt-0">
              <ExportDropdown
                onExportPDF={handleDownloadPDF}
                onExportExcel={handleExportExcel}
                onExportCSV={handleExportCSV}
                onExportWord={handleExportWord}
                reportSlug={getReportExportMode('application-form') === 'REQUEST_QUEUE' ? 'application-form' : undefined}
                canExport={canExportReport('application-form')}
                exportParams={{ filters: { centerId: selectedCenter } }}
                className="h-10 px-5 border-green-500 text-green-700 hover:bg-green-50 transition-colors"
              />
              <Button
                variant="outline"
                onClick={handlePrint}
                className="h-10 px-5 border-primary/30 hover:bg-green-50 transition-colors"
              >
                <Printer className="h-4 w-4 mr-2" />
                Print Preview
              </Button>
            </div>
          </DialogHeader>
          <div className="flex-1 w-full bg-brand-green-tint/50 p-6 overflow-hidden">
            <div className="w-full h-full bg-white rounded-lg shadow-xl border border-primary/30 overflow-hidden">
              {printData && (
                <iframe
                  ref={iframeRef}
                  className="w-full h-full border-none rounded-lg"
                  srcDoc={buildApplicationFormHTML(printData)}
                  title="Application Form Preview"
                />
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
