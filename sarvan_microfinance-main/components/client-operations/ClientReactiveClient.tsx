'use client';

import { useState, useEffect, useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import {
    UserCheck,
    CheckCircle2,
    RotateCcw,
    Loader2,
    CalendarDays,
    Search,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { apiClient } from '@/app/lib/api-client';
import { getPersonLabel } from '@/app/lib/person-label';
import { branchStorage } from '@/app/lib/branch-storage';
import { tokenStorage } from '@/app/lib/token-storage';
import { PageLoader } from '@/components/ui/page-loader';
import { DateInput } from '@/components/ui/date-input';

import { matchesMemberSearch } from '@/app/lib/reports/member-contact-columns';
type Branch = {
  id: string;
  name: string;
  code: string;
};

type Center = {
  id: string;
  name: string;
  code: string;
};

type Client = {
  id: string;
  clientId: string;
  firstName: string;
  lastName: string;
  otherIdNo?: string | null;
  mobileNumber?: string | null;
  centerId: string;
  inactiveDate?: string | null;
  inactiveReason?: string | null;
  isActive: boolean;
  /** Has at least one Loan record (any status) — false means still a Member, not yet a Client */
  hasLoan?: boolean;
};

// Validation schema
const clientReactiveSchema = z.object({
  centerName: z.string().min(1, 'Center name is required'),
  clientName: z.string().min(1, 'Name is required'),
  clientId: z.string().optional(),
  clientNameDisplay: z.string().optional(),
  inactiveDate: z.string().optional(),
  inactiveReason: z.string().optional(),
});

type ClientReactiveFormValues = z.infer<typeof clientReactiveSchema>;

export function ClientReactiveClient() {
  const { canPage } = usePermission();
  const canEditClient = canPage('/dashboard/client-operations/reactive', 'edit');
  const { toast } = useToast();
  const router = useRouter();

  // Branch filter — ADMIN, SUBADMIN (ADMIN_NON_HO_BRANCH_SWITCH) and AREA_MANAGER get a
  // picker; AREA_MANAGER's branch list is scoped to their assigned branches. Others are
  // locked to their own/active branch.
  const storedUser = tokenStorage.getUser();
  const isAreaManager = storedUser?.role === 'AREA_MANAGER';
  const isAdminOrAM = storedUser?.role === 'ADMIN' || storedUser?.role === 'ADMIN_NON_HO_BRANCH_SWITCH' || isAreaManager;
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<string>('');
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);

  const [centers, setCenters] = useState<Center[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingClients, setIsLoadingClients] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) =>
      matchesMemberSearch(q, { aadhaarNumber: c.otherIdNo, mobileNumber: c.mobileNumber }, c.clientId, `${c.firstName} ${c.lastName}`)
    );
  }, [clients, clientSearch]);

  const form = useForm<ClientReactiveFormValues>({
    resolver: zodResolver(clientReactiveSchema),
    defaultValues: {
      centerName: '',
      clientName: '',
      clientId: '',
      clientNameDisplay: '',
      inactiveDate: '',
      inactiveReason: '',
    },
  });

  const selectedCenterId = form.watch('centerName');
  const selectedClientId = form.watch('clientName');

  // Resolve branch on mount — ADMIN/SUBADMIN/AREA_MANAGER get a branch picker,
  // others are locked to their own/active branch.
  useEffect(() => {
    if (isAdminOrAM) {
      setIsLoadingBranches(true);
      apiClient.get<Branch[]>('/branches').then((result) => {
        if (result.success && result.data) {
          let list = result.data;
          if (isAreaManager) {
            const assignedBranchIds = (storedUser as any)?.assignedBranchIds ?? [];
            if (assignedBranchIds.length > 0) {
              list = list.filter((b) => assignedBranchIds.includes(b.id));
            }
          }
          setBranches(list);
          const activeBranch = branchStorage.getActiveBranch();
          const preferredId = activeBranch?.id ?? storedUser?.branchId;
          const match = list.find((b) => b.id === preferredId) ?? list[0];
          if (match) setBranchId(match.id);
        }
      }).finally(() => setIsLoadingBranches(false));
    } else {
      const activeBranch = branchStorage.getActiveBranch();
      const id = activeBranch?.id || storedUser?.branchId || '';
      setBranchId(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (branchId) fetchCenters(branchId);
    else setCenters([]);
    form.setValue('centerName', '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  useEffect(() => {
    if (selectedCenterId) {
      fetchClients(selectedCenterId);
    } else {
      setClients([]);
      form.setValue('clientName', '');
      form.setValue('clientId', '');
      form.setValue('clientNameDisplay', '');
      form.setValue('inactiveDate', '');
      form.setValue('inactiveReason', '');
    }
    setClientSearch('');
  }, [selectedCenterId, form]);

  useEffect(() => {
    if (selectedClientId) {
      const client = clients.find((c) => c.id === selectedClientId);
      if (client) {
        form.setValue('clientId', client.clientId);
        form.setValue('clientNameDisplay', `${client.firstName} ${client.lastName}`.trim());
        form.setValue('inactiveDate', client.inactiveDate || '');
        form.setValue('inactiveReason', client.inactiveReason || '');
      }
    } else {
      form.setValue('clientId', '');
      form.setValue('clientNameDisplay', '');
      form.setValue('inactiveDate', '');
      form.setValue('inactiveReason', '');
    }
  }, [selectedClientId, clients, form]);

  const fetchCenters = async (forBranchId: string) => {
    setIsLoading(true);
    try {
      if (!forBranchId) {
        toast({
          title: 'Error',
          description: 'No branch found. Please select a branch first.',
          variant: 'destructive',
        });
        setIsLoading(false);
        return;
      }

      const result = await apiClient.get<Center[]>(
        `/centers?branchId=${forBranchId}&includeInactive=false&status=APPROVED`
      );

      if (result.success && result.data) {
        setCenters(result.data);
      } else {
        toast({
          title: 'Error',
          description: result.error || 'Failed to load centers.',
          variant: 'destructive',
        });
        setCenters([]);
      }
    } catch (error) {
      console.error('Error fetching centers:', error);
      toast({
        title: 'Error',
        description: 'Failed to load centers. Please try again.',
        variant: 'destructive',
      });
      setCenters([]);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchClients = async (centerId: string) => {
    setIsLoadingClients(true);
    try {
      // Fetch all clients including inactive ones
      const result = await apiClient.get<{ clients: Client[]; pagination: any }>(
        `/clients?centerId=${centerId}&includeInactive=true`
      ).catch(() => {
        // Fallback to empty array if endpoint doesn't exist yet
        return { success: true, data: { clients: [], pagination: null } };
      });

      if (result.success && result.data) {
        const clientsData = result.data.clients || [];
        // Filter to only show inactive clients
        const inactiveClients = clientsData.filter((client: Client) => !client.isActive);
        setClients(inactiveClients);

        if (inactiveClients.length === 0) {
          toast({
            title: 'Info',
            description: 'No inactive members/clients found for the selected center.',
            variant: 'default',
          });
        }
      } else {
        toast({
          title: 'Warning',
          description: 'No records found for the selected center.',
          variant: 'default',
        });
        setClients([]);
      }
    } catch (error) {
      console.error('Error fetching clients:', error);
      setClients([]);
    } finally {
      setIsLoadingClients(false);
    }
  };

  const onSubmit = async (values: ClientReactiveFormValues) => {
    setIsSubmitting(true);
    try {
      const selected = clients.find((c) => c.id === values.clientName);
      const result = await apiClient.post('/client-operations/reactive', {
        clientId: values.clientName,
        centerId: values.centerName,
      });

      if (result.success) {
        toast({
          title: 'Success',
          description: result.message || `${getPersonLabel(!!selected?.hasLoan).singular} reactivated successfully.`,
        });
        // Reset form after successful submission
        handleReset();
      } else {
        toast({
          title: 'Error',
          description: result.error || 'Failed to reactivate client. Please try again.',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      console.error('Error reactivating client:', error);
      let errorMessage = 'Failed to reactivate client. Please try again.';
      
      if (error?.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else if (error?.message) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      }
      
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    form.reset({
      centerName: '',
      clientName: '',
      clientId: '',
      clientNameDisplay: '',
      inactiveDate: '',
      inactiveReason: '',
    });
    setClients([]);
    toast({
      title: 'Reset',
      description: 'Form has been reset.',
    });
  };

  const handleClose = () => {
    router.back();
  };

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-brand-green-darker to-sidebar-accent dark:from-slate-50 dark:to-slate-300 bg-clip-text text-transparent">
          Client Active
        </h1>
        <p className="text-muted-foreground">
          Reactivate inactive clients and restore their active status
        </p>
      </div>

      {/* Main Form Card */}
      <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
        {/* Top Accent Bar */}
        <div className="h-1.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-green-600" />

        <CardHeader className="bg-gradient-to-r from-slate-50 via-emerald-50/60 to-teal-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
              <UserCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <CardTitle className="text-xl">Reactivation Details</CardTitle>
              <CardDescription>
                Select inactive client and reactivate their account
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {isLoading ? (
                <PageLoader label="Loading..." fullScreen={false} />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Branch (ADMIN / SUBADMIN / AREA_MANAGER only) */}
                  {isAdminOrAM && (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">Branch</FormLabel>
                      <Select
                        value={branchId}
                        onValueChange={setBranchId}
                        disabled={isLoadingBranches || branches.length === 0}
                      >
                        <FormControl>
                          <SelectTrigger className="h-11 w-full">
                            <SelectValue placeholder="-- SELECT BRANCH --" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {branches.map((b) => (
                            <SelectItem key={b.id} value={b.id}>
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{b.name}</span>
                                <span className="text-muted-foreground text-xs">({b.code})</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}

                  {/* Center Name */}
                  <FormField
                    control={form.control}
                    name="centerName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium">
                          Center Name
                        </FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                          disabled={centers.length === 0}
                        >
                          <FormControl>
                            <SelectTrigger className="h-11 w-full">
                              <SelectValue placeholder="-- SELECT --" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {centers.length === 0 ? (
                              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                No centers available
                              </div>
                            ) : (
                              centers.map((center) => (
                                <SelectItem key={center.id} value={center.id}>
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium">{center.name}</span>
                                                                        <span className="text-muted-foreground">({center.code})</span>
                                  </div>
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Member/Client Search */}
                  <FormItem>
                    <FormLabel className="text-sm font-medium">
                      Search Member / Client
                    </FormLabel>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        value={clientSearch}
                        onChange={(e) => setClientSearch(e.target.value)}
                        placeholder="ID (e.g. 34-1-1-1), name, Aadhaar or mobile…"
                        disabled={!selectedCenterId || isLoadingClients}
                        className="h-11 pl-9"
                      />
                    </div>
                  </FormItem>

                  {/* Client Name */}
                  <FormField
                    control={form.control}
                    name="clientName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium">
                          Client Name
                        </FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                          disabled={!selectedCenterId || isLoadingClients || clients.length === 0}
                        >
                          <FormControl>
                            <SelectTrigger className="h-11 w-full">
                              <SelectValue placeholder="-- SELECT --" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {isLoadingClients ? (
                              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                Loading clients...
                              </div>
                            ) : clients.length === 0 ? (
                              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                No inactive clients available
                              </div>
                            ) : filteredClients.length === 0 ? (
                              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                No clients match &quot;{clientSearch}&quot;
                              </div>
                            ) : (
                              filteredClients.map((client) => (
                                <SelectItem key={client.id} value={client.id}>
                                  {`${client.firstName} ${client.lastName}`.trim()} ({client.clientId})
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Client Id */}
                  <FormField
                    control={form.control}
                    name="clientId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium">
                          Client Id
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            className="h-11 bg-muted cursor-not-allowed"
                            readOnly
                            disabled
                            placeholder="--"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Client Name Display */}
                  <FormField
                    control={form.control}
                    name="clientNameDisplay"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium">
                          Client Name
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            className="h-11 bg-muted cursor-not-allowed"
                            readOnly
                            disabled
                            placeholder="--"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Inactive Date */}
                  <FormField
                    control={form.control}
                    name="inactiveDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium">
                          Inactive Date
                        </FormLabel>
                        <FormControl>
                          <div className="relative">
                            <CalendarDays className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <DateInput
                              {...field}
                              className="h-11 w-full pr-9 bg-muted cursor-not-allowed"
                              readOnly
                              disabled
                              placeholder="--"
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Inactive Reason */}
                  <FormField
                    control={form.control}
                    name="inactiveReason"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium">
                          Inactive Reason
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            className="h-11 bg-muted cursor-not-allowed"
                            readOnly
                            disabled
                            placeholder="--"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              {/* Action Buttons */}
              {!isLoading && (
                <>
                  <div className="flex flex-wrap gap-3 pt-4">
                    <Button
                      type="submit"
                      disabled={!canEditClient || isSubmitting}
                      className="flex-1 min-w-[120px] bg-primary hover:bg-primary text-white"
                      size="lg"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                          Active
                        </>
                      )}
                    </Button>

                    <Button
                      type="button"
                      onClick={handleReset}
                      disabled={isSubmitting}
                      variant="destructive"
                      className="flex-1 min-w-[120px]"
                      size="lg"
                    >
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Reset
                    </Button>
                  </div>
                  <div className="pt-2">
                    <Button
                      type="button"
                      onClick={handleClose}
                      disabled={isSubmitting}
                      variant="outline"
                      className="w-full bg-primary hover:bg-primary text-white border-primary"
                      size="lg"
                    >
                      Close
                    </Button>
                  </div>
                </>
              )}
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}

