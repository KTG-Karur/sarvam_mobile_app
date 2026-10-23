'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { LoginCredentials, AuthResponse } from '@/app/types';
import { tokenStorage } from '@/app/lib/token-storage';
import { apiClient } from '@/app/lib/api-client';
import { Loader2, IdCard, Lock, AlertCircle, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '@/app/store/authStore';
import { useBrandNames } from '@/app/lib/brand-context';
import Image from 'next/image';
import { getLoginAnimation } from '@/components/auth/login-animations/registry';
import { DeclarativeAnimationRunner } from '@/components/auth/login-animations/DeclarativeAnimationRunner';
import { validateAnimationManifest } from '@/components/auth/login-animations/validateManifest';
import type { AnimationManifest } from '@/components/auth/login-animations/types';

/* ─── Validation ─────────────────────────────────────────────────────────── */
const loginSchema = z.object({
  employeeId: z.string().min(1, 'Employee ID is required'),
  password: z
    .string()
    .min(1, 'Password is required')
    .min(6, 'Password must be at least 6 characters'),
});

/* ─── Inline brand icons ─────────────────────────────────────────────────── */
function GoogleIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden>
      <path d="M11.4 11.4H0V0h11.4v11.4z" fill="#F25022" />
      <path d="M24 11.4H12.6V0H24v11.4z" fill="#7FBA00" />
      <path d="M11.4 24H0V12.6h11.4V24z" fill="#00A4EF" />
      <path d="M24 24H12.6V12.6H24V24z" fill="#FFB900" />
    </svg>
  );
}

interface LoginFormProps {
  loginAnimationKey?: string | null;
  themePresetId?: string | null;
}

