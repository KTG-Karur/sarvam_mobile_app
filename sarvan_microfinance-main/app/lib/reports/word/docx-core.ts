// ============================================================
// SHARED DOCX CONSTRUCTION CORE
// app/lib/reports/word/docx-core.ts
//
// Environment-agnostic: pure `docx` (Document/Table/Paragraph) construction with
// no browser APIs (no `document`, `Image`, `URL.createObjectURL`) and no
// server-only APIs (no `fs`, Prisma, `sharp`). Both the client-side direct
// export (app/lib/report-export-utils.ts, via Packer.toBlob) and the
// server-side queued export (app/lib/reports/word/server-word-builder.ts, via
// Packer.toBuffer) build their Document through buildWordDocument() here, so
// direct and queued Word output are guaranteed to share one design — the logo
// bytes and the final pack/download vs. pack/upload step are the only things
// that differ between the two callers.
// ============================================================

import {
    Document,
    Paragraph,
    Table,
    TableRow,
    TableCell,
    TextRun,
    ImageRun,
    HeadingLevel,
    AlignmentType,
    WidthType,
    ShadingType,
    PageOrientation,
    VerticalAlign,
    BorderStyle,
    Footer,
    PageNumber,
    TableLayoutType,
    convertMillimetersToTwip,
    HorizontalPositionRelativeFrom,
    HorizontalPositionAlign,
    VerticalPositionRelativeFrom,
    VerticalPositionAlign,
    TextWrappingType,
} from 'docx';
import { withMemberContactWordColumns } from '@/app/lib/reports/member-contact-columns';
import { mixHex } from '@/app/lib/color-scale';

export type CellValue = string | number;

/** Active theme's color anchors (hex, with or without leading `#`), threaded in by both
 *  callers (browser `exportToWord` / server `buildWord`) so the Word header/table/summary
 *  shading follows the active ThemePreset instead of a fixed brand color. */
export interface WordBrandColor {
    primary: string;
    dark: string;
    tint: string;
}

/** One label/value pair shown in the report-info grid or the summary cards. */
export interface WordExportInfoItem {
    label: string;
    value: string;
}

/** A grouped (top-level) header cell spanning `span` leaf columns. `span === 1` renders as a
 *  standalone header that spans both header rows (no matching entry in `subHeaders`). */
export interface WordExportGroupHeader {
    label: string;
    span: number;
}

/** Optional rich-layout instructions for {@link buildWordDocument}. When omitted, output is the
 *  original flat single-header-row layout used by most reports' Word export. */
export interface WordExportOptions {
    /** Report-info grid rendered under the title (Branch, Center, FDO, dates, ...). */
    reportInfo?: WordExportInfoItem[];
    /** Compact bordered summary cards rendered under the report-info grid. */
    summary?: WordExportInfoItem[];
    /** Top header row groups; `span` values must sum to `headers.length`. */
    groupHeaders?: WordExportGroupHeader[];
    /** Second header row labels — one per leaf column belonging to a `span > 1` group, in order
     *  (columns covered by a `span === 1` standalone group are skipped, since they don't repeat
     *  in the second row). */
    subHeaders?: string[];
    /** Per leaf column alignment (same length/order as `headers`). */
    columnAlignments?: ('left' | 'center' | 'right')[];
    /** Relative width weights per leaf column (same length/order as `headers`) — e.g. a "Member
     *  Name" column might get weight 16 vs. weight 4 for "S.No". Converted to fixed DXA widths
     *  that fill the full usable page width. Defaults to equal-width columns when omitted. */
    columnWidthWeights?: number[];
    /** Alternating light shading on data rows. Defaults to true whenever `options` is provided. */
    zebra?: boolean;
    /** A visually distinct grand-total row appended after the data rows (same shape as a data row). */
    totalsRow?: CellValue[];
    /** Explicit page size in portrait millimetres — swapped to landscape width/height by docx
     *  because the section orientation is always LANDSCAPE in this exporter. */
    pageSize?: { widthMm: number; heightMm: number };
    /** Footer text shown centered on every page, e.g. "Demand Sheet — Clientwise". The company
     *  name and "Page X of Y" are appended automatically. */
    footerText?: string;
}

