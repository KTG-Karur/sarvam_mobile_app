'use client';

import { use } from 'react';
import { ThemePresetEditorClient } from '@/components/settings/ThemePresetEditorClient';

export default function EditThemePresetPage({ params }: { params: Promise<{ presetId: string }> }) {
  const { presetId } = use(params);
  return <ThemePresetEditorClient presetId={presetId} />;
}
