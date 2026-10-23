// components/masters/EconomicActivityPage.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { Badge } from '@/components/ui/badge';
import {
    Plus,
    Edit,
    Trash2,
    Loader2,
    Building2,
    Save,
    RotateCcw,
    ChevronLeft,
    ChevronRight,
    Search,
    Upload,
    Download
} from 'lucide-react';
import * as XLSX from 'xlsx';

interface EconomicActivityType {
    id: string;
    typeId: string;
    name: string;
}

interface EconomicActivity {
    id: string;
    activityId: string;
    name: string;
    economicActivityTypeId: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
    economicActivityType?: EconomicActivityType;
    _count?: {
        clients: number;
    };
}

interface EconomicActivityRow {
    id: string;
    activityId: string;
    name: string;
    activityTypeId: string;
    activityTypeName: string;
    status: string;
    clientCount: number;
}

interface UploadResult {
    totalUploaded: number;
    totalCreated: number;
    totalNotCreated: number;
}

export default function EconomicActivityPage() {
    const [activities, setActivities] = useState<EconomicActivityRow[]>([]);
    const [activityTypes, setActivityTypes] = useState<EconomicActivityType[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [editingActivity, setEditingActivity] = useState<EconomicActivity | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        economicActivityTypeId: ''
    });
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedTypeId, setSelectedTypeId] = useState('all');
    const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
    const [showUploadResult, setShowUploadResult] = useState(false);

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage] = useState(10);
    const [totalCount, setTotalCount] = useState(0);

    const { toast } = useToast();

    const fetchActivityTypes = useCallback(async () => {
        try {
            const result = await apiClient.get<EconomicActivityType[]>('/economic-activity-types');
            if (result.success && result.data) {
                setActivityTypes(result.data);
            }
        } catch (error) {
            console.error('Error fetching activity types:', error);
        }
    }, []);

    const fetchActivities = useCallback(async () => {
        setIsLoading(true);
        try {
            let url = '/economic-activities?includeType=true&includeInactive=false';
            if (searchTerm) {
                url += `&search=${encodeURIComponent(searchTerm)}`;
            }
            if (selectedTypeId && selectedTypeId !== 'all') {
                url += `&activityTypeId=${selectedTypeId}`;
            }

            const result = await apiClient.get<EconomicActivity[]>(url);
            if (result.success && result.data) {
                const rows: EconomicActivityRow[] = result.data.map((a) => ({
                    id: a.id,
                    activityId: a.activityId,
                    name: a.name,
                    activityTypeId: a.economicActivityTypeId,
                    activityTypeName: a.economicActivityType?.name || 'Not Set',
                    status: a.isActive ? 'Active' : 'Inactive',
                    clientCount: a._count?.clients || 0,
                }));
                setActivities(rows);
                setTotalCount(rows.length);
                setCurrentPage(1);
            }
        } catch (error) {
            console.error('Error fetching activities:', error);
            toast({
                title: 'Error',
                description: 'Failed to load economic activities.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    }, [toast, searchTerm, selectedTypeId]);

    useEffect(() => {
        fetchActivityTypes();
    }, [fetchActivityTypes]);

    useEffect(() => {
        fetchActivities();
    }, [fetchActivities]);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        fetchActivities();
    };

    const handleTypeFilterChange = (value: string) => {
        setSelectedTypeId(value);
        setCurrentPage(1);
    };

    const handleOpenForm = (activity?: EconomicActivity) => {
        if (activity) {
            setEditingActivity(activity);
            setFormData({
                name: activity.name,
                economicActivityTypeId: activity.economicActivityTypeId
            });
        } else {
            setEditingActivity(null);
            setFormData({ name: '', economicActivityTypeId: '' });
        }
        setShowForm(true);
    };

    const handleCloseForm = () => {
        setShowForm(false);
        setEditingActivity(null);
        setFormData({ name: '', economicActivityTypeId: '' });
    };

    const handleSave = async () => {
        if (!formData.name.trim()) {
            toast({
                title: 'Validation Error',
                description: 'Activity name is required.',
                variant: 'destructive',
            });
            return;
        }

        if (!formData.economicActivityTypeId) {
            toast({
                title: 'Validation Error',
                description: 'Activity type is required.',
                variant: 'destructive',
            });
            return;
        }

        setIsSaving(true);
        try {
            if (editingActivity) {
                const result = await apiClient.put('/economic-activities', {
                    id: editingActivity.id,
                    name: formData.name.trim(),
                    economicActivityTypeId: formData.economicActivityTypeId,
                });
                if (result.success) {
                    toast({
                        title: 'Success',
                        description: 'Economic activity updated successfully.',
                    });
                    handleCloseForm();
                    fetchActivities();
                } else {
                    throw new Error(result.error || 'Update failed');
                }
            } else {
                const result = await apiClient.post('/economic-activities', {
                    name: formData.name.trim(),
                    economicActivityTypeId: formData.economicActivityTypeId,
                });
                if (result.success) {
                    toast({
                        title: 'Success',
                        description: 'Economic activity created successfully.',
                    });
                    handleCloseForm();
                    fetchActivities();
                } else {
                    throw new Error(result.error || 'Creation failed');
                }
            }
        } catch (error) {
            console.error('Error saving economic activity:', error);
            toast({
                title: 'Error',
                description: error instanceof Error ? error.message : 'Failed to save economic activity.',
                variant: 'destructive',
            });
        } finally {
            setIsSaving(false);
        }
    };

    const handleReset = () => {
        if (editingActivity) {
            setFormData({
                name: editingActivity.name,
                economicActivityTypeId: editingActivity.economicActivityTypeId
            });
        } else {
            setFormData({ name: '', economicActivityTypeId: '' });
        }
    };

    const handleDelete = async (activityId: string, activityName: string, clientCount: number) => {
        if (clientCount > 0) {
            toast({
                title: 'Cannot Delete',
                description: `Cannot delete "${activityName}" because it has ${clientCount} active client(s) associated.`,
                variant: 'destructive',
            });
            return;
        }

        if (!confirm(`Are you sure you want to delete "${activityName}"?`)) {
            return;
        }

        setIsLoading(true);
        try {
            const result = await apiClient.delete(`/economic-activities?id=${activityId}`);
            if (result.success) {
                toast({
                    title: 'Success',
                    description: 'Economic activity deleted successfully.',
                });
                fetchActivities();
            } else {
                throw new Error(result.error || 'Delete failed');
            }
        } catch (error) {
            console.error('Error deleting economic activity:', error);
            toast({
                title: 'Error',
                description: error instanceof Error ? error.message : 'Failed to delete economic activity.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!selectedTypeId || selectedTypeId === 'all') {
            toast({
                title: 'Validation Error',
                description: 'Please select an activity type before uploading.',
                variant: 'destructive',
            });
            return;
        }

        setIsUploading(true);
        try {
            const formDataObj = new FormData();
            formDataObj.append('file', file);
            formDataObj.append('economicActivityTypeId', selectedTypeId);

            const response = await apiClient.post<UploadResult>('/economic-activities/upload', formDataObj);

            if (response.success && response.data) {
                setUploadResult(response.data);
                setShowUploadResult(true);
                fetchActivities();

                toast({
                    title: 'Upload Complete',
                    description: `${response.data.totalCreated} records created successfully.`,
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

    const downloadTemplate = () => {
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.aoa_to_sheet([
            ['Name'],
            ['Cotton Production'],
            ['Textile Manufacturing'],
            ['Vehicle Assembly'],
            ['Metal Fabrication'],
            ['Dairy Farming'],
        ]);
        worksheet['!cols'] = [{ wch: 25 }];
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Template');
        XLSX.writeFile(workbook, 'economic-activity-template.xlsx');
    };

    // Pagination calculations
    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    const currentItems = activities.slice(indexOfFirstItem, indexOfLastItem);
    const totalPages = Math.ceil(activities.length / itemsPerPage);

    const handlePageChange = (page: number) => {
        setCurrentPage(page);
        document.getElementById('activities-table')?.scrollIntoView({ behavior: 'smooth' });
    };

    return (
        <div className="px-4 md:px-4 sm:px-8 py-8 md:py-12">
            <div className="mx-auto max-w-7xl">
                {/* Header */}
                <div className="mb-8 flex items-center justify-between rounded-3xl border border-primary/20/80 bg-white/80 px-6 py-4 shadow-xl backdrop-blur-xl dark:border-sidebar-accent dark:bg-brand-green-darker/70">
                    <div className="flex items-center gap-4">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-600 to-cyan-600 shadow-lg shadow-teal-500/30">
                            <Building2 className="h-6 w-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-lg font-semibold text-foreground dark:text-white">Economic Activities</h1>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Manage economic activity options
                            </p>
                        </div>
                    </div>
                    <Badge variant="secondary" className="bg-brand-green-darker text-white dark:bg-brand-green-tint dark:text-foreground">
                        {totalCount} Activities
                    </Badge>
                </div>

                {/* Upload Result Alert */}
                {showUploadResult && uploadResult && (
                    <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-6 py-4 dark:border-emerald-800 dark:bg-emerald-950/30 backdrop-blur-xl">
                        <div className="flex items-start justify-between">
                            <div className="flex-1">
                                <h3 className="font-semibold text-emerald-900 dark:text-emerald-200 flex items-center gap-2">
                                    <span className="h-2 w-2 bg-emerald-600 rounded-full"></span>
                                    Upload Result
                                </h3>
                                <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
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

                {/* Search, Filter and Upload Bar */}
                <div className="mb-6 flex flex-col sm:flex-row gap-3">
                    <form onSubmit={handleSearch} className="flex flex-1 gap-3">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <Input
                                type="text"
                                placeholder="Search by activity name..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-9 h-10 text-sm"
                            />
                        </div>
                        <Button type="submit" variant="secondary" className="h-10">
                            <Search className="h-4 w-4 mr-2" />
                            Search
                        </Button>
                        {searchTerm && (
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={() => {
                                    setSearchTerm('');
                                    fetchActivities();
                                }}
                                className="h-10"
                            >
                                Clear
                            </Button>
                        )}
                    </form>

                    <div className="w-full sm:w-64">
                        <Select value={selectedTypeId} onValueChange={handleTypeFilterChange}>
                            <SelectTrigger className="h-10 text-sm">
                                <SelectValue placeholder="All Activity Types" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Activity Types</SelectItem>
                                {activityTypes.map((type) => (
                                    <SelectItem key={type.id} value={type.id}>
                                        {type.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex gap-2">
                        <Button
                            onClick={downloadTemplate}
                            variant="outline"
                            size="sm"
                            className="h-10 text-teal-600 border-teal-200 hover:bg-teal-50 dark:border-teal-800 dark:text-teal-400 dark:hover:bg-teal-950/30"
                        >
                            <Download className="h-4 w-4 mr-2" />
                            Template
                        </Button>
                        <label className="h-10 px-4 rounded-lg border border-primary/30 hover:bg-green-50 dark:border-sidebar-accent dark:hover:bg-brand-green-darker flex items-center gap-2 text-sm font-medium cursor-pointer bg-white dark:bg-sidebar-accent transition-colors">
                            <Upload className="h-4 w-4" />
                            Upload Excel
                            <input
                                type="file"
                                accept=".xlsx,.xls,.csv"
                                onChange={handleFileUpload}
                                disabled={isUploading || selectedTypeId === 'all'}
                                className="hidden"
                            />
                        </label>
                    </div>
                </div>

                {/* Form Section - Toggle */}
                {showForm && (
                    <div className="mb-8 overflow-hidden rounded-2xl border border-primary/20/80 bg-white/70 shadow-2xl backdrop-blur-xl dark:border-sidebar-accent dark:bg-brand-green-darker/50">
                        <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-teal-600 via-cyan-600 to-primary" />

                        <div className="p-6">
                            <h2 className="mb-6 text-lg font-semibold text-foreground dark:text-slate-100 flex items-center gap-2">
                                <Building2 className="h-5 w-5 text-teal-600" />
                                {editingActivity ? 'Edit Economic Activity' : 'Create Economic Activity'}
                            </h2>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <Label className="text-xs font-medium text-sidebar-accent dark:text-slate-400">
                                        Activity Name <span className="text-red-500">*</span>
                                    </Label>
                                    <Input
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        placeholder="e.g., Textile Manufacturing, Retail Trade"
                                        className="mt-1 h-10 text-sm"
                                        autoFocus
                                    />
                                </div>

                                <div>
                                    <Label className="text-xs font-medium text-sidebar-accent dark:text-slate-400">
                                        Activity Type <span className="text-red-500">*</span>
                                    </Label>
                                    <Select
                                        value={formData.economicActivityTypeId}
                                        onValueChange={(v) => setFormData({ ...formData, economicActivityTypeId: v })}
                                    >
                                        <SelectTrigger className="mt-1 h-10 text-sm">
                                            <SelectValue placeholder="Select activity type" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {activityTypes.length === 0 ? (
                                                <div className="p-4 text-center text-sm text-muted-foreground">
                                                    No activity types available. Please create one first.
                                                </div>
                                            ) : (
                                                activityTypes.map((type) => (
                                                    <SelectItem key={type.id} value={type.id}>
                                                        {type.name}
                                                    </SelectItem>
                                                ))
                                            )}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {editingActivity && (
                                    <div>
                                        <Label className="text-xs font-medium text-sidebar-accent dark:text-slate-400">
                                            Activity ID
                                        </Label>
                                        <Input
                                            value={editingActivity.activityId}
                                            disabled
                                            className="mt-1 h-10 text-sm bg-green-50 dark:bg-brand-green-darker"
                                        />
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center gap-3 pt-6">
                                <Button
                                    onClick={handleSave}
                                    disabled={isSaving}
                                    className="bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700"
                                >
                                    {isSaving ? (
                                        <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                                    ) : (
                                        <Save className="h-4 w-4 mr-1.5" />
                                    )}
                                    {editingActivity ? 'Update Activity' : 'Save Activity'}
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={handleReset}
                                    className="text-sm"
                                >
                                    <RotateCcw className="h-4 w-4 mr-1.5" /> Reset
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={handleCloseForm}
                                    className="text-sm"
                                >
                                    Cancel
                                </Button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Add Button */}
                {!showForm && (
                    <div className="mb-6 flex justify-end">
                        <Button
                            onClick={() => handleOpenForm()}
                            className="bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700"
                        >
                            <Plus className="mr-2 h-4 w-4" />
                            Add Economic Activity
                        </Button>
                    </div>
                )}

                {/* Table Section */}
                <div id="activities-table" className="overflow-hidden rounded-2xl border border-primary/20/80 bg-white/70 shadow-2xl backdrop-blur-xl dark:border-sidebar-accent dark:bg-brand-green-darker/50">
                    <div className="flex items-center justify-between border-b border-primary/20/70 px-5 py-3 dark:border-sidebar-accent/80">
                        <h3 className="text-sm font-semibold text-sidebar-accent dark:text-slate-100">Economic Activities Registry</h3>
                        <Badge variant="secondary" className="bg-brand-green-darker text-white dark:bg-brand-green-tint dark:text-foreground">
                            {activities.length} Records
                        </Badge>
                    </div>

                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader className="bg-gradient-to-r from-teal-600 to-cyan-600 text-white">
                                <TableRow>
                                    <TableHead className="px-6 py-3 font-semibold text-white">Activity ID</TableHead>
                                    <TableHead className="px-6 py-3 font-semibold text-white">Activity Name</TableHead>
                                    <TableHead className="px-6 py-3 font-semibold text-white">Activity Type</TableHead>
                                    <TableHead className="px-6 py-3 text-center font-semibold text-white">Members</TableHead>
                                    <TableHead className="px-6 py-3 text-center font-semibold text-white">Status</TableHead>
                                    <TableHead className="px-6 py-3 text-center font-semibold text-white">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading && activities.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="h-32 text-center">
                                            <Loader2 className="mx-auto h-8 w-8 animate-spin text-teal-600" />
                                            <p className="mt-2 text-sm text-slate-500">Loading economic activities...</p>
                                        </TableCell>
                                    </TableRow>
                                ) : currentItems.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="h-32 text-center">
                                            <Building2 className="mx-auto h-12 w-12 text-slate-400" />
                                            <p className="mt-2 text-sm text-slate-500">No economic activities found.</p>
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    currentItems.map((activity) => (
                                        <TableRow
                                            key={activity.id}
                                            className="border-b border-slate-100 hover:bg-teal-50/40 dark:border-sidebar-accent dark:hover:bg-teal-950/20"
                                        >
                                            <TableCell className="px-6 py-3 font-mono text-sm font-medium text-foreground dark:text-white">
                                                {activity.activityId}
                                            </TableCell>
                                            <TableCell className="px-6 py-3 font-medium text-sidebar-accent dark:text-slate-200">
                                                {activity.name}
                                            </TableCell>
                                            <TableCell className="px-6 py-3">
                                                <Badge variant="outline" className="border-cyan-200 text-cyan-700 dark:border-cyan-800 dark:text-cyan-400">
                                                    {activity.activityTypeName}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="px-6 py-3 text-center">
                                                <Badge
                                                    variant="outline"
                                                    className={activity.clientCount > 0
                                                        ? "border-primary/50 text-sidebar-accent dark:border-sidebar-accent dark:text-primary"
                                                        : "border-primary/30 text-sidebar-accent dark:border-sidebar-accent dark:text-slate-400"
                                                    }
                                                >
                                                    {activity.clientCount} {activity.clientCount === 1 ? 'Member' : 'Members'}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="px-6 py-3 text-center">
                                                <Badge
                                                    variant="outline"
                                                    className={
                                                        activity.status === 'Active'
                                                            ? 'border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400'
                                                            : 'border-primary/30 text-sidebar-accent dark:border-sidebar-accent dark:text-slate-400'
                                                    }
                                                >
                                                    {activity.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="px-6 py-3 text-center">
                                                <div className="flex items-center justify-center gap-2">
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() => handleOpenForm({
                                                            id: activity.id,
                                                            activityId: activity.activityId,
                                                            name: activity.name,
                                                            economicActivityTypeId: activity.activityTypeId,
                                                            isActive: activity.status === 'Active',
                                                            createdAt: '',
                                                            updatedAt: '',
                                                        })}
                                                        className="h-8 w-8 p-0 border-primary/30 text-teal-600 hover:bg-teal-50 dark:border-sidebar-accent"
                                                        title="Edit"
                                                    >
                                                        <Edit className="h-3.5 w-3.5" />
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() => handleDelete(activity.id, activity.name, activity.clientCount)}
                                                        className="h-8 w-8 p-0 border-primary/30 text-red-600 hover:bg-red-50 dark:border-sidebar-accent"
                                                        title="Delete"
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>

                    {/* Pagination */}
                    {activities.length > 0 && (
                        <div className="flex items-center justify-between border-t border-primary/20/70 px-5 py-4 dark:border-sidebar-accent/80">
                            <div className="text-sm text-sidebar-accent dark:text-slate-400">
                                Showing {indexOfFirstItem + 1} to {Math.min(indexOfLastItem, activities.length)} of {activities.length} entries
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handlePageChange(currentPage - 1)}
                                    disabled={currentPage === 1}
                                    className="h-8 w-8 p-0"
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                                    <Button
                                        key={page}
                                        variant={currentPage === page ? "default" : "outline"}
                                        size="sm"
                                        onClick={() => handlePageChange(page)}
                                        className={`h-8 w-8 p-0 ${
                                            currentPage === page
                                                ? "bg-gradient-to-r from-teal-600 to-cyan-600"
                                                : ""
                                        }`}
                                    >
                                        {page}
                                    </Button>
                                ))}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handlePageChange(currentPage + 1)}
                                    disabled={currentPage === totalPages}
                                    className="h-8 w-8 p-0"
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
