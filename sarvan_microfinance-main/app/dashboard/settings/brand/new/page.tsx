'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { PageLoader } from '@/components/ui/page-loader';
import { ThemePresetEditorClient } from '@/components/settings/ThemePresetEditorClient';

function NewThemePresetForm() {
  const searchParams = useSearchParams();
  const initialName = searchParams.get('name') ?? '';
  return <ThemePresetEditorClient presetId={null} initialName={initialName} />;
}

export default function NewThemePresetPage() {
  return (
    <Suspense fallback={<PageLoader fullScreen={false} />}>
      <NewThemePresetForm />
    </Suspense>
  );
}
