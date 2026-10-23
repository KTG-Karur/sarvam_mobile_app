"use client";

import { useState, useEffect } from "react";
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
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Trash2, Eye, Loader2, RefreshCw } from "lucide-react";
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
import { tokenStorage } from "@/app/lib/token-storage";
import { User } from "@/app/types";
import { getRoleDisplayName } from "@/app/lib/role-display";
import { useTableSearch } from "@/hooks/useTableSearch";
import { TableSearchInput } from "@/components/ui/table-search";
import { PageLoader } from "@/components/ui/page-loader";
import { toDisplayDate } from '@/app/lib/date-format';

interface UserWithBranch extends User {
    branch?: {
        id: string;
        name: string;
        code: string;
    } | null;
    /** Active RBAC role — shown instead of legacy enum for custom roles */
    rbacRole?: { id: string; name: string; slug: string; color?: string | null } | null;
}

interface EmployeeListProps {
    refreshRef?: React.MutableRefObject<(() => void) | null>;
}

export function EmployeeList({ refreshRef }: EmployeeListProps) {
    const { toast } = useToast();
    const [users, setUsers] = useState<UserWithBranch[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [previewUser, setPreviewUser] = useState<UserWithBranch | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    // Branch filter — ADMIN sees all branches, AREA_MANAGER scoped to their assigned branches
    const storedUser = tokenStorage.getUser();
    const isAdminOrAM = storedUser?.role === "ADMIN" || storedUser?.role === "AREA_MANAGER";
    const [branches, setBranches] = useState<{ id: string; name: string; code: string }[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState("all");
    const [isLoadingBranches, setIsLoadingBranches] = useState(false);

    useEffect(() => {
        if (!isAdminOrAM) return;
        setIsLoadingBranches(true);
        fetch("/api/branches")
            .then((res) => res.json())
            .then((json) => {
                let list: { id: string; name: string; code: string }[] = (json?.data ?? []).map(
                    (b: any) => ({ id: b.id, name: b.name, code: b.code })
                );
                if (storedUser?.role === "AREA_MANAGER") {
                    const assignedBranchIds = (storedUser as any)?.assignedBranchIds ?? [];
                    if (assignedBranchIds.length > 0) {
                        list = list.filter((b) => assignedBranchIds.includes(b.id));
                    }
                }
                setBranches(list);
            })
            .catch(() => {
                toast({ title: "Error", description: "Failed to load branches.", variant: "destructive" });
            })
            .finally(() => setIsLoadingBranches(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAdminOrAM]);

    const fetchUsers = async () => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams();
            if (isAdminOrAM && selectedBranchId !== "all") params.set("branchId", selectedBranchId);
            // API hard-caps pageSize at 50 — this page has no pagination UI of its own, so
            // request the max to minimize truncation for branches with many employees.
            params.set("pageSize", "50");
            const result = await apiClient.get<{ users: UserWithBranch[] }>(`/users?${params.toString()}`);
            if (result.success && result.data) {
                setUsers(result.data.users);
            } else {
                toast({
                    title: "Error",
                    description: result.error || "Failed to fetch users",
                    variant: "destructive",
                });
            }
        } catch (error) {
            console.error("Error fetching users:", error);
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
        fetchUsers();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedBranchId]);

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedUsers } = useTableSearch(users);

    // Expose refresh function via ref
    useEffect(() => {
        if (refreshRef) {
            refreshRef.current = fetchUsers;
        }
    }, [refreshRef]);

    const handleDelete = async () => {
        if (!deleteId) return;

        setIsDeleting(true);
        try {
            // TODO: Implement delete API endpoint
            toast({
                title: "Info",
                description: "Delete functionality will be implemented soon",
            });
        setDeleteId(null);
        } catch (error) {
            console.error("Error deleting user:", error);
            toast({
                title: "Error",
                description: "Failed to delete user",
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
                    <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-primary/20 dark:border-sidebar-accent">
                        <h3 className="text-lg font-semibold text-foreground dark:text-white">
                            Users List
                        </h3>
                        <div className="flex items-center gap-2">
                            <TableSearchInput
                                value={tableSearchQuery}
                                onChange={setTableSearchQuery}
                                placeholder="Search users..."
                            />
                            {isAdminOrAM && (
                                <div className="flex items-center gap-2">
                                    <Label className="text-sm font-medium whitespace-nowrap">Branch</Label>
                                    <Select
                                        value={selectedBranchId}
                                        onValueChange={setSelectedBranchId}
                                        disabled={isLoadingBranches}
                                    >
                                        <SelectTrigger className="h-8 w-[200px]">
                                            <SelectValue placeholder="All Branches" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">
                                                {storedUser?.role === "AREA_MANAGER" ? "All Assigned Branches" : "All Branches"}
                                            </SelectItem>
                                            {branches.map((b) => (
                                                <SelectItem key={b.id} value={b.id}>
                                                    {b.code} - {b.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={fetchUsers}
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
                                    Email
                                </TableHead>
                                <TableHead className="text-white font-semibold h-12">
                                    Name
                                </TableHead>
                                <TableHead className="text-white font-semibold h-12">
                                    Role
                                </TableHead>
                                <TableHead className="text-white font-semibold h-12">
                                    Branch
                                </TableHead>
                                <TableHead className="text-white font-semibold h-12">
                                    Status
                                </TableHead>
                                <TableHead className="text-white font-semibold h-12 text-right pr-6">
                                    Action
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="py-4">
                                        <PageLoader label="Loading users..." fullScreen={false} />
                                    </TableCell>
                                </TableRow>
                            ) : users.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center py-8">
                                        <p className="text-sm text-sidebar-accent dark:text-slate-400">
                                            No users found. Create your first user above.
                                        </p>
                                    </TableCell>
                                </TableRow>
                            ) : searchedUsers.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center py-8">
                                        <p className="text-sm text-sidebar-accent dark:text-slate-400">
                                            No users match your search.
                                        </p>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                searchedUsers.map((user, index) => (
                                <TableRow
                                        key={user.id}
                                    className={`
                    border-b border-gray-100 dark:border-gray-800 transition-colors hover:bg-green-50/50 dark:hover:bg-brand-green-darker/10
                    ${index % 2 === 0 ? "bg-white/50" : "bg-gray-50/30"}
                  `}
                                >
                                    <TableCell className="font-medium text-gray-700 dark:text-gray-300 pl-6">
                                            {user.email}
                                        </TableCell>
                                        <TableCell className="text-gray-600 dark:text-gray-400 font-medium">
                                            {user.firstName} {user.lastName}
                                        </TableCell>
                                        <TableCell>
                                            <Badge
                                                variant="outline"
                                                className="bg-green-50 text-sidebar-accent border-primary/30 dark:bg-brand-green-darker/30 dark:text-green-300 dark:border-sidebar-accent"
                                            >
                                                {/* Prefer RBAC role name so custom roles show correctly */}
                                                {user.rbacRole?.name ?? getRoleDisplayName(user)}
                                        </Badge>
                                    </TableCell>
                                        <TableCell className="text-gray-600 dark:text-gray-400">
                                            {user.branch ? (
                                                <span className="text-sm">
                                                    {user.branch.name} ({user.branch.code})
                                                </span>
                                            ) : (
                                                <span className="text-sm text-slate-400">No Branch</span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <Badge
                                                variant={user.isActive ? "default" : "secondary"}
                                                className={
                                                    user.isActive
                                                        ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300"
                                                        : "bg-green-50 text-slate-500 border-primary/20"
                                                }
                                            >
                                                {user.isActive ? "Active" : "Inactive"}
                                            </Badge>
                                    </TableCell>
                                    <TableCell className="text-right pr-6">
                                        <div className="flex items-center justify-end gap-2">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                    onClick={() => setPreviewUser(user)}
                                                className="h-8 w-8 text-primary hover:text-sidebar-accent hover:bg-green-50 transition-colors"
                                                    aria-label="View user details"
                                            >
                                                <Eye className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                    onClick={() => setDeleteId(user.id)}
                                                className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50 transition-colors"
                                                    aria-label="Delete user"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
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
                        <DialogTitle>Delete User</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete this user? This action cannot be undone.
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
            <Dialog open={!!previewUser} onOpenChange={() => setPreviewUser(null)}>
                <DialogContent className="max-w-2xl">
                        <DialogHeader>
                            <DialogTitle className="text-xl font-semibold text-foreground dark:text-white">
                            User Details
                            </DialogTitle>
                            <DialogDescription className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                            View user information and details.
                            </DialogDescription>
                        </DialogHeader>
                    {previewUser && (
                        <div className="space-y-4 py-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <p className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                        Email
                                    </p>
                                    <p className="text-sm text-sidebar-accent dark:text-slate-400">
                                        {previewUser.email}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                        Full Name
                                    </p>
                                    <p className="text-sm text-sidebar-accent dark:text-slate-400">
                                        {previewUser.firstName} {previewUser.lastName}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                        Role
                                    </p>
                                    <Badge
                                        variant="outline"
                                        className="bg-green-50 text-sidebar-accent border-primary/30 dark:bg-brand-green-darker/30 dark:text-green-300"
                                    >
                                        {/* Prefer RBAC role name so custom roles show correctly */}
                                        {previewUser.rbacRole?.name ?? getRoleDisplayName(previewUser)}
                                    </Badge>
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                        Status
                                    </p>
                                    <Badge
                                        variant={previewUser.isActive ? "default" : "secondary"}
                                        className={
                                            previewUser.isActive
                                                ? "bg-green-50 text-green-700 border-green-200"
                                                : "bg-green-50 text-slate-500"
                                        }
                                    >
                                        {previewUser.isActive ? "Active" : "Inactive"}
                                    </Badge>
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                        Branch
                                    </p>
                                    <p className="text-sm text-sidebar-accent dark:text-slate-400">
                                        {previewUser.branch
                                            ? `${previewUser.branch.name} (${previewUser.branch.code})`
                                            : "No Branch"}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                        Created At
                                    </p>
                                    <p className="text-sm text-sidebar-accent dark:text-slate-400">
                                        {toDisplayDate(new Date(previewUser.createdAt))}
                                    </p>
                                </div>
                    </div>
                    </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setPreviewUser(null)}>
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
