'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, MapPin, AlertCircle, Trash2, RotateCcw, CheckCircle2, MoreVertical, Save, LocateFixed } from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { branchStorage } from '@/app/lib/branch-storage';
import { tokenStorage } from '@/app/lib/token-storage';
import { LocalBranchFilter } from '@/components/branch/LocalBranchFilter';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { useAccurateLocation } from '@/hooks/useAccurateLocation';

// Dynamically import the map component to avoid SSR issues with Leaflet
const MapComponent = dynamic(() => import('./CenterMap'), {
    ssr: false,
    loading: () => <PageLoader fullScreen={false} />,
});

type Center = {
    id: string;
    name: string;
    code: string;
    address?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    status?: string;
    branch?: {
        id: string;
        name: string;
        code: string;
    } | null;
    fdo?: {
        id: string;
        firstName: string;
        lastName: string;
    } | null;
};

// Fallback map center (India) used when a center has no coordinates set yet.
const DEFAULT_MAP_LAT = 20.5937;
const DEFAULT_MAP_LNG = 78.9629;

/** First value that is a finite number (0 is valid) — plain `||` chaining treats 0 as falsy. */
function firstFiniteNumber(...values: Array<number | null | undefined>): number {
    for (const v of values) {
        if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
    return 0;
}

export function LocateCenterClient() {
    const { toast } = useToast();
    const searchParams = useSearchParams();
    // Page-local branch filter — does not switch the session-wide active branch.
    const [branchId, setBranchId] = useState<string>(() => {
        const activeBranch = branchStorage.getActiveBranch();
        const storedUser = tokenStorage.getUser();
        return activeBranch?.id || storedUser?.branchId || '';
    });
    const [centers, setCenters] = useState<Center[]>([]);
    const [selectedCenterId, setSelectedCenterId] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);
    const [isDeleting, setIsDeleting] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

    // Set/edit location
    const [editLat, setEditLat] = useState('');
    const [editLng, setEditLng] = useState('');
    const [isSavingLocation, setIsSavingLocation] = useState(false);
    const { locate, isLocating, locatingLabel } = useAccurateLocation();

    const selectedCenter = useMemo(() => {
        return centers.find((center) => center.id === selectedCenterId) || null;
    }, [centers, selectedCenterId]);

    const centersWithLocation = useMemo(() => {
        return centers.filter(
            (center) =>
                center.latitude !== null &&
                center.latitude !== undefined &&
                center.longitude !== null &&
                center.longitude !== undefined
        );
    }, [centers]);

    useEffect(() => {
        if (branchId) fetchCenters(branchId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branchId]);

    // Keep the lat/lng edit inputs in sync with whichever center is selected
    useEffect(() => {
        setEditLat(selectedCenter?.latitude != null ? String(selectedCenter.latitude) : '');
        setEditLng(selectedCenter?.longitude != null ? String(selectedCenter.longitude) : '');
    }, [selectedCenter]);

    // Handle centerId from URL query parameter
    useEffect(() => {
        const centerIdFromUrl = searchParams.get('centerId');
        if (centerIdFromUrl && centers.length > 0) {
            const centerExists = centers.find((c) => c.id === centerIdFromUrl);
            if (centerExists) {
                setSelectedCenterId(centerIdFromUrl);
            }
        }
    }, [searchParams, centers]);

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
                if (result.data.length === 1 && !selectedCenterId) {
                    setSelectedCenterId(result.data[0].id);
                }
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

    const handleCenterChange = (centerId: string) => {
        setSelectedCenterId(centerId);
    };

    const handleDelete = async () => {
        if (!selectedCenterId || !selectedCenter) {
            return;
        }

        setIsDeleting(true);
        try {
            const result = await apiClient.delete(`/centers/${selectedCenterId}`);

            if (result.success) {
                toast({
                    title: 'Success',
                    description: `Center "${selectedCenter.name}" has been deleted successfully.`,
                });
                // Reset selection and refresh centers
                setSelectedCenterId('');
                await fetchCenters(branchId);
                setDeleteDialogOpen(false);
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to delete center.',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Error deleting center:', error);
            toast({
                title: 'Error',
                description: 'Failed to delete center. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsDeleting(false);
        }
    };

    const handleReset = () => {
        setSelectedCenterId('');
        toast({
            title: 'Reset',
            description: 'Form has been reset.',
        });
    };

    const handleMapLocationChange = (lat: number, lng: number) => {
        setEditLat(lat.toFixed(6));
        setEditLng(lng.toFixed(6));
    };

    // Samples high-accuracy GPS and keeps the best fix (not the browser's first coarse guess)
    const handleUseMyLocation = () =>
        locate({
            onPosition: (lat, lng) => {
                setEditLat(lat.toFixed(6));
                setEditLng(lng.toFixed(6));
            },
            subject: 'Center location',
        });

    const handleSaveLocation = async () => {
        if (!selectedCenterId) return;

        const lat = parseFloat(editLat);
        const lng = parseFloat(editLng);

        if (isNaN(lat) || lat < -90 || lat > 90) {
            toast({ title: 'Invalid latitude', description: 'Latitude must be a number between -90 and 90.', variant: 'destructive' });
            return;
        }
        if (isNaN(lng) || lng < -180 || lng > 180) {
            toast({ title: 'Invalid longitude', description: 'Longitude must be a number between -180 and 180.', variant: 'destructive' });
            return;
        }

        setIsSavingLocation(true);
        try {
            const result = await apiClient.patch(`/centers/${selectedCenterId}`, { latitude: lat, longitude: lng });
            if (result.success) {
                toast({ title: 'Saved', description: 'Center location updated successfully.' });
                setCenters((prev) =>
                    prev.map((c) => (c.id === selectedCenterId ? { ...c, latitude: lat, longitude: lng } : c))
                );
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to save location.', variant: 'destructive' });
            }
        } catch (error) {
            console.error('Error saving center location:', error);
            toast({ title: 'Error', description: 'Failed to save location. Please try again.', variant: 'destructive' });
        } finally {
            setIsSavingLocation(false);
        }
    };

    const handleDeleteClick = () => {
        if (!selectedCenterId || !selectedCenter) {
            toast({
                title: 'No Center Selected',
                description: 'Please select a center first.',
                variant: 'destructive',
            });
            return;
        }
        setDeleteDialogOpen(true);
    };

    const hasLocationData = selectedCenter?.latitude !== null && 
                           selectedCenter?.latitude !== undefined && 
                           selectedCenter?.longitude !== null && 
                           selectedCenter?.longitude !== undefined;

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight">Locate Center</h1>
                <p className="text-muted-foreground">
                    Select a center from the dropdown to view its location on the map
                </p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <MapPin className="h-5 w-5" />
                        Center Selection
                    </CardTitle>
                    <CardDescription>
                        Choose a center to display its location on the map
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <LocalBranchFilter value={branchId} onChange={(id) => { setBranchId(id); setSelectedCenterId(''); }} />
                    {isLoading ? (
                        <PageLoader label="Loading centers..." fullScreen={false} />
                    ) : (
                        <>
                            <div className="space-y-2">
                                <label
                                    htmlFor="center-select"
                                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                >
                                    Center Name
                                </label>
                                <Select
                                    value={selectedCenterId}
                                    onValueChange={handleCenterChange}
                                    disabled={centers.length === 0}
                                >
                                    <SelectTrigger id="center-select" className="w-full h-11">
                                        <SelectValue placeholder="-- SELECT --" />
                                    </SelectTrigger>
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
                            </div>

                            {/* Action Buttons */}
                            <div className="flex flex-wrap gap-3 pt-2">
                                <Button
                                    onClick={handleReset}
                                    disabled={!selectedCenterId}
                                    variant="outline"
                                    className="flex-1 min-w-[120px]"
                                    size="lg"
                                >
                                    <RotateCcw className="mr-2 h-4 w-4" />
                                    Reset
                                </Button>
                            </div>

                            {centers.length > 0 &&
                                centersWithLocation.length < centers.length && (
                                    <Alert>
                                        <AlertCircle className="h-4 w-4" />
                                        <AlertTitle>Note</AlertTitle>
                                        <AlertDescription>
                                            {centers.length - centersWithLocation.length} center(s)
                                            do not have location data (latitude/longitude) and
                                            cannot be displayed on the map.
                                        </AlertDescription>
                                    </Alert>
                                )}
                        </>
                    )}
                </CardContent>
            </Card>

            {/* Selected Center Details Card */}
            {selectedCenter && (
                <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-lg">
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <CardTitle className="flex items-center gap-2">
                                <MapPin className="h-5 w-5 text-primary dark:text-primary" />
                                Center Details
                            </CardTitle>
                            <div className="flex items-center gap-2">
                                {hasLocationData && (
                                    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400">
                                        <CheckCircle2 className="h-3 w-3 mr-1" />
                                        Has Location
                                    </Badge>
                                )}
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                            disabled={!selectedCenterId || isDeleting}
                                        >
                                            <MoreVertical className="h-4 w-4" />
                                            <span className="sr-only">More options</span>
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-48">
                                        <DropdownMenuItem
                                            onClick={handleDeleteClick}
                                            disabled={!selectedCenterId || isDeleting}
                                            className="text-red-600 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-950/20"
                                        >
                                            <Trash2 className="mr-2 h-4 w-4" />
                                            Delete Center
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        </div>
                        <CardDescription>
                            Information about the selected center
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <p className="text-sm font-medium text-muted-foreground">Center Name</p>
                                <p className="text-base font-semibold">{selectedCenter.name}</p>
                            </div>
                            <div className="space-y-1">
                                <p className="text-sm font-medium text-muted-foreground">Center Code</p>
                                <p className="text-base font-semibold">{selectedCenter.code}</p>
                            </div>
                            {selectedCenter.address && (
                                <div className="space-y-1 md:col-span-2">
                                    <p className="text-sm font-medium text-muted-foreground">Address</p>
                                    <p className="text-base">{selectedCenter.address}</p>
                                </div>
                            )}
                            {selectedCenter.branch && (
                                <div className="space-y-1">
                                    <p className="text-sm font-medium text-muted-foreground">Branch</p>
                                    <p className="text-base">{selectedCenter.branch.name} ({selectedCenter.branch.code})</p>
                                </div>
                            )}
                            {selectedCenter.fdo && (
                                <div className="space-y-1">
                                    <p className="text-sm font-medium text-muted-foreground">Assigned FDO</p>
                                    <p className="text-base">
                                        {selectedCenter.fdo.firstName} {selectedCenter.fdo.lastName}
                                    </p>
                                </div>
                            )}
                            {hasLocationData && (
                                <>
                                    <div className="space-y-1">
                                        <p className="text-sm font-medium text-muted-foreground">Latitude</p>
                                        <p className="text-base font-mono text-sm">
                                            {selectedCenter.latitude?.toFixed(6)}
                                        </p>
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-sm font-medium text-muted-foreground">Longitude</p>
                                        <p className="text-base font-mono text-sm">
                                            {selectedCenter.longitude?.toFixed(6)}
                                        </p>
                                    </div>
                                </>
                            )}
                        </div>

                        {!hasLocationData && (
                            <Alert>
                                <AlertCircle className="h-4 w-4" />
                                <AlertTitle>Location Data Missing</AlertTitle>
                                <AlertDescription>
                                    This center does not have location coordinates yet. Set it below —
                                    type the values, use your current location, or click/drag the marker on the map.
                                </AlertDescription>
                            </Alert>
                        )}

                        {/* Set / Update Location */}
                        <div className="space-y-3 rounded-lg border p-4">
                            <p className="text-sm font-medium">Set Location</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <Label htmlFor="center-lat">Latitude</Label>
                                    <Input
                                        id="center-lat"
                                        type="number"
                                        step="any"
                                        placeholder="e.g. 11.341726"
                                        value={editLat}
                                        onChange={(e) => setEditLat(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="center-lng">Longitude</Label>
                                    <Input
                                        id="center-lng"
                                        type="number"
                                        step="any"
                                        placeholder="e.g. 77.717514"
                                        value={editLng}
                                        onChange={(e) => setEditLng(e.target.value)}
                                    />
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={handleUseMyLocation}
                                    disabled={isLocating}
                                >
                                    {isLocating ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    ) : (
                                        <LocateFixed className="mr-2 h-4 w-4" />
                                    )}
                                    {isLocating ? locatingLabel : 'Use My Location'}
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    className="bg-primary hover:bg-sidebar-accent text-white"
                                    onClick={handleSaveLocation}
                                    disabled={isSavingLocation || !editLat || !editLng}
                                >
                                    {isSavingLocation ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    ) : (
                                        <Save className="mr-2 h-4 w-4" />
                                    )}
                                    Save Location
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Map Display */}
            {selectedCenter && (
                <Card>
                    <CardHeader>
                        <CardTitle>Map Location</CardTitle>
                        <CardDescription>
                            {hasLocationData
                                ? `Exact location of ${selectedCenter.name} — drag the marker or click the map to update it`
                                : `No location set yet — click the map or drag the marker to place ${selectedCenter.name}`}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <MapComponent
                            latitude={firstFiniteNumber(parseFloat(editLat), selectedCenter.latitude, DEFAULT_MAP_LAT)}
                            longitude={firstFiniteNumber(parseFloat(editLng), selectedCenter.longitude, DEFAULT_MAP_LNG)}
                            centerName={selectedCenter.name}
                            centerCode={selectedCenter.code}
                            address={selectedCenter.address || undefined}
                            editable
                            onLocationChange={handleMapLocationChange}
                        />
                    </CardContent>
                </Card>
            )}

            {/* Empty State */}
            {!isLoading && centers.length === 0 && (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <div className="rounded-full bg-muted p-4 mb-4">
                            <MapPin className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <h3 className="text-lg font-semibold mb-2">No Centers Found</h3>
                        <p className="text-sm text-muted-foreground text-center max-w-md">
                            There are no active centers available. Please create a center first or check your branch selection.
                        </p>
                    </CardContent>
                </Card>
            )}

            {/* Delete Confirmation Dialog */}
            <ConfirmationDialog
                open={deleteDialogOpen}
                onOpenChange={setDeleteDialogOpen}
                onConfirm={handleDelete}
                title="Delete Center"
                description={
                    selectedCenter
                        ? `Are you sure you want to delete "${selectedCenter.name}" (${selectedCenter.code})? This action cannot be undone. The center will be soft-deleted and cannot be used for new operations. Note: Centers with active clients or loans cannot be deleted.`
                        : ''
                }
                confirmText="Delete"
                cancelText="Cancel"
                type="delete"
                isLoading={isDeleting}
            />
        </div>
    );
}

