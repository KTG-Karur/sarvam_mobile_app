'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { FileStack, Upload, Download, Trash2 } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';
import { PageLoader } from '@/components/ui/page-loader';

const ADMIN_ROLES = ['ADMIN', 'HR', 'HRM', 'CM-HR'];

type Policy = {
    id: string;
    title: string;
    category: string | null;
    fileUrl: string;
    fileName: string;
    isPublished?: boolean;
    publishedAt: string | null;
    uploadedBy?: { firstName: string; lastName: string };
};

export function PolicyLibrary() {
    const { toast } = useToast();
    const storedUser = tokenStorage.getUser();
    const isAdmin = !!storedUser?.role && ADMIN_ROLES.includes(storedUser.role);

    const [policies, setPolicies] = useState<Policy[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isUploadOpen, setIsUploadOpen] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [title, setTitle] = useState('');
    const [category, setCategory] = useState('');
    const [file, setFile] = useState<File | null>(null);

    const fetchPolicies = useCallback(async () => {
        try {
            const res = await apiClient.get<Policy[]>(isAdmin ? '/hr/policies' : '/hr/policies/published');
            if (res.success && res.data) setPolicies(res.data);
        } catch {
            toast({ title: 'Error', description: 'Failed to fetch policies.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [isAdmin, toast]);

    useEffect(() => {
        fetchPolicies();
    }, [fetchPolicies]);

    const handleUpload = async () => {
        if (!file || !title.trim()) {
            toast({ title: 'Validation Error', description: 'Title and file are required.', variant: 'destructive' });
            return;
        }
        setIsUploading(true);
        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('title', title.trim());
            if (category) formData.append('category', category);

            const res = await apiClient.post('/hr/policies', formData);
            if (res.success) {
                toast({ title: 'Uploaded', description: 'Policy uploaded successfully.' });
                setIsUploadOpen(false);
                setTitle(''); setCategory(''); setFile(null);
                await fetchPolicies();
            } else {
                throw new Error(res.error || 'Upload failed');
            }
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Upload failed.', variant: 'destructive' });
        } finally {
            setIsUploading(false);
        }
    };

    const handleTogglePublish = async (policy: Policy) => {
        try {
            const res = await apiClient.patch(`/hr/policies/${policy.id}`, { isPublished: !policy.isPublished });
            if (res.success) {
                await fetchPolicies();
            } else {
                throw new Error(res.error || 'Update failed');
            }
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Update failed.', variant: 'destructive' });
        }
    };

    const handleDelete = async (policy: Policy) => {
        try {
            const res = await apiClient.delete(`/hr/policies/${policy.id}`);
            if (res.success) {
                toast({ title: 'Deleted', description: `"${policy.title}" deleted.` });
                await fetchPolicies();
            } else {
                throw new Error(res.error || 'Delete failed');
            }
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Delete failed.', variant: 'destructive' });
        }
    };

    const handleDownload = async (policy: Policy) => {
        try {
            const res = await apiClient.get<{ url: string }>(`/storage/signed-url?key=${encodeURIComponent(policy.fileUrl)}`);
            if (res.success && res.data?.url) window.open(res.data.url, '_blank', 'noopener,noreferrer');
        } catch {
            toast({ title: 'Error', description: 'Could not resolve document URL.', variant: 'destructive' });
        }
    };

    if (isLoading) {
        return <PageLoader label="Loading Policies..." fullScreen={false} />;
    }

    return (
        <div className="relative min-h-screen">
            <div className="mx-auto max-w-5xl space-y-6">
                <div className="mb-8 flex items-center justify-between mt-4">
                    <div className="flex items-center gap-4">
                        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                            <FileStack className="h-7 w-7 text-white" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">Policies &amp; Documents</h1>
                            <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                {isAdmin ? 'Upload, publish and manage policy documents.' : 'View and download published policies.'}
                            </p>
                        </div>
                    </div>
                    {isAdmin && (
                        <Button onClick={() => setIsUploadOpen(true)} className="bg-primary text-white">
                            <Upload className="h-4 w-4 mr-2" />
                            Upload Policy
                        </Button>
                    )}
                </div>

                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40 overflow-hidden">
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-green-50/50 dark:bg-brand-green-darker/50">
                                        <TableHead>Title</TableHead>
                                        <TableHead>Category</TableHead>
                                        {isAdmin && <TableHead>Published</TableHead>}
                                        <TableHead className="text-center">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {policies.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={isAdmin ? 4 : 3} className="px-4 py-12 text-center text-slate-500">No policies available.</TableCell>
                                        </TableRow>
                                    ) : (
                                        policies.map((policy) => (
                                            <TableRow key={policy.id}>
                                                <TableCell className="text-sm font-medium">{policy.title}</TableCell>
                                                <TableCell className="text-sm text-slate-500">{policy.category || '—'}</TableCell>
                                                {isAdmin && (
                                                    <TableCell>
                                                        <div className="flex items-center gap-2">
                                                            <Switch checked={!!policy.isPublished} onCheckedChange={() => handleTogglePublish(policy)} />
                                                            <Badge variant={policy.isPublished ? 'default' : 'outline'}>
                                                                {policy.isPublished ? 'Published' : 'Draft'}
                                                            </Badge>
                                                        </div>
                                                    </TableCell>
                                                )}
                                                <TableCell className="text-center">
                                                    <div className="flex items-center justify-center gap-1">
                                                        <Button size="sm" variant="ghost" onClick={() => handleDownload(policy)} title="Download">
                                                            <Download className="h-4 w-4" />
                                                        </Button>
                                                        {isAdmin && (
                                                            <Button size="sm" variant="ghost" className="text-red-600" onClick={() => handleDelete(policy)} title="Delete">
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
            </div>

            <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Upload Policy</DialogTitle></DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>Title</Label>
                            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>Category (optional)</Label>
                            <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. HR Policy, Code of Conduct" />
                        </div>
                        <div className="space-y-2">
                            <Label>File (PDF, JPEG or PNG)</Label>
                            <Input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsUploadOpen(false)} disabled={isUploading}>Cancel</Button>
                        <Button onClick={handleUpload} disabled={isUploading}>Upload</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