/* ─── Component ─────────────────────────────────────────────────────────── */
export function LoginForm({
  loginAnimationKey = null,
  themePresetId = null,
}: LoginFormProps = {}) {
  const router = useRouter();
  const { toast } = useToast();
  const { companyNameShort, companyNameFull, logoVersion } = useBrandNames();
  const [isLoading, setIsLoading] = useState(false);
  const [showLoginTransition, setShowLoginTransition] = useState(false);
  const [customManifest, setCustomManifest] = useState<AnimationManifest | null>(null);
  const [isFetchingManifest, setIsFetchingManifest] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noPageWarning, setNoPageWarning] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const { setAuth, setPermissions } = useAuthStore();

  const isMountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const navigatedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const handleNavigation = useCallback(() => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    router.push('/dashboard');
    router.refresh();
  }, [router]);

  const AnimationComponent = getLoginAnimation(loginAnimationKey);

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<LoginCredentials>({
    resolver: zodResolver(loginSchema),
    defaultValues: { employeeId: '', password: '' },
  });

  const employeeIdValue = watch('employeeId');
  const passwordValue = watch('password');

  const onSubmit = async (data: LoginCredentials) => {
    if (isLoading || showLoginTransition) return;
    setIsLoading(true);
    setError(null);
    setNoPageWarning(false);

    try {
      const result = await apiClient.post<AuthResponse>('/auth/login', {
        employeeId: data.employeeId,
        password: data.password,
      });

      if (!result.success || !result.data) {
        const msg = result.error || 'Login failed. Please try again.';
        setError(msg);
        toast({ title: 'Login Failed', description: msg, variant: 'destructive' });
        setIsLoading(false);
        return;
      }

      tokenStorage.setAccessToken(result.data.accessToken);
      tokenStorage.setRefreshToken(result.data.refreshToken);
      tokenStorage.setUser(result.data.user);

      const { branchStorage } = await import('@/app/lib/branch-storage');
      branchStorage.clearActiveBranch();

      if (result.data.branch) {
        branchStorage.setActiveBranch({
          id:      result.data.branch.id,
          name:    result.data.branch.name,
          code:    result.data.branch.code,
          address: result.data.branch.address || null,
        });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = result.data as any;
      setAuth({
        user: {
          id: d.user.id, email: d.user.email,
          firstName: d.user.firstName, lastName: d.user.lastName,
          employeeId: d.user.employeeId ?? null,
        },
        accessToken:  d.accessToken,
        refreshToken: d.refreshToken,
        branch: d.branch
          ? { id: d.branch.id, name: d.branch.name, code: d.branch.code, isHeadOffice: d.branch.isHeadOffice ?? false }
          : null,
        roles:       d.roles ?? [],
        permVersion: d.permissions?.version ?? 1,
      });

      try {
        const permRes = await fetch('/api/auth/permissions', {
          headers: { Authorization: `Bearer ${d.accessToken}` },
        });
        if (permRes.ok) {
          const permData = await permRes.json();
          if (permData.success) {
            const isAdmin = (d.user.role as string) === 'ADMIN';
            const pagePerms = permData.pagePermissions as Record<string, unknown> | null;
            const hasConfiguredPerms = pagePerms !== null;
            const hasAnyVisiblePage = hasConfiguredPerms && Object.values(pagePerms).some((v) => {
              if (typeof v === 'object' && v !== null) return (v as Record<string, boolean>).view === true;
              return v === true;
            });

            if (!isAdmin && hasConfiguredPerms && !hasAnyVisiblePage) {
              tokenStorage.clear();
              branchStorage.clearActiveBranch();
              try {
                localStorage.removeItem('sarvan-page-permissions');
                localStorage.removeItem('sarvan-rbac-permissions');
              } catch { /* ignore */ }
              setNoPageWarning(true);
              setIsLoading(false);
              return;
            }

            setPermissions({
              granted:           permData.permissions?.granted ?? [],
              roles:             permData.roles ?? [],
              branchAccess:      permData.branchAccess ?? [],
              fieldPermissions:  permData.fieldPermissions ?? {},
              reportPermissions: permData.reportPermissions ?? {},
              menu:              permData.menu ?? [],
              pagePermissions:   permData.pagePermissions ?? null,
            });

            if (Array.isArray(permData.permissions?.granted))
              localStorage.setItem('sarvan-rbac-permissions', JSON.stringify(permData.permissions.granted));
            if (permData.pagePermissions !== undefined)
              localStorage.setItem('sarvan-page-permissions', JSON.stringify(permData.pagePermissions));
          }
        }
      } catch { /* Non-fatal */ }

      try {
        if (loginAnimationKey === 'sarvam') {
          sessionStorage.setItem('sarvam_login_crossfade', 'true');
        }
        const welcomeName = result.data.user.firstName || result.data.user.employeeId || 'User';
        sessionStorage.setItem('sarvam_login_toast', welcomeName);
      } catch { /* ignore */ }

      const normalizedKey = loginAnimationKey?.trim();

      if (normalizedKey === 'sarvam') {
        if (AnimationComponent) {
          router.prefetch('/dashboard');
          setShowLoginTransition(true);
        } else {
          handleNavigation();
        }
      } else if (normalizedKey && normalizedKey !== 'none') {
        router.prefetch('/dashboard');
        setShowLoginTransition(true);
        setIsFetchingManifest(true);

        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        try {
          const animationUrl = themePresetId
            ? `/api/settings/brand/presets/${encodeURIComponent(themePresetId)}/login-animation`
            : null;

          if (!animationUrl) {
            handleNavigation();
            return;
          }

          const res = await fetch(animationUrl, {
            headers: {
              Authorization: `Bearer ${d.accessToken}`,
            },
            signal: abortController.signal,
          });

          if (!res.ok) {
            console.warn(
              `Custom login animation for theme '${themePresetId}' not found (HTTP ${res.status}), proceeding to dashboard`
            );
            handleNavigation();
            return;
          }

          const json = await res.json();
          const manifestCandidate = json.data?.manifest ?? json.data;
          const validation = validateAnimationManifest(manifestCandidate);

          if (validation.success && validation.data) {
            if (!isMountedRef.current) return;
            setCustomManifest(validation.data);
            setIsFetchingManifest(false);
          } else {
            console.warn(
              `Custom login animation '${normalizedKey}' failed manifest validation:`,
              validation.issues
            );
            handleNavigation();
          }
        } catch (fetchErr: any) {
          if (fetchErr?.name === 'AbortError') {
            return;
          }
          console.warn(`Error fetching custom animation '${normalizedKey}':`, fetchErr);
          handleNavigation();
        }
      } else {
        handleNavigation();
      }
    } catch (err) {
      console.error('Login error:', err);
      const msg = 'Network error. Please check your connection and try again.';
      setError(msg);
      toast({ title: 'Login Failed', description: msg, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {showLoginTransition && (
        <>
          {loginAnimationKey === 'sarvam' && AnimationComponent && (
            <AnimationComponent onComplete={handleNavigation} />
          )}

          {loginAnimationKey !== 'sarvam' && customManifest && (
            <DeclarativeAnimationRunner
              manifest={customManifest}
              onComplete={handleNavigation}
            />
          )}

          {loginAnimationKey !== 'sarvam' && !customManifest && isFetchingManifest && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm"
              role="status"
              aria-live="polite"
              aria-label="Preparing workspace..."
            >
              <div className="flex flex-col items-center gap-3 p-6 text-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm font-medium text-muted-foreground">Preparing your workspace...</p>
              </div>
            </div>
          )}
        </>
      )}
      <div
        className="flex flex-col flex-1 px-9 py-9"
        style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
      >
      {/* ── Logo ──────────────────────────────────────────────────── */}
      <div className="mb-7">
        <Image
          src={`/api/branding/asset/logo-wordmark?v=${logoVersion}`}
          alt={companyNameFull}
          width={155}
          height={48}
          className="object-contain"
          unoptimized
        />
        <p
          className="mt-2 text-[10.5px] font-semibold tracking-[0.18em] uppercase"
          style={{ color: '#9ca3af' }}
        >
          {companyNameShort} Microfinance ERP
        </p>
      </div>

      {/* ── Welcome heading ───────────────────────────────────────── */}
      <div className="mb-6">
        <h1
          className="text-[22px] font-extrabold tracking-[0.14em] uppercase leading-tight"
          style={{ color: '#575757' }}
        >
          WELCOME BACK!
        </h1>
        <p className="mt-1.5 text-[13px]" style={{ color: '#a0aec0' }}>
          Sign in to continue
        </p>
      </div>

      {/* ── Alerts ────────────────────────────────────────────────── */}
      {error && (
        <Alert className="mb-4 border-red-100 bg-red-50 py-3">
          <AlertCircle className="h-4 w-4 text-red-500" />
          <AlertDescription className="ml-1 text-sm font-medium text-red-700">
            {error}
          </AlertDescription>
        </Alert>
      )}
      {noPageWarning && (
        <Alert className="mb-4 border-amber-200 bg-amber-50 py-3">
          <AlertCircle className="h-4 w-4 text-amber-500" />
          <AlertTitle className="ml-1 text-sm font-semibold text-amber-800">
            No Pages Assigned
          </AlertTitle>
          <AlertDescription className="ml-1 mt-0.5 text-sm leading-relaxed text-amber-700">
            Please contact your Administrator to get page access.
          </AlertDescription>
        </Alert>
      )}

      {/* ── Form ──────────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">

        {/* Employee ID */}
        <div className="space-y-1.5">
          <label
            htmlFor="employeeId"
            className="block text-[11px] font-semibold uppercase tracking-widest"
            style={{ color: '#9ca3af' }}
          >
            Employee ID
          </label>
          <div className="relative">
            <IdCard
              className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none"
              style={{ color: '#c4c4c4' }}
            />
            <Input
              id="employeeId"
              type="text"
              placeholder="Enter your Employee ID"
              className={[
                'pl-10 h-11 rounded-xl border-0 text-[#575757] placeholder:text-gray-300',
                'transition-all duration-200',
                errors.employeeId
                  ? 'ring-2 ring-red-300 bg-red-50'
                  : 'focus:ring-2 focus:ring-secondary',
                isLoading || showLoginTransition ? 'opacity-50 cursor-not-allowed' : '',
              ].join(' ')}
              style={{ background: errors.employeeId ? undefined : '#F6F6F6' }}
              {...register('employeeId')}
              disabled={isLoading || showLoginTransition}
              autoComplete="username"
            />
          </div>
          {errors.employeeId && (
            <p className="flex items-center gap-1 text-xs text-red-500">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {errors.employeeId.message}
            </p>
          )}
        </div>

        {/* Password */}
        <div className="space-y-1.5">
          <label
            htmlFor="password"
            className="block text-[11px] font-semibold uppercase tracking-widest"
            style={{ color: '#9ca3af' }}
          >
            Password
          </label>
          <div className="relative">
            <Lock
              className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none z-10"
              style={{ color: '#c4c4c4' }}
            />
            <PasswordInput
              id="password"
              placeholder="Enter your password"
              className={[
                'pl-10 h-11 rounded-xl border-0 text-[#575757] placeholder:text-gray-300',
                'transition-all duration-200',
                errors.password
                  ? 'ring-2 ring-red-300 bg-red-50'
                  : 'focus:ring-2 focus:ring-secondary',
                isLoading || showLoginTransition ? 'opacity-50 cursor-not-allowed' : '',
              ].join(' ')}
              style={{ background: errors.password ? undefined : '#F6F6F6' }}
              {...register('password')}
              disabled={isLoading || showLoginTransition}
              autoComplete="current-password"
              showToggle={true}
            />
          </div>
          {errors.password && (
            <p className="flex items-center gap-1 text-xs text-red-500">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {errors.password.message}
            </p>
          )}
        </div>

        {/* Remember me + Forgot Password */}
        <div className="flex items-center justify-between pt-0.5">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="h-4 w-4 cursor-pointer rounded border-gray-300 accent-primary"
            />
            <span className="text-[13px]" style={{ color: '#7a7a7a' }}>
              Remember me
            </span>
          </label>
         
        </div>

        {/* Login button */}
        <button
          type="submit"
          disabled={isLoading || showLoginTransition || !employeeIdValue || !passwordValue}
          className="mt-1 w-full h-12 rounded-full font-bold text-[15px] text-white transition-all duration-200 hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
          style={{ background: 'linear-gradient(135deg, #7A7A7A 0%, #575757 100%)' }}
        >
          {isLoading || showLoginTransition ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Authenticating...
            </span>
          ) : (
            'LOGIN'
          )}
        </button>
      </form>

      {/* ── OR divider ────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 my-5">
        <div className="flex-1 h-px" style={{ background: '#ebebeb' }} />
        
         <ShieldCheck className="h-3.5 w-3.5" style={{ color: '#b0b0b0' }} />
         <span
          className="text-[10px] font-bold tracking-[0.16em] uppercase whitespace-nowrap"
          style={{ color: '#c0c0c0' }}
        >
          SVM
        </span>
        <span className="text-[11px]" style={{ color: '#b0b0b0' }}>
          Secure Banking Grade Authentication
        </span>
        <div className="flex-1 h-px" style={{ background: '#ebebeb' }} />
      </div>

     
      {/* ── Security footer ───────────────────────────────────────── */}
      <div className="mt-auto pt-7 flex items-center justify-center gap-1.5">
       
      </div>
    </div>
    </>
  );
}