/** A ready-to-embed compressed logo — loaded differently per environment (browser `Image`/canvas
 *  for the client, `sharp` for the server) but consumed identically here. */
export type WordLogo = { dataUri: string; widthPx: number; heightPx: number };

/** The ImageRun for the compressed logo, or `[]` when unavailable — spread directly into the
 *  company-name Paragraph's `children`. Positioned as a floating image anchored to the page
 *  margin's top-left corner with no text wrapping, so it never participates in that paragraph's
 *  own layout: the company name / title paragraphs stay plain, full-width, centered text and are
 *  centered on the actual page — not shifted by the logo's presence, unlike an inline run would. */
function logoRunChildren(logo: WordLogo | null): ImageRun[] {
    if (!logo) return [];
    return [
        new ImageRun({
            type: 'jpg',
            data: logo.dataUri,
            transformation: { width: logo.widthPx, height: logo.heightPx },
            floating: {
                horizontalPosition: { relative: HorizontalPositionRelativeFrom.MARGIN, align: HorizontalPositionAlign.LEFT },
                verticalPosition: { relative: VerticalPositionRelativeFrom.MARGIN, align: VerticalPositionAlign.TOP },
                wrap: { type: TextWrappingType.NONE },
            },
        }),
    ];
}

// NOTE ON SHADING: docx's `ShadingType.SOLID` (OOXML w:val="solid") renders the cell using the
// shading *foreground* color (`color`) at 100% density — NOT `fill` — and `color` defaults to
// "auto" (black) when unset. `ShadingType.CLEAR` (w:val="clear") is the correct type for a flat
// background color: it paints `fill` directly with no foreground pattern on top. Every shaded
// cell below therefore uses CLEAR — using SOLID here is what previously rendered every shaded
// cell as solid black regardless of the intended `fill` hex.
const BORDER_GRAY = 'C7D2CC'; // hairline table borders — neutral, not brand-reactive
const FONT_FAMILY = 'Times New Roman';

/** Fallback anchors — Sarvam's own theme — used when a caller omits `brandColor`. */
const DEFAULT_BRAND_COLOR: WordBrandColor = { primary: '#037f35', dark: '#025c27', tint: '#e6f5ec' };

const toDocxHex = (hex: string) => hex.replace('#', '').toUpperCase();

/** Resolved, docx-ready (no `#`) palette derived from the active theme's three color anchors —
 *  same derivation shape as the header/table shading that used to be hardcoded per-report. */
interface WordPalette {
    brandGreen: string; // primary header band / company name / accent borders
    greenTint: string; // sub-header row / report-info label / summary card background
    zebraTint: string; // alternate data-row background
    totalsTint: string; // grand-total row background
    darkText: string; // dark-on-tint accent text (summary card values, grouped sub-header labels)
}

function resolveWordPalette(brandColor: WordBrandColor | undefined): WordPalette {
    const { primary, dark, tint } = brandColor ?? DEFAULT_BRAND_COLOR;
    return {
        brandGreen: toDocxHex(primary),
        greenTint: toDocxHex(tint),
        zebraTint: toDocxHex(mixHex(tint, '#ffffff', 0.55)),
        // Deliberately a light nudge toward `primary`, not a strong one — matches the original
        // hardcoded D7EEDB's subtlety (verified: t=0.35 renders visibly darker/oversaturated
        // than D7EEDB for Sarvam's own default colors; t=0.08 reproduces it almost exactly).
        totalsTint: toDocxHex(mixHex(tint, primary, 0.08)),
        darkText: toDocxHex(dark),
    };
}

const ALIGNMENT_MAP: Record<'left' | 'center' | 'right', (typeof AlignmentType)[keyof typeof AlignmentType]> = {
    left: AlignmentType.LEFT,
    center: AlignmentType.CENTER,
    right: AlignmentType.RIGHT,
};

/** Converts relative weights into fixed DXA (twip) column widths that sum exactly to
 *  `usableWidthTwips`. Falls back to equal widths when `weights` is omitted/mismatched. */
