'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { StorageImage } from '@/components/storage/StorageMedia';
import { CameraCapture } from '@/components/ui/CameraCapture';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { ArrowLeft, CheckCircle2, Loader2, Camera, Users, Trash2 } from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';

interface GrtSessionDetailPageProps {
    sessionId: string;
    onClose: () => void;
}

type Member = { id: string; clientId: string; name: string; loanId: string; loanNumber: string };
type QuestionChoice = { id: string; choice: string };
type Question = { id: string; question: string; questionType: string; priorityOrder: number; choices: QuestionChoice[] };
type Answer = { questionId: string; answerText: string | null; answerBool: boolean | null; answerChoiceIds: string[] };
type Photo = { id: string; questionId: string | null; photoUrl: string; notes: string | null; createdAt: string };

type SessionData = {
    id: string; sessionId: string; sessionDate: string; centerName: string; centerCode: string;
    isComplete: boolean; completedAt: string | null;
    members: Member[];
    questionnaire: { id: string; title: string; questions: Question[] };
    answers: Answer[];
    photos: Photo[];
};

export function GrtSessionDetailPage({ sessionId, onClose }: GrtSessionDetailPageProps) {
    const { toast } = useToast();
    const [data, setData] = useState<SessionData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [answers, setAnswers] = useState<Map<string, Answer>>(new Map());
    const [isSaving, setIsSaving] = useState(false);
    const [isCompleting, setIsCompleting] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [cameraQuestionId, setCameraQuestionId] = useState<string | null>(null);
    const [generalCameraOpen, setGeneralCameraOpen] = useState(false);
    const answersRef = useRef<Map<string, Answer>>(new Map());
    const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            const result = await apiClient.get<SessionData>(`/grt-sessions/${sessionId}`);
            if (result.success && result.data) {
                setData(result.data);
                const map = new Map<string, Answer>();
                result.data.answers.forEach((a) => map.set(a.questionId, a));
                setAnswers(map);
                answersRef.current = map;
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to load session.', variant: 'destructive' });
            }
        } finally {
            setIsLoading(false);
        }
    }, [sessionId, toast]);

    useEffect(() => { fetchData(); }, [fetchData]);

    // Saves the current answers as-is — used both by the debounced autosave and
    // as a flush before any action (photo upload/remove, complete) that refetches
    // the session, so those refetches never clobber not-yet-saved answers.
    const persistAnswers = useCallback(async () => {
        if (autoSaveTimeoutRef.current) {
            clearTimeout(autoSaveTimeoutRef.current);
            autoSaveTimeoutRef.current = null;
        }
        if (answersRef.current.size === 0) return;
        setIsSaving(true);
        try {
            const result = await apiClient.patch(`/grt-sessions/${sessionId}/answers`, { answers: Array.from(answersRef.current.values()) });
            if (!result.success) {
                toast({ title: 'Error', description: result.error || 'Failed to save answers.', variant: 'destructive' });
            }
        } finally {
            setIsSaving(false);
        }
    }, [sessionId, toast]);

    const scheduleAutoSave = () => {
        if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
        autoSaveTimeoutRef.current = setTimeout(() => { persistAnswers(); }, 800);
    };

    const updateAnswer = (questionId: string, patch: Partial<Answer>) => {
        setAnswers((prev) => {
            const next = new Map(prev);
            const current = next.get(questionId) ?? { questionId, answerText: '', answerBool: null, answerChoiceIds: [] };
            next.set(questionId, { ...current, ...patch });
            answersRef.current = next;
            return next;
        });
        scheduleAutoSave();
    };

    const toggleChoice = (questionId: string, choiceId: string) => {
        const current = answers.get(questionId);
        const existing = current?.answerChoiceIds ?? [];
        const updated = existing.includes(choiceId) ? existing.filter((id) => id !== choiceId) : [...existing, choiceId];
        updateAnswer(questionId, { answerChoiceIds: updated });
    };

    const handlePhotoUpload = async (file: File, questionId: string | null) => {
        await persistAnswers();
        const formData = new FormData();
        formData.append('photo', file);
        if (questionId) formData.append('questionId', questionId);
        const result = await apiClient.post(`/grt-sessions/${sessionId}/photos`, formData);
        if (result.success) {
            toast({ title: 'Photo Uploaded' });
            fetchData();
        } else {
            toast({ title: 'Error', description: result.error || 'Upload failed.', variant: 'destructive' });
        }
    };

    const removePhoto = async (photoId: string) => {
        await persistAnswers();
        const result = await apiClient.delete(`/grt-sessions/${sessionId}/photos/${photoId}`);
        if (result.success) fetchData();
    };

    const completeSession = async () => {
        await persistAnswers();
        setIsCompleting(true);
        try {
            const result = await apiClient.patch(`/grt-sessions/${sessionId}/complete`, {});
            if (result.success) {
                toast({ title: 'Complete', description: 'GRT session marked complete — all selected members are now cleared.' });
                fetchData();
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to complete session.', variant: 'destructive' });
            }
        } finally {
            setIsCompleting(false);
        }
    };

    useEffect(() => () => { if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current); }, []);

    const deleteSession = async () => {
        if (!confirm('Delete this GRT session? This cannot be undone.')) return;
        setIsDeleting(true);
        try {
            const result = await apiClient.delete(`/grt-sessions/${sessionId}`);
            if (result.success) {
                toast({ title: 'Deleted', description: 'GRT session removed.' });
                onClose();
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to delete session.', variant: 'destructive' });
            }
        } finally {
            setIsDeleting(false);
        }
    };

    const renderQuestion = (q: Question) => {
        const ans = answers.get(q.id);
        const photo = data?.photos.find((p) => p.questionId === q.id);
        const locked = !!data?.isComplete;
        return (
            <Card key={q.id} className="border border-slate-200 dark:border-slate-700">
                <CardContent className="p-4 space-y-3">
                    <p className="text-sm font-medium">{q.question}</p>
                    {q.questionType === 'TEXT' && (
                        <Input
                            value={ans?.answerText ?? ''}
                            disabled={locked}
                            onChange={(e) => updateAnswer(q.id, { answerText: e.target.value })}
                            placeholder="Enter answer"
                        />
                    )}
                    {q.questionType === 'YES_OR_NO' && (
                        <div className="flex gap-2">
                            <Button type="button" size="sm" disabled={locked} variant={ans?.answerBool === true ? 'default' : 'outline'} onClick={() => updateAnswer(q.id, { answerBool: true })}>Yes</Button>
                            <Button type="button" size="sm" disabled={locked} variant={ans?.answerBool === false ? 'default' : 'outline'} onClick={() => updateAnswer(q.id, { answerBool: false })}>No</Button>
                        </div>
                    )}
                    {q.questionType === 'SINGLE_CHOICE' && (
                        <RadioGroup value={ans?.answerChoiceIds?.[0] ?? ''} onValueChange={(v) => updateAnswer(q.id, { answerChoiceIds: [v] })}>
                            {q.choices.map((c) => (
                                <div key={c.id} className="flex items-center gap-2">
                                    <RadioGroupItem value={c.id} id={`${q.id}-${c.id}`} disabled={locked} />
                                    <Label htmlFor={`${q.id}-${c.id}`} className="text-sm font-normal cursor-pointer">{c.choice}</Label>
                                </div>
                            ))}
                        </RadioGroup>
                    )}
                    {q.questionType === 'MULTIPLE_CHOICE' && (
                        <div className="space-y-1.5">
                            {q.choices.map((c) => (
                                <div key={c.id} className="flex items-center gap-2">
                                    <Checkbox
                                        id={`${q.id}-${c.id}`}
                                        disabled={locked}
                                        checked={(ans?.answerChoiceIds ?? []).includes(c.id)}
                                        onCheckedChange={() => toggleChoice(q.id, c.id)}
                                    />
                                    <Label htmlFor={`${q.id}-${c.id}`} className="text-sm font-normal cursor-pointer">{c.choice}</Label>
                                </div>
                            ))}
                        </div>
                    )}
                    {q.questionType === 'IMAGE' && (
                        <div className="flex items-center gap-3">
                            {photo ? (
                                <StorageImage src={photo.photoUrl} alt="Answer" className="h-16 w-20 object-cover rounded border" />
                            ) : (
                                <Button type="button" size="sm" variant="outline" disabled={locked} onClick={() => setCameraQuestionId(q.id)}>
                                    <Camera className="h-3.5 w-3.5 mr-1.5" /> Capture
                                </Button>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>
        );
    };

    if (isLoading || !data) {
        return <PageLoader label="Loading GRT session..." fullScreen={false} />;
    }

    const generalPhotos = data.photos.filter((p) => !p.questionId);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="sm" onClick={onClose}>
                        <ArrowLeft className="h-4 w-4 mr-1.5" /> Back
                    </Button>
                    <div>
                        <h1 className="text-xl font-bold text-foreground dark:text-white">{data.sessionId}</h1>
                        <p className="text-xs text-slate-500">{data.centerName} ({data.centerCode}) · {data.sessionDate} · {data.questionnaire.title}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {data.isComplete
                        ? <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Complete</Badge>
                        : <Badge variant="outline" className="text-amber-700 border-amber-300">Pending</Badge>}
                    {!data.isComplete && (
                        <Button type="button" size="sm" variant="ghost" className="text-red-500 hover:text-red-600" disabled={isDeleting} onClick={deleteSession}>
                            {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </Button>
                    )}
                </div>
            </div>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-1.5"><Users className="h-4 w-4" />Members ({data.members.length})</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-wrap gap-2">
                        {data.members.map((m) => (
                            <Badge key={m.loanId} variant="outline" className="font-normal">
                                <span className="font-mono text-[10px] mr-1.5">{m.clientId}</span>{m.name}
                                <span className="font-mono text-[10px] text-slate-400 ml-1.5">({m.loanNumber})</span>
                            </Badge>
                        ))}
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-2">
                        <CardTitle className="text-sm">{data.questionnaire.title}</CardTitle>
                        {!data.isComplete && (
                            <span className="flex items-center text-[11px] text-muted-foreground">
                                {isSaving ? <><Loader2 className="h-3 w-3 animate-spin mr-1.5" />Saving…</> : 'Answers auto-save'}
                            </span>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="space-y-3">
                    {data.questionnaire.questions.map(renderQuestion)}
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Center-wise Photos</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-3">
                        {generalPhotos.map((p) => (
                            <div key={p.id} className="relative">
                                <StorageImage src={p.photoUrl} alt="GRT" className="h-20 w-24 object-cover rounded border" />
                                {!data.isComplete && (
                                    <button
                                        type="button"
                                        className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-red-500 text-white flex items-center justify-center"
                                        onClick={() => removePhoto(p.id)}
                                    >
                                        ×
                                    </button>
                                )}
                            </div>
                        ))}
                        {!data.isComplete && (
                            <Button type="button" variant="outline" size="sm" onClick={() => setGeneralCameraOpen(true)}>
                                <Camera className="h-3.5 w-3.5 mr-1.5" /> Add Photo
                            </Button>
                        )}
                    </div>
                </CardContent>
            </Card>

            {!data.isComplete && (
                <>
                    <Separator />
                    <div className="flex justify-end gap-2">
                        <Button onClick={completeSession} disabled={isCompleting} className="bg-primary hover:bg-primary text-white">
                            {isCompleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                            Mark Complete
                        </Button>
                    </div>
                </>
            )}

            <CameraCapture
                open={!!cameraQuestionId}
                onClose={() => setCameraQuestionId(null)}
                onCapture={(file) => { const qId = cameraQuestionId; setCameraQuestionId(null); if (qId) handlePhotoUpload(file, qId); }}
                label="GRT Photo"
            />
            <CameraCapture
                open={generalCameraOpen}
                onClose={() => setGeneralCameraOpen(false)}
                onCapture={(file) => { setGeneralCameraOpen(false); handlePhotoUpload(file, null); }}
                label="Center Photo"
            />
        </div>
    );
}
