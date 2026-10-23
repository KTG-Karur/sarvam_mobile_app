import { Suspense } from 'react';
import DenominationEntryContent from './DenominationEntryContent';
import { PageLoader } from '@/components/ui/page-loader';

export default function DenominationEntryPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <DenominationEntryContent />
    </Suspense>
  );
}