function computeColumnWidths(
    weights: number[] | undefined,
    count: number,
    usableWidthTwips: number
): number[] {
    const w = weights && weights.length === count ? weights : new Array(count).fill(1);
    const totalWeight = w.reduce((s, x) => s + x, 0) || count;
    const widths = w.map((x) => Math.round((x / totalWeight) * usableWidthTwips));
    const drift = usableWidthTwips - widths.reduce((s, x) => s + x, 0);
    widths[widths.length - 1] += drift; // absorb rounding error on the last column
    return widths;
}

/** Sum of column widths covered by a span starting at `fromIndex` (inclusive). */
function sumWidths(colWidths: number[], fromIndex: number, span: number): number {
    let total = 0;
    for (let i = fromIndex; i < fromIndex + span; i++) total += colWidths[i] ?? 0;
    return total;
}

function buildGroupedHeaderRows(
    groupHeaders: WordExportGroupHeader[],
    subHeaders: string[],
    colWidths: number[],
    palette: WordPalette
): TableRow[] {
    const topCells: TableCell[] = [];
    const subCells: TableCell[] = [];
    let subHeaderCursor = 0;
    let colCursor = 0;

    for (const group of groupHeaders) {
        const groupWidth = sumWidths(colWidths, colCursor, group.span);
        if (group.span > 1) {
            topCells.push(
                new TableCell({
                    columnSpan: group.span,
                    width: { size: groupWidth, type: WidthType.DXA },
                    shading: { type: ShadingType.CLEAR, fill: palette.brandGreen },
                    verticalAlign: VerticalAlign.CENTER,
                    children: [
                        new Paragraph({
                            alignment: AlignmentType.CENTER,
                            children: [new TextRun({ text: group.label, bold: true, color: 'FFFFFF', size: 17, font: FONT_FAMILY, noProof: true })],
                        }),
                    ],
                })
            );
            for (let i = 0; i < group.span; i++) {
                const label = subHeaders[subHeaderCursor++] ?? '';
                subCells.push(
                    new TableCell({
                        width: { size: colWidths[colCursor + i] ?? 0, type: WidthType.DXA },
                        shading: { type: ShadingType.CLEAR, fill: palette.greenTint },
                        verticalAlign: VerticalAlign.CENTER,
                        children: [
                            new Paragraph({
                                alignment: AlignmentType.CENTER,
                                children: [new TextRun({ text: label, bold: true, color: palette.darkText, size: 15, font: FONT_FAMILY, noProof: true })],
                            }),
                        ],
                    })
                );
            }
        } else {
            topCells.push(
                new TableCell({
                    rowSpan: 2,
                    width: { size: groupWidth, type: WidthType.DXA },
                    shading: { type: ShadingType.CLEAR, fill: palette.brandGreen },
                    verticalAlign: VerticalAlign.CENTER,
                    children: [
                        new Paragraph({
                            alignment: AlignmentType.CENTER,
                            children: [new TextRun({ text: group.label, bold: true, color: 'FFFFFF', size: 17, font: FONT_FAMILY, noProof: true })],
                        }),
                    ],
                })
            );
        }
        colCursor += group.span;
    }

    return [
        new TableRow({ tableHeader: true, children: topCells }),
        new TableRow({ tableHeader: true, children: subCells }),
    ];
}

