'use client';

import { useState, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useSignedUrl } from '@/hooks/useSignedUrl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { PasswordInput } from '@/components/ui/password-input';
import { Separator } from '@/components/ui/separator';
import {
  User, Phone, Mail, Building2, Briefcase, GraduationCap,
  MapPin, FileText, Shield, Loader2, Save, IdCard, Lock,
  Camera, CheckCircle2,
} from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';
import { branchStorage } from '@/app/lib/branch-storage';
import { getRoleDisplayName } from '@/app/lib/role-display';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { compressImageForCategory } from '@/app/lib/image-compress';

// ── Types ────────────────────────────────────────────────────────────────────
interface FullProfile {
  id: string;
  employeeId?: string | null;
  firstName: string;
  lastName: string;
  mobileNumber?: string | null;
  email?: string | null;
  role: string;
  branchId?: string | null;
  profilePhotoUrl?: string | null;
  /** KYC "Photo" document (the ID-card photo) — shown when no profile photo was uploaded. */
  idCardPhotoKey?: string | null;
  fatherName?: string | null;
  motherName?: string | null;
  education?: string | null;
  address?: string | null;
  aadhaarNumber?: string | null;
  aadhaarDocUrl?: string | null;
  panNumber?: string | null;
  panDocUrl?: string | null;
  esiNumber?: string | null;
  pfNumber?: string | null;
  esiPfDocUrl?: string | null;
  hasChangedPassword?: boolean;
  hasChangedProfilePhoto?: boolean;
  rbacRole?: { name: string; color?: string | null } | null;
}

// ── Password schema ───────────────────────────────────────────────────────────
const passwordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
  confirmPassword: z.string().min(1, 'Please confirm your new password'),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

type PasswordFormData = z.infer<typeof passwordSchema>;

// ── Helpers ───────────────────────────────────────────────────────────────────
function maskAadhaar(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 4) return value;
  return `XXXX XXXX ${digits.slice(-4)}`;
}

function maskPan(value: string): string {
  if (value.length < 6) return value;
  return `${value.slice(0, 2)}${'*'.repeat(value.length - 4)}${value.slice(-2)}`;
}

