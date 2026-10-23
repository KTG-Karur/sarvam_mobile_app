'use client';

import { useState, useRef, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Map, Network, FolderTree, Building2, Plus, X, Download, Upload, Settings } from 'lucide-react';
import RegionPage from '@/components/masters/RegionPage';
import DivisionPage from '@/components/masters/DivisionPage';
import AreaPage from '@/components/masters/AreaPage';
import { BranchForm } from '@/components/branch/BranchForm';
import { BranchList } from '@/components/branch/BranchList';
import { DashboardFooter } from '@/components/dashboard/DashboardFooter';
import { GroupAssignmentSettings } from '@/components/hub/GroupAssignmentSettings';
import { LoanAdvanceSettings } from '@/components/hub/LoanAdvanceSettings';
import { apiClient } from '@/app/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { tokenStorage } from '@/app/lib/token-storage';
import { Branch } from '@/app/types';
import * as XLSX from 'xlsx';

interface UploadResult {
    totalUploaded: number;
    totalCreated: number;
    totalNotCreated: number;
}

function BranchSection() {
    const { canPage } = usePermission();
    const canCreateBranch = canPage('/dashboard/branch/create', 'add');
    const [isFormVisible, setIsFormVisible] = useState(false);
    const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
    const [showUploadResult, setShowUploadResult] = useState(false);
    const refreshListRef = useRef<(() => void) | null>(null);
    const formCardRef = useRef<HTMLDivElement | null>(null);
    const { toast } = useToast();

    const handleBranchCreated = () => {
        setIsFormVisible(false);
        refreshListRef.current?.();
    };

    const handleEditBranch = (branch: Branch) => {
        setEditingBranch(branch);
        setIsFormVisible(true);
        // The form card renders above the (long) branch table — when a row is
        // clicked while scrolled down into the list, the card opens off-screen
        // above the viewport and looks like the click did nothing.
        requestAnimationFrame(() => {
            formCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    };

    const handleCancel = () => {
        setIsFormVisible(false);
        setEditingBranch(null);
    };

    const handleBranchUpdated = () => {
        setIsFormVisible(false);
        setEditingBranch(null);
        refreshListRef.current?.();
    };

    const downloadTemplate = () => {
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.aoa_to_sheet([
            ['Branch Name', 'Branch Code', 'Address'],
            ['Main Branch', 'BR001', '123 Main Street'],
            ['City Branch', 'BR002', '456 City Road'],
            ['Town Branch', '', '789 Town Ave'],
        ]);
        worksheet['!cols'] = [{ wch: 25 }, { wch: 15 }, { wch: 35 }];
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Template');
        XLSX.writeFile(workbook, 'branch-template.xlsx');
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setIsUploading(true);
        try {
            const formDataObj = new FormData();
            formDataObj.append('file', file);
            const response = await apiClient.post<UploadResult>('/branches/upload', formDataObj);
            if (response.success && response.data) {
                setUploadResult(response.data);
                setShowUploadResult(true);
                refreshListRef.current?.();
                toast({ title: 'Upload Complete', description: `${response.data.totalCreated} branches created successfully.` });
            } else {
                throw new Error(response.error || 'Upload failed');
            }
        } catch (error) {
            toast({ title: 'Error', description: error instanceof Error ? error.message : 'Failed to upload file.', variant: 'destructive' });
        } finally {
            setIsUploading(false);
            if (e.target) e.target.value = '';
        }
    };

    return (
        <div className="space-y-4 sm:space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h2 className="text-lg sm:text-xl font-semibold text-foreground dark:text-white">Branch Management</h2>
                    <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                        Create, view, edit, and delete branches. Each branch must have a unique code.
                    </p>
                </div>
                {!isFormVisible && canCreateBranch && (
                    <div className="flex flex-col gap-2">
                        <Button onClick={() => setIsFormVisible(true)} size="sm" className="w-full sm:w-auto">
                            <Plus className="mr-2 h-4 w-4" />
                            Create New Branch
                        </Button>
                        <div className="flex gap-2">
                            <Button onClick={downloadTemplate} variant="outline" size="sm" className="flex-1 sm:flex-none">
                                <Download className="h-4 w-4 mr-2" />
                                Template
                            </Button>
                            <label className="flex-1 sm:flex-none h-9 px-3 rounded-lg border border-primary/30 hover:bg-green-50 dark:border-sidebar-accent dark:hover:bg-brand-green-darker flex items-center gap-2 text-sm font-medium cursor-pointer bg-white dark:bg-sidebar-accent transition-colors">
                                <Upload className="h-4 w-4" />
                                Upload Excel
                                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} disabled={isUploading} className="hidden" />
                            </label>
                        </div>
                    </div>
                )}
            </div>

            {showUploadResult && uploadResult && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 px-6 py-4 dark:border-emerald-800 dark:bg-emerald-950/30">
                    <div className="flex items-start justify-between">
                        <div className="flex-1">
                            <h3 className="font-semibold text-emerald-900 dark:text-emerald-200 flex items-center gap-2">
                                <span className="h-2 w-2 bg-emerald-600 rounded-full" />
                                Upload Result
                            </h3>
                            <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 text-sm">
                                <div>
                                    <p className="text-emerald-700 dark:text-emerald-300 font-medium">Total Uploaded</p>
                                    <p className="text-2xl font-bold text-emerald-900 dark:text-emerald-100">{uploadResult.totalUploaded}</p>
                                </div>
                                <div>
                                    <p className="text-emerald-700 dark:text-emerald-300 font-medium">Total Created</p>
                                    <p className="text-2xl font-bold text-emerald-900 dark:text-emerald-100">{uploadResult.totalCreated}</p>
                                </div>
                                <div>
                                    <p className="text-emerald-700 dark:text-emerald-300 font-medium">Total Not Created</p>
                                    <p className="text-2xl font-bold text-emerald-900 dark:text-emerald-100">{uploadResult.totalNotCreated}</p>
                                </div>
                            </div>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setShowUploadResult(false)} className="text-emerald-700 hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-900/50">✕</Button>
                    </div>
                </div>
            )}

            {isFormVisible && (
                <Card ref={formCardRef} className="border-2 border-primary/30 dark:border-sidebar-accent">
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-xl">{editingBranch ? 'Edit Branch' : 'Create New Branch'}</CardTitle>
                                <CardDescription>
                                    {editingBranch ? 'Update branch information' : 'Fill in the details to create a new branch. The branch code must be unique.'}
                                </CardDescription>
                            </div>
                            <Button variant="ghost" size="icon" onClick={handleCancel} aria-label="Close form">
                                <X className="h-5 w-5" />
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <BranchForm
                            key={editingBranch?.id ?? 'new'}
                            initialData={editingBranch || undefined}
                            onSuccess={editingBranch ? handleBranchUpdated : handleBranchCreated}
                            variant="compact"
                        />
                    </CardContent>
                </Card>
            )}

            <BranchList refreshRef={refreshListRef} onEdit={handleEditBranch} />
        </div>
    );
}

