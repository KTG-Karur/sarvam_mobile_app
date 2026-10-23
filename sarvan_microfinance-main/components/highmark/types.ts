export interface HighmarkReportSummary {
  id: string;
  pullId: number;
  provider: string;
  status: string;
  fromCache: boolean;
  providerReference: string | null;
  creditScore: number | null;
  creditsCharged: number | string;
  reportJson: unknown;
  firstName: string;
  lastName: string | null;
  aadhaarMasked: string;
  phone: string;
  consentObtained: boolean;
  consentAt: string;
  requestedById: string;
  branchId: string;
  clientId: string | null;
  pulledAt: string;
  createdAt: string;
  requestedBy?: { firstName: string; lastName: string };
  branch?: { name: string; code: string };
  client?: { clientId: string; firstName: string; lastName: string } | null;
}
