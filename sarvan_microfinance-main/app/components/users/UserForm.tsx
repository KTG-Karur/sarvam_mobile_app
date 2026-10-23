'use client';

import { useState, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import dynamic from 'next/dynamic';
import {
  Save, Loader2, Upload, X, FileText, User, ShieldCheck, Briefcase, LocateFixed, AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageLoader } from '@/components/ui/page-loader';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { UserRole } from '@/app/types';
import { useUserManagement, UserWithBranch } from '@/app/hooks/use-user-management';
import { AmBranchMultiSelect } from '@/components/employees/creation/AmBranchMultiSelect';
import { compressImageForCategory, type ImageCategory } from '@/app/lib/image-compress';
import { FIELD_PATTERNS, FIELD_ERROR_MESSAGES } from '@/app/lib/hr/onboarding-form-fields';
import { filterDigits, filterUppercase } from '@/app/lib/hr/onboarding-validation-rules';
import { DateInput } from '@/components/ui/date-input';
import { useAccurateLocation } from '@/hooks/useAccurateLocation';

// Reused as-is from the centers module — it's a generic pin-drop/drag Leaflet
// map, only the prop names (centerName/centerCode) are center-flavored.
const LocationMap = dynamic(() => import('@/components/centers/CenterMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[300px] items-center justify-center rounded-lg border bg-muted">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  ),
});

// Fallback map center (India) used until the employee has coordinates set.
const DEFAULT_MAP_LAT = 10.486995;
const DEFAULT_MAP_LNG = 77.748029;

// Employee document types (UserForm) don't have their own KYC document-type
// keys, so they're mapped to a compression category directly here instead of
// going through the KYC DOCUMENT_TYPE_CATEGORY_MAP.
const DOC_TYPE_COMPRESSION_CATEGORY: Record<string, ImageCategory> = {
  profile: 'portrait',
  aadhaar: 'document',
  pan: 'document',
  esi_pf: 'document',
  location: 'house',
};

// ─── RBAC role helpers ────────────────────────────────────────────────────────
const SLUG_TO_LEGACY_ROLE: Record<string, UserRole> = {
  admin: 'ADMIN',
  'area-manager': 'AREA_MANAGER',
  'branch-manager': 'BRANCH_MANAGER',
  fdo: 'FDO',
};

function slugToLegacyRole(slug: string): UserRole {
  return SLUG_TO_LEGACY_ROLE[slug] ?? 'FDO';
}

interface RbacRole {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: string | null;
  priority: number;
}

interface Branch {
  id: string;
  name: string;
  code: string;
}

interface ActiveBranch {
  id: string;
  name: string;
  code: string;
  address?: string;
}

interface CurrentUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  branchId: string | null;
  isActive: boolean;
}

// ─── Zod Schemas ──────────────────────────────────────────────────────────────
const baseSchema = {
  mobileNumber: z.string().min(1, 'Mobile number is required').regex(FIELD_PATTERNS.MOBILE, FIELD_ERROR_MESSAGES.MOBILE),
  email: z.union([z.string().regex(FIELD_PATTERNS.EMAIL, FIELD_ERROR_MESSAGES.EMAIL), z.literal('')]).optional(),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().optional(),
  employeeId: z.string().min(1, 'Employee ID is required'),
  roleSlug: z.string().min(1, 'Role is required'),
  branchId: z.string().optional().nullable(),
  // Personal
  dateOfJoining: z.string().optional(),
  fatherName: z.string().optional(),
  motherName: z.string().optional(),
  address: z.string().optional(),
  education: z.string().optional(),
  // Documents — URL fields (filled after upload)
  aadhaarNumber: z.string().optional().refine(
    (val) => !val || val.trim() === '' || FIELD_PATTERNS.AADHAAR.test(val.trim()),
    { message: FIELD_ERROR_MESSAGES.AADHAAR }
  ),
  aadhaarDocUrl: z.string().optional(),
  panNumber: z.string().optional().refine(
    (val) => !val || val.trim() === '' || FIELD_PATTERNS.PAN.test(val.trim().toUpperCase()),
    { message: FIELD_ERROR_MESSAGES.PAN }
  ),
  panDocUrl: z.string().optional(),
  profilePhotoUrl: z.string().optional(),
  esiNumber: z.string().optional().refine(
    (val) => !val || val.trim() === '' || FIELD_PATTERNS.ESI.test(val.trim()),
    { message: FIELD_ERROR_MESSAGES.ESI }
  ),
  pfNumber: z.string().optional().refine(
    (val) => !val || val.trim() === '' || FIELD_PATTERNS.UAN.test(val.trim()),
    { message: FIELD_ERROR_MESSAGES.UAN }
  ),
  esiPfDocUrl: z.string().optional(),
  locationPhotoUrl: z.string().optional(),
  // Location — kept as plain strings (not coerced numbers) so the input isn't
  // reformatted on every keystroke, which previously stripped decimal points
  // and minus signs while typing. Parsed to a float only at submit time.
  latitude: z.string().optional(),
  longitude: z.string().optional(),
};

