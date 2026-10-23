'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Printer, Loader2, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { resolveStorageUrls } from '@/app/lib/storage-url-client';
import { getKycDocumentDataUrls } from '@/app/lib/actions/kyc-document-photos';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';

interface Document {
    id: string;
    documentType: string;
    fileUrl: string | null;
    fileName: string | null;
    fileSize: number | null;
    mimeType: string | null;
    uploadedAt: string;
}

interface KycDocumentApiResponse {
    clientId: string;
    documents: Document[];
}

interface PrintKYCDocumentsProps {
    clientId: string;
    clientName?: string;
}

export function PrintKYCDocuments({ clientId, clientName }: PrintKYCDocumentsProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [clientDocuments, setClientDocuments] = useState<Document[]>([]);
    const [coApplicantDocuments, setCoApplicantDocuments] = useState<Document[]>([]);
    const [coApplicantName, setCoApplicantName] = useState<string>('');
    const [previewHtml, setPreviewHtml] = useState<string>('');

    const { toast } = useToast();

    const fetchDocuments = async () => {
        if (!clientId) return;

        setIsLoading(true);
        try {
            // Fetch client documents
            const clientRes = await apiClient.get<KycDocumentApiResponse>(`/clients/${clientId}/kyc-documents`);
            
            // Fetch co-applicant documents
            const coApplicantRes = await apiClient.get<{ clientId: string; documents: Document[] }>(
                `/clients/${clientId}/kyc-documents?scope=co_applicant`
            );

            // Fetch co-applicant info
            try {
                const coAppRes = await apiClient.get(`/co-applicants?clientId=${clientId}`);
                if (coAppRes.success && coAppRes.data) {
                    setCoApplicantName((coAppRes.data as any).name || '');
                }
            } catch {
                // Co-applicant might not exist
            }

            setClientDocuments(clientRes.success && clientRes.data ? clientRes.data.documents : []);
            setCoApplicantDocuments(coApplicantRes.success && coApplicantRes.data ? coApplicantRes.data.documents : []);
        } catch (error) {
            console.error('Error fetching KYC documents:', error);
            toast({
                title: 'Error',
                description: 'Failed to load documents for printing',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleOpen = async () => {
        await fetchDocuments();
        setIsOpen(true);
    };

    // Regenerate the preview whenever the dialog is open and the underlying
    // documents change — getPrintHTML is async because it resolves each
    // stored fileUrl (a GCS key) to a signed URL before building the markup.
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        getPrintHTML().then((html) => {
            if (!cancelled) setPreviewHtml(html);
        });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, clientDocuments, coApplicantDocuments, clientName, coApplicantName]);

    const getDocDisplayName = (type: string) => {
        const names: Record<string, string> = {
            'client_photo': 'Member / Client Photo',
            'aadhaar_front': 'Aadhaar Card - Front',
            'aadhaar_back': 'Aadhaar Card - Back',
            'pan_card': 'PAN Card',
            'voter_id': 'Voter ID',
            'signature': 'Signature',
            'bank_passbook': 'Bank Passbook',
            'smart_card_front': 'Smart Card - Front',
            'smart_card_back': 'Smart Card - Back',
            'smart_card': 'Smart Card',
            'co_applicant_photo': 'Co-Applicant Photo',
            'co_applicant_aadhaar_front': 'Co-Applicant Aadhaar - Front',
            'co_applicant_aadhaar_back': 'Co-Applicant Aadhaar - Back',
            'co_applicant_pan_card': 'Co-Applicant PAN Card',
            'co_applicant_voter_id': 'Co-Applicant Voter ID',
            'co_applicant_signature': 'Co-Applicant Signature',
            'co_applicant_other_id': 'Co-Applicant Other ID',
        };
        return names[type] || type.replace(/_/g, ' ').toUpperCase();
    };

    const getPrintHTML = async () => {
        // Find client photo and co-applicant photo
        let clientPhoto = clientDocuments.find(doc => doc.documentType === 'client_photo');
        let coApplicantPhoto = coApplicantDocuments.find(doc => doc.documentType === 'co_applicant_photo');

        // Group Aadhar front/back in order: Client Front → Client Back → Co-App Front → Co-App Back
        let clientAadharFront = clientDocuments.find(doc => doc.documentType === 'aadhaar_front');
        let clientAadharBack = clientDocuments.find(doc => doc.documentType === 'aadhaar_back');
        let coAadharFront = coApplicantDocuments.find(doc => doc.documentType === 'co_applicant_aadhaar_front');
        let coAadharBack = coApplicantDocuments.find(doc => doc.documentType === 'co_applicant_aadhaar_back');

        // Voter ID: Client then Co-Applicant
        let clientVoterId = clientDocuments.find(doc => doc.documentType === 'voter_id');
        let coApplicantVoterId = coApplicantDocuments.find(doc => doc.documentType === 'co_applicant_voter_id');

        // PAN Card: Client then Co-Applicant
        let clientPanCard = clientDocuments.find(doc => doc.documentType === 'pan_card');
        let coApplicantPanCard = coApplicantDocuments.find(doc => doc.documentType === 'co_applicant_pan_card');

        // Smart Card (Client) and Other ID (Co-Applicant)
        let clientSmartCardFront = clientDocuments.find(doc => doc.documentType === 'smart_card_front');
        let clientSmartCardBack = clientDocuments.find(doc => doc.documentType === 'smart_card_back');
        let clientSmartCardLegacy = clientDocuments.find(doc => doc.documentType === 'smart_card');
        let coApplicantOtherId = coApplicantDocuments.find(doc => doc.documentType === 'co_applicant_other_id');

        // Bank Passbook
        let bankPassbook = clientDocuments.find(doc => doc.documentType === 'bank_passbook');

        // Remaining documents (not specifically placed)
        const placedTypes = new Set([
            'client_photo', 'co_applicant_photo',
            'aadhaar_front', 'aadhaar_back', 'co_applicant_aadhaar_front', 'co_applicant_aadhaar_back',
            'voter_id', 'co_applicant_voter_id',
            'pan_card', 'co_applicant_pan_card',
            'smart_card_front', 'smart_card_back', 'smart_card', 'co_applicant_other_id',
            'bank_passbook', 'signature', 'co_applicant_signature'
        ]);

        let remainingDocs = [...clientDocuments, ...coApplicantDocuments].filter(doc => !placedTypes.has(doc.documentType));

        // The GCS bucket is private — every fileUrl above is a bare object key.
        // Resolve them all to signed URLs up front since this HTML is written
        // into a raw print window rather than rendered through React.
        const allFileUrls = [
            clientPhoto?.fileUrl, coApplicantPhoto?.fileUrl,
            clientAadharFront?.fileUrl, clientAadharBack?.fileUrl, coAadharFront?.fileUrl, coAadharBack?.fileUrl,
            clientVoterId?.fileUrl, coApplicantVoterId?.fileUrl,
            clientPanCard?.fileUrl, coApplicantPanCard?.fileUrl,
            clientSmartCardFront?.fileUrl, clientSmartCardBack?.fileUrl, clientSmartCardLegacy?.fileUrl, coApplicantOtherId?.fileUrl,
            bankPassbook?.fileUrl,
            ...remainingDocs.map(doc => doc.fileUrl),
        ];
        // Compress each image server-side (bounded pixel size + JPEG re-encode) before
        // embedding — this print output is commonly saved as a PDF via the browser print
        // dialog, so it needs the same fix already applied to Demand Sheet/Passbook/
        // Application Form. Falls back to plain signed URLs if compression fails for a
        // given document (or throws entirely) so printing still works.
        let urlMap: Map<string, string>;
        try {
            const validKeys = allFileUrls.filter((url): url is string => !!url);
            const compressedEntries = await getKycDocumentDataUrls(validKeys);
            urlMap = new Map(compressedEntries.map(({ key, dataUrl }) => [key, dataUrl]));
            const missingKeys = validKeys.filter((key) => !urlMap.has(key));
            if (missingKeys.length > 0) {
                const fallbackMap = await resolveStorageUrls(missingKeys);
                fallbackMap.forEach((url, key) => urlMap.set(key, url));
            }
        } catch {
            urlMap = await resolveStorageUrls(allFileUrls);
        }
        const withResolvedUrl = <T extends Document | undefined>(doc: T): T =>
            doc && doc.fileUrl ? { ...doc, fileUrl: urlMap.get(doc.fileUrl) || null } : doc;

        clientPhoto = withResolvedUrl(clientPhoto);
        coApplicantPhoto = withResolvedUrl(coApplicantPhoto);
        clientAadharFront = withResolvedUrl(clientAadharFront);
        clientAadharBack = withResolvedUrl(clientAadharBack);
        coAadharFront = withResolvedUrl(coAadharFront);
        coAadharBack = withResolvedUrl(coAadharBack);
        clientVoterId = withResolvedUrl(clientVoterId);
        coApplicantVoterId = withResolvedUrl(coApplicantVoterId);
        clientPanCard = withResolvedUrl(clientPanCard);
        coApplicantPanCard = withResolvedUrl(coApplicantPanCard);
        clientSmartCardFront = withResolvedUrl(clientSmartCardFront);
        clientSmartCardBack = withResolvedUrl(clientSmartCardBack);
        clientSmartCardLegacy = withResolvedUrl(clientSmartCardLegacy);
        coApplicantOtherId = withResolvedUrl(coApplicantOtherId);
        bankPassbook = withResolvedUrl(bankPassbook);
        remainingDocs = remainingDocs.map(doc => withResolvedUrl(doc)!);

        return `<!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>KYC Documents - ${clientName || 'Member/Client'}</title>
                <style>
                    * {
                        margin: 0;
                        padding: 0;
                        box-sizing: border-box;
                    }
                    
                    body {
                        font-family: 'Times New Roman', Times, serif;
                        font-size: 10pt;
                        line-height: 1.3;
                        background: white;
                        color: black;
                        padding: 20px;
                    }
                    
                    @page {
                        size: A4;
                        margin: 10mm;
                    }
                    
                    .page-break {
                        page-break-after: always;
                    }
                    
                    .page-break:last-child {
                        page-break-after: auto;
                    }
                    
                    .container {
                        padding: 5px;
                        width: 100%;
                        max-width: 100%;
                    }
                    
                    .header-section {
                        text-align: center;
                        margin-bottom: 20px;
                        padding-bottom: 10px;
                        border-bottom: 2px solid #000;
                    }
                    
                    .header-title {
                        font-size: 16pt;
                        font-weight: bold;
                    }
                    
                    .header-subtitle {
                        font-size: 10pt;
                        color: #555;
                    }
                    
                    .photo-section {
                        margin-bottom: 25px;
                    }
                    
                    .photo-container {
                        display: flex;
                        gap: 30px;
                        justify-content: flex-start;
                        margin-bottom: 15px;
                    }
                    
                    .photo-box {
                        width: 120px;
                        text-align: center;
                    }
                    
                    .photo-box h3 {
                        font-size: 9pt;
                        font-weight: bold;
                        margin-bottom: 8px;
                        color: #333;
                    }
                    
                    .photo-frame {
                        width: 120px;
                        height: 140px;
                        border: 1px solid #000;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        background: #fafafa;
                        overflow: hidden;
                    }
                    
                    .photo-frame img {
                        width: 100%;
                        height: 100%;
                        object-fit: cover;
                    }
                    
                    .photo-placeholder {
                        padding: 40px 10px;
                        text-align: center;
                        color: #999;
                        font-size: 8pt;
                        background: #fafafa;
                    }
                    
                    .section-title {
                        font-size: 11pt;
                        font-weight: bold;
                        margin: 20px 0 12px 0;
                        padding-bottom: 3px;
                        border-bottom: 2px solid #000;
                        background: #f0f0f0;
                        padding: 6px 10px;
                    }
                    
                    .docs-section {
                        margin-bottom: 25px;
                    }
                    
                    .pair-row {
                        display: flex;
                        gap: 20px;
                        margin-bottom: 20px;
                    }
                    
                    .document-card {
                        flex: 1;
                        text-align: center;
                        border: 1px solid #ddd;
                        padding: 10px;
                        background: #fff;
                    }
                    
                    .document-label {
                        font-weight: bold;
                        margin-bottom: 8px;
                        font-size: 9pt;
                        color: #333;
                        background: #f5f5f5;
                        padding: 4px;
                    }
                    
                    .document-image {
                        width: 100%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        min-height: 200px;
                    }
                    
                    .document-image img {
                        max-width: 100%;
                        max-height: 220px;
                        object-fit: contain;
                    }
                    
                    .placeholder {
                        padding: 50px 20px;
                        text-align: center;
                        color: #999;
                        font-size: 9pt;
                        background: #fafafa;
                    }
                    
                    .single-doc {
                        max-width: 50%;
                        margin: 0 auto;
                    }
                    
                    @media print {
                        body {
                            padding: 0;
                        }
                        .photo-frame img, .document-image img {
                            break-inside: avoid;
                        }
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <!-- HEADER -->
                    <div class="header-section">
                        <div class="header-title">KYC Documents Verification Report</div>
                        <div class="header-subtitle">${clientName || 'Member/Client'} - ${coApplicantName ? `Co-Applicant: ${coApplicantName}` : ''}</div>
                    </div>

                    <!-- PHOTOS SECTION - Member/Client Photo Left, Co-Applicant Photo Right -->
                    <div class="photo-section">
                        <div class="photo-container">
                            <div class="photo-box">
                                <h3>Member / Client Photo</h3>
                                <div class="photo-frame">
                                    ${clientPhoto && clientPhoto.fileUrl ?
                                        `<img src="${clientPhoto.fileUrl}" alt="Member / Client Photo" onerror="this.outerHTML='<div class=\\'photo-placeholder\\'>Image not available</div>'" />` :
                                        `<div class="photo-placeholder">Not Available</div>`
                                    }
                                </div>
                            </div>
                            <div class="photo-box">
                                <h3>Co-Applicant Photo</h3>
                                <div class="photo-frame">
                                    ${coApplicantPhoto && coApplicantPhoto.fileUrl ? 
                                        `<img src="${coApplicantPhoto.fileUrl}" alt="Co-Applicant Photo" onerror="this.outerHTML='<div class=\\'photo-placeholder\\'>Image not available</div>'" />` : 
                                        `<div class="photo-placeholder">Not Available</div>`
                                    }
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- ROW 1 & 2: Client Aadhar Front & Back -->
                    ${(clientAadharFront || clientAadharBack) ? `
                        <div class="docs-section">
                            <div class="section-title">APPLICANT AADHAAR CARD</div>
                            <div class="pair-row">
                                ${clientAadharFront ? `
                                    <div class="document-card">
                                        <div class="document-label">FRONT SIDE</div>
                                        <div class="document-image">
                                            <img src="${clientAadharFront.fileUrl}" alt="Aadhaar Front" onerror="this.outerHTML='<div class=\\'placeholder\\'>Image not available</div>'" />
                                        </div>
                                    </div>
                                ` : '<div class="document-card"><div class="document-label">FRONT SIDE</div><div class="placeholder">Not Available</div></div>'}
                                ${clientAadharBack ? `
                                    <div class="document-card">
                                        <div class="document-label">BACK SIDE</div>
                                        <div class="document-image">
                                            <img src="${clientAadharBack.fileUrl}" alt="Aadhaar Back" onerror="this.outerHTML='<div class=\\'placeholder\\'>Image not available</div>'" />
                                        </div>
                                    </div>
                                ` : '<div class="document-card"><div class="document-label">BACK SIDE</div><div class="placeholder">Not Available</div></div>'}
                            </div>
                        </div>
                    ` : ''}

                    <!-- ROW 3 & 4: Co-Applicant Aadhar Front & Back -->
                    ${(coApplicantOtherId || coAadharBack) ? `
                        <div class="docs-section">
                            <div class="section-title">CO-APPLICANT AADHAAR CARD</div>
                            <div class="pair-row">
                                ${coApplicantOtherId ? `
                                    <div class="document-card">
                                        <div class="document-label">FRONT SIDE</div>
                                        <div class="document-image">
                                            <img src="${coApplicantOtherId.fileUrl}" alt="Co-Applicant Aadhaar Front" onerror="this.outerHTML='<div class=\\'placeholder\\'>Image not available</div>'" />
                                        </div>
                                    </div>
                                ` : '<div class="document-card"><div class="document-label">FRONT SIDE</div><div class="placeholder">Not Available</div></div>'}
                                ${coAadharBack ? `
                                    <div class="document-card">
                                        <div class="document-label">BACK SIDE</div>
                                        <div class="document-image">
                                            <img src="${coAadharBack.fileUrl}" alt="Co-Applicant Aadhaar Back" onerror="this.outerHTML='<div class=\\'placeholder\\'>Image not available</div>'" />
                                        </div>
                                    </div>
                                ` : '<div class="document-card"><div class="document-label">BACK SIDE</div><div class="placeholder">Not Available</div></div>'}
                            </div>
                        </div>
                    ` : ''}

                    <!-- ROW 5: Voter ID - Client & Co-Applicant -->
                    ${(clientVoterId || coApplicantVoterId) ? `
                        <div class="docs-section">
                            <div class="section-title">VOTER ID CARDS</div>
                            <div class="pair-row">
                                ${clientVoterId ? `
                                    <div class="document-card">
                                        <div class="document-label">APPLICANT VOTER ID</div>
                                        <div class="document-image">
                                            <img src="${clientVoterId.fileUrl}" alt="Voter ID" onerror="this.outerHTML='<div class=\\'placeholder\\'>Image not available</div>'" />
                                        </div>
                                    </div>
                                ` : '<div class="document-card"><div class="document-label">APPLICANT VOTER ID</div><div class="placeholder">Not Available</div></div>'}
                                ${coApplicantVoterId ? `
                                    <div class="document-card">
                                        <div class="document-label">CO-APPLICANT VOTER ID</div>
                                        <div class="document-image">
                                            <img src="${coApplicantVoterId.fileUrl}" alt="Co-Applicant Voter ID" onerror="this.outerHTML='<div class=\\'placeholder\\'>Image not available</div>'" />
                                        </div>
                                    </div>
                                ` : '<div class="document-card"><div class="document-label">CO-APPLICANT VOTER ID</div><div class="placeholder">Not Available</div></div>'}
                            </div>
                        </div>
                    ` : ''}

                    <!-- ROW 6: PAN Card - Client & Co-Applicant -->
                    ${(clientPanCard || coApplicantPanCard) ? `
                        <div class="docs-section">
                            <div class="section-title">PAN CARDS</div>
                            <div class="pair-row">
                                ${clientPanCard ? `
                                    <div class="document-card">
                                        <div class="document-label">APPLICANT PAN CARD</div>
                                        <div class="document-image">
                                            <img src="${clientPanCard.fileUrl}" alt="PAN Card" onerror="this.outerHTML='<div class=\\'placeholder\\'>Image not available</div>'" />
                                        </div>
                                    </div>
                                ` : '<div class="document-card"><div class="document-label">APPLICANT PAN CARD</div><div class="placeholder">Not Available</div></div>'}
                                ${coApplicantPanCard ? `
                                    <div class="document-card">
                                        <div class="document-label">CO-APPLICANT PAN CARD</div>
                                        <div class="document-image">
                                            <img src="${coApplicantPanCard.fileUrl}" alt="Co-Applicant PAN Card" onerror="this.outerHTML='<div class=\\'placeholder\\'>Image not available</div>'" />
                                        </div>
                                    </div>
                                ` : '<div class="document-card"><div class="document-label">CO-APPLICANT PAN CARD</div><div class="placeholder">Not Available</div></div>'}
                            </div>
                        </div>
                    ` : ''}

                    <!-- ROW 7: Smart Card (Client) & Other ID (Co-Applicant) -->
                    ${(clientSmartCardFront || clientSmartCardBack || clientSmartCardLegacy || coApplicantOtherId) ? `
                        <div class="docs-section">
                            <div class="section-title">ADDITIONAL IDENTIFICATION</div>
                            <div class="pair-row">
                                ${(clientSmartCardFront || clientSmartCardLegacy) ? `
                                    <div class="document-card">
                                        <div class="document-label">SMART CARD - FRONT (Applicant)</div>
                                        <div class="document-image">
                                            <img src="${(clientSmartCardFront ?? clientSmartCardLegacy)!.fileUrl}" alt="Smart Card Front" onerror="this.outerHTML='<div class=\\'placeholder\\'>Image not available</div>'" />
                                        </div>
                                    </div>
                                ` : '<div class="document-card"><div class="document-label">SMART CARD - FRONT (Applicant)</div><div class="placeholder">Not Available</div></div>'}
                                ${clientSmartCardBack ? `
                                    <div class="document-card">
                                        <div class="document-label">SMART CARD - BACK (Applicant)</div>
                                        <div class="document-image">
                                            <img src="${clientSmartCardBack.fileUrl}" alt="Smart Card Back" onerror="this.outerHTML='<div class=\\'placeholder\\'>Image not available</div>'" />
                                        </div>
                                    </div>
                                ` : '<div class="document-card"><div class="document-label">SMART CARD - BACK (Applicant)</div><div class="placeholder">Not Available</div></div>'}
                            </div>

                            ${coApplicantOtherId ? `
                                <div class="pair-row single-doc">
                                    <div class="document-card">
                                        <div class="document-label">OTHER ID (Co-Applicant)</div>
                                        <div class="document-image">
                                            <img src="${coApplicantOtherId.fileUrl}" alt="Co-Applicant Aadhar ID" onerror="this.outerHTML='<div class=\\'placeholder\\'>Image not available</div>'" />
                                        </div>
                                    </div>
                                </div>
                            ` : ''}
                        </div>
                    ` : ''}

                    <!-- Bank Passbook Section -->
                    ${bankPassbook ? `
                        <div class="docs-section">
                            <div class="section-title">BANK PASSBOOK</div>
                            <div class="pair-row single-doc">
                                <div class="document-card">
                                    <div class="document-label">BANK PASSBOOK</div>
                                    <div class="document-image">
                                        <img src="${bankPassbook.fileUrl}" alt="Bank Passbook" onerror="this.outerHTML='<div class=\\'placeholder\\'>Image not available</div>'" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    ` : ''}

                    <!-- Remaining Documents -->
                    ${remainingDocs.length > 0 ? remainingDocs.map((doc, idx) => {
                        if (idx % 2 === 0) {
                            const nextDoc = remainingDocs[idx + 1];
                            return `
                                <div class="docs-section">
                                    <div class="section-title">OTHER DOCUMENTS</div>
                                    <div class="pair-row">
                                        <div class="document-card">
                                            <div class="document-label">${getDocDisplayName(doc.documentType)}</div>
                                            <div class="document-image">
                                                <img src="${doc.fileUrl}" alt="${doc.documentType}" onerror="this.outerHTML='<div class=\\'placeholder\\'>Image not available</div>'" />
                                            </div>
                                        </div>
                                        ${nextDoc ? `
                                            <div class="document-card">
                                                <div class="document-label">${getDocDisplayName(nextDoc.documentType)}</div>
                                                <div class="document-image">
                                                    <img src="${nextDoc.fileUrl}" alt="${nextDoc.documentType}" onerror="this.outerHTML='<div class=\\'placeholder\\'>Image not available</div>'" />
                                                </div>
                                            </div>
                                        ` : '<div class="document-card"><div class="document-label">-</div><div class="placeholder">No Document</div></div>'}
                                    </div>
                                </div>
                            `;
                        }
                        return '';
                    }).join('') : ''}

                    <!-- NO DOCUMENTS MESSAGE -->
                    ${clientDocuments.length === 0 && coApplicantDocuments.length === 0 ? `
                        <div class="placeholder" style="text-align: center; padding: 40px; margin-top: 20px;">
                            No KYC documents have been uploaded for this client.
                        </div>
                    ` : ''}
                </div>
            </body>
            </html>
        `;
    };

    const handlePrint = async () => {
        // window.open must be called synchronously in the click handler or
        // popup blockers will kill it — the HTML is written in once resolved.
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            toast({
                title: 'Print failed',
                description: 'Please allow pop-ups to print',
                variant: 'destructive',
            });
            return;
        }
        printWindow.document.write('<p style="font-family:sans-serif;padding:2rem;">Preparing documents…</p>');

        const html = await getPrintHTML();

        printWindow.document.open();
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.focus();

        setTimeout(() => {
            printWindow.print();
        }, 500);
    };

    return (
        <>
            <Button
                onClick={handleOpen}
                disabled={isLoading}
                className="bg-gradient-to-r from-primary to-primary hover:from-sidebar-accent hover:to-primary text-white shadow-lg shadow-primary/30"
            >
                {isLoading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                    <Printer className="h-4 w-4 mr-2" />
                )}
                {isLoading ? 'Loading...' : 'Print KYC Report'}
            </Button>

            <Dialog open={isOpen} onOpenChange={setIsOpen}>
                <DialogContent className="max-w-[1200px] w-[95vw] max-h-[90vh] overflow-y-auto">
                    <DialogHeader className="flex flex-row items-center justify-between">
                        <DialogTitle className="text-xl font-bold flex items-center gap-2">
                            <Printer className="h-5 w-5 text-primary" />
                            KYC Documents - {clientName || 'Member/Client'}
                        </DialogTitle>
                        <Button
                            onClick={() => setIsOpen(false)}
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </DialogHeader>

                    <div className="mt-4">
                        {/* Preview Section */}
                        <div className="mb-6">
                            <div className="border rounded-lg overflow-hidden">
                                <iframe
                                    className="w-full h-[70vh] border-none"
                                    srcDoc={previewHtml}
                                    title="KYC Documents Preview"
                                />
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex justify-end gap-3">
                            <Button
                                variant="outline"
                                onClick={handlePrint}
                                className="gap-2"
                            >
                                <Printer className="h-4 w-4" />
                                Print
                            </Button>
                            <Button
                                onClick={() => setIsOpen(false)}
                                variant="ghost"
                                className="gap-2"
                            >
                                <X className="h-4 w-4" />
                                Close
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}