'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Plus, X, ChevronRight, Users, MessageSquareText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { GrtSessionDetailPage } from '@/components/loan-module/GrtSessionDetailPage';
import { DateInput } from '@/components/ui/date-input';

type SessionRow = {
    id: string; sessionId: string; sessionDate: string; questionnaireTitle: string;
    memberCount: number; isComplete: boolean; createdBy: string;
};
type QuestionnaireOption = { id: string; title: string; auditType: string };
type LoanMemberOption = {
    loanId: string; loanNumber: string; clientDisplayId: string; clientName: string; grtComplete: boolean;
};

interface GrtSessionsClientProps {
    centerId: string;
    centerName: string;
}

export function GrtSessionsClient({ centerId, centerName }: GrtSessionsClientProps) {
    const { toast } = useToast();
    const [sessions, setSessions] = useState<SessionRow[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [openSessionId, setOpenSessionId] = useState<string | null>(null);

    const [showForm, setShowForm] = useState(false);
    const [sessionDate, setSessionDate] = useState(new Date().toISOString().split('T')[0]);
    const [questionnaires, setQuestionnaires] = useState<QuestionnaireOption[]>([]);
    const [selectedQuestionnaireId, setSelectedQuestionnaireId] = useState('');
    const [loanMembers, setLoanMembers] = useState<LoanMemberOption[]>([]);
    const [selectedLoanIds, setSelectedLoanIds] = useState<Set<string>>(new Set());
    const [isLoadingClients, setIsLoadingClients] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const fetchSessions = useCallback(() => {
        setIsLoading(true);
        apiClient.get<SessionRow[]>(`/grt-sessions?centerId=${centerId}`)
            .then((r) => { if (r.success && r.data) setSessions(r.data); })
            .finally(() => setIsLoading(false));
    }, [centerId]);

    useEffect(() => { fetchSessions(); }, [fetchSessions]);

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedSessions } = useTableSearch(sessions);

    useEffect(() => {
        apiClient.get<QuestionnaireOption[]>('/questionnaires').then((r) => {
            if (r.success && r.data) setQuestionnaires(r.data);
        });
    }, []);

    const openCreateForm = () => {
        setShowForm(true);
        setIsLoadingClients(true);
        // Members are sourced from the pending-disbursement roster (loan-scoped) —
        // GRT coverage is per loan, so only clients with an active loan awaiting
        // disbursement in this center are eligible to be added to a session.
        apiClient.get<any[]>(`/member-individual?centerId=${centerId}`)
            .then((r) => {
                if (r.success && r.data) {
                    const list: LoanMemberOption[] = r.data.map((row) => ({
                        loanId: row.loanId, loanNumber: row.loanNumber,
                        clientDisplayId: row.clientDisplayId, clientName: row.clientName,
                        grtComplete: row.grtComplete,
                    }));
                    setLoanMembers(list);
                    setSelectedLoanIds(new Set(list.filter((l) => !l.grtComplete).map((l) => l.loanId)));
                }
            })
            .finally(() => setIsLoadingClients(false));
    };

    const toggleLoan = (loanId: string) => {
        setSelectedLoanIds((prev) => {
            const next = new Set(prev);
            if (next.has(loanId)) next.delete(loanId); else next.add(loanId);
            return next;
        });
    };

    const createSession = async () => {
        if (!selectedQuestionnaireId) {
            toast({ title: 'Select Questionnaire', description: 'Choose a GRT questionnaire.', variant: 'destructive' });
            return;
        }
        if (selectedLoanIds.size === 0) {
            toast({ title: 'Select Members', description: 'Select at least one member for this GRT session.', variant: 'destructive' });
            return;
        }
        setIsSaving(true);
        try {
            const result = await apiClient.post<{ id: string; sessionId: string }>('/grt-sessions', {
                centerId,
                sessionDate,
                questionnaireId: selectedQuestionnaireId,
                loanIds: Array.from(selectedLoanIds),
            });
            if (result.success && result.data) {
                toast({ title: 'Created', description: `GRT session ${result.data.sessionId} created.` });
                setShowForm(false);
                setSelectedQuestionnaireId('');
                fetchSessions();
                setOpenSessionId(result.data.id);
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to create session.', variant: 'destructive' });
            }
        } finally {
            setIsSaving(false);
        }
    };

    if (openSessionId) {
        return (
            <GrtSessionDetailPage
                sessionId={openSessionId}
                onClose={() => { setOpenSessionId(null); fetchSessions(); }}
            />
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-base font-semibold text-foreground dark:text-white">GRT Sessions — {centerName}</h3>
                    <p className="text-xs text-muted-foreground">Fill GRT for a group of members at once. A center can have multiple sessions across different dates.</p>
                </div>
                <Button
                    type="button" size="sm"
                    className={showForm ? 'bg-brand-green-tint text-sidebar-accent hover:bg-green-200' : 'bg-gradient-to-r from-teal-500 to-teal-700 text-white'}
                    onClick={() => { if (showForm) setShowForm(false); else openCreateForm(); }}
                >
                    {showForm ? <><X className="h-3.5 w-3.5 mr-1.5" />Cancel</> : <><Plus className="h-3.5 w-3.5 mr-1.5" />New GRT Session</>}
                </Button>
            </div>

            {showForm && (
                <Card className="border-2 border-teal-200 dark:border-teal-800">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm">New GRT Session</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold">Session Date</Label>
                                <DateInput value={sessionDate} onChange={(e) => setSessionDate(e.target.value)} />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold">Questionnaire</Label>
                                <Select value={selectedQuestionnaireId} onValueChange={setSelectedQuestionnaireId}>
                                    <SelectTrigger><SelectValue placeholder="Select Questionnaire" /></SelectTrigger>
                                    <SelectContent>
                                        {questionnaires.map((q) => (
                                            <SelectItem key={q.id} value={q.id}>{q.title}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label className="text-xs font-semibold flex items-center gap-1.5">
                                <Users className="h-3.5 w-3.5" /> Members ({selectedLoanIds.size} selected of {loanMembers.length})
                            </Label>
                            {isLoadingClients ? (
                                <div className="flex items-center justify-center py-6">
                                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mr-2" />
                                    <span className="text-xs text-muted-foreground">Loading members...</span>
                                </div>
                            ) : loanMembers.length === 0 ? (
                                <p className="text-xs text-slate-400 py-4">No pending-disbursement loans found in this center.</p>
                            ) : (
                                <div className="max-h-56 overflow-y-auto rounded-lg border divide-y">
                                    {loanMembers.map((m) => (
                                        <label key={m.loanId} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-green-50 dark:hover:bg-brand-green-darker/40 cursor-pointer">
                                            <Checkbox checked={selectedLoanIds.has(m.loanId)} onCheckedChange={() => toggleLoan(m.loanId)} />
                                            <span className="font-mono text-xs text-slate-500">{m.clientDisplayId}</span>
                                            <span>{m.clientName}</span>
                                            <span className="font-mono text-[10px] text-slate-400">({m.loanNumber})</span>
                                            {m.grtComplete && (
                                                <Badge className="ml-auto bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-[10px]">Already Complete</Badge>
                                            )}
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="flex justify-end">
                            <Button onClick={createSession} disabled={isSaving} className="bg-teal-600 hover:bg-teal-700 text-white">
                                {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <MessageSquareText className="h-4 w-4 mr-2" />}
                                Create Session
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {sessions.length > 0 && (
                <div className="flex justify-end">
                    <TableSearchInput
                        value={tableSearchQuery}
                        onChange={setTableSearchQuery}
                        placeholder="Search GRT sessions..."
                    />
                </div>
            )}

            <Card>
                <CardContent className="p-0">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mr-2" />
                            <span className="text-sm text-muted-foreground">Loading sessions...</span>
                        </div>
                    ) : sessions.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                            <MessageSquareText className="h-10 w-10 mb-3 opacity-30" />
                            <p className="text-sm">No GRT sessions yet for this center.</p>
                        </div>
                    ) : searchedSessions.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                            <MessageSquareText className="h-10 w-10 mb-3 opacity-30" />
                            <p className="text-sm">No GRT sessions match your search.</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader className="bg-brand-green-darker dark:bg-sidebar-accent text-white">
                                    <TableRow className="hover:bg-brand-green-darker dark:hover:bg-sidebar-accent border-none">
                                        <TableHead className="text-white">Session</TableHead>
                                        <TableHead className="text-white">Date</TableHead>
                                        <TableHead className="text-white">Questionnaire</TableHead>
                                        <TableHead className="text-white text-center">Members</TableHead>
                                        <TableHead className="text-white text-center">Status</TableHead>
                                        <TableHead className="text-white">Created By</TableHead>
                                        <TableHead className="text-white text-center">Open</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {searchedSessions.map((s) => (
                                        <TableRow key={s.id} className="even:bg-green-50 dark:even:bg-brand-green-darker/50">
                                            <TableCell className="font-mono text-xs">{s.sessionId}</TableCell>
                                            <TableCell className="text-xs">{s.sessionDate}</TableCell>
                                            <TableCell className="text-xs">{s.questionnaireTitle}</TableCell>
                                            <TableCell className="text-center text-xs">{s.memberCount}</TableCell>
                                            <TableCell className="text-center">
                                                {s.isComplete
                                                    ? <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Complete</Badge>
                                                    : <Badge variant="outline" className="text-amber-700 border-amber-300">Pending</Badge>}
                                            </TableCell>
                                            <TableCell className="text-xs">{s.createdBy}</TableCell>
                                            <TableCell className="text-center">
                                                <Button
                                                    type="button" size="sm" variant="outline"
                                                    className="h-8 px-2 border-teal-600 text-teal-700 hover:bg-teal-50"
                                                    onClick={() => setOpenSessionId(s.id)}
                                                >
                                                    Open <ChevronRight className="h-3.5 w-3.5 ml-1" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
