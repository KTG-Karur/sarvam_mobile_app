'use client';

import { useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { apiClient } from '@/app/lib/api-client';

type Named = { id: string; name: string };
type ShiftOption = Named & { shiftStart: string; shiftEnd: string };

export interface OnboardingOrgValue {
    regionId: string;
    divisionId: string;
    shiftId: string;
}

/**
 * Region → Division (cascading) and Shift, chosen when a new-employee request is raised.
 * The branch is still assigned where it always was (Submit for Approval); the shift is
 * copied onto the employee when they are created at final approval.
 */
export function OnboardingOrgPicker({
    value,
    onChange,
    disabled,
}: {
    value: OnboardingOrgValue;
    onChange: (field: keyof OnboardingOrgValue, next: string) => void;
    disabled?: boolean;
}) {
    const [regions, setRegions] = useState<Named[]>([]);
    const [divisions, setDivisions] = useState<Named[]>([]);
    const [shifts, setShifts] = useState<ShiftOption[]>([]);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const [regionsRes, shiftsRes] = await Promise.all([
                apiClient.get<Named[]>('/regions'),
                apiClient.get<ShiftOption[]>('/hr/shifts'),
            ]);
            if (cancelled) return;
            if (regionsRes.success && regionsRes.data) setRegions(regionsRes.data);
            if (shiftsRes.success && shiftsRes.data) setShifts(shiftsRes.data);
        })();
        return () => { cancelled = true; };
    }, []);

    // Divisions follow the chosen region.
    useEffect(() => {
        if (!value.regionId) {
            setDivisions([]);
            return;
        }
        let cancelled = false;
        void (async () => {
            const res = await apiClient.get<Named[]>(`/divisions?regionId=${encodeURIComponent(value.regionId)}`);
            if (!cancelled && res.success && res.data) setDivisions(res.data);
        })();
        return () => { cancelled = true; };
    }, [value.regionId]);

    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1">
                <Label htmlFor="onboarding-region">Region</Label>
                <Select
                    value={value.regionId || undefined}
                    onValueChange={(v) => { onChange('regionId', v); onChange('divisionId', ''); }}
                    disabled={disabled}
                >
                    <SelectTrigger id="onboarding-region" className="bg-white"><SelectValue placeholder="Select region" /></SelectTrigger>
                    <SelectContent>
                        {regions.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>
            <div className="space-y-1">
                <Label htmlFor="onboarding-division">Division</Label>
                <Select
                    value={value.divisionId || undefined}
                    onValueChange={(v) => onChange('divisionId', v)}
                    disabled={disabled || !value.regionId}
                >
                    <SelectTrigger id="onboarding-division" className="bg-white">
                        <SelectValue placeholder={value.regionId ? 'Select division' : 'Select a region first'} />
                    </SelectTrigger>
                    <SelectContent>
                        {divisions.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>
            <div className="space-y-1">
                <Label htmlFor="onboarding-shift">Shift</Label>
                <Select value={value.shiftId || undefined} onValueChange={(v) => onChange('shiftId', v)} disabled={disabled}>
                    <SelectTrigger id="onboarding-shift" className="bg-white"><SelectValue placeholder="Select shift" /></SelectTrigger>
                    <SelectContent>
                        {shifts.map((s) => (
                            <SelectItem key={s.id} value={s.id}>{s.name} ({s.shiftStart}–{s.shiftEnd})</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
        </div>
    );
}
