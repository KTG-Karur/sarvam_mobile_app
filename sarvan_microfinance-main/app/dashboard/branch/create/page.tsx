'use client';

import { useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, X, Download, Upload } from 'lucide-react';
import { BranchForm } from '@/components/branch/BranchForm';
import { BranchList } from '@/components/branch/BranchList';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { Branch } from '@/app/types';
import * as XLSX from 'xlsx';
import { apiClient } from '@/app/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';

interface UploadResult {
  totalUploaded: number;
  totalCreated: number;
  totalNotCreated: number;
}

export default function CreateBranchPage() {
  const { canPage } = usePermission();
  const canCreateBranch = canPage('/dashboard/branch/create', 'add');
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [showUploadResult, setShowUploadResult] = useState(false);
  const refreshListRef = useRef<(() => void) | null>(null);
  const { toast } = useToast();

  const handleBranchCreated = () => {
    setIsFormVisible(false);
    if (refreshListRef.current) {
      refreshListRef.current();
    }
  };

  const handleEditBranch = (branch: Branch) => {
    setEditingBranch(branch);
    setIsFormVisible(true);
  };

  const handleCancel = () => {
    setIsFormVisible(false);
    setEditingBranch(null);
  };

  const handleBranchUpdated = () => {
    setIsFormVisible(false);
    setEditingBranch(null);
    if (refreshListRef.current) {
      refreshListRef.current();
    }
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
        if (refreshListRef.current) {
          refreshListRef.current();
        }

        toast({
          title: 'Upload Complete',
          description: `${response.data.totalCreated} branches created successfully.`,
        });
      } else {
        throw new Error(response.error || 'Upload failed');
      }
    } catch (error) {
      console.error('Error uploading file:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to upload file.',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
      if (e.target) e.target.value = '';
    }
  };

  return (
    <ProtectedRoute requiredRoles={['ADMIN']}>
      <div className="space-y-4 sm:space-y-6 pt-3 sm:pt-4 md:pt-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
              Branch Management
            </h1>
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
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleFileUpload}
                    disabled={isUploading}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Upload Result Alert */}
        {showUploadResult && uploadResult && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 px-6 py-4 dark:border-emerald-800 dark:bg-emerald-950/30 backdrop-blur-xl">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h3 className="font-semibold text-emerald-900 dark:text-emerald-200 flex items-center gap-2">
                  <span className="h-2 w-2 bg-emerald-600 rounded-full"></span>
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
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowUploadResult(false)}
                className="text-emerald-700 hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
              >
                ✕
              </Button>
            </div>
          </div>
        )}

        {/* Create/Edit Form */}
        {isFormVisible && (
          <Card className="border-2 border-primary/30 dark:border-sidebar-accent">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-xl">
                    {editingBranch ? 'Edit Branch' : 'Create New Branch'}
                  </CardTitle>
                  <CardDescription>
                    {editingBranch
                      ? 'Update branch information'
                      : 'Fill in the details to create a new branch. The branch code must be unique.'}
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleCancel}
                  aria-label="Close form"
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <BranchForm
                initialData={editingBranch || undefined}
                onSuccess={editingBranch ? handleBranchUpdated : handleBranchCreated}
                variant="compact"
              />
            </CardContent>
          </Card>
        )}

        {/* Branch List */}
        <BranchList
          refreshRef={refreshListRef}
          onEdit={handleEditBranch}
        />
      </div>
    </ProtectedRoute>
  );
}
