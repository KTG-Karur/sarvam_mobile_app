import { BrandSettingsClient } from '@/components/settings/BrandSettingsClient';

// This page shares the root layout's theme CSS injection (colors/logo/favicon),
// which is read from the DB via a tag-revalidated cache. Without forcing dynamic
// rendering here, Next's static/ISR cache serves one stale reload after Apply —
// the new theme only shows up on a second, later refresh. Force-dynamic makes
// every load (including the immediate post-Apply reload) hit the DB fresh.
export const dynamic = 'force-dynamic';

export default function BrandSettingsPage() {
  return <BrandSettingsClient />;
}
