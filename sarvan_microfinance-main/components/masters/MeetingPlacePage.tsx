// components/masters/MeetingPlacePage.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { Badge } from '@/components/ui/badge';
import {
    Plus,
    Edit,
    Trash2,
    Loader2,
    MapPin,
    Save,
    RotateCcw,
    ChevronLeft,
    ChevronRight,
    Search,
} from 'lucide-react';

interface MeetingPlace {
    id: string;
    placeId: string;
    name: string;
    isActive: boolean;
}

interface MeetingPlaceRow {
    id: string;
    placeId: string;
    name: string;
    status: string;
}

export default function MeetingPlacePage() {
    const [places, setPlaces] = useState<MeetingPlaceRow[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [editingPlace, setEditingPlace] = useState<MeetingPlace | null>(null);
    const [formData, setFormData] = useState({ name: '' });
    const [searchTerm, setSearchTerm] = useState('');

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage] = useState(10);

    const { toast } = useToast();

    const fetchPlaces = useCallback(async () => {
        setIsLoading(true);
        try {
            let url = '/meeting-places?includeInactive=true';
            if (searchTerm) {
                url += `&search=${encodeURIComponent(searchTerm)}`;
            }

            const result = await apiClient.get<MeetingPlace[]>(url);
            if (result.success && result.data) {
                const rows: MeetingPlaceRow[] = result.data.map((p) => ({
                    id: p.id,
                    placeId: p.placeId,
                    name: p.name,
                    status: p.isActive ? 'Active' : 'Inactive',
                }));
                setPlaces(rows);
                setCurrentPage(1);
            }
        } catch (error) {
            console.error('Error fetching meeting places:', error);
            toast({
                title: 'Error',
                description: 'Failed to load meeting places.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    }, [toast, searchTerm]);

    useEffect(() => {
        fetchPlaces();
    }, [fetchPlaces]);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        fetchPlaces();
    };

    const handleOpenForm = (place?: MeetingPlace) => {
        if (place) {
            setEditingPlace(place);
            setFormData({ name: place.name });
        } else {
            setEditingPlace(null);
            setFormData({ name: '' });
        }
        setShowForm(true);
    };

    const handleCloseForm = () => {
        setShowForm(false);
        setEditingPlace(null);
        setFormData({ name: '' });
    };

    const handleSave = async () => {
        if (!formData.name.trim()) {
            toast({
                title: 'Validation Error',
                description: 'Meeting place name is required.',
                variant: 'destructive',
            });
            return;
        }

        setIsSaving(true);
        try {
            if (editingPlace) {
                const result = await apiClient.put('/meeting-places', {
                    id: editingPlace.id,
                    name: formData.name.trim(),
                });
                if (result.success) {
                    toast({
                        title: 'Success',
                        description: 'Meeting place updated successfully.',
                    });
                    handleCloseForm();
                    fetchPlaces();
                } else {
                    throw new Error(result.error || 'Update failed');
                }
            } else {
                const result = await apiClient.post('/meeting-places', {
                    name: formData.name.trim(),
                });
                if (result.success) {
                    toast({
                        title: 'Success',
                        description: 'Meeting place created successfully.',
                    });
                    handleCloseForm();
                    fetchPlaces();
                } else {
                    throw new Error(result.error || 'Creation failed');
                }
            }
        } catch (error) {
            console.error('Error saving meeting place:', error);
            toast({
                title: 'Error',
                description: error instanceof Error ? error.message : 'Failed to save meeting place.',
                variant: 'destructive',
            });
        } finally {
            setIsSaving(false);
        }
    };

    const handleReset = () => {
        if (editingPlace) {
            setFormData({ name: editingPlace.name });
        } else {
            setFormData({ name: '' });
        }
    };

    const handleDelete = async (placeId: string, placeName: string) => {
        if (!confirm(`Are you sure you want to deactivate "${placeName}"?`)) {
            return;
        }

        setIsLoading(true);
        try {
            const result = await apiClient.delete(`/meeting-places?id=${placeId}`);
            if (result.success) {
                toast({
                    title: 'Success',
                    description: 'Meeting place deactivated successfully.',
                });
                fetchPlaces();
            } else {
                throw new Error(result.error || 'Delete failed');
            }
        } catch (error) {
            console.error('Error deleting meeting place:', error);
            toast({
                title: 'Error',
                description: error instanceof Error ? error.message : 'Failed to delete meeting place.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    // Pagination calculations
    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    const currentItems = places.slice(indexOfFirstItem, indexOfLastItem);
    const totalPages = Math.ceil(places.length / itemsPerPage);

    const handlePageChange = (page: number) => {
        setCurrentPage(page);
        document.getElementById('meeting-places-table')?.scrollIntoView({ behavior: 'smooth' });
    };

    return (
        <div className="px-4 md:px-4 sm:px-8 py-8 md:py-12">
            <div className="mx-auto max-w-7xl">
                {/* Header */}
                <div className="mb-8 flex items-center justify-between rounded-3xl border border-primary/20/80 bg-white/80 px-6 py-4 shadow-xl backdrop-blur-xl dark:border-sidebar-accent dark:bg-brand-green-darker/70">
                    <div className="flex items-center gap-4">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-600 to-primary shadow-lg shadow-cyan-500/30">
                            <MapPin className="h-6 w-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-lg font-semibold text-foreground dark:text-white">Meeting Places</h1>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Manage the list of meeting places available on the Center form
                            </p>
                        </div>
                    </div>
                    <Badge variant="secondary" className="bg-brand-green-darker text-white dark:bg-brand-green-tint dark:text-foreground">
                        {places.length} Places
                    </Badge>
                </div>

                {/* Search and Actions Bar */}
                <div className="mb-6 flex flex-col sm:flex-row gap-3">
                    <form onSubmit={handleSearch} className="flex flex-1 gap-3">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <Input
                                type="text"
                                placeholder="Search by meeting place name..."
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
                                    fetchPlaces();
                                }}
                                className="h-10"
                            >
                                Clear
                            </Button>
                        )}
                    </form>
                </div>

                {/* Form Section - Toggle */}
                {showForm && (
                    <div className="mb-8 overflow-hidden rounded-2xl border border-primary/20/80 bg-white/70 shadow-2xl backdrop-blur-xl dark:border-sidebar-accent dark:bg-brand-green-darker/50">
                        <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-cyan-600 via-primary to-purple-500" />

                        <div className="p-6">
                            <h2 className="mb-6 text-lg font-semibold text-foreground dark:text-slate-100 flex items-center gap-2">
                                <MapPin className="h-5 w-5 text-cyan-600" />
                                {editingPlace ? 'Edit Meeting Place' : 'Create Meeting Place'}
                            </h2>

                            <div className="grid grid-cols-1 gap-6">
                                <div>
                                    <Label className="text-xs font-medium text-sidebar-accent dark:text-slate-400">
                                        Meeting Place Name <span className="text-red-500">*</span>
                                    </Label>
                                    <Input
                                        value={formData.name}
                                        onChange={(e) => setFormData({ name: e.target.value })}
                                        placeholder="e.g., Community Hall, Panchayat Office, FDO Field Office"
                                        className="mt-1 h-10 text-sm"
                                        autoFocus
                                    />
                                </div>

                                {editingPlace && (
                                    <div>
                                        <Label className="text-xs font-medium text-sidebar-accent dark:text-slate-400">
                                            Place ID
                                        </Label>
                                        <Input
                                            value={editingPlace.placeId}
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
                                    className="bg-gradient-to-r from-cyan-600 to-primary hover:from-cyan-700 hover:to-sidebar-accent"
                                >
                                    {isSaving ? (
                                        <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                                    ) : (
                                        <Save className="h-4 w-4 mr-1.5" />
                                    )}
                                    {editingPlace ? 'Update Place' : 'Save Place'}
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
                            className="bg-gradient-to-r from-cyan-600 to-primary hover:from-cyan-700 hover:to-sidebar-accent"
                        >
                            <Plus className="mr-2 h-4 w-4" />
                            Add Meeting Place
                        </Button>
                    </div>
                )}

                {/* Table Section */}
                <div id="meeting-places-table" className="overflow-hidden rounded-2xl border border-primary/20/80 bg-white/70 shadow-2xl backdrop-blur-xl dark:border-sidebar-accent dark:bg-brand-green-darker/50">
                    <div className="flex items-center justify-between border-b border-primary/20/70 px-5 py-3 dark:border-sidebar-accent/80">
                        <h3 className="text-sm font-semibold text-sidebar-accent dark:text-slate-100">Meeting Places Registry</h3>
                        <Badge variant="secondary" className="bg-brand-green-darker text-white dark:bg-brand-green-tint dark:text-foreground">
                            {places.length} Records
                        </Badge>
                    </div>

                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader className="bg-gradient-to-r from-cyan-600 to-primary text-white">
                                <TableRow>
                                    <TableHead className="px-6 py-3 font-semibold text-white">Place ID</TableHead>
                                    <TableHead className="px-6 py-3 font-semibold text-white">Place Name</TableHead>
                                    <TableHead className="px-6 py-3 text-center font-semibold text-white">Status</TableHead>
                                    <TableHead className="px-6 py-3 text-center font-semibold text-white">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading && places.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={4} className="h-32 text-center">
                                            <Loader2 className="mx-auto h-8 w-8 animate-spin text-cyan-600" />
                                            <p className="mt-2 text-sm text-slate-500">Loading meeting places...</p>
                                        </TableCell>
                                    </TableRow>
                                ) : currentItems.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={4} className="h-32 text-center">
                                            <MapPin className="mx-auto h-12 w-12 text-slate-400" />
                                            <p className="mt-2 text-sm text-slate-500">No meeting places found.</p>
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    currentItems.map((place) => (
                                        <TableRow
                                            key={place.id}
                                            className="border-b border-slate-100 hover:bg-cyan-50/40 dark:border-sidebar-accent dark:hover:bg-cyan-950/20"
                                        >
                                            <TableCell className="px-6 py-3 font-mono text-sm font-medium text-foreground dark:text-white">
                                                {place.placeId}
                                            </TableCell>
                                            <TableCell className="px-6 py-3 font-medium text-sidebar-accent dark:text-slate-200">
                                                {place.name}
                                            </TableCell>
                                            <TableCell className="px-6 py-3 text-center">
                                                <Badge
                                                    variant="outline"
                                                    className={
                                                        place.status === 'Active'
                                                            ? 'border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400'
                                                            : 'border-primary/30 text-sidebar-accent dark:border-sidebar-accent dark:text-slate-400'
                                                    }
                                                >
                                                    {place.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="px-6 py-3 text-center">
                                                <div className="flex items-center justify-center gap-2">
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() => handleOpenForm({
                                                            id: place.id,
                                                            placeId: place.placeId,
                                                            name: place.name,
                                                            isActive: place.status === 'Active',
                                                        })}
                                                        className="h-8 w-8 p-0 border-primary/30 text-cyan-600 hover:bg-cyan-50 dark:border-sidebar-accent"
                                                        title="Edit"
                                                    >
                                                        <Edit className="h-3.5 w-3.5" />
                                                    </Button>
                                                    {place.status === 'Active' && (
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => handleDelete(place.id, place.name)}
                                                            className="h-8 w-8 p-0 border-primary/30 text-red-600 hover:bg-red-50 dark:border-sidebar-accent"
                                                            title="Deactivate"
                                                        >
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                        </Button>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>

                    {/* Pagination */}
                    {places.length > 0 && (
                        <div className="flex items-center justify-between border-t border-primary/20/70 px-5 py-4 dark:border-sidebar-accent/80">
                            <div className="text-sm text-sidebar-accent dark:text-slate-400">
                                Showing {indexOfFirstItem + 1} to {Math.min(indexOfLastItem, places.length)} of {places.length} entries
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
                                                ? "bg-gradient-to-r from-cyan-600 to-primary"
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
