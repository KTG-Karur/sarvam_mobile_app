'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Upload, X, FileText, Image as ImageIcon, Loader2, Camera, Clipboard, Search, ImageDown } from 'lucide-react';
import { CameraCapture } from '@/components/ui/CameraCapture';
import { compressImage, type CompressionResult } from '@/app/lib/image-compress';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';
import {
    CLIENT_KYC_DOCUMENT_TYPES,
    SupportedKycDocumentType,
    appendKycUploadOwnerAndCategory,
} from '@/components/client/kyc-document-types';
import { DateInput } from '@/components/ui/date-input';

interface PreselectedClientInfo {
    id: string;
    clientId: string;
    name?: string;
    createdAt?: string;
}

interface KYCDocumentFormProps {
    onDocumentUploaded?: (clientId: string) => void;
    onClientChange?: (clientId: string, clientName?: string) => void;
    preselectedClient?: PreselectedClientInfo;
    permissionPage?: string;
    uploadedDocumentTypes?: string[];
}

interface Branch {
    id: string;
    name: string;
    code: string;
}

interface Client {
    id: string;
    clientId: string;
    firstName: string;
    lastName: string;
    centerId: string | null;
    createdAt?: string;
}

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const DEFAULT_ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png'];

export function KYCDocumentForm({ onDocumentUploaded, onClientChange, preselectedClient, permissionPage, uploadedDocumentTypes = [] }: KYCDocumentFormProps) {
    const { canPage } = usePermission();
    const canEditClient = canPage(permissionPage ?? '/dashboard/client/kyc-documents', 'edit');
    const { toast } = useToast();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [cameraOpen, setCameraOpen] = useState(false);

    const isControlled = !!preselectedClient;

    const userRole = useMemo(() => tokenStorage.getUser()?.role, []);
    const isAdmin = userRole === 'ADMIN' || userRole === 'ADMIN_NON_HO_BRANCH_SWITCH';

    const [branches, setBranches] = useState<Branch[]>([]);
    const [selectedBranch, setSelectedBranch] = useState('');
    const [isLoadingBranches, setIsLoadingBranches] = useState(false);

    const [clients, setClients] = useState<Client[]>([]);
    const [isLoadingClients, setIsLoadingClients] = useState(false);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [selectedClient, setSelectedClient] = useState(preselectedClient?.clientId ?? '');
    const [selectedDocumentType, setSelectedDocumentType] = useState<SupportedKycDocumentType | ''>('');
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [filePreview, setFilePreview] = useState<string | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [isCompressing, setIsCompressing] = useState(false);
    const [compressionResult, setCompressionResult] = useState<CompressionResult | null>(null);

    // Sync when preselectedClient changes
    useEffect(() => {
        if (preselectedClient?.clientId) {
            setSelectedClient(preselectedClient.clientId);
        }
    }, [preselectedClient?.clientId]);

    // Admin: load branches on mount
    useEffect(() => {
        if (isAdmin && !isControlled) void fetchBranches();
    }, [isAdmin, isControlled]);

    // Debounce search
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => setDebouncedSearch(search), 350);
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [search]);

    // Global paste event listener for Ctrl+V support
    useEffect(() => {
        const onPaste = async (e: ClipboardEvent) => {
            if (!e.clipboardData) return;
            const items = Array.from(e.clipboardData.items);
            const imageItem = items.find((item) => item.type.startsWith('image/'));
            if (!imageItem) return;
            const file = imageItem.getAsFile();
            if (!file) return;
            setIsCompressing(true);
            const result = await compressImage(file, selectedDocumentType || 'other');
            setIsCompressing(false);
            setCompressionResult(result);
            setSelectedFile(result.compressedFile);
            setFilePreview(result.previewUrl);
        };
        document.addEventListener('paste', onPaste);
        return () => document.removeEventListener('paste', onPaste);
    }, []);

    // Fetch clients whenever search or branch selection changes
    const fetchClients = useCallback(async () => {
        if (isControlled) return;
        if (isAdmin && !selectedBranch) {
            setClients([]);
            return;
        }
        setIsLoadingClients(true);
        try {
            const params = new URLSearchParams();
            params.set('allBranch', 'true');
            params.set('includeInactive', 'false');
            params.set('pageSize', '200');
            if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
            if (isAdmin && selectedBranch) params.set('branchId', selectedBranch);
            const result = await apiClient.get<{ clients: Client[] }>(`/clients?${params.toString()}`);
            if (result.success && result.data) {
                const list = Array.isArray(result.data) ? result.data : (result.data.clients || []);
                setClients(list as Client[]);
                if (!list.some((c: Client) => c.clientId === selectedClient)) {
                    setSelectedClient('');
                    onClientChange?.('');
                }
            } else {
                setClients([]);
            }
        } catch {
            setClients([]);
        } finally {
            setIsLoadingClients(false);
        }
    }, [debouncedSearch, selectedBranch, isAdmin, isControlled]);

    useEffect(() => { void fetchClients(); }, [fetchClients]);

    const currentClient = useMemo(
        () => clients.find((client) => client.clientId === selectedClient) || null,
        [clients, selectedClient],
    );

    const fetchBranches = async () => {
        setIsLoadingBranches(true);
        try {
            const result = await apiClient.get<Branch[]>('/branches');
            setBranches(Array.isArray(result.data) ? result.data : []);
        } catch {
            setBranches([]);
        } finally {
            setIsLoadingBranches(false);
        }
    };

    const handleClientChange = (value: string) => {
        setSelectedClient(value);
        const client = clients.find((c) => c.clientId === value);
        const name = client ? `${client.firstName} ${client.lastName}` : undefined;
        onClientChange?.(value, name);
    };

    const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) {
            return;
        }

        if (!selectedDocumentType) {
            toast({
                title: 'Document type required',
                description: 'Please select the document type before choosing a file.',
                variant: 'destructive',
            });
            return;
        }

        if (file.size > MAX_FILE_SIZE_BYTES) {
            toast({
                title: 'File too large',
                description: 'Please select an image smaller than 5MB.',
                variant: 'destructive',
            });
            return;
        }

        const selectedDocumentConfig = CLIENT_KYC_DOCUMENT_TYPES.find(
            (type) => type.value === selectedDocumentType,
        );
        const allowedTypes = selectedDocumentConfig?.accept.split(',') || DEFAULT_ALLOWED_TYPES;

        if (!allowedTypes.includes(file.type)) {
            toast({
                title: 'Invalid file type',
                description: 'Please select a supported file type for the chosen document.',
                variant: 'destructive',
            });
            return;
        }

        void handleFileSelectWithCompression(file);
    };

    const handleCameraCapture = async (file: File) => {
        setIsCompressing(true);
        const result = await compressImage(file, selectedDocumentType || 'portrait');
        setIsCompressing(false);
        setCompressionResult(result);
        setSelectedFile(result.compressedFile);
        setFilePreview(result.previewUrl);
    };

    const handleFileSelectWithCompression = async (file: File) => {
        if (!file.type.startsWith('image/')) {
            // Non-image files (PDF etc.) — skip compression
            setCompressionResult(null);
            setSelectedFile(file);
            const reader = new FileReader();
            reader.onloadend = () => setFilePreview(reader.result as string);
            reader.readAsDataURL(file);
            return;
        }
        setIsCompressing(true);
        const result = await compressImage(file, selectedDocumentType || 'other');
        setIsCompressing(false);
        setCompressionResult(result);
        setSelectedFile(result.compressedFile);
        setFilePreview(result.previewUrl);
    };

    const handlePasteFromClipboard = async () => {
        if (!selectedDocumentType) {
            toast({
                title: 'Document type required',
                description: 'Please select the document type before pasting.',
                variant: 'destructive',
            });
            return;
        }
        try {
            const clipboardItems = await navigator.clipboard.read();
            for (const item of clipboardItems) {
                const imageType = item.types.find((t) => t.startsWith('image/'));
                if (imageType) {
                    const blob = await item.getType(imageType);
                    const file = new File([blob], `pasted_photo_${Date.now()}.png`, { type: imageType });
                    setIsCompressing(true);
                    const result = await compressImage(file, selectedDocumentType || 'other');
                    setIsCompressing(false);
                    setCompressionResult(result);
                    setSelectedFile(result.compressedFile);
                    setFilePreview(result.previewUrl);
                    return;
                }
            }
            toast({
                title: 'No image found',
                description: 'Clipboard does not contain an image. Copy an image first.',
                variant: 'destructive',
            });
        } catch {
            toast({
                title: 'Paste failed',
                description: 'Could not access clipboard. Please allow clipboard permission or use Ctrl+V.',
                variant: 'destructive',
            });
        }
    };

    const handleFileDrop = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (!file || !fileInputRef.current) {
            return;
        }

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        fileInputRef.current.files = dataTransfer.files;
        handleFileSelect({ target: fileInputRef.current } as React.ChangeEvent<HTMLInputElement>);
    };

    const handleUpload = async () => {
        if (!selectedClient) {
            toast({
                title: 'Selection required',
                description: 'Please select a member/client.',
                variant: 'destructive',
            });
            return;
        }

        if (!selectedDocumentType) {
            toast({
                title: 'Document type required',
                description: 'Please select a document type.',
                variant: 'destructive',
            });
            return;
        }

        if (!selectedFile) {
            toast({
                title: 'File required',
                description: 'Please select a file to upload.',
                variant: 'destructive',
            });
            return;
        }

        setIsUploading(true);
        try {
            const formData = new FormData();
            formData.append('clientId', selectedClient);
            formData.append('documentType', selectedDocumentType);
            formData.append('file', selectedFile);
            appendKycUploadOwnerAndCategory(formData, selectedDocumentType);

            const response = await fetch('/api/kyc/aadhaar/upload', {
                method: 'POST',
                body: formData,
            });

            const result = await response.json();
            if (!response.ok || !result?.success) {
                throw new Error(result?.error || result?.message || 'Failed to upload document');
            }

            toast({
                title: 'Document uploaded',
                description: `${selectedFile.name} uploaded successfully.`,
            });

            handleReset(false);
            onDocumentUploaded?.(selectedClient);
        } catch (error) {
            console.error('KYC upload error:', error);
            toast({
                title: 'Upload failed',
                description: error instanceof Error ? error.message : 'Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsUploading(false);
        }
    };

    const handleReset = (clearClient = true) => {
        if (clearClient) {
            if (isAdmin) setSelectedBranch('');
            setSearch('');
            setSelectedClient('');
            onClientChange?.('');
        }

        setSelectedDocumentType('');
        setSelectedFile(null);
        setFilePreview(null);
        setCompressionResult(null);
        setIsCompressing(false);

        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const formatJoiningDate = (value?: string) => {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return date.toISOString().split('T')[0];
    };

    return (
        <div className="space-y-6">
            {!isControlled && (
                <>
                    {isAdmin && (
                        <div className="space-y-2">
                            <Label htmlFor="branch" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                Branch Name <span className="text-red-500">*</span>
                            </Label>
                            <Select value={selectedBranch} onValueChange={setSelectedBranch} disabled={isLoadingBranches || isUploading}>
                                <SelectTrigger
                                    id="branch"
                                    className={cn(
                                        'h-11 w-full border border-primary/30 text-sm font-medium',
                                        'bg-green-50 hover:border-primary focus:border-primary',
                                        'dark:bg-brand-green-darker dark:border-sidebar-accent',
                                        (isLoadingBranches || isUploading) && 'opacity-50 cursor-not-allowed',
                                    )}
                                >
                                    <SelectValue placeholder={isLoadingBranches ? 'Loading branches...' : '-- SELECT --'} />
                                </SelectTrigger>
                                <SelectContent>
                                    {branches.length > 0 ? (
                                        branches.map((branch) => (
                                            <SelectItem key={branch.id} value={branch.id}>
                                                {branch.code} - {branch.name}
                                            </SelectItem>
                                        ))
                                    ) : (
                                        <SelectItem value="no-branches" disabled>
                                            No branches available
                                        </SelectItem>
                                    )}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    <div className="space-y-2">
                        <Label htmlFor="clientSearch" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                            Search Client
                        </Label>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                            <input
                                id="clientSearch"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search by name, client ID or phone…"
                                disabled={isAdmin && !selectedBranch}
                                className={cn(
                                    'h-11 w-full pl-9 rounded-md border border-primary/30 text-sm',
                                    'bg-green-50 hover:border-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30',
                                    'dark:bg-brand-green-darker dark:border-sidebar-accent dark:text-slate-100',
                                    isAdmin && !selectedBranch && 'opacity-50 cursor-not-allowed',
                                )}
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="client" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                            Client Name <span className="text-red-500">*</span>
                        </Label>
                        <Select
                            value={selectedClient}
                            onValueChange={handleClientChange}
                            disabled={isLoadingClients || isUploading || (isAdmin && !selectedBranch)}
                        >
                    <SelectTrigger
                        id="client"
                        className={cn(
                            'h-11 w-full border border-primary/30 text-sm font-medium',
                            'bg-green-50 hover:border-primary focus:border-primary',
                            'dark:bg-brand-green-darker dark:border-sidebar-accent',
                            (isLoadingClients || isUploading || (isAdmin && !selectedBranch)) && 'opacity-50 cursor-not-allowed',
                        )}
                    >
                        <SelectValue
                            placeholder={
                                isLoadingClients
                                    ? 'Loading clients…'
                                    : isAdmin && !selectedBranch
                                        ? 'Select branch first'
                                        : clients.length === 0
                                            ? 'No clients found'
                                            : '-- SELECT --'
                            }
                        />
                    </SelectTrigger>
                    <SelectContent>
                        {clients.length > 0 ? (
                            clients.map((client) => (
                                <SelectItem key={client.id} value={client.clientId}>
                                    {client.clientId} — {client.firstName} {client.lastName}
                                    {!client.centerId && <span className="ml-1 text-amber-600 text-xs"> ⚠ No center</span>}
                                </SelectItem>
                            ))
                        ) : (
                            <SelectItem value="no-clients" disabled>
                                No clients found
                            </SelectItem>
                        )}
                    </SelectContent>
                </Select>
                {clients.length > 0 && !isLoadingClients && (
                    <p className="text-xs text-slate-500">{clients.length} client{clients.length !== 1 ? 's' : ''} found{search ? ` for "${search}"` : ''}</p>
                )}
                    </div>
                </>
            )}

            <div className="space-y-2">
                <Label htmlFor="clientId" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                    Client Id
                </Label>
                <Input
                    id="clientId"
                    value={selectedClient || ''}
                    readOnly
                    className={cn(
                        'h-11 w-full border border-primary/30 text-sm font-medium',
                        'bg-brand-green-tint dark:bg-sidebar-accent dark:border-sidebar-accent',
                        'cursor-not-allowed',
                    )}
                />
            </div>

            <div className="space-y-2">
                <Label htmlFor="dateOfJoining" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                    Date of Joining
                </Label>
                <DateInput
                    id="dateOfJoining"
                    value={isControlled ? formatJoiningDate(preselectedClient?.createdAt) : formatJoiningDate(currentClient?.createdAt)}
                    readOnly
                    className={cn(
                        'h-11 w-full border border-primary/30 text-sm font-medium',
                        'bg-brand-green-tint dark:bg-sidebar-accent dark:border-sidebar-accent',
                        'cursor-not-allowed',
                    )}
                />
            </div>

            <div className="space-y-2">
                <Label htmlFor="documentType" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                    Document Name <span className="text-red-500">*</span>
                </Label>
                <Select
                    value={selectedDocumentType}
                    onValueChange={(value) => setSelectedDocumentType(value as SupportedKycDocumentType)}
                    disabled={isUploading}
                >
                    <SelectTrigger
                        id="documentType"
                        className={cn(
                            'h-11 w-full border border-primary/30 text-sm font-medium',
                            'bg-green-50 hover:border-primary focus:border-primary',
                            'dark:bg-brand-green-darker dark:border-sidebar-accent',
                            isUploading && 'opacity-50 cursor-not-allowed',
                        )}
                    >
                        <SelectValue placeholder="-- SELECT --" />
                    </SelectTrigger>
                    <SelectContent>
                        {CLIENT_KYC_DOCUMENT_TYPES.filter(
                            (type) => !uploadedDocumentTypes.includes(type.value)
                        ).map((type) => (
                            <SelectItem key={type.value} value={type.value}>
                                {type.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-2">
                <Label htmlFor="documentImage" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                    Document Image <span className="text-red-500">*</span>
                </Label>
                <div
                    className={cn(
                        'relative border-2 border-dashed rounded-lg p-6 transition-colors',
                        'border-primary/30 hover:border-primary dark:border-sidebar-accent dark:hover:border-primary',
                        'bg-green-50 dark:bg-brand-green-darker/50',
                    )}
                    onDrop={handleFileDrop}
                    onDragOver={(event) => event.preventDefault()}
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        id="documentImage"
                        accept={
                            selectedDocumentType
                                ? CLIENT_KYC_DOCUMENT_TYPES.find((type) => type.value === selectedDocumentType)?.accept
                                : 'image/jpeg,image/jpg,image/png'
                        }
                        onChange={handleFileSelect}
                        className="hidden"
                    />

                    {/* ── Compressing indicator ──────────────────────────────── */}
                    {isCompressing && (
                        <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 mb-2">
                            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                            Optimising image… please wait
                        </div>
                    )}

                    {selectedFile ? (
                        <div className="space-y-3">
                            {filePreview && (
                                <div className="relative w-full h-48 rounded-lg overflow-hidden bg-brand-green-tint dark:bg-sidebar-accent">
                                    <img src={filePreview} alt="Preview" className="w-full h-full object-contain" />
                                </div>
                            )}

                            {/* ── Compression stats ──────────────────────────────── */}
                            {compressionResult?.wasCompressed && (
                                <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                                    <div className="mb-1 flex items-center gap-1 font-semibold">
                                        <ImageDown className="h-3.5 w-3.5 shrink-0" />
                                        Image optimised
                                    </div>
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-4">
                                        <span className="text-blue-600">Original</span>
                                        <span className="font-medium">{compressionResult.originalSizeLabel}</span>
                                        <span className="text-blue-600">Compressed</span>
                                        <span className="font-medium">{compressionResult.compressedSizeLabel}</span>
                                        <span className="text-blue-600">Saved</span>
                                        <span className="font-medium text-green-700">{compressionResult.reductionPercent}%</span>
                                        {compressionResult.dimensions.width > 0 && (
                                            <>
                                                <span className="text-blue-600">Dimensions</span>
                                                <span className="font-medium">
                                                    {compressionResult.dimensions.width} × {compressionResult.dimensions.height} px
                                                </span>
                                            </>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div className="flex items-center justify-between p-3 bg-white dark:bg-sidebar-accent rounded-lg border border-primary/20 dark:border-sidebar-accent">
                                <div className="flex items-center gap-3">
                                    {selectedFile.type === 'application/pdf' ? (
                                        <FileText className="h-8 w-8 text-red-500" />
                                    ) : (
                                        <ImageIcon className="h-8 w-8 text-primary" />
                                    )}
                                    <div>
                                        <p className="text-sm font-medium text-foreground dark:text-slate-100">{selectedFile.name}</p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">
                                            {(selectedFile.size / 1024).toFixed(2)} KB
                                        </p>
                                    </div>
                                </div>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => {
                                        setSelectedFile(null);
                                        setFilePreview(null);
                                        setCompressionResult(null);
                                        if (fileInputRef.current) {
                                            fileInputRef.current.value = '';
                                        }
                                    }}
                                    className="h-8 w-8 text-slate-500 hover:text-red-600"
                                    disabled={isUploading}
                                >
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center">
                            <Upload className="mx-auto h-12 w-12 text-slate-400" />
                            <div className="mt-4 flex items-center justify-center gap-3 flex-wrap">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => fileInputRef.current?.click()}
                                    className="text-sm font-medium"
                                    disabled={isUploading}
                                >
                                    Choose File
                                </Button>
                                <span className="text-xs text-slate-400">or</span>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setCameraOpen(true)}
                                    className="text-sm font-medium gap-2"
                                    disabled={isUploading}
                                >
                                    <Camera className="h-4 w-4" />
                                    Take Photo
                                </Button>
                                <span className="text-xs text-slate-400">or</span>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={handlePasteFromClipboard}
                                    className="text-sm font-medium gap-2"
                                    disabled={isUploading}
                                >
                                    <Clipboard className="h-4 w-4" />
                                    Paste Photo
                                </Button>
                            </div>
                            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">or drag and drop / press Ctrl+V to paste</p>
                            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                                JPG, PNG{selectedDocumentType === 'bank_passbook' ? ' or PDF' : ''} (max 5MB)
                            </p>
                        </div>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-3 pt-4">
                <Button
                    type="button"
                    onClick={handleUpload}
                    disabled={!canEditClient || isUploading || isCompressing}
                    className="h-10 px-6 text-sm font-semibold bg-primary hover:bg-primary text-white"
                >
                    {isUploading ? (
                        <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Uploading...
                        </>
                    ) : (
                        <>
                            <Upload className="h-4 w-4 mr-2" />
                            Upload
                        </>
                    )}
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleReset(true)}
                    disabled={isUploading}
                    className="h-10 px-5 text-sm font-semibold border-primary/30 text-sidebar-accent hover:border-red-300 hover:text-red-600 hover:bg-red-50 dark:border-sidebar-accent dark:text-slate-200"
                >
                    Reset
                </Button>
            </div>
        <CameraCapture
            open={cameraOpen}
            onClose={() => setCameraOpen(false)}
            onCapture={handleCameraCapture}
            label="Document"
        />
        </div>
    );
}
