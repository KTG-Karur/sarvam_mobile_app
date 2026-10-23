"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trash2, Edit, Loader2, RefreshCw, Eye, MapPin } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/app/lib/api-client";
import { Branch } from "@/app/types";
import { cn } from "@/lib/utils";
import { usePermission } from "@/app/hooks/usePermission";
import { useTableSearch } from "@/hooks/useTableSearch";
import { TableSearchInput } from "@/components/ui/table-search";
import { PageLoader } from "@/components/ui/page-loader";
import { toDisplayDate } from '@/app/lib/date-format';

// Leaflet touches `window`, so it must be loaded client-side only
const MapComponent = dynamic(() => import("@/components/centers/CenterMap"), {
    ssr: false,
    loading: () => (
        <div className="flex h-64 items-center justify-center rounded-lg border">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
    ),
});

interface BranchListProps {
    refreshRef?: React.MutableRefObject<(() => void) | null>;
    onEdit?: (branch: Branch) => void;
}

export function BranchList({ refreshRef, onEdit }: BranchListProps) {
    const { canPage } = usePermission();
    const canEditBranch   = canPage('/dashboard/branch/create', 'edit');
    const canDeleteBranch = canPage('/dashboard/branch/create', 'delete');
    const { toast } = useToast();
    const [branches, setBranches] = useState<Branch[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [previewBranch, setPreviewBranch] = useState<Branch | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(branches);

    const fetchBranches = async () => {
        setIsLoading(true);
        try {
            // Include inactive branches for management view
            const result = await apiClient.get<Branch[]>("/branches?includeInactive=true");
            if (result.success && result.data) {
                setBranches(result.data);
            } else {
                toast({
                    title: "Error",
                    description: result.error || "Failed to fetch branches",
                    variant: "destructive",
                });
            }
        } catch (error) {
            console.error("Error fetching branches:", error);
            toast({
                title: "Error",
                description: "Network error. Please try again.",
                variant: "destructive",
            });
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchBranches();
    }, []);

    // Expose refresh function via ref
    useEffect(() => {
        if (refreshRef) {
            refreshRef.current = fetchBranches;
        }
    }, [refreshRef]);

    const handleDelete = async () => {
        if (!deleteId) return;

        setIsDeleting(true);
        try {
            const result = await apiClient.delete(`/branches/${deleteId}`);
            if (result.success) {
                toast({
                    title: "Success",
                    description: "Branch deleted successfully",
                });
                fetchBranches();
                setDeleteId(null);
            } else {
                toast({
                    title: "Error",
                    description: result.error || "Failed to delete branch",
                    variant: "destructive",
                });
            }
        } catch (error) {
            console.error("Error deleting branch:", error);
            toast({
                title: "Error",
                description: "Network error. Please try again.",
                variant: "destructive",
            });
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <>
            <Card className="border-none shadow-xl bg-white/80 backdrop-blur-md dark:bg-green-950/50 overflow-hidden mt-8">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-purple-500/5 to-pink-500/5 pointer-events-none" />
                <CardContent className="p-0">
                    <div className="flex items-center justify-between p-4 border-b border-primary/20 dark:border-sidebar-accent">
                        <h3 className="text-lg font-semibold text-foreground dark:text-white">
                            Branches List
                        </h3>
                        <div className="flex items-center gap-2">
                            <TableSearchInput
                                value={tableSearchQuery}
                                onChange={setTableSearchQuery}
                                placeholder="Search branches..."
                            />
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={fetchBranches}
                                disabled={isLoading}
                                className="h-8"
                            >
                                <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
                                Refresh
                            </Button>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-gradient-to-r from-primary to-primary hover:from-primary hover:to-primary border-none">
                                <TableHead className="text-white font-semibold h-12 pl-6">
                                    Branch
                                </TableHead>
                                <TableHead className="text-white font-semibold h-12">
                                    Address
                                </TableHead>
                                <TableHead className="text-white font-semibold h-12">
                                    Area
                                </TableHead>
                                <TableHead className="text-white font-semibold h-12">
                                    Status
                                </TableHead>
                                <TableHead className="text-white font-semibold h-12 text-right pr-6">
                                    Actions
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="py-4">
                                        <PageLoader label="Loading branches..." fullScreen={false} />
                                    </TableCell>
                                </TableRow>
                            ) : searchedRows.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center py-8">
                                        <p className="text-sm text-sidebar-accent dark:text-slate-400">
                                            No branches found. Create your first branch above.
                                        </p>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                searchedRows.map((branch, index) => (
                                    <TableRow
                                        key={branch.id}
                                        className={`
                                            border-b border-gray-100 dark:border-gray-800 transition-colors hover:bg-green-50/50 dark:hover:bg-brand-green-darker/10
                                            ${index % 2 === 0 ? "bg-white/50" : "bg-gray-50/30"}
                                        `}
                                    >
                                        <TableCell className="font-medium text-gray-700 dark:text-gray-300 pl-6">
                                            <span className="font-mono text-sm">{branch.code}-{branch.name}</span>
                                        </TableCell>
                                        <TableCell className="text-gray-600 dark:text-gray-400">
                                            {branch.address || (
                                                <span className="text-sm text-slate-400">No address</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-gray-600 dark:text-gray-400 text-sm">
                                            {branch.areas?.[0] ? branch.areas[0].name : (
                                                <span className="text-slate-400 italic">—</span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <Badge
                                                variant={branch.isActive ? "default" : "secondary"}
                                                className={
                                                    branch.isActive
                                                        ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700"
                                                        : "bg-green-50 text-slate-500 border-primary/20"
                                                }
                                            >
                                                {branch.isActive ? "Active" : "Inactive"}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right pr-6">
                                            <div className="flex items-center justify-end gap-2">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => setPreviewBranch(branch)}
                                                    className="h-8 w-8 text-primary hover:text-sidebar-accent hover:bg-green-50 transition-colors"
                                                    aria-label="View branch details"
                                                >
                                                    <Eye className="h-4 w-4" />
                                                </Button>
                                                {onEdit && canEditBranch && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => onEdit(branch)}
                                                        className="h-8 w-8 text-primary hover:text-primary hover:bg-green-50 transition-colors"
                                                        aria-label="Edit branch"
                                                    >
                                                        <Edit className="h-4 w-4" />
                                                    </Button>
                                                )}
                                                {canDeleteBranch && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => setDeleteId(branch.id)}
                                                        disabled={branch.name.toLowerCase() === "head office"}
                                                        className={cn(
                                                            "h-8 w-8 transition-colors",
                                                            branch.name.toLowerCase() === "head office"
                                                                ? "text-slate-300 cursor-not-allowed cursor-not-allowed opacity-50"
                                                                : "text-red-600 hover:text-red-700 hover:bg-red-50"
                                                        )}
                                                        aria-label={branch.name.toLowerCase() === "head office" ? "Head Office cannot be deleted" : "Delete branch"}
                                                        title={branch.name.toLowerCase() === "head office" ? "Head Office cannot be deleted" : "Delete branch"}
                                                    >
                                                        <Trash2 className="h-4 w-4" />
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
                </CardContent>
            </Card>

            {/* Delete Confirmation Dialog */}
            <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete Branch</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete this branch? This action cannot be undone.
                            The branch will be deactivated if it has active users or centers.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setDeleteId(null)}
                            disabled={isDeleting}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={handleDelete}
                            disabled={isDeleting}
                        >
                            {isDeleting ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Deleting...
                                </>
                            ) : (
                                "Delete"
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Preview Dialog */}
            <Dialog open={!!previewBranch} onOpenChange={() => setPreviewBranch(null)}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-semibold text-foreground dark:text-white">
                            Branch Details
                        </DialogTitle>
                        <DialogDescription className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                            View branch information and details.
                        </DialogDescription>
                    </DialogHeader>
                    {previewBranch && (
                        <div className="space-y-4 py-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="col-span-2">
                                    <p className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                        Branch
                                    </p>
                                    <p className="text-sm text-sidebar-accent dark:text-slate-400 font-mono">
                                        {previewBranch.code}-{previewBranch.name}
                                    </p>
                                </div>
                                <div className="col-span-2">
                                    <p className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                        Address
                                    </p>
                                    <p className="text-sm text-sidebar-accent dark:text-slate-400">
                                        {previewBranch.address || "No address provided"}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                        Area
                                    </p>
                                    <p className="text-sm text-sidebar-accent dark:text-slate-400">
                                        {previewBranch.areas?.[0] ? previewBranch.areas[0].name : "Not assigned"}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                        Status
                                    </p>
                                    <Badge
                                        variant={previewBranch.isActive ? "default" : "secondary"}
                                        className={
                                            previewBranch.isActive
                                                ? "bg-green-50 text-green-700 border-green-200"
                                                : "bg-green-50 text-slate-500"
                                        }
                                    >
                                        {previewBranch.isActive ? "Active" : "Inactive"}
                                    </Badge>
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                        Created At
                                    </p>
                                    <p className="text-sm text-sidebar-accent dark:text-slate-400">
                                        {toDisplayDate(new Date(previewBranch.createdAt))}
                                    </p>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <p className="flex items-center gap-1 text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                    <MapPin className="h-4 w-4" />
                                    Location
                                </p>
                                {previewBranch.latitude != null && previewBranch.longitude != null ? (
                                    <>
                                        <p className="text-xs text-sidebar-accent dark:text-slate-400 font-mono">
                                            {previewBranch.latitude.toFixed(6)}, {previewBranch.longitude.toFixed(6)}
                                        </p>
                                        <MapComponent
                                            latitude={previewBranch.latitude}
                                            longitude={previewBranch.longitude}
                                            centerName={previewBranch.name}
                                            centerCode={previewBranch.code}
                                            address={previewBranch.address || undefined}
                                            heightClassName="h-64"
                                        />
                                    </>
                                ) : (
                                    <p className="text-sm text-sidebar-accent dark:text-slate-400">
                                        Location not set
                                    </p>
                                )}
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setPreviewBranch(null)}>
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
