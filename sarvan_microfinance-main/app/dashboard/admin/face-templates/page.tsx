'use client';

import { useEffect, useState } from 'react';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { PageLoader } from '@/components/ui/page-loader';
import {
  Search,
  ScanFace,
  Eye,
  Settings2,
  ShieldCheck,
} from 'lucide-react';
import { useFaceTemplates } from '@/app/hooks/use-face-templates';
import { getRoleDisplayName } from '@/app/lib/role-display';
import { TrainedFaceModal } from '@/app/components/users/TrainedFaceModal';
import { useToast } from '@/app/hooks/use-toast';
import { toDisplayDate } from '@/app/lib/date-format';

interface AttendanceConfig {
  faceTrainingEnabled: boolean;
  faceAttendanceEnabled: boolean;
}

export default function FaceTemplatesPage() {
  const { templates, isLoading, fetchTemplates } = useFaceTemplates();
  const { toast } = useToast();

  const [search, setSearch] = useState('');
  const [detailUser, setDetailUser] = useState<{ id: string; firstName: string; lastName: string } | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Admin Controls State
  const [config, setConfig] = useState<AttendanceConfig>({
    faceTrainingEnabled: true,
    faceAttendanceEnabled: true,
  });
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  useEffect(() => {
    fetchTemplates();
    fetchConfig();
  }, [fetchTemplates]);

  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/admin/attendance-config');
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          setConfig(json.data);
        }
      }
    } catch (e) {
      console.error('Failed to load attendance config', e);
    }
  };

  const saveConfig = async (updatedConfig: AttendanceConfig) => {
    try {
      setIsSavingConfig(true);
      const res = await fetch('/api/admin/attendance-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedConfig),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.data) {
        setConfig(json.data);
        toast({
          title: 'Controls Saved',
          description: 'Attendance & Face access controls updated successfully.',
        });
      } else {
        toast({
          title: 'Save Failed',
          description: json?.error || json?.message || 'Failed to update attendance configuration.',
          variant: 'destructive',
        });
      }
    } catch (e) {
      toast({
        title: 'Error',
        description: 'Error saving configuration.',
        variant: 'destructive',
      });
    } finally {
      setIsSavingConfig(false);
    }
  };

  const toggleFaceAttendance = () => {
    const updated = {
      ...config,
      faceAttendanceEnabled: !config.faceAttendanceEnabled,
    };
    setConfig(updated);
    saveConfig(updated);
  };

  const toggleFaceTraining = () => {
    const updated = {
      ...config,
      faceTrainingEnabled: !config.faceTrainingEnabled,
    };
    setConfig(updated);
    saveConfig(updated);
  };

  const filtered = templates.filter((t) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      `${t.firstName} ${t.lastName}`.toLowerCase().includes(q) ||
      (t.employeeId ?? '').toLowerCase().includes(q) ||
      (t.branchName ?? '').toLowerCase().includes(q)
    );
  });

  const trainedCount = templates.filter((t) => t.trained).length;

  const openDetail = (t: { id: string; firstName: string; lastName: string }) => {
    setDetailUser(t);
    setDetailOpen(true);
  };

  return (
    <ProtectedRoute>
      <div className="p-6 space-y-6">
        {/* Admin Access Controls Header Card */}
        <Card className="border-emerald-200 bg-gradient-to-r from-emerald-50/50 via-white to-slate-50 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-emerald-900 text-lg font-bold">
                <Settings2 className="h-5 w-5 text-emerald-600" />
                Face Access Controls (Admin)
              </CardTitle>
              <Badge variant="outline" className="bg-emerald-100 text-emerald-800 border-emerald-300">
                Live Admin Settings
              </Badge>
            </div>
            <p className="text-sm text-slate-600">
              Enable or disable face attendance and face training. Week-off days and holidays are managed under HR &rsaquo; Week Configuration / Holiday Calendar.
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Feature Toggles */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-slate-100">
              <div className="flex items-center justify-between p-3.5 rounded-lg border bg-white shadow-2xs">
                <div className="space-y-0.5">
                  <div className="text-sm font-semibold flex items-center gap-2 text-slate-900">
                    <ShieldCheck className="h-4 w-4 text-emerald-600" />
                    Face Attendance (Punch In / Out)
                  </div>
                  <p className="text-xs text-slate-500">
                    {config.faceAttendanceEnabled
                      ? 'Enabled — Employees can punch attendance using face biometric.'
                      : 'Disabled — Face attendance is locked for all employees.'}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={config.faceAttendanceEnabled ? 'default' : 'outline'}
                  className={config.faceAttendanceEnabled ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
                  onClick={toggleFaceAttendance}
                  disabled={isSavingConfig}
                >
                  {config.faceAttendanceEnabled ? 'Enabled' : 'Disabled'}
                </Button>
              </div>

              <div className="flex items-center justify-between p-3.5 rounded-lg border bg-white shadow-2xs">
                <div className="space-y-0.5">
                  <div className="text-sm font-semibold flex items-center gap-2 text-slate-900">
                    <ScanFace className="h-4 w-4 text-emerald-600" />
                    Face Training (Biometric Registration)
                  </div>
                  <p className="text-xs text-slate-500">
                    {config.faceTrainingEnabled
                      ? 'Enabled — Unregistered employees can train their face template.'
                      : 'Disabled — Face registration is locked by Admin.'}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={config.faceTrainingEnabled ? 'default' : 'outline'}
                  className={config.faceTrainingEnabled ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
                  onClick={toggleFaceTraining}
                  disabled={isSavingConfig}
                >
                  {config.faceTrainingEnabled ? 'Enabled' : 'Disabled'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Employees Trained Faces Table */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ScanFace className="h-5 w-5 text-emerald-600" />
                Trained Faces
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {trainedCount} of {templates.length} employees have registered their face biometric.
              </p>
            </div>
            <div className="relative w-72">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, employee ID, branch…"
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent>
            {isLoading && templates.length === 0 ? (
              <PageLoader fullScreen={false} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Employee ID</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Quality</TableHead>
                    <TableHead>Captured</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={undefined} />
                            <AvatarFallback>
                              {t.firstName[0]}
                              {t.lastName[0]}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">
                            {t.firstName} {t.lastName}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>{t.employeeId ?? '—'}</TableCell>
                      <TableCell>{t.branchName ?? '—'}</TableCell>
                      <TableCell>{getRoleDisplayName({ role: t.role })}</TableCell>
                      <TableCell>
                        {t.trained ? (
                          <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-emerald-300">
                            Trained
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            Not trained
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {t.qualityScore != null ? `${t.qualityScore.toFixed(0)}%` : '—'}
                      </TableCell>
                      <TableCell>
                        {t.capturedAt ? toDisplayDate(new Date(t.capturedAt)) : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        {t.trained && (
                          <Button variant="ghost" size="sm" onClick={() => openDetail(t)}>
                            <Eye className="h-4 w-4 mr-1 text-emerald-600" />
                            View
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                        No employees match your search.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <TrainedFaceModal
          open={detailOpen}
          onOpenChange={setDetailOpen}
          user={detailUser}
          onRevoked={() => fetchTemplates()}
        />
      </div>
    </ProtectedRoute>
  );
}
