'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { RefreshCw, Download, Loader2, FileText, MessageSquare, Save } from 'lucide-react';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function SMSFormatPage() {
    const { toast } = useToast();
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [smsFormat, setSmsFormat] = useState('');

    const handleSave = () => {
        if (!smsFormat.trim()) {
            toast({
                title: 'Format required',
                description: 'Please enter SMS format before saving.',
                variant: 'destructive',
            });
            return;
        }

        setIsSaving(true);
        // Simulate API call
        setTimeout(() => {
            setIsSaving(false);
            toast({
                title: 'Save successful',
                description: 'SMS format has been saved successfully.',
            });
        }, 1500);
    };

    const handleExport = () => {
        toast({
            title: 'Export started',
            description: 'Exporting SMS Format report. This will trigger an export once backend integration is ready.',
        });
        // TODO: Implement actual export functionality
    };

    return (
        <ProtectedRoute>
            <div className="relative min-h-screen bg-gradient-to-br from-background via-cyan-50/30 to-green-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
                <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-8">
                    {/* Header Section */}
                    <div className="mb-8">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-600 to-primary shadow-lg shadow-cyan-500/30">
                                <MessageSquare className="h-7 w-7 text-white" />
                                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent" />
                            </div>
                            <div className="flex-1">
                                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                    SMS Format
                                </h1>
                                <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                    Configure SMS message formats for notifications and alerts
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Main Content Card */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                        <div className="h-1.5 bg-gradient-to-r from-cyan-600 via-primary to-primary" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-cyan-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-100 dark:bg-cyan-900/30">
                                        <MessageSquare className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                                    </div>
                                    <div>
                                        <CardTitle className="text-xl">SMS Format Configuration</CardTitle>
                                        <CardDescription>
                                            Manage SMS message templates and formats
                                        </CardDescription>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={handleExport}
                                        className="border-cyan-300 text-cyan-700 hover:bg-cyan-50 dark:border-cyan-700 dark:text-cyan-300"
                                    >
                                        <Download className="h-4 w-4 mr-2" />
                                        Export
                                    </Button>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <div className="space-y-6">
                                <div className="space-y-2">
                                    <Label htmlFor="smsFormat" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        SMS Format Template
                                    </Label>
                                    <Textarea
                                        id="smsFormat"
                                        value={smsFormat}
                                        onChange={(e) => setSmsFormat(e.target.value)}
                                        placeholder="Enter SMS format template here. Use variables like {clientName}, {amount}, {date}, etc."
                                        className="min-h-[200px] border-primary/30 dark:border-sidebar-accent"
                                        disabled={isLoading || isSaving}
                                    />
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        Use placeholders like {'{clientName}'}, {'{amount}'}, {'{date}'} for dynamic content
                                    </p>
                                </div>

                                <div className="p-8 text-center border-2 border-dashed border-primary/30 dark:border-sidebar-accent rounded-lg">
                                    <FileText className="mx-auto h-12 w-12 text-slate-400 dark:text-slate-500 mb-4" />
                                    <p className="text-sm font-medium text-sidebar-accent dark:text-slate-400">
                                        SMS Format management functionality will be implemented here
                                    </p>
                                    <p className="text-xs text-slate-500 dark:text-slate-500 mt-2">
                                        Configure different SMS formats for various notification types
                                    </p>
                                </div>

                                <div className="flex justify-center gap-4 pt-4">
                                    <Button
                                        onClick={handleSave}
                                        disabled={isSaving || isLoading}
                                        className="bg-gradient-to-r from-cyan-600 to-primary hover:from-cyan-700 hover:to-sidebar-accent text-white shadow-lg shadow-cyan-500/30"
                                    >
                                        {isSaving ? (
                                            <>
                                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                                Saving...
                                            </>
                                        ) : (
                                            <>
                                                <Save className="h-4 w-4 mr-2" />
                                                Save Format
                                            </>
                                        )}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        onClick={() => {
                                            setSmsFormat('');
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