const NO_BORDER = {
    top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

function buildInfoGrid(items: WordExportInfoItem[], palette: WordPalette): Table {
    const rows: TableRow[] = [];
    for (let i = 0; i < items.length; i += 2) {
        const pair = [items[i], items[i + 1]];
        const cells: TableCell[] = [];
        for (const item of pair) {
            if (!item) {
                cells.push(new TableCell({ children: [new Paragraph('')], borders: NO_BORDER }));
                cells.push(new TableCell({ children: [new Paragraph('')], borders: NO_BORDER }));
                continue;
            }
            cells.push(
                new TableCell({
                    shading: { type: ShadingType.CLEAR, fill: palette.greenTint },
                    verticalAlign: VerticalAlign.CENTER,
                    margins: { top: 60, bottom: 60, left: 100, right: 60 },
                    children: [
                        new Paragraph({
                            children: [new TextRun({ text: item.label.toUpperCase(), bold: true, size: 14, color: '4B5563', font: FONT_FAMILY, noProof: true })],
                        }),
                    ],
                })
            );
            cells.push(
                new TableCell({
                    shading: { type: ShadingType.CLEAR, fill: 'FFFFFF' },
                    verticalAlign: VerticalAlign.CENTER,
                    margins: { top: 60, bottom: 60, left: 100, right: 60 },
                    children: [
                        new Paragraph({
                            children: [new TextRun({ text: item.value, bold: true, size: 17, color: '111827', font: FONT_FAMILY, noProof: true })],
                        }),
                    ],
                })
            );
        }
        rows.push(new TableRow({ children: cells }));
    }
    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
            top: { style: BorderStyle.SINGLE, size: 4, color: BORDER_GRAY },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER_GRAY },
            left: { style: BorderStyle.SINGLE, size: 4, color: BORDER_GRAY },
            right: { style: BorderStyle.SINGLE, size: 4, color: BORDER_GRAY },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: BORDER_GRAY },
            insideVertical: { style: BorderStyle.SINGLE, size: 2, color: BORDER_GRAY },
        },
        rows,
    });
}

function buildSummaryCards(items: WordExportInfoItem[], palette: WordPalette): Table {
    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
            top: { style: BorderStyle.SINGLE, size: 4, color: palette.brandGreen },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: palette.brandGreen },
            left: { style: BorderStyle.SINGLE, size: 4, color: palette.brandGreen },
            right: { style: BorderStyle.SINGLE, size: 4, color: palette.brandGreen },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: palette.brandGreen },
            insideVertical: { style: BorderStyle.SINGLE, size: 4, color: palette.brandGreen },
        },
        rows: [
            new TableRow({
                children: items.map(
                    (item) =>
                        new TableCell({
                            shading: { type: ShadingType.CLEAR, fill: palette.greenTint },
                            verticalAlign: VerticalAlign.CENTER,
                            margins: { top: 100, bottom: 100, left: 80, right: 80 },
                            children: [
                                new Paragraph({
                                    alignment: AlignmentType.CENTER,
                                    children: [new TextRun({ text: item.label.toUpperCase(), bold: true, size: 13, color: '4B5563', font: FONT_FAMILY, noProof: true })],
                                }),
                                new Paragraph({
                                    alignment: AlignmentType.CENTER,
                                    children: [new TextRun({ text: item.value, bold: true, size: 22, color: palette.darkText, font: FONT_FAMILY, noProof: true })],
                                }),
                            ],
                        })
                ),
            }),
        ],
    });
}

/**
 * Builds the `docx` Document for a report export — the shared core consumed by both the
 * client-side direct export (Packer.toBlob) and the server-side queued export (Packer.toBuffer).
 * Pure function of its arguments: no I/O, no browser/server-only APIs.
 *
 * `options` is optional and additive — when omitted, output is the original flat single-header-row
 * layout used by most reports' Word export.
 *
 * `brandColor` is optional — omit it to fall back to Sarvam's own theme (`DEFAULT_BRAND_COLOR`);
 * both callers (browser `exportToWord` / server `buildWord`) pass the active ThemePreset's
 * anchors so the header/table/summary shading follows whichever theme is currently active.
 */