function InfoRow({ icon: Icon, label, value }: {
  icon: React.ElementType;
  label: string;
  value?: string | null;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-primary/10 last:border-0">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-green-50 dark:bg-brand-green-darker/60">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-400 dark:text-slate-500">{label}</p>
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100 break-words">{value}</p>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
interface ProfileModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
}

export function ProfileModal({ open, onOpenChange, userId }: ProfileModalProps) {
  const { toast } = useToast();
  const [profile, setProfile] = useState<FullProfile | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [activeBranchName, setActiveBranchName] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  // ── Load profile on open ──────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !userId) return;

    // Immediate: load basic info from localStorage
    const stored = tokenStorage.getUser();
    if (stored) {
      setProfile({
        id: stored.id,
        firstName: stored.firstName,
        lastName: stored.lastName,
        email: stored.email,
        role: stored.role,
        branchId: stored.branchId,
        rbacRole: stored.rbacRoleName ? { name: stored.rbacRoleName } : null,
      });
    }

    const branch = branchStorage.getActiveBranch();
    if (branch) setActiveBranchName(`${branch.name} (${branch.code})`);

    // Then fetch full profile for extended fields
    setIsLoadingProfile(true);
    apiClient.get<FullProfile>(`/users/${userId}`)
      .then((result) => {
        if (result.success && result.data) setProfile(result.data);
      })
      .catch(() => { /* keep localStorage data on network error */ })
      .finally(() => setIsLoadingProfile(false));
  }, [open, userId]);

  // ── Profile photo upload ──────────────────────────────────────────────────
  const handlePhotoFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    e.target.value = '';

    setIsUploadingPhoto(true);
    try {
      const compressionResult = await compressImageForCategory(file, 'portrait');
      const { compressedFile, previewUrl } = compressionResult;
      URL.revokeObjectURL(previewUrl);
      const compressionNote = compressionResult.wasCompressed
        ? `${compressionResult.originalSizeLabel} → ${compressionResult.compressedSizeLabel} (saved ${compressionResult.reductionPercent}%).`
        : '';

      const token = tokenStorage.getAccessToken();
      const formData = new FormData();
      formData.append('file', compressedFile);
      formData.append('docType', 'profile');
      formData.append('employeeId', profile.employeeId || profile.id);

      const uploadRes = await fetch('/api/employees/upload-document', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const uploadJson = await uploadRes.json();
      if (!uploadJson.success) {
        toast({ title: 'Upload failed', description: uploadJson.error || 'Could not upload photo', variant: 'destructive' });
        return;
      }

      const photoUrl: string = uploadJson.data.url;

      // Save to DB and set one-time lock
      const saveResult = await apiClient.post<{ profilePhotoUrl: string }>('/users/update-profile-photo', {
        profilePhotoUrl: photoUrl,
      });

      if (!saveResult.success) {
        toast({ title: 'Error', description: saveResult.error || 'Failed to save photo', variant: 'destructive' });
        return;
      }

      setProfile((prev) => prev ? { ...prev, profilePhotoUrl: photoUrl, hasChangedProfilePhoto: true } : prev);
      toast({
        title: 'Profile photo saved',
        description: `Your photo has been updated. This cannot be changed again. ${compressionNote}`.trim(),
      });
    } catch {
      toast({ title: 'Error', description: 'Network error. Please try again.', variant: 'destructive' });
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  // ── Password change handler ───────────────────────────────────────────────
  const handlePasswordChange = async (values: PasswordFormData) => {
    setIsSavingPassword(true);
    try {
      const result = await apiClient.post('/auth/change-password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      if (!result.success) {
        toast({ title: 'Error', description: result.error || 'Failed to change password', variant: 'destructive' });
        return;
      }
      setProfile((prev) => prev ? { ...prev, hasChangedPassword: true } : prev);
      toast({ title: 'Password changed', description: 'Your password has been updated. This cannot be changed again.' });
      form.reset();
    } catch {
      toast({ title: 'Error', description: 'Network error. Please try again.', variant: 'destructive' });
    } finally {
      setIsSavingPassword(false);
    }
  };

  // Stored photos are private storage keys, so they're resolved to a signed
  // URL. An uploaded profile photo wins (it's the user's own choice); otherwise
  // the same photo as their employee ID card.
  const avatarSrc = useSignedUrl(profile?.profilePhotoUrl || profile?.idCardPhotoKey || null);

  const displayName = profile ? `${profile.firstName} ${profile.lastName}` : '';
  const roleLabel = profile
    ? (profile.rbacRole?.name ?? getRoleDisplayName(profile as Parameters<typeof getRoleDisplayName>[0]))
    : '';
  const initial = profile?.firstName?.charAt(0).toUpperCase() ?? '?';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg w-full max-h-[90vh] overflow-y-auto p-0 gap-0">
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="bg-gradient-to-r from-primary to-sidebar-accent px-6 py-5 rounded-t-lg">
          <DialogHeader>
            <DialogTitle className="sr-only">My Profile</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16 border-2 border-secondary shrink-0">
              {avatarSrc && (
                <AvatarImage src={avatarSrc} alt={displayName} className="object-cover" />
              )}
              <AvatarFallback className="bg-secondary text-foreground text-xl font-bold">
                {initial}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-white truncate">{displayName || '—'}</h2>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {roleLabel && (
                  <Badge
                    className={cn(
                      'text-xs font-medium border-0',
                      !profile?.rbacRole?.color && 'bg-secondary/20 text-secondary'
                    )}
                    style={
                      profile?.rbacRole?.color
                        ? { backgroundColor: `${profile.rbacRole.color}33`, color: profile.rbacRole.color }
                        : undefined
                    }
                  >
                    {roleLabel}
                  </Badge>
                )}
                {activeBranchName && (
                  <Badge className="text-xs font-medium bg-white/10 text-white/80 border-0">
                    {activeBranchName}
                  </Badge>
                )}
              </div>
              {profile?.employeeId && (
                <p className="text-xs text-white/60 mt-1 font-mono">{profile.employeeId}</p>
              )}
            </div>
          </div>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* ── Profile Info ─────────────────────────────────────────────── */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-sidebar-accent dark:text-primary mb-3">
              Profile Information
            </h3>
            {isLoadingProfile && !profile && (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            )}
            {profile && (
              <div className="space-y-0">
                <InfoRow icon={User}         label="Full Name"         value={displayName} />
                <InfoRow icon={IdCard}       label="Employee ID"       value={profile.employeeId} />
                <InfoRow icon={Phone}        label="Mobile Number"     value={profile.mobileNumber} />
                <InfoRow icon={Mail}         label="Email ID"          value={profile.email} />
                <InfoRow icon={GraduationCap} label="Education Qualification" value={profile.education} />
                <InfoRow icon={MapPin}       label="Current Address"   value={profile.address} />
                <InfoRow icon={User}         label="Father Name"       value={profile.fatherName} />
                <InfoRow icon={User}         label="Mother Name"       value={profile.motherName} />
                <InfoRow icon={Building2}    label="Branch"            value={activeBranchName} />
              </div>
            )}
          </section>

          {/* ── Identity Documents ───────────────────────────────────────── */}
          {profile && (profile.aadhaarNumber || profile.panNumber || profile.esiNumber || profile.pfNumber) && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-sidebar-accent dark:text-primary mb-3">
                Identity &amp; Documents
              </h3>
              <div className="space-y-0">
                {profile.aadhaarNumber && (
                  <div className="flex items-start gap-3 py-2.5 border-b border-primary/10">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-green-50 dark:bg-brand-green-darker/60">
                      <Shield className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-slate-400">Aadhaar Number</p>
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-100 font-mono">
                        {maskAadhaar(profile.aadhaarNumber)}
                      </p>
                      {profile.aadhaarDocUrl && (
                        <a href={profile.aadhaarDocUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-0.5">
                          <FileText className="h-3 w-3" /> View document
                        </a>
                      )}
                    </div>
                  </div>
                )}
                {profile.panNumber && (
                  <div className="flex items-start gap-3 py-2.5 border-b border-primary/10">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-green-50 dark:bg-brand-green-darker/60">
                      <Briefcase className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-slate-400">PAN Number</p>
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-100 font-mono">
                        {maskPan(profile.panNumber)}
                      </p>
                      {profile.panDocUrl && (
                        <a href={profile.panDocUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-0.5">
                          <FileText className="h-3 w-3" /> View document
                        </a>
                      )}
                    </div>
                  </div>
                )}
                {(profile.esiNumber || profile.pfNumber) && (
                  <div className="flex items-start gap-3 py-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-green-50 dark:bg-brand-green-darker/60">
                      <Briefcase className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      {profile.esiNumber && (
                        <>
                          <p className="text-xs text-slate-400">ESI Number</p>
                          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{profile.esiNumber}</p>
                        </>
                      )}
                      {profile.pfNumber && (
                        <>
                          <p className="text-xs text-slate-400 mt-1">PF / UAN Number</p>
                          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{profile.pfNumber}</p>
                        </>
                      )}
                      {profile.esiPfDocUrl && (
                        <a href={profile.esiPfDocUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-0.5">
                          <FileText className="h-3 w-3" /> View document
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ── Profile Photo ─────────────────────────────────────────────── */}
          {profile && (
            <section>
              <Separator className="mb-5 bg-primary/15" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-sidebar-accent dark:text-primary mb-4">
                Profile Photo
              </h3>
              <div className="flex items-center gap-4">
                <Avatar className="h-20 w-20 border-2 border-primary/30 shrink-0">
                  {avatarSrc && (
                    <AvatarImage src={avatarSrc} alt={displayName} className="object-cover" />
                  )}
                  <AvatarFallback className="bg-green-50 text-primary text-2xl font-bold dark:bg-brand-green-darker">
                    {initial}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  {profile.hasChangedProfilePhoto ? (
                    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                      <span className="text-sm text-slate-600 dark:text-slate-300">
                        Photo is set and locked. Contact admin to change.
                      </span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Upload your profile photo. <span className="font-medium text-amber-600">Can only be changed once.</span>
                      </p>
                      <input
                        ref={photoInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handlePhotoFileSelect}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isUploadingPhoto}
                        onClick={() => photoInputRef.current?.click()}
                        className="border-primary/30 text-sidebar-accent hover:bg-green-50 dark:text-primary"
                      >
                        {isUploadingPhoto ? (
                          <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Uploading…</>
                        ) : (
                          <><Camera className="mr-2 h-4 w-4" />Upload Photo</>
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* ── Change Password ───────────────────────────────────────────── */}
          <section>
            <Separator className="mb-5 bg-primary/15" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-sidebar-accent dark:text-primary mb-4">
              Change Password
            </h3>
            {profile?.hasChangedPassword ? (
              <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-700/40 dark:bg-amber-900/20">
                <Lock className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span className="text-sm text-amber-700 dark:text-amber-300">
                  Password has already been changed. Contact your administrator for further changes.
                </span>
              </div>
            ) : (
              <Form {...form}>
                <form onSubmit={form.handleSubmit(handlePasswordChange)} className="space-y-4">
                  <p className="text-xs text-slate-500 dark:text-slate-400 -mt-1">
                    <span className="font-medium text-amber-600">One-time change only.</span> Choose a strong password.
                  </p>
                  <FormField
                    control={form.control}
                    name="currentPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm">Current Password</FormLabel>
                        <FormControl>
                          <PasswordInput placeholder="Enter current password" {...field}
                            className="h-10 border-primary/30 bg-green-50 dark:bg-brand-green-darker dark:border-sidebar-accent"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="newPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm">New Password</FormLabel>
                        <FormControl>
                          <PasswordInput placeholder="Min 8 characters" {...field}
                            className="h-10 border-primary/30 bg-green-50 dark:bg-brand-green-darker dark:border-sidebar-accent"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="confirmPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm">Confirm New Password</FormLabel>
                        <FormControl>
                          <PasswordInput placeholder="Re-enter new password" {...field}
                            className="h-10 border-primary/30 bg-green-50 dark:bg-brand-green-darker dark:border-sidebar-accent"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    type="submit"
                    disabled={isSavingPassword}
                    className="w-full bg-primary hover:bg-sidebar-accent text-white h-10"
                  >
                    {isSavingPassword ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Updating…</>
                    ) : (
                      <><Save className="mr-2 h-4 w-4" /> Update Password</>
                    )}
                  </Button>
                </form>
              </Form>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