const createUserSchema = z.object({
  ...baseSchema,
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const updateUserSchema = z.object(baseSchema);

type CreateFormData = z.infer<typeof createUserSchema>;
type UpdateFormData = z.infer<typeof updateUserSchema>;
type UserFormData = CreateFormData | UpdateFormData;

interface UserFormProps {
  userId?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

// ─── File upload helper ───────────────────────────────────────────────────────
async function uploadDoc(
  file: File,
  docType: string,
  employeeId: string,
): Promise<{ url: string; compressionNote: string }> {
  const category = DOC_TYPE_COMPRESSION_CATEGORY[docType] ?? 'document';
  const compressionResult = await compressImageForCategory(file, category);
  const { compressedFile, previewUrl } = compressionResult;
  URL.revokeObjectURL(previewUrl);
  const compressionNote = compressionResult.wasCompressed
    ? `Compressed ${compressionResult.originalSizeLabel} → ${compressionResult.compressedSizeLabel} (saved ${compressionResult.reductionPercent}%)`
    : '';

  const fd = new FormData();
  fd.append('file', compressedFile);
  fd.append('docType', docType);
  fd.append('employeeId', employeeId);
  const res = await fetch('/api/employees/upload-document', { method: 'POST', body: fd });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Upload failed');
  return { url: json.data.url as string, compressionNote };
}

// ─── Small doc-upload sub-component ──────────────────────────────────────────
function DocUploadField({
  label,
  currentUrl,
  onUploaded,
  docType,
  employeeId,
  accept = 'image/*,application/pdf',
}: {
  label: string;
  currentUrl?: string;
  onUploaded: (url: string) => void;
  docType: string;
  employeeId: string;
  accept?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [compressionNote, setCompressionNote] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const { url, compressionNote } = await uploadDoc(file, docType, employeeId || 'temp');
      onUploaded(url);
      setCompressionNote(compressionNote);
      toast({
        title: 'Uploaded',
        description: compressionNote ? `${label} uploaded — ${compressionNote}` : `${label} uploaded successfully`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      toast({ title: 'Upload failed', description: message, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mt-1">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="h-9 gap-1.5 text-xs border-primary/30 text-sidebar-accent"
        >
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {uploading ? 'Uploading…' : currentUrl ? 'Replace' : 'Upload'}
        </Button>
        {currentUrl && (
          <a href={currentUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-primary hover:underline">
            <FileText className="h-3.5 w-3.5" />
            View file
          </a>
        )}
      </div>
      {compressionNote && (
        <p className="mt-1 text-[10px] text-blue-600 dark:text-blue-400">{compressionNote}</p>
      )}
    </div>
  );
}

// ─── Field style helper ───────────────────────────────────────────────────────
const fieldCls =
  'h-10 w-full border border-primary/30 text-sm bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20 dark:bg-brand-green-darker dark:border-sidebar-accent dark:text-slate-100 aria-invalid:border-red-500 aria-invalid:focus:border-red-500 aria-invalid:focus:ring-red-500/20 transition-all duration-200';

// ─── Main component ───────────────────────────────────────────────────────────
export function UserForm({ userId, onSuccess, onCancel }: UserFormProps) {
  const { toast } = useToast();
  const { updateUser } = useUserManagement();
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingUser, setIsLoadingUser] = useState(!!userId);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(true);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [activeBranch, setActiveBranch] = useState<ActiveBranch | null>(null);
  const [rbacRoles, setRbacRoles] = useState<RbacRole[]>([]);
  const [isLoadingRoles, setIsLoadingRoles] = useState(true);
  const [selectedRbacRole, setSelectedRbacRole] = useState<RbacRole | null>(null);
  const [amSelectedBranchIds, setAmSelectedBranchIds] = useState<string[]>([]);
  const [amPrimaryBranchId, setAmPrimaryBranchId] = useState<string | null>(null);
  const [extraBranchIds, setExtraBranchIds] = useState<string[]>([]);
  const [extraPrimaryBranchId, setExtraPrimaryBranchId] = useState<string | null>(null);
  const { locate, isLocating, locatingLabel } = useAccurateLocation();
  const [activeTab, setActiveTab] = useState<'basic' | 'personal' | 'documents' | 'role'>('basic');

  const isEditMode = !!userId;
  const schema = isEditMode ? updateUserSchema : createUserSchema;

  const form = useForm<UserFormData>({
    resolver: zodResolver(schema),
    defaultValues: (isEditMode
      ? {
          mobileNumber: '', email: '', firstName: '', lastName: '', employeeId: '',
          roleSlug: '', branchId: null,
          dateOfJoining: '',
          fatherName: '', motherName: '', address: '', education: '',
          aadhaarNumber: '', aadhaarDocUrl: '', panNumber: '', panDocUrl: '',
          profilePhotoUrl: '', esiNumber: '', pfNumber: '', esiPfDocUrl: '',
          locationPhotoUrl: '', latitude: '', longitude: '',
        }
      : {
          mobileNumber: '', email: '', password: '', firstName: '', lastName: '',
          employeeId: '', roleSlug: '', branchId: null,
          dateOfJoining: '',
          fatherName: '', motherName: '', address: '', education: '',
          aadhaarNumber: '', aadhaarDocUrl: '', panNumber: '', panDocUrl: '',
          profilePhotoUrl: '', esiNumber: '', pfNumber: '', esiPfDocUrl: '',
          locationPhotoUrl: '', latitude: '', longitude: '',
        }) as UserFormData,
  });

  const selectedRoleSlug = form.watch('roleSlug');
  const watchedEmpId = form.watch('employeeId');

  // ── Load current user + branch from localStorage ──────────────────────────
  useEffect(() => {
    try {
      const userStr = localStorage.getItem('user');
      if (userStr) setCurrentUser(JSON.parse(userStr) as CurrentUser);
      const branchStr = localStorage.getItem('activeBranch');
      if (branchStr) setActiveBranch(JSON.parse(branchStr) as ActiveBranch);
    } catch { /* ignore */ }
  }, []);

  // ── Fetch RBAC roles ───────────────────────────────────────────────────────
  useEffect(() => {
    const fetchRoles = async () => {
      setIsLoadingRoles(true);
      try {
        const result = await apiClient.get<RbacRole[]>('/roles');
        if (result.success && result.data) {
          const filtered = result.data.filter((r) => {
            if (currentUser?.role !== 'ADMIN' && r.slug === 'admin') return false;
            return true;
          });
          setRbacRoles(filtered);
        }
      } catch {
        setRbacRoles([
          { id: 'branch-manager', name: 'Branch Manager', slug: 'branch-manager', description: null, color: '#3b82f6', priority: 200 },
          { id: 'area-manager', name: 'Area Manager', slug: 'area-manager', description: null, color: '#8b5cf6', priority: 300 },
          { id: 'fdo', name: 'Field Development Officer', slug: 'fdo', description: null, color: '#22c55e', priority: 100 },
        ]);
      } finally {
        setIsLoadingRoles(false);
      }
    };
    fetchRoles();
  }, [currentUser?.role]);

  // ── Fetch branches ─────────────────────────────────────────────────────────
  useEffect(() => {
    const fetchBranches = async () => {
      try {
        const result = await apiClient.get<Branch[]>('/branches');
        if (result.success && result.data) setBranches(result.data);
      } catch { /* ignore */ } finally {
        setIsLoadingBranches(false);
      }
    };
    fetchBranches();
  }, []);

  // ── Fetch user for edit ────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId || !currentUser) return;
    const fetchUser = async () => {
      setIsLoadingUser(true);
      try {
        const result = await apiClient.get<UserWithBranch & {
          employeeId?: string | null;
          dateOfJoining?: string | null;
          fatherName?: string | null;
          motherName?: string | null;
          address?: string | null;
          education?: string | null;
          aadhaarNumber?: string | null;
          aadhaarDocUrl?: string | null;
          panNumber?: string | null;
          panDocUrl?: string | null;
          profilePhotoUrl?: string | null;
          esiNumber?: string | null;
          pfNumber?: string | null;
          esiPfDocUrl?: string | null;
          locationPhotoUrl?: string | null;
          latitude?: number | null;
          longitude?: number | null;
        }>(`/users/${userId}`);
        if (result.success && result.data) {
          const u = result.data;
          let branchId = u.branchId || null;
          if (currentUser.role === 'AREA_MANAGER' && activeBranch?.id) branchId = activeBranch.id;
          else if (currentUser.role !== 'ADMIN') branchId = currentUser.branchId || null;

          const legacyToSlug: Record<string, string> = {
            ADMIN: 'admin', AREA_MANAGER: 'area-manager',
            BRANCH_MANAGER: 'branch-manager', FDO: 'fdo',
          };
          const roleSlug = (u as { rbacRole?: { slug?: string } }).rbacRole?.slug ?? legacyToSlug[u.role] ?? 'fdo';

          form.reset({
            mobileNumber: u.mobileNumber || '',
            email: u.email || '',
            firstName: u.firstName,
            lastName: u.lastName,
            employeeId: u.employeeId || '',
            roleSlug,
            branchId,
            dateOfJoining: u.dateOfJoining ? new Date(u.dateOfJoining).toISOString().slice(0, 10) : '',
            fatherName: u.fatherName || '',
            motherName: u.motherName || '',
            address: u.address || '',
            education: u.education || '',
            aadhaarNumber: u.aadhaarNumber || '',
            aadhaarDocUrl: u.aadhaarDocUrl || '',
            panNumber: u.panNumber || '',
            panDocUrl: u.panDocUrl || '',
            profilePhotoUrl: u.profilePhotoUrl || '',
            esiNumber: u.esiNumber || '',
            pfNumber: u.pfNumber || '',
            esiPfDocUrl: u.esiPfDocUrl || '',
            locationPhotoUrl: u.locationPhotoUrl || '',
            latitude: u.latitude != null ? String(u.latitude) : '',
            longitude: u.longitude != null ? String(u.longitude) : '',
          } as UpdateFormData);
        } else {
          toast({ title: 'Error', description: result.error || 'Failed to load user', variant: 'destructive' });
        }
      } catch {
        toast({ title: 'Error', description: 'Network error. Please try again.', variant: 'destructive' });
      } finally {
        setIsLoadingUser(false);
      }
    };
    fetchUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, currentUser, activeBranch]);

  // ── Set branchId for non-admin create ─────────────────────────────────────
  useEffect(() => {
    if (!isEditMode && currentUser) {
      if (currentUser.role === 'AREA_MANAGER' && activeBranch?.id) {
        form.setValue('branchId', activeBranch.id);
      } else if (currentUser.role !== 'ADMIN' && currentUser.branchId) {
        form.setValue('branchId', currentUser.branchId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoleSlug, isEditMode, currentUser, activeBranch]);

  // ── Keep selectedRbacRole in sync ─────────────────────────────────────────
  useEffect(() => {
    if (selectedRoleSlug && rbacRoles.length > 0) {
      setSelectedRbacRole(rbacRoles.find((r) => r.slug === selectedRoleSlug) ?? null);
    }
  }, [selectedRoleSlug, rbacRoles]);

  const handleRoleChange = (slug: string, onChange: (v: string) => void) => {
    onChange(slug);
    setAmSelectedBranchIds([]);
    setAmPrimaryBranchId(null);
    if (currentUser?.role === 'AREA_MANAGER' && activeBranch?.id) {
      form.setValue('branchId', activeBranch.id);
    } else if (currentUser && currentUser.role !== 'ADMIN' && currentUser.branchId) {
      form.setValue('branchId', currentUser.branchId);
    }
  };

  const isBranchDisabled = () => {
    if (isLoadingUser) return true;
    if (currentUser?.role === 'AREA_MANAGER') return true;
    if (currentUser && currentUser.role !== 'ADMIN') return true;
    return false;
  };

  const isAmRole =
    selectedRbacRole?.slug === 'area-manager' ||
    slugToLegacyRole(selectedRoleSlug) === 'AREA_MANAGER';

  // ── Location: geolocation button + click/drag map (mirrors CenterForm) ────
  // Samples high-accuracy GPS and keeps the best fix (not the browser's first coarse guess)
  const handleUseMyLocation = () =>
    locate({
      onPosition: (lat, lng) => {
        form.setValue('latitude', lat.toFixed(6));
        form.setValue('longitude', lng.toFixed(6));
      },
      subject: 'Location',
    });

  const handleMapLocationChange = (lat: number, lng: number) => {
    form.setValue('latitude', lat.toFixed(6));
    form.setValue('longitude', lng.toFixed(6));
  };

  const watchedLatitude = form.watch('latitude');
  const watchedLongitude = form.watch('longitude');
  const parsedLat = watchedLatitude ? parseFloat(watchedLatitude) : NaN;
  const parsedLng = watchedLongitude ? parseFloat(watchedLongitude) : NaN;
  const mapLat = Number.isFinite(parsedLat) ? parsedLat : DEFAULT_MAP_LAT;
  const mapLng = Number.isFinite(parsedLng) ? parsedLng : DEFAULT_MAP_LNG;

  // ── Submit ─────────────────────────────────────────────────────────────────
  const onSubmit = async (values: UserFormData) => {
    setIsLoading(true);
    try {
      const legacyRole = slugToLegacyRole(values.roleSlug);
      const isAM = legacyRole === 'AREA_MANAGER';

      const extendedFields = {
        dateOfJoining: values.dateOfJoining || undefined,
        fatherName: values.fatherName || undefined,
        motherName: values.motherName || undefined,
        address: values.address || undefined,
        education: values.education || undefined,
        aadhaarNumber: values.aadhaarNumber || undefined,
        aadhaarDocUrl: values.aadhaarDocUrl || undefined,
        panNumber: values.panNumber || undefined,
        panDocUrl: values.panDocUrl || undefined,
        profilePhotoUrl: values.profilePhotoUrl || undefined,
        esiNumber: values.esiNumber || undefined,
        pfNumber: values.pfNumber || undefined,
        esiPfDocUrl: values.esiPfDocUrl || undefined,
        locationPhotoUrl: values.locationPhotoUrl || undefined,
        latitude: values.latitude ? parseFloat(values.latitude) : null,
        longitude: values.longitude ? parseFloat(values.longitude) : null,
      };

      if (isEditMode && userId) {
        // updateUser already toasts its own error on failure (e.g. server-side
        // validation rejects the payload) — bail out here instead of falling
        // through to the blind "Success" toast below, which would otherwise
        // mask a failed update as if it had gone through.
        const updated = await updateUser(userId, {
          mobileNumber: values.mobileNumber,
          email: values.email,
          firstName: values.firstName,
          lastName: values.lastName,
          role: legacyRole,
          branchId: values.branchId || null,
          rbacRoleId: selectedRbacRole?.id,
          ...extendedFields,
        });
        if (!updated) {
          setIsLoading(false);
          return;
        }
      } else {
        const createData = values as CreateFormData;

        if (isAM && amSelectedBranchIds.length === 0) {
          toast({ title: 'Branch Required', description: 'Please assign at least one branch to the Area Manager.', variant: 'destructive' });
          setIsLoading(false);
          return;
        }

        let branchId = createData.branchId || null;
        if (currentUser?.role === 'AREA_MANAGER' && activeBranch?.id) branchId = activeBranch.id;
        else if (currentUser && currentUser.role !== 'ADMIN') branchId = currentUser.branchId || null;

        const payload = isAM
          ? {
              mobileNumber: createData.mobileNumber,
              email: createData.email,
              password: createData.password,
              firstName: createData.firstName,
              lastName: createData.lastName,
              employeeId: createData.employeeId,
              role: legacyRole,
              branchId: null,
              assignedBranchIds: amSelectedBranchIds,
              primaryBranchId: amPrimaryBranchId ?? amSelectedBranchIds[0],
              rbacRoleId: selectedRbacRole?.id,
              ...extendedFields,
            }
          : {
              mobileNumber: createData.mobileNumber,
              email: createData.email,
              password: createData.password,
              firstName: createData.firstName,
              lastName: createData.lastName,
              employeeId: createData.employeeId,
              role: legacyRole,
              branchId,
              rbacRoleId: selectedRbacRole?.id,
              ...extendedFields,
            };

        const result = await apiClient.post<{ id: string }>('/users', payload);
        if (!result.success) {
          toast({ title: 'Error', description: result.error || 'Failed to create user', variant: 'destructive' });
          setIsLoading(false);
          return;
        }

        if (!isAM && extraBranchIds.length > 0 && result.data?.id) {
          await apiClient.post('/user-branch-assignments', {
            userId: result.data.id,
            branchIds: extraBranchIds,
            primaryBranchId: extraPrimaryBranchId ?? extraBranchIds[0],
          });
        }
      }

      toast({ title: 'Success', description: isEditMode ? 'User updated successfully' : 'User created successfully' });
      if (onSuccess) onSuccess();
    } catch {
      toast({ title: 'Error', description: 'Failed to save user. Please try again.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoadingUser) {
    return <PageLoader fullScreen={false} />;
  }

  const selectedBranchId = form.watch('branchId');
  const formErrors = form.formState.errors;
  const basicErrors = ['employeeId', 'mobileNumber', 'email', 'password', 'firstName', 'lastName']
    .reduce((acc, f) => acc + (formErrors[f as keyof typeof formErrors] ? 1 : 0), 0);
  const personalErrors = ['dateOfJoining', 'fatherName', 'motherName', 'address', 'education', 'latitude', 'longitude']
    .reduce((acc, f) => acc + (formErrors[f as keyof typeof formErrors] ? 1 : 0), 0);
  const docErrors = ['aadhaarNumber', 'aadhaarDocUrl', 'panNumber', 'panDocUrl', 'profilePhotoUrl', 'esiNumber', 'pfNumber', 'esiPfDocUrl', 'locationPhotoUrl']
    .reduce((acc, f) => acc + (formErrors[f as keyof typeof formErrors] ? 1 : 0), 0);
  const roleErrors = ['roleSlug', 'branchId']
    .reduce((acc, f) => acc + (formErrors[f as keyof typeof formErrors] ? 1 : 0), 0);

  const onInvalid = (errors: Record<string, unknown>) => {
    const errorKeys = Object.keys(errors);
    if (errorKeys.length === 0) return;

    const basicFields = ['employeeId', 'mobileNumber', 'email', 'password', 'firstName', 'lastName'];
    const personalFields = ['dateOfJoining', 'fatherName', 'motherName', 'address', 'education', 'latitude', 'longitude'];
    const docFields = ['aadhaarNumber', 'aadhaarDocUrl', 'panNumber', 'panDocUrl', 'profilePhotoUrl', 'esiNumber', 'pfNumber', 'esiPfDocUrl', 'locationPhotoUrl'];
    const roleFields = ['roleSlug', 'branchId'];

    if (errorKeys.some((k) => basicFields.includes(k))) {
      setActiveTab('basic');
    } else if (errorKeys.some((k) => personalFields.includes(k))) {
      setActiveTab('personal');
    } else if (errorKeys.some((k) => docFields.includes(k))) {
      setActiveTab('documents');
    } else if (errorKeys.some((k) => roleFields.includes(k))) {
      setActiveTab('role');
    }

    toast({
      title: 'Validation Errors',
      description: 'Please review and correct the highlighted fields before saving.',
      variant: 'destructive',
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit, onInvalid)} className="space-y-6">
        <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as 'basic' | 'personal' | 'documents' | 'role')} className="w-full">
          <TabsList className="grid w-full grid-cols-4 h-11 bg-green-50 dark:bg-brand-green-darker/60">
            <TabsTrigger value="basic" className="flex items-center gap-1.5 text-xs sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-white">
              <User className="h-3.5 w-3.5" />
              Basic Info
              {basicErrors > 0 && (
                <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 dark:bg-red-950/60 dark:text-red-400">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  {basicErrors}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="personal" className="flex items-center gap-1.5 text-xs sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-white">
              <Briefcase className="h-3.5 w-3.5" />
              Personal
              {personalErrors > 0 && (
                <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 dark:bg-red-950/60 dark:text-red-400">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  {personalErrors}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="documents" className="flex items-center gap-1.5 text-xs sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-white">
              <FileText className="h-3.5 w-3.5" />
              Documents
              {docErrors > 0 && (
                <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 dark:bg-red-950/60 dark:text-red-400">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  {docErrors}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="role" className="flex items-center gap-1.5 text-xs sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-white">
              <ShieldCheck className="h-3.5 w-3.5" />
              Role &amp; Branch
              {roleErrors > 0 && (
                <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 dark:bg-red-950/60 dark:text-red-400">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  {roleErrors}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── Tab 1: Basic Info ─────────────────────────────────────────── */}
          <TabsContent value="basic" className="pt-5">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {/* Employee ID */}
              <FormField
                control={form.control}
                name="employeeId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Employee ID <span className="text-red-500">*</span></FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. EMP-001"
                        {...field}
                        disabled={isEditMode}
                        className={fieldCls}
                      />
                    </FormControl>
                    {isEditMode && (
                      <FormDescription className="text-xs">Employee ID cannot be changed after creation</FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Mobile */}
              <FormField
                control={form.control}
                name="mobileNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mobile Number <span className="text-red-500">*</span></FormLabel>
                    <FormControl>
                      <Input
                        type="tel"
                        inputMode="numeric"
                        maxLength={10}
                        placeholder="10-digit mobile number"
                        {...field}
                        onChange={(e) => field.onChange(filterDigits(e.target.value, 10))}
                        disabled={isEditMode}
                        className={fieldCls}
                      />
                    </FormControl>
                    {isEditMode && <FormDescription className="text-xs">Mobile number cannot be changed after creation</FormDescription>}
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Email */}
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email <span className="text-xs font-normal text-slate-400">(optional)</span></FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="user@example.com" {...field} className={fieldCls} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Password — create mode only */}
              {!isEditMode && (
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password <span className="text-red-500">*</span></FormLabel>
                      <FormControl>
                        <PasswordInput placeholder="Min 8 characters" {...field} className={fieldCls} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* First Name */}
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First Name <span className="text-red-500">*</span></FormLabel>
                    <FormControl>
                      <Input placeholder="Enter first name" {...field} className={fieldCls} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Last Name */}
              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter last name" {...field} className={fieldCls} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </TabsContent>

          {/* ── Tab 2: Personal Details ───────────────────────────────────── */}
          <TabsContent value="personal" className="pt-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <FormField
                control={form.control}
                name="fatherName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Father&apos;s Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter father's name" {...field} className={fieldCls} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="motherName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mother&apos;s Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter mother's name" {...field} className={fieldCls} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="education"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Education Qualification</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. B.Com, MBA, 12th Pass" {...field} className={fieldCls} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="dateOfJoining"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date of Joining <span className="text-xs font-normal text-slate-400">(optional)</span></FormLabel>
                    <FormControl>
                      <DateInput {...field} className={fieldCls} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>Residential Address</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Door No., Street, City, State, Pincode"
                        rows={3}
                        {...field}
                        className="w-full border border-primary/30 text-sm bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20 dark:bg-brand-green-darker dark:border-sidebar-accent dark:text-slate-100 resize-none"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="md:col-span-2 space-y-3 rounded-lg border border-primary/20 bg-green-50/60 dark:bg-brand-green-darker/40 p-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <p className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">Residence Location</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleUseMyLocation}
                    disabled={isLocating}
                    className="h-8 gap-1.5 text-xs border-primary/30 text-sidebar-accent"
                  >
                    {isLocating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LocateFixed className="h-3.5 w-3.5" />}
                    {isLocating ? locatingLabel : 'Use My Location'}
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <FormField
                    control={form.control}
                    name="latitude"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Latitude <span className="text-xs font-normal text-slate-400">(optional)</span></FormLabel>
                        <FormControl>
                          <Input
                            type="text"
                            inputMode="decimal"
                            placeholder="e.g. 11.0168"
                            {...field}
                            value={field.value ?? ''}
                            className={fieldCls}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="longitude"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Longitude <span className="text-xs font-normal text-slate-400">(optional)</span></FormLabel>
                        <FormControl>
                          <Input
                            type="text"
                            inputMode="decimal"
                            placeholder="e.g. 76.9558"
                            {...field}
                            value={field.value ?? ''}
                            className={fieldCls}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Click or drag the marker on the map to set the location precisely.
                </p>
                <LocationMap
                  latitude={mapLat}
                  longitude={mapLng}
                  centerName={`${form.watch('firstName') || 'Employee'} ${form.watch('lastName') || ''}`.trim()}
                  centerCode={watchedEmpId || ''}
                  editable
                  onLocationChange={handleMapLocationChange}
                  heightClassName="h-[320px]"
                />
              </div>
            </div>
          </TabsContent>

          {/* ── Tab 3: Documents ──────────────────────────────────────────── */}
          <TabsContent value="documents" className="pt-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

              {/* Profile Photo */}
              <div className="space-y-3 rounded-lg border border-primary/20 bg-green-50/60 dark:bg-brand-green-darker/40 p-4">
                <p className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">Profile Photo</p>
                <FormField
                  control={form.control}
                  name="profilePhotoUrl"
                  render={({ field }) => (
                    <FormItem>
                      {field.value && (
                        <div className="mb-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={field.value} alt="Profile" className="h-20 w-20 rounded-full object-cover border-2 border-primary/30" />
                        </div>
                      )}
                      <DocUploadField
                        label="Profile Photo"
                        currentUrl={field.value || undefined}
                        onUploaded={(url) => field.onChange(url)}
                        docType="profile"
                        employeeId={watchedEmpId || 'temp'}
                        accept="image/*"
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Aadhaar */}
              <div className="space-y-3 rounded-lg border border-primary/20 bg-green-50/60 dark:bg-brand-green-darker/40 p-4">
                <p className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">Aadhaar Card</p>
                <FormField
                  control={form.control}
                  name="aadhaarNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Aadhaar Number</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="12-digit Aadhaar number"
                          maxLength={12}
                          {...field}
                          value={field.value ?? ''}
                          onChange={(e) => field.onChange(filterDigits(e.target.value, 12))}
                          className={fieldCls}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="aadhaarDocUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Aadhaar Document</FormLabel>
                      <DocUploadField
                        label="Aadhaar"
                        currentUrl={field.value || undefined}
                        onUploaded={(url) => field.onChange(url)}
                        docType="aadhaar"
                        employeeId={watchedEmpId || 'temp'}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* PAN */}
              <div className="space-y-3 rounded-lg border border-primary/20 bg-green-50/60 dark:bg-brand-green-darker/40 p-4">
                <p className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">PAN Card</p>
                <FormField
                  control={form.control}
                  name="panNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">PAN Number</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="ABCDE1234F"
                          maxLength={10}
                          {...field}
                          value={field.value ?? ''}
                          onChange={(e) => field.onChange(filterUppercase(e.target.value, 10))}
                          className={fieldCls}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="panDocUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">PAN Document</FormLabel>
                      <DocUploadField
                        label="PAN"
                        currentUrl={field.value || undefined}
                        onUploaded={(url) => field.onChange(url)}
                        docType="pan"
                        employeeId={watchedEmpId || 'temp'}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* ESI / PF */}
              <div className="space-y-3 rounded-lg border border-primary/20 bg-green-50/60 dark:bg-brand-green-darker/40 p-4">
                <p className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">ESI / PF Details</p>
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="esiNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">ESI Number</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="17-digit ESI number"
                            maxLength={17}
                            {...field}
                            value={field.value ?? ''}
                            onChange={(e) => field.onChange(filterDigits(e.target.value, 17))}
                            className={fieldCls}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="pfNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">PF / UAN Number</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="12-digit UAN number"
                            maxLength={12}
                            {...field}
                            value={field.value ?? ''}
                            onChange={(e) => field.onChange(filterDigits(e.target.value, 12))}
                            className={fieldCls}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="esiPfDocUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">ESI/PF Document</FormLabel>
                      <DocUploadField
                        label="ESI/PF"
                        currentUrl={field.value || undefined}
                        onUploaded={(url) => field.onChange(url)}
                        docType="esi_pf"
                        employeeId={watchedEmpId || 'temp'}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Location Photo */}
              <div className="space-y-3 rounded-lg border border-primary/20 bg-green-50/60 dark:bg-brand-green-darker/40 p-4">
                <p className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">Location Photo</p>
                <FormField
                  control={form.control}
                  name="locationPhotoUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Location / Residence Photo</FormLabel>
                      <DocUploadField
                        label="Location Photo"
                        currentUrl={field.value || undefined}
                        onUploaded={(url) => field.onChange(url)}
                        docType="location"
                        employeeId={watchedEmpId || 'temp'}
                        accept="image/*"
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
          </TabsContent>

          {/* ── Tab 4: Role & Branch ──────────────────────────────────────── */}
          <TabsContent value="role" className="pt-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Role */}
              <FormField
                control={form.control}
                name="roleSlug"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role <span className="text-red-500">*</span></FormLabel>
                    <Select
                      onValueChange={(v) => handleRoleChange(v, field.onChange)}
                      value={field.value}
                      disabled={isLoadingRoles || isLoadingBranches}
                    >
                      <FormControl>
                        <SelectTrigger className={fieldCls}>
                          <SelectValue placeholder={isLoadingRoles ? 'Loading roles…' : 'Select role'} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {rbacRoles.map((role) => (
                          <SelectItem key={role.slug} value={role.slug}>
                            <span className="flex items-center gap-2">
                              {role.color && (
                                <span className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: role.color }} />
                              )}
                              {role.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Branch */}
              <FormField
                control={form.control}
                name="branchId"
                render={({ field }) => {
                  if (isAmRole && !isEditMode) {
                    return (
                      <FormItem className="md:col-span-2">
                        <FormLabel>
                          Assigned Branches <span className="text-red-500">*</span>
                          <span className="ml-1 text-xs font-normal text-slate-500">(up to 4 — ★ = primary)</span>
                        </FormLabel>
                        <AmBranchMultiSelect
                          branches={branches}
                          selectedIds={amSelectedBranchIds}
                          primaryId={amPrimaryBranchId}
                          onChange={(ids, primary) => { setAmSelectedBranchIds(ids); setAmPrimaryBranchId(primary); }}
                          isLoading={isLoadingBranches}
                          disabled={isLoading}
                        />
                      </FormItem>
                    );
                  }
                  if (isAmRole && isEditMode) {
                    return (
                      <FormItem className="md:col-span-2">
                        <FormLabel>Branch Assignments</FormLabel>
                        <div className="rounded-lg border border-primary/20 bg-green-50 px-4 py-3 text-sm text-sidebar-accent">
                          Managed via <span className="font-semibold">&ldquo;Manage Branches&rdquo;</span> in the user table (⋮ menu).
                        </div>
                      </FormItem>
                    );
                  }
                  if (!isAmRole && !isEditMode && currentUser?.role === 'ADMIN') {
                    return (
                      <FormItem className="md:col-span-2">
                        <FormLabel>Assigned Branches <span className="ml-1 text-xs font-normal text-slate-500">(★ = primary)</span></FormLabel>
                        <AmBranchMultiSelect
                          branches={branches}
                          selectedIds={extraBranchIds}
                          primaryId={extraPrimaryBranchId}
                          onChange={(ids, primary) => {
                            setExtraBranchIds(ids);
                            setExtraPrimaryBranchId(primary);
                            field.onChange(primary ?? ids[0] ?? null);
                          }}
                          isLoading={isLoadingBranches}
                          disabled={isLoading}
                        />
                      </FormItem>
                    );
                  }
                  if (!isAmRole && isEditMode && currentUser?.role === 'ADMIN') {
                    return (
                      <FormItem className="md:col-span-2">
                        <FormLabel>Branch Assignments</FormLabel>
                        <div className="rounded-lg border border-primary/20 bg-green-50 px-4 py-3 text-sm text-sidebar-accent">
                          Managed via <span className="font-semibold">&ldquo;Manage Branches&rdquo;</span> in the user table (⋮ menu).
                        </div>
                      </FormItem>
                    );
                  }
                  return (
                    <FormItem>
                      <FormLabel>Branch</FormLabel>
                      {isBranchDisabled() && selectedBranchId ? (
                        <div className="relative">
                          <Select value={field.value || undefined} disabled>
                            <FormControl>
                              <SelectTrigger className="bg-gray-50">
                                <SelectValue placeholder="Select branch" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {branches.map((b) => (
                                <SelectItem key={b.id} value={b.id}>{b.name} ({b.code})</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <div className="mt-1 text-xs text-amber-600">Branch is auto-set from your active branch</div>
                        </div>
                      ) : (
                        <Select
                          onValueChange={field.onChange}
                          value={field.value || undefined}
                          disabled={isBranchDisabled() || isLoadingBranches}
                        >
                          <FormControl>
                            <SelectTrigger className={fieldCls}>
                              <SelectValue placeholder="Select branch" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {branches.map((b) => (
                              <SelectItem key={b.id} value={b.id}>{b.name} ({b.code})</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
            </div>
          </TabsContent>
        </Tabs>

        {/* ── Action Buttons ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-4 pt-4 border-t border-primary/20">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
              <X className="mr-2 h-4 w-4" />
              Cancel
            </Button>
          )}
          <Button
            type="submit"
            disabled={isLoading || isLoadingBranches || isLoadingRoles}
            className="bg-primary hover:bg-sidebar-accent text-white"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {isEditMode ? 'Updating…' : 'Creating…'}
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                {isEditMode ? 'Update User' : 'Create User'}
              </>
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
