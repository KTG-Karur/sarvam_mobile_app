import { getBrandNamesGlobal } from '@/app/lib/brand-context';

/**
 * Standard trust header markup for raw HTML-string print windows
 * (plain inline styles — no external stylesheet is available in these documents).
 */
export function reportHtmlHeader(title: string): string {
  const brand = getBrandNamesGlobal();
  const companyNameCaps = brand.companyNameFull.toUpperCase();
  return `
    <div style="display:flex;align-items:center;justify-content:center;gap:12px;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:12px;">
      <img src="/api/branding/asset/logo-wordmark" alt="${companyNameCaps}" style="height:48px;width:auto;max-width:160px;object-fit:contain;" onerror="this.style.display='none'" />
      <div style="text-align:center;">
        <div style="font-size:18px;font-weight:bold;letter-spacing:0.5px;">${companyNameCaps}</div>
        <div style="font-size:13px;font-weight:600;color:${brand.primaryColor};">${title}</div>
      </div>
    </div>`;
}
