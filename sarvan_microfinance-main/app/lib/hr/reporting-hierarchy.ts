// Reporting Manager (L1/L2/L3) fields only mean something when the configured
// hr-onboarding approval workflow has a real chain — more than the single
// "Admin Approval" stage. Every page that shows those fields (Employee Master,
// My Profile, the onboarding Finalize panel, and both field-config admin
// pages) asks this one function, so they always agree with Approval Settings.
// Pure (no Prisma) so client components can import it.
export function hasReportingHierarchy(stageCount: number | null | undefined): boolean {
  return (stageCount ?? 0) > 1;
}
