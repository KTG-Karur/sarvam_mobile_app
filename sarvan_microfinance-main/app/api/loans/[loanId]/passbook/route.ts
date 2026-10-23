import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { format } from 'date-fns';
import { getSignedReadUrl } from '@/app/lib/storage/gcs-client';
import { loanService } from '@/app/lib/services/loan.service';
import { compressImageBufferForPdf } from '@/app/lib/pdf/compress-image-server';
import { formatReportAmountPlain } from '@/app/lib/utils/format-amount';

export async function OPTIONS() {
    return handleCorsPreflight();
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ loanId: string }> }
) {
    return withAuth(async (req, user) => {
        try {
            const { loanId } = await params;
            const { searchParams } = new URL(req.url);
            const firstDueDateParam = searchParams.get('firstDueDate');

            if (!loanId) {
                return errorResponse('Loan ID is required', 400);
            }

            const loan = await prisma.loan.findUnique({
                where: { id: loanId },
                include: {
                    client: {
                        select: {
                            firstName: true,
                            lastName: true,
                            mobileNumber: true,
                            spouseName: true,
                            clientId: true,
                        },
                    },
                    center: {
                        select: {
                            code: true,
                            name: true,
                        },
                    },
                    branch: {
                        select: {
                            code: true,
                            name: true,
                        },
                    },
                    loanPurpose: {
                        select: { name: true },
                    },
                    loanProduct: {
                        select: {
                            productName: true,
                            numberOfDues: true,
                            interestAmount: true,
                            interestMethod: true,
                            documentCharges: true,
                            insuranceFees: true,
                            advanceSavingsAmount: true,
                            loanProductType: {
                                select: { name: true },
                            },
                            scheduleTemplates: {
                                orderBy: { installmentNo: 'asc' },
                                select: {
                                    installmentNo: true,
                                    principalAmount: true,
                                    interestAmount: true,
                                },
                            },
                        },
                    },
                    schedules: {
                        orderBy: { installmentNo: 'asc' },
                        select: {
                            installmentNo: true,
                            dueDate: true,
                            principalDue: true,
                            interestDue: true,
                        },
                    },
                },
            });

            if (!loan) {
                return errorResponse('Loan not found', 404);
            }

            // Pre-disbursement preview: no persisted schedule exists yet, but the BM
            // wants to show the auditor what the passbook will look like once the
            // First Due Date (set at Loan Index time) drives disbursement. This is a
            // pure calculation — nothing is written to the database. Falls back to the
            // loan's stored firstDueDate (set at Loan Index approval) when no explicit
            // query param is given, so Index Records can preview without replumbing it.
            const effectiveFirstDueDate =
                firstDueDateParam && /^\d{4}-\d{2}-\d{2}$/.test(firstDueDateParam)
                    ? firstDueDateParam
                    : loan.firstDueDate
                        ? format(new Date(loan.firstDueDate), 'yyyy-MM-dd')
                        : null;

            let previewSchedule: { installmentNo: number; dueDate: Date; principalDue: number; interestDue: number }[] | null = null;
            if (loan.schedules.length === 0 && effectiveFirstDueDate) {
                const computed = loanService.calculateScheduleFromFirstDueDate(
                    {
                        amount: loan.amount,
                        interestRate: loan.interestRate,
                        tenureMonths: loan.tenureMonths,
                        frequency: loan.frequency,
                    },
                    loan.loanProduct
                        ? {
                              numberOfDues: loan.loanProduct.numberOfDues,
                              interestAmount: loan.loanProduct.interestAmount,
                              interestMethod: loan.loanProduct.interestMethod,
                              documentCharges: loan.loanProduct.documentCharges,
                              insuranceFees: loan.loanProduct.insuranceFees,
                              advanceSavingsAmount: loan.loanProduct.advanceSavingsAmount,
                          }
                        : null,
                    new Date(effectiveFirstDueDate),
                    loan.loanProduct?.scheduleTemplates?.length
                        ? loan.loanProduct.scheduleTemplates
                        : undefined
                );
                previewSchedule = computed.map((item) => ({
                    installmentNo: item.installmentNo,
                    dueDate: item.dueDate,
                    principalDue: item.principalDue,
                    interestDue: item.interestDue,
                }));
            }

            const clientPhoto = await prisma.kYC.findFirst({
                where: {
                    clientId: loan.clientId,
                    documentType: 'client_photo',
                    isDeleted: false,
                    fileUrl: { not: null },
                },
                select: { fileUrl: true, mimeType: true },
                orderBy: { createdAt: 'desc' },
            });

            // fileUrl is a private GCS object key (or a legacy Supabase https:// URL) —
            // resolve to a fetchable signed URL and inline as base64 so the PDF
            // renderer (Puppeteer, no auth context) can embed it without a second fetch.
            let clientPhotoDataUri: string | null = null;
            if (clientPhoto?.fileUrl) {
                try {
                    const signedUrl = await getSignedReadUrl(clientPhoto.fileUrl);
                    const res = await fetch(signedUrl);
                    if (res.ok) {
                        const buf = Buffer.from(await res.arrayBuffer());
                        // Rendered at only 44x52px in the passbook PDF — the full-resolution
                        // camera photo is unnecessary and can be several MB uncompressed.
                        const compressed = await compressImageBufferForPdf(buf);
                        if (compressed) {
                            clientPhotoDataUri = compressed.dataUrl;
                        } else {
                            const mime = clientPhoto.mimeType || res.headers.get('content-type') || 'image/jpeg';
                            clientPhotoDataUri = `data:${mime};base64,${buf.toString('base64')}`;
                        }
                    }
                } catch (photoErr) {
                    console.error('Failed to resolve client photo for passbook:', photoErr);
                }
            }

            const isPreview = previewSchedule !== null;
            const scheduleRows = previewSchedule ?? loan.schedules;
            const disbursedDate = loan.disbursedByBMAt ?? loan.disbursedLevel1At ?? loan.createdAt;

            let runningBalance = Number(loan.amount);
            const installments = scheduleRows.map((s) => {
                const principal = Number(s.principalDue);
                const interest = Number(s.interestDue);
                runningBalance -= principal;
                return {
                    no: s.installmentNo,
                    date: format(new Date(s.dueDate), 'dd/MM/yyyy'),
                    principal: formatReportAmountPlain(principal),
                    interest: formatReportAmountPlain(interest),
                    balance: formatReportAmountPlain(Math.max(0, runningBalance)),
                };
            });

            // G-Pay / PhonePe number is set per theme in Brand settings (blank = omitted)
            const activeTheme = await prisma.themePreset.findFirst({
                where: { isActive: true },
                select: { paymentUpiNumber: true },
            });

            const responseData = {
                memberDetails: {
                    loanAmount: Number(loan.amount),
                    accountNumber: loan.loanNumber,
                    branchCode: loan.branch?.code ?? '',
                    branchName: loan.branch?.name ?? '',
                    memberName: `${loan.client.firstName} ${loan.client.lastName ?? ''}`.trim(),
                    disbursementDate: isPreview ? 'Not yet disbursed (preview)' : format(new Date(disbursedDate), 'dd/MM/yyyy'),
                    loanPurpose: loan.loanPurpose?.name ?? 'N/A',
                    centerCode: loan.center.code,
                    centerName: loan.center.name,
                    centerMemberNo: loan.client.clientId,
                    husbandName: loan.client.spouseName ?? '',
                    loanType: loan.loanProduct?.loanProductType?.name ?? 'N/A',
                    firstInstallmentDate: scheduleRows.length > 0
                        ? format(new Date(scheduleRows[0].dueDate), 'dd/MM/yyyy')
                        : '',
                    memberPhone: loan.client.mobileNumber ?? '',
                    upiNumber: activeTheme?.paymentUpiNumber?.trim() || '',
                    clientPhotoUrl: clientPhotoDataUri,
                },
                installments,
            };

            return successResponse(responseData, 'Passbook data retrieved successfully');

        } catch (error) {
            console.error('Error fetching passbook data:', error);
            return errorResponse('Failed to fetch passbook data', 500);
        }
    })(request);
}