export function buildWordDocument(
    companyNameCaps: string,
    title: string,
    headers: CellValue[],
    rows: CellValue[][],
    options: WordExportOptions | undefined,
    logo: WordLogo | null,
    brandColor?: WordBrandColor
): Document {
    const palette = resolveWordPalette(brandColor);
    // Member-level reports append Aadhaar / Member Mobile / Co-Applicant Mobile to every
    // row — widen their rich layout (group headers, alignments, widths, totals) to match.
    options = withMemberContactWordColumns(headers.map(String), options);

    if (!options) {
        // Original layout — used by every report that doesn't pass WordExportOptions.
        const headerRow = new TableRow({
            tableHeader: true,
            children: headers.map(
                (h) =>
                    new TableCell({
                        shading: { type: ShadingType.CLEAR, fill: palette.brandGreen },
                        children: [
                            new Paragraph({
                                children: [new TextRun({ text: String(h), bold: true, color: 'FFFFFF', font: FONT_FAMILY, noProof: true })],
                            }),
                        ],
                    })
            ),
        });

        const dataRows = rows.map(
            (row) =>
                new TableRow({
                    children: row.map(
                        (cell) =>
                            new TableCell({
                                children: [new Paragraph({ children: [new TextRun({ text: String(cell ?? ''), font: FONT_FAMILY, noProof: true })] })],
                            })
                    ),
                })
        );

        return new Document({
            sections: [
                {
                    properties: {
                        page: {
                            size: {
                                orientation: PageOrientation.LANDSCAPE,
                            },
                        },
                    },
                    children: [
                        new Paragraph({
                            alignment: AlignmentType.CENTER,
                            heading: HeadingLevel.HEADING_2,
                            children: [...logoRunChildren(logo), new TextRun({ text: companyNameCaps, bold: true, font: FONT_FAMILY, noProof: true })],
                        }),
                        new Paragraph({
                            alignment: AlignmentType.CENTER,
                            heading: HeadingLevel.HEADING_3,
                            children: [new TextRun({ text: title, font: FONT_FAMILY, noProof: true })],
                        }),
                        new Paragraph({ text: '' }),
                        new Table({
                            width: { size: 100, type: WidthType.PERCENTAGE },
                            rows: [headerRow, ...dataRows],
                        }),
                    ],
                },
            ],
        });
    }

    // Rich, grouped-header layout.
    const zebra = options.zebra !== false;
    const alignments = options.columnAlignments;

    // Fixed-width columns: the whole point of grouping headers is wasted if Word is still free
    // to auto-fit every column to its own content, so every column gets an explicit DXA width
    // (proportioned by `columnWidthWeights`) and the table is pinned to `layout: FIXED`.
    const landscapeWidthTwips = options.pageSize
        ? convertMillimetersToTwip(options.pageSize.heightMm) // portrait height -> landscape width
        : convertMillimetersToTwip(297); // fallback: A4 landscape width
    const marginLeftRightTwips = 1000; // matches page.margin.left(500) + right(500) below
    const usableWidthTwips = landscapeWidthTwips - marginLeftRightTwips;
    const colWidths = computeColumnWidths(options.columnWidthWeights, headers.length, usableWidthTwips);

    const headerRows: TableRow[] =
        options.groupHeaders && options.subHeaders
            ? buildGroupedHeaderRows(options.groupHeaders, options.subHeaders, colWidths, palette)
            : [
                  new TableRow({
                      tableHeader: true,
                      children: headers.map(
                          (h, i) =>
                              new TableCell({
                                  width: { size: colWidths[i] ?? 0, type: WidthType.DXA },
                                  shading: { type: ShadingType.CLEAR, fill: palette.brandGreen },
                                  verticalAlign: VerticalAlign.CENTER,
                                  children: [
                                      new Paragraph({
                                          alignment: AlignmentType.CENTER,
                                          children: [new TextRun({ text: String(h), bold: true, color: 'FFFFFF', size: 16, font: FONT_FAMILY, noProof: true })],
                                      }),
                                  ],
                              })
                      ),
                  }),
              ];

    const dataRows = rows.map(
        (row, rowIndex) =>
            new TableRow({
                children: row.map((cell, colIndex) => {
                    const align = alignments?.[colIndex];
                    return new TableCell({
                        width: { size: colWidths[colIndex] ?? 0, type: WidthType.DXA },
                        shading: {
                            type: ShadingType.CLEAR,
                            fill: zebra && rowIndex % 2 === 1 ? palette.zebraTint : 'FFFFFF',
                        },
                        verticalAlign: VerticalAlign.CENTER,
                        margins: { top: 40, bottom: 40, left: 60, right: 60 },
                        children: [
                            new Paragraph({
                                alignment: align ? ALIGNMENT_MAP[align] : undefined,
                                children: [new TextRun({ text: String(cell ?? ''), size: 15, font: FONT_FAMILY, noProof: true })],
                            }),
                        ],
                    });
                }),
            })
    );

    if (options.totalsRow) {
        const totalsBorder = { style: BorderStyle.SINGLE, size: 12, color: palette.brandGreen };
        dataRows.push(
            new TableRow({
                children: options.totalsRow.map((cell, colIndex) => {
                    const align = alignments?.[colIndex];
                    return new TableCell({
                        width: { size: colWidths[colIndex] ?? 0, type: WidthType.DXA },
                        shading: { type: ShadingType.CLEAR, fill: palette.totalsTint },
                        verticalAlign: VerticalAlign.CENTER,
                        margins: { top: 60, bottom: 60, left: 60, right: 60 },
                        borders: { top: totalsBorder, bottom: totalsBorder },
                        children: [
                            new Paragraph({
                                alignment: align ? ALIGNMENT_MAP[align] : undefined,
                                children: [new TextRun({ text: String(cell ?? ''), bold: true, size: 16, font: FONT_FAMILY, noProof: true })],
                            }),
                        ],
                    });
                }),
            })
        );
    }

    // Title/company-name paragraphs deliberately avoid `heading: HeadingLevel.*` here (unlike the
    // fallback path above) so nothing is inherited from Word's built-in Heading style definitions
    // — every visual property is explicit.
    const bodyChildren: (Paragraph | Table)[] = [
        new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [...logoRunChildren(logo), new TextRun({ text: companyNameCaps, bold: true, color: palette.brandGreen, size: 32, font: FONT_FAMILY, noProof: true })],
        }),
        new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: title, bold: true, size: 24, color: '1F2937', font: FONT_FAMILY, noProof: true })],
        }),
        new Paragraph({ text: '' }),
    ];

    if (options.reportInfo && options.reportInfo.length > 0) {
        bodyChildren.push(buildInfoGrid(options.reportInfo, palette));
        bodyChildren.push(new Paragraph({ text: '' }));
    }

    if (options.summary && options.summary.length > 0) {
        bodyChildren.push(buildSummaryCards(options.summary, palette));
        bodyChildren.push(new Paragraph({ text: '' }));
    }

    bodyChildren.push(
        new Table({
            width: { size: usableWidthTwips, type: WidthType.DXA },
            layout: TableLayoutType.FIXED,
            columnWidths: colWidths,
            borders: {
                top: { style: BorderStyle.SINGLE, size: 4, color: BORDER_GRAY },
                bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER_GRAY },
                left: { style: BorderStyle.SINGLE, size: 4, color: BORDER_GRAY },
                right: { style: BorderStyle.SINGLE, size: 4, color: BORDER_GRAY },
                insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: BORDER_GRAY },
                insideVertical: { style: BorderStyle.SINGLE, size: 2, color: BORDER_GRAY },
            },
            rows: [...headerRows, ...dataRows],
        })
    );

    const pageSizeProps = options.pageSize
        ? {
              width: convertMillimetersToTwip(options.pageSize.widthMm),
              height: convertMillimetersToTwip(options.pageSize.heightMm),
          }
        : {};

    return new Document({
        sections: [
            {
                properties: {
                    page: {
                        size: {
                            ...pageSizeProps,
                            orientation: PageOrientation.LANDSCAPE,
                        },
                        margin: { top: 600, bottom: 600, left: 500, right: 500 },
                    },
                },
                footers: options.footerText
                    ? {
                          default: new Footer({
                              children: [
                                  new Paragraph({
                                      alignment: AlignmentType.CENTER,
                                      children: [
                                          new TextRun({ text: `${companyNameCaps} | ${options.footerText}`, size: 14, color: '6B7280', font: FONT_FAMILY, noProof: true }),
                                          new TextRun({ text: '   |   Page ', size: 14, color: '6B7280', font: FONT_FAMILY, noProof: true }),
                                          new TextRun({ children: [PageNumber.CURRENT], size: 14, color: '6B7280', font: FONT_FAMILY, noProof: true }),
                                          new TextRun({ text: ' of ', size: 14, color: '6B7280', font: FONT_FAMILY, noProof: true }),
                                          new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 14, color: '6B7280', font: FONT_FAMILY, noProof: true }),
                                      ],
                                  }),
                              ],
                          }),
                      }
                    : undefined,
                children: bodyChildren,
            },
        ],
    });
}
