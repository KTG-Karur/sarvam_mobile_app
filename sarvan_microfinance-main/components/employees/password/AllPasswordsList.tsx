"use client";

import { useState } from "react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Key, Search, RefreshCw, ArrowUpDown, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";

interface PasswordData {
    id: string;
    branchCode: string;
    branchName: string;
    employeeId: string;
    employeeName: string;
    designation: string;
    username: string;
    password: string;
    loginStatus: boolean;
}

// Mock password data - in production, this would come from an API
const mockPasswordData: PasswordData[] = [
    {
        id: "1",
        branchCode: "000",
        branchName: "HEAD OFFICE",
        employeeId: "0.2",
        employeeName: "ACCOUNTANT",
        designation: "HO-ACCOUNTANT",
        username: "K3002",
        password: "Happy@11",
        loginStatus: true,
    },
    {
        id: "2",
        branchCode: "001",
        branchName: "GUDALUR",
        employeeId: "1.4",
        employeeName: "VIJAYAKUMAR BM",
        designation: "BRANCH MANAGER",
        username: "VIJAYKUMAR BM",
        password: "Vijay@123",
        loginStatus: true,
    },
    {
        id: "3",
        branchCode: "001",
        branchName: "GUDALUR",
        employeeId: "1.21",
        employeeName: "AREA MANAGER",
        designation: "AREA MANAGER",
        username: "AREA MANAGER",
        password: "Vijay@25",
        loginStatus: true,
    },
    {
        id: "4",
        branchCode: "001",
        branchName: "GUDALUR",
        employeeId: "1.24",
        employeeName: "MANIKANDAN E",
        designation: "FIELD OFFICER",
        username: "MANIKANDAN E",
        password: "November@123",
        loginStatus: true,
    },
    {
        id: "5",
        branchCode: "001",
        branchName: "GUDALUR",
        employeeId: "1.32",
        employeeName: "PARTHIBAN",
        designation: "FIELD OFFICER",
        username: "PARTHIBAN",
        password: "Gdrparthi@12345",
        loginStatus: true,
    },
    {
        id: "6",
        branchCode: "002",
        branchName: "ERODE",
        employeeId: "2.17",
        employeeName: "YUVARAJ",
        designation: "FIELD OFFICER",
        username: "YUVARAJ BM",
        password: "Yuvaraj@11",
        loginStatus: true,
    },
    {
        id: "7",
        branchCode: "002",
        branchName: "ERODE",
        employeeId: "2.35",
        employeeName: "MANOJ DHANAPAL",
        designation: "FIELD OFFICER",
        username: "MANOJ FDO",
        password: "Manoj@01",
        loginStatus: true,
    },
    {
        id: "8",
        branchCode: "003",
        branchName: "KARUR",
        employeeId: "3.9",
        employeeName: "BM",
        designation: "BRANCH MANAGER",
        username: "MAHESWARI",
        password: "Mahes@11",
        loginStatus: true,
    },
    {
        id: "9",
        branchCode: "003",
        branchName: "KARUR",
        employeeId: "3.34",
        employeeName: "MAHESWARI M",
        designation: "FIELD OFFICER",
        username: "MAHES FDO",
        password: "Mahes@25",
        loginStatus: true,
    },
    {
        id: "10",
        branchCode: "003",
        branchName: "KARUR",
        employeeId: "3.38",
        employeeName: "THIRUNAVUKKARASU RAJA",
        designation: "FIELD OFFICER",
        username: "RAJA FIELD OFFICER",
        password: "Nov@2025",
        loginStatus: true,
    },
    {
        id: "11",
        branchCode: "004",
        branchName: "TIRUCHIRAPPALLI",
        employeeId: "4.25",
        employeeName: "BM-TRICHY",
        designation: "BRANCH MANAGER",
        username: "BRANCH MANAGER TRICHY",
        password: "Trichy@nov25",
        loginStatus: true,
    },
];

