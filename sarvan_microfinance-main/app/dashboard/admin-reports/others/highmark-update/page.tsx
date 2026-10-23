'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { RefreshCw, Download, Loader2, FileText, Upload, CheckCircle } from 'lucide-react';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function HighmarkUpdatePage() {
    const { toast } = useToast();
    const [isLoading, setIsLoading] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);

    const handleUpdate = () => {
        setIsUpdating(true);
        // Simulate API call
        setTimeout(() => {
            setIsUpdating(false);
            toast({
                title: 'Update successful',
                description: 'Highmark data has been updated successfully.',
            });
        }, 1500);
    };

    const handleExport = () => {
        toast({
            title: 'Export started',
            description: 'Exporting Highmark Update report. This will trigger an export once backend integration is ready.',
        });
        // TODO: Implement actual export functionality
    };

    return (
        <ProtectedRoute>
            <div className="relative min-h-screen bg-gradient-to-br from-background via-purple-50/30 to-pink-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
                <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-8">
                    {/* Header Section */}
                    <div className="mb-8">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-600 to-pink-600 shadow-lg shadow-purple-500/30">
                                <Upload className="h-7 w-7 text-white" />
                                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent" />
                            </div>
                            <div className="flex-1">
                                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                    Highmark Update
                                </h1>
                                <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                    Update highmark data for clients and loan accounts
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Main Content Card */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                        <div className="h-1.5 bg-gradient-to-r from-purple-600 via-pink-600 to-rose-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-purple-50/60 to-pink-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30">
                                        <Upload className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                                    </div>
                                    <div>
                                        <CardTitle className="text-xl">Highmark Update</CardTitle>
                                        <CardDescription>
                                            Update highmark information for clients
                                        </CardDescription>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={handleExport}
                                        className="border-purple-300 text-purple-700 hover:bg-purple-50 dark:border-purple-700 dark:text-purple-300"
                                    >
                                        <Download className="h-4 w-4 mr-2" />
                                        Export
                                    </Button>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <div className="space-y-6">
                                <div className="p-12 text-center">
                                    <FileText className="mx-auto h-16 w-16 text-slate-400 dark:text-slate-500 mb-4" />
                                    <p className="text-sm font-medium text-sidebar-accent dark:text-slate-400">
                                        Highmark Update functionality will be implemented here
                                    </p>
                                    <p className="text-xs text-slate-500 dark:text-slate-500 mt-2">
                                        This feature allows updating highmark data for clients and loan accounts
                                    </p>
                                </div>

                                <div className="flex justify-center gap-4 pt-4">
                                    <Button
                                        onClick={handleUpdate}
                                        disabled={isUpdating}
                                        className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white shadow-lg shadow-purple-500/30"
                                    >
                                        {isUpdating ? (
                                            <>
                                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                                Updating...
                                            </>
                                        ) : (
                                            <>
                                                <CheckCircle className="h-4 w-4 mr-2" />
                                                Update Highmark
                                            </>
                                        )}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        onClick={() => {
                                            toast({
                                                title: 'Reset',
                                                description: 'Form has been reset.',
                                            });
                                        }}
                                        className="border-primary/30 text-sidebar-accent hover:bg-green-50 dark:border-sidebar-accent dark:text-slate-300"
                                    >
                                        <RefreshCw className="h-4 w-4 mr-2" />
                                        Reset
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </ProtectedRoute>
    );
}