export default function HubManagement() {
    // The Settings tab (automatic group assignment) is Admin-only —
    // Area Managers can also open the Hub but must not see it.
    // tokenStorage reads localStorage, which doesn't exist during SSR — computing
    // this directly in render made the server always emit 4 tabs while the client's
    // very first render (before any effect runs) already saw the real role and
    // rendered 5, causing a hydration mismatch. Starting false (matching SSR) and
    // flipping it in an effect keeps the first client render identical to the server's.
    const [isAdmin, setIsAdmin] = useState(false);
    useEffect(() => {
        // Synchronizing with an external, browser-only system (localStorage via
        // tokenStorage) — this can't be derived during render without breaking SSR,
        // so the one-time setState here is intentional, not redundant.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setIsAdmin(tokenStorage.getUser()?.role === 'ADMIN');
    }, []);

    return (
        <div className="relative min-h-screen bg-gradient-to-br from-background via-green-50/30 to-green-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
            <div className="p-4 sm:p-6 space-y-6">
                <div>
                    <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
                        Hub Management
                    </h1>
                    <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                        Manage your organizational hierarchy — Region, Division, Area, and Branch — all in one place.
                    </p>
                </div>

                <Tabs defaultValue="region" className="w-full">
                    <TabsList className={`grid w-full ${isAdmin ? 'grid-cols-5' : 'grid-cols-4'} mb-6`}>
                        <TabsTrigger value="region" className="flex items-center gap-2 text-xs sm:text-sm">
                            <Map className="h-4 w-4" />
                            <span className="hidden sm:inline">Region</span>
                            <span className="sm:hidden">Region</span>
                        </TabsTrigger>
                        <TabsTrigger value="division" className="flex items-center gap-2 text-xs sm:text-sm">
                            <Network className="h-4 w-4" />
                            <span className="hidden sm:inline">Division</span>
                            <span className="sm:hidden">Division</span>
                        </TabsTrigger>
                        <TabsTrigger value="area" className="flex items-center gap-2 text-xs sm:text-sm">
                            <FolderTree className="h-4 w-4" />
                            <span className="hidden sm:inline">Area</span>
                            <span className="sm:hidden">Area</span>
                        </TabsTrigger>
                        <TabsTrigger value="branch" className="flex items-center gap-2 text-xs sm:text-sm">
                            <Building2 className="h-4 w-4" />
                            <span className="hidden sm:inline">Branch</span>
                            <span className="sm:hidden">Branch</span>
                        </TabsTrigger>
                        {isAdmin && (
                            <TabsTrigger value="settings" className="flex items-center gap-2 text-xs sm:text-sm">
                                <Settings className="h-4 w-4" />
                                <span className="hidden sm:inline">Settings</span>
                                <span className="sm:hidden">Settings</span>
                            </TabsTrigger>
                        )}
                    </TabsList>

                    <TabsContent value="region">
                        <RegionPage />
                    </TabsContent>

                    <TabsContent value="division">
                        <DivisionPage />
                    </TabsContent>

                    <TabsContent value="area">
                        <AreaPage />
                    </TabsContent>

                    <TabsContent value="branch">
                        <BranchSection />
                    </TabsContent>

                    {isAdmin && (
                        <TabsContent value="settings">
                            <LoanAdvanceSettings />
                            <GroupAssignmentSettings />
                        </TabsContent>
                    )}
                </Tabs>

                <DashboardFooter />
            </div>
        </div>
    );
}