export function AllPasswordsList() {
    const { toast } = useToast();
    const [searchQuery, setSearchQuery] = useState("");
    const [passwordData, setPasswordData] = useState<PasswordData[]>(mockPasswordData);
    const [editedData, setEditedData] = useState<Record<string, Partial<PasswordData>>>({});
    const [isSaving, setIsSaving] = useState(false);

    const filteredData = passwordData.filter(
        (item) =>
            item.branchName.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.employeeName.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.employeeId.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.designation.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const handleFieldChange = (
        id: string,
        field: keyof PasswordData,
        value: string | boolean
    ) => {
        setEditedData((prev) => ({
            ...prev,
            [id]: {
                ...prev[id],
                [field]: value,
            },
        }));
    };

    const handleSave = async (id: string) => {
        setIsSaving(true);
        const changes = editedData[id];
        if (changes) {
            // TODO: Handle API submission
            setPasswordData((prev) =>
                prev.map((item) =>
                    item.id === id ? { ...item, ...changes } : item
                )
            );
            setEditedData((prev) => {
                const newData = { ...prev };
                delete newData[id];
                return newData;
            });
            toast({
                title: "Password Updated",
                description: "Employee password has been updated successfully.",
            });
        }
        setIsSaving(false);
    };

    const handleLoginStatusToggle = async (id: string, newStatus: boolean) => {
        setIsSaving(true);
        // TODO: Handle API submission
        setPasswordData((prev) =>
            prev.map((item) =>
                item.id === id ? { ...item, loginStatus: newStatus } : item
            )
        );
        toast({
            title: newStatus ? "Login Enabled" : "Login Disabled",
            description: `Login status has been ${newStatus ? "enabled" : "disabled"} for this employee.`,
        });
        setIsSaving(false);
    };

    const handleRefresh = () => {
        setPasswordData(mockPasswordData);
        setEditedData({});
        toast({
            title: "Data Refreshed",
            description: "Password data has been refreshed.",
        });
    };

    const hasChanges = (id: string) => {
        return editedData[id] && Object.keys(editedData[id]).length > 0;
    };

    return (
        <div className="relative w-full max-w-7xl">
            {/* Background Accent */}
            <div className="absolute -inset-4 -z-10 rounded-3xl bg-gradient-to-r from-primary/15 via-primary/10 to-primary/15 blur-2xl" />

            {/* Main Card */}
            <div className="relative overflow-hidden rounded-3xl border border-primary/20/80 bg-white/95 shadow-2xl dark:border-sidebar-accent/60 dark:bg-brand-green-darker/95">
                {/* Top Gradient Bar */}
                <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-primary bg-[length:200%_100%] animate-shimmer" />

                {/* Header */}
                <div className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 px-4 sm:px-8 py-6 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                            <div className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                                <Key className="h-6 w-6 text-white" />
                            </div>
                            <div className="flex flex-col gap-0.5">
                                <h1 className="text-xl font-semibold tracking-tight text-foreground dark:text-white">
                                    All Password
                                </h1>
                                <p className="text-xs text-sidebar-accent dark:text-slate-400">
                                    View and manage all employee passwords, usernames, and login status.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Search and Actions */}
                <div className="px-4 sm:px-8 py-4 border-b border-primary/20 dark:border-sidebar-accent">
                    <div className="flex items-center gap-4">
                        <div className="relative flex-1 max-w-md">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                            <Input
                                placeholder="Search by branch, employee name, ID, username, or designation..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className={cn(
                                    "h-10 pl-10 pr-4 border border-primary/30 text-sm",
                                    "bg-white hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20",
                                    "dark:bg-brand-green-darker dark:border-sidebar-accent dark:text-slate-100",
                                    "transition-all duration-200"
                                )}
                            />
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-10 px-4 text-sm font-semibold"
                            onClick={handleRefresh}
                        >
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Refresh
                        </Button>
                    </div>
                </div>

                {/* Table Section */}
                <div className="px-4 sm:px-8 py-6">
                    <div className="rounded-lg border border-primary/20 dark:border-sidebar-accent overflow-hidden">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-gradient-to-r from-primary to-primary hover:from-primary hover:to-primary border-none">
                                        <TableHead className="text-white font-semibold h-12 pl-6">
                                            <div className="flex items-center gap-2">
                                                Branch Name
                                                <ArrowUpDown className="h-3.5 w-3.5 opacity-70" />
                                            </div>
                                        </TableHead>
                                        <TableHead className="text-white font-semibold h-12">
                                            <div className="flex items-center gap-2">
                                                Employee Name
                                                <ArrowUpDown className="h-3.5 w-3.5 opacity-70" />
                                            </div>
                                        </TableHead>
                                        <TableHead className="text-white font-semibold h-12">
                                            <div className="flex items-center gap-2">
                                                Designation
                                                <ArrowUpDown className="h-3.5 w-3.5 opacity-70" />
                                            </div>
                                        </TableHead>
                                        <TableHead className="text-white font-semibold h-12">
                                            Username
                                        </TableHead>
                                        <TableHead className="text-white font-semibold h-12">
                                            Password
                                        </TableHead>
                                        <TableHead className="text-white font-semibold h-12 text-center">
                                            Login Status
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredData.length === 0 ? (
                                        <TableRow>
                                            <TableCell
                                                colSpan={6}
                                                className="text-center py-12 text-slate-500 dark:text-slate-400"
                                            >
                                                No employees found matching your search.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        filteredData.map((item, index) => {
                                            const editedItem = editedData[item.id] || {};
                                            const currentUsername = editedItem.username ?? item.username;
                                            const currentPassword = editedItem.password ?? item.password;
                                            const itemHasChanges = hasChanges(item.id);

                                            return (
                                                <TableRow
                                                    key={item.id}
                                                    className={cn(
                                                        "border-b border-slate-100 dark:border-sidebar-accent transition-colors hover:bg-green-50/50 dark:hover:bg-brand-green-darker/10",
                                                        index % 2 === 0
                                                            ? "bg-white/50"
                                                            : "bg-gray-50/30",
                                                        itemHasChanges && "bg-green-50/30 dark:bg-green-950/20"
                                                    )}
                                                >
                                                    <TableCell className="font-medium text-sidebar-accent dark:text-slate-300 pl-6">
                                                        {item.branchCode} - {item.branchName}
                                                    </TableCell>
                                                    <TableCell className="text-sidebar-accent dark:text-slate-400 font-medium">
                                                        {item.employeeId} - {item.employeeName}
                                                    </TableCell>
                                                    <TableCell className="text-sidebar-accent dark:text-slate-400 font-medium">
                                                        {item.designation}
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex items-center gap-2">
                                                            <Input
                                                                value={currentUsername}
                                                                onChange={(e) =>
                                                                    handleFieldChange(
                                                                        item.id,
                                                                        "username",
                                                                        e.target.value
                                                                    )
                                                                }
                                                                className={cn(
                                                                    "h-9 w-full border border-primary/30 text-sm font-medium",
                                                                    "bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20",
                                                                    "dark:bg-brand-green-darker dark:border-sidebar-accent dark:text-slate-100",
                                                                    "transition-all duration-200"
                                                                )}
                                                            />
                                                            {itemHasChanges && (
                                                                <Button
                                                                    size="sm"
                                                                    onClick={() => handleSave(item.id)}
                                                                    disabled={isSaving}
                                                                    className="h-9 px-3 text-xs bg-primary hover:bg-primary"
                                                                >
                                                                    <Save className="h-3.5 w-3.5" />
                                                                </Button>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex items-center gap-2">
                                                            <Input
                                                                type="text"
                                                                value={currentPassword}
                                                                onChange={(e) =>
                                                                    handleFieldChange(
                                                                        item.id,
                                                                        "password",
                                                                        e.target.value
                                                                    )
                                                                }
                                                                className={cn(
                                                                    "h-9 w-full border border-primary/30 text-sm font-medium",
                                                                    "bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20",
                                                                    "dark:bg-brand-green-darker dark:border-sidebar-accent dark:text-slate-100",
                                                                    "transition-all duration-200"
                                                                )}
                                                            />
                                                            {itemHasChanges && (
                                                                <Button
                                                                    size="sm"
                                                                    onClick={() => handleSave(item.id)}
                                                                    disabled={isSaving}
                                                                    className="h-9 px-3 text-xs bg-primary hover:bg-primary"
                                                                >
                                                                    <Save className="h-3.5 w-3.5" />
                                                                </Button>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-center">
                                                        <div className="flex items-center justify-center gap-3">
                                                            <Switch
                                                                checked={item.loginStatus}
                                                                onCheckedChange={(checked) =>
                                                                    handleLoginStatusToggle(
                                                                        item.id,
                                                                        checked
                                                                    )
                                                                }
                                                                disabled={isSaving}
                                                                aria-label={`Toggle login status for ${item.employeeName}`}
                                                            />
                                                            <span className={cn(
                                                                "text-xs font-medium",
                                                                item.loginStatus
                                                                    ? "text-primary dark:text-primary"
                                                                    : "text-slate-500 dark:text-slate-400"
                                                            )}>
                                                                {item.loginStatus ? "Enabled" : "Disabled"}
                                                            </span>
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
