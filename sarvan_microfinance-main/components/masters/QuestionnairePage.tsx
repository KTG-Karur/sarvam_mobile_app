'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { Badge } from '@/components/ui/badge';
import {
    Plus,
    Edit,
    Trash2,
    Loader2,
    ClipboardList,
    Save,
    ChevronLeft,
    ChevronRight,
    Search,
    X,
    GripVertical,
    ImageIcon,
    Type,
    ToggleLeft,
    CheckSquare,
    Circle,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type QuestionType = 'TEXT' | 'YES_OR_NO' | 'MULTIPLE_CHOICE' | 'SINGLE_CHOICE' | 'IMAGE';
type AuditType = 'PRE_AUDIT' | 'POST_AUDIT';

interface ChoiceInput {
    choice: string;
    weightage: string;
}

interface QuestionInput {
    id?: string;
    question: string;
    questionType: QuestionType;
    weightage: string;
    yesWeightage: string;
    noWeightage: string;
    imageCount: number;
    choices: ChoiceInput[];
}

interface QuestionnaireRow {
    id: string;
    questionnaireId: string;
    title: string;
    description: string | null;
    auditType: AuditType;
    isPublished: boolean;
    _count: { questions: number };
}

const QUESTION_TYPE_OPTIONS: { value: QuestionType; label: string; icon: React.ReactNode }[] = [
    { value: 'TEXT', label: 'Text', icon: <Type className="h-3.5 w-3.5" /> },
    { value: 'YES_OR_NO', label: 'Yes or No', icon: <ToggleLeft className="h-3.5 w-3.5" /> },
    { value: 'MULTIPLE_CHOICE', label: 'Multiple Choice', icon: <CheckSquare className="h-3.5 w-3.5" /> },
    { value: 'SINGLE_CHOICE', label: 'Single Choice', icon: <Circle className="h-3.5 w-3.5" /> },
    { value: 'IMAGE', label: 'Image', icon: <ImageIcon className="h-3.5 w-3.5" /> },
];

function emptyQuestion(order: number): QuestionInput {
    return {
        question: '',
        questionType: 'TEXT',
        weightage: '1',
        yesWeightage: '1',
        noWeightage: '1',
        imageCount: 1,
        choices: [{ choice: '', weightage: '1' }],
    };
}

// ── Question Card Component ────────────────────────────────────────────────────

interface QuestionCardProps {
    index: number;
    question: QuestionInput;
    onChange: (index: number, updated: QuestionInput) => void;
    onRemove: (index: number) => void;
}

function QuestionCard({ index, question, onChange, onRemove }: QuestionCardProps) {
    const update = (patch: Partial<QuestionInput>) => onChange(index, { ...question, ...patch });

    const addChoice = () => update({ choices: [...question.choices, { choice: '', weightage: '1' }] });

    const removeChoice = (i: number) =>
        update({ choices: question.choices.filter((_, idx) => idx !== i) });

    const updateChoice = (i: number, patch: Partial<ChoiceInput>) => {
        const updated = question.choices.map((c, idx) => (idx === i ? { ...c, ...patch } : c));
        update({ choices: updated });
    };

    const typeLabel = QUESTION_TYPE_OPTIONS.find((o) => o.value === question.questionType)?.label ?? question.questionType;

    return (
        <div className="rounded-xl border border-primary/20 bg-white/80 p-4 dark:border-sidebar-accent dark:bg-brand-green-darker/50 shadow-sm">
            {/* Question header */}
            <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <GripVertical className="h-4 w-4 text-slate-300" />
                    <span className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                        Q.{index + 1}
                    </span>
                    <Badge variant="outline" className="text-xs border-primary text-primary dark:border-primary dark:text-primary">
                        {typeLabel}
                    </Badge>
                </div>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemove(index)}
                    className="h-7 w-7 p-0 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                    title="Remove question"
                >
                    <X className="h-4 w-4" />
                </Button>
            </div>

            {/* Question type selector */}
            <div className="mb-3">
                <Label className="text-xs font-medium text-slate-500 dark:text-slate-400">Question Type</Label>
                <Select
                    value={question.questionType}
                    onValueChange={(v) => update({ questionType: v as QuestionType, choices: [{ choice: '', weightage: '1' }] })}
                >
                    <SelectTrigger className="mt-1 h-9 text-sm">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {QUESTION_TYPE_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                                <span className="flex items-center gap-2">
                                    {opt.icon} {opt.label}
                                </span>
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {/* Question text */}
            <div className="mb-3">
                <Label className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Question <span className="text-red-500">*</span>
                </Label>
                <Input
                    value={question.question}
                    onChange={(e) => update({ question: e.target.value })}
                    placeholder="Enter your question here..."
                    className="mt-1 h-9 text-sm"
                />
            </div>

            {/* Type-specific fields */}
            {question.questionType === 'TEXT' && (
                <div>
                    <Label className="text-xs font-medium text-slate-500 dark:text-slate-400">Weightage</Label>
                    <Input
                        type="number"
                        min="0"
                        step="0.5"
                        value={question.weightage}
                        onChange={(e) => update({ weightage: e.target.value })}
                        className="mt-1 h-9 w-32 text-sm"
                    />
                </div>
            )}

            {question.questionType === 'YES_OR_NO' && (
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <Label className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                            Yes — Weightage
                        </Label>
                        <Input
                            type="number"
                            min="0"
                            step="0.5"
                            value={question.yesWeightage}
                            onChange={(e) => update({ yesWeightage: e.target.value })}
                            className="mt-1 h-9 text-sm border-emerald-300 dark:border-emerald-700"
                        />
                    </div>
                    <div>
                        <Label className="text-xs font-medium text-red-600 dark:text-red-400">
                            No — Weightage
                        </Label>
                        <Input
                            type="number"
                            min="0"
                            step="0.5"
                            value={question.noWeightage}
                            onChange={(e) => update({ noWeightage: e.target.value })}
                            className="mt-1 h-9 text-sm border-red-300 dark:border-red-700"
                        />
                    </div>
                </div>
            )}

            {(question.questionType === 'MULTIPLE_CHOICE' || question.questionType === 'SINGLE_CHOICE') && (
                <div>
                    <div className="mb-2 flex items-center justify-between">
                        <Label className="text-xs font-medium text-slate-500 dark:text-slate-400">
                            Answer Choices <span className="text-red-500">*</span>
                        </Label>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={addChoice}
                            className="h-7 text-xs border-primary text-primary hover:bg-green-50 dark:border-primary dark:text-primary"
                        >
                            <Plus className="h-3 w-3 mr-1" /> Add Choice
                        </Button>
                    </div>
                    <div className="space-y-2">
                        {question.choices.map((c, ci) => (
                            <div key={ci} className="flex items-center gap-2">
                                <span className="text-xs font-medium text-slate-400 w-5">{ci + 1}.</span>
                                <Input
                                    value={c.choice}
                                    onChange={(e) => updateChoice(ci, { choice: e.target.value })}
                                    placeholder={`Choice ${ci + 1}`}
                                    className="h-8 text-sm flex-1"
                                />
                                <Input
                                    type="number"
                                    min="0"
                                    step="0.5"
                                    value={c.weightage}
                                    onChange={(e) => updateChoice(ci, { weightage: e.target.value })}
                                    placeholder="Wt."
                                    className="h-8 text-sm w-20"
                                    title="Weightage"
                                />
                                {question.choices.length > 1 && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => removeChoice(ci)}
                                        className="h-8 w-8 p-0 text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </Button>
                                )}
                            </div>
                        ))}
                    </div>
                    <p className="mt-1.5 text-xs text-slate-400">
                        {question.questionType === 'MULTIPLE_CHOICE'
                            ? 'User can select multiple answers.'
                            : 'User can select only one answer.'}
                    </p>
                </div>
            )}

            {question.questionType === 'IMAGE' && (
                <div>
                    <Label className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        Number of Images Required
                    </Label>
                    <Input
                        type="number"
                        min="1"
                        max="20"
                        value={question.imageCount}
                        onChange={(e) => update({ imageCount: parseInt(e.target.value) || 1 })}
                        className="mt-1 h-9 w-32 text-sm"
                    />
                </div>
            )}
        </div>
    );
}

// ── Main Page Component ────────────────────────────────────────────────────────

export default function QuestionnairePage() {
    const [questionnaires, setQuestionnaires] = useState<QuestionnaireRow[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;

    // Form state
    const [formTitle, setFormTitle] = useState('');
    const [formDescription, setFormDescription] = useState('');
    const [formQuestions, setFormQuestions] = useState<QuestionInput[]>([emptyQuestion(0)]);

    const { toast } = useToast();

    // ── Data fetching ─────────────────────────────────────────────────────────

    const fetchQuestionnaires = useCallback(async () => {
        setIsLoading(true);
        try {
            let url = '/questionnaires';
            if (searchTerm) url += `?search=${encodeURIComponent(searchTerm)}`;

            const result = await apiClient.get<QuestionnaireRow[]>(url);
            if (result.success && result.data) {
                setQuestionnaires(result.data);
                setCurrentPage(1);
            }
        } catch (error) {
            console.error('Error fetching questionnaires:', error);
            toast({ title: 'Error', description: 'Failed to load questionnaires.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [toast, searchTerm]);

    useEffect(() => {
        fetchQuestionnaires();
    }, [fetchQuestionnaires]);

    // ── Form helpers ──────────────────────────────────────────────────────────

    const resetForm = () => {
        setFormTitle('');
        setFormDescription('');
        setFormQuestions([emptyQuestion(0)]);
        setEditingId(null);
    };

    const handleOpenCreate = () => {
        resetForm();
        setShowForm(true);
    };

    const handleOpenEdit = async (id: string) => {
        setIsLoading(true);
        try {
            const result = await apiClient.get<{
                id: string;
                title: string;
                description: string | null;
                auditType: AuditType;
                questions: Array<{
                    id: string;
                    question: string;
                    questionType: QuestionType;
                    weightage: number | null;
                    imageCount: number | null;
                    choices: Array<{ choice: string; weightage: number }>;
                }>;
            }>(`/questionnaires?id=${id}`);

            if (result.success && result.data) {
                const q = result.data;
                setEditingId(q.id);
                setFormTitle(q.title);
                setFormDescription(q.description || '');
                setFormQuestions(
                    q.questions.map((ques) => {
                        const yesChoice = ques.choices.find((c) => c.choice === 'YES');
                        const noChoice = ques.choices.find((c) => c.choice === 'NO');
                        return {
                            id: ques.id,
                            question: ques.question,
                            questionType: ques.questionType,
                            weightage: String(ques.weightage ?? 1),
                            yesWeightage: String(yesChoice?.weightage ?? 1),
                            noWeightage: String(noChoice?.weightage ?? 1),
                            imageCount: ques.imageCount ?? 1,
                            choices:
                                ques.questionType === 'MULTIPLE_CHOICE' || ques.questionType === 'SINGLE_CHOICE'
                                    ? ques.choices.map((c) => ({ choice: c.choice, weightage: String(c.weightage) }))
                                    : [{ choice: '', weightage: '1' }],
                        };
                    })
                );
                setShowForm(true);
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to load questionnaire.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleCloseForm = () => {
        setShowForm(false);
        resetForm();
    };

    // ── Question management ───────────────────────────────────────────────────

    const handleAddQuestion = () => {
        setFormQuestions((prev) => [...prev, emptyQuestion(prev.length)]);
    };

    const handleQuestionChange = (index: number, updated: QuestionInput) => {
        setFormQuestions((prev) => prev.map((q, i) => (i === index ? updated : q)));
    };

    const handleRemoveQuestion = (index: number) => {
        if (formQuestions.length === 1) {
            toast({ title: 'Cannot remove', description: 'At least one question is required.', variant: 'destructive' });
            return;
        }
        setFormQuestions((prev) => prev.filter((_, i) => i !== index));
    };

    // ── Validation ────────────────────────────────────────────────────────────

    const validateForm = (): boolean => {
        if (!formTitle.trim()) {
            toast({ title: 'Validation Error', description: 'Questionnaire title is required.', variant: 'destructive' });
            return false;
        }

        for (let i = 0; i < formQuestions.length; i++) {
            const q = formQuestions[i];
            if (!q.question.trim()) {
                toast({ title: 'Validation Error', description: `Q.${i + 1}: Question text is required.`, variant: 'destructive' });
                return false;
            }
            if (q.questionType === 'MULTIPLE_CHOICE' || q.questionType === 'SINGLE_CHOICE') {
                const filled = q.choices.filter((c) => c.choice.trim());
                if (filled.length < 2) {
                    toast({ title: 'Validation Error', description: `Q.${i + 1}: At least 2 choices are required.`, variant: 'destructive' });
                    return false;
                }
            }
        }

        return true;
    };

    // ── Save ──────────────────────────────────────────────────────────────────

    const handleSave = async () => {
        if (!validateForm()) return;

        setIsSaving(true);
        try {
            const payload = {
                id: editingId || undefined,
                title: formTitle.trim(),
                description: formDescription.trim() || null,
                auditType: 'PRE_AUDIT' as AuditType,
                questions: formQuestions.map((q) => ({
                    id: q.id,
                    question: q.question.trim(),
                    questionType: q.questionType,
                    weightage: q.weightage,
                    yesWeightage: q.yesWeightage,
                    noWeightage: q.noWeightage,
                    imageCount: q.imageCount,
                    choices: q.choices.filter((c) => c.choice.trim()),
                })),
            };

            const result = editingId
                ? await apiClient.put('/questionnaires', payload)
                : await apiClient.post('/questionnaires', payload);

            if (result.success) {
                toast({
                    title: 'Success',
                    description: editingId ? 'Questionnaire updated successfully.' : 'Questionnaire created successfully.',
                });
                handleCloseForm();
                fetchQuestionnaires();
            } else {
                throw new Error(result.error || 'Save failed');
            }
        } catch (error) {
            toast({
                title: 'Error',
                description: error instanceof Error ? error.message : 'Failed to save questionnaire.',
                variant: 'destructive',
            });
        } finally {
            setIsSaving(false);
        }
    };

    // ── Delete ────────────────────────────────────────────────────────────────

    const handleDelete = async (id: string, title: string) => {
        if (!confirm(`Are you sure you want to delete "${title}"?`)) return;

        setIsLoading(true);
        try {
            const result = await apiClient.delete(`/questionnaires?id=${id}`);
            if (result.success) {
                toast({ title: 'Success', description: 'Questionnaire deleted successfully.' });
                fetchQuestionnaires();
            } else {
                throw new Error(result.error || 'Delete failed');
            }
        } catch (error) {
            toast({
                title: 'Error',
                description: error instanceof Error ? error.message : 'Failed to delete questionnaire.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    // ── Pagination ────────────────────────────────────────────────────────────

    const totalPages = Math.ceil(questionnaires.length / itemsPerPage);
    const indexOfFirst = (currentPage - 1) * itemsPerPage;
    const currentItems = questionnaires.slice(indexOfFirst, indexOfFirst + itemsPerPage);

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className="px-4 md:px-4 sm:px-8 py-8 md:py-12">
            <div className="mx-auto max-w-7xl">
                {/* Header */}
                <div className="mb-8 flex items-center justify-between rounded-3xl border border-primary/20/80 bg-white/80 px-6 py-4 shadow-xl backdrop-blur-xl dark:border-sidebar-accent dark:bg-brand-green-darker/70">
                    <div className="flex items-center gap-4">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-primary shadow-lg shadow-violet-500/30">
                            <ClipboardList className="h-6 w-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-lg font-semibold text-foreground dark:text-white">Questionnaire Master</h1>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Manage audit questionnaires for loan disbursement
                            </p>
                        </div>
                    </div>
                    <Badge variant="secondary" className="bg-brand-green-darker text-white dark:bg-brand-green-tint dark:text-foreground">
                        {questionnaires.length} Questionnaires
                    </Badge>
                </div>

                {/* ── LIST VIEW ── */}
                {!showForm && (
                    <>
                        {/* Search + Add */}
                        <div className="mb-6 flex flex-col sm:flex-row gap-3">
                            <form
                                onSubmit={(e) => { e.preventDefault(); fetchQuestionnaires(); }}
                                className="flex flex-1 gap-3"
                            >
                                <div className="relative flex-1">
                                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                    <Input
                                        placeholder="Search questionnaires..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        className="pl-9 h-10 text-sm"
                                    />
                                </div>
                                <Button type="submit" variant="secondary" className="h-10">
                                    <Search className="h-4 w-4 mr-2" /> Search
                                </Button>
                                {searchTerm && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        onClick={() => { setSearchTerm(''); fetchQuestionnaires(); }}
                                        className="h-10"
                                    >
                                        Clear
                                    </Button>
                                )}
                            </form>
                            <Button
                                onClick={handleOpenCreate}
                                className="bg-gradient-to-r from-violet-600 to-primary hover:from-violet-700 hover:to-primary h-10"
                            >
                                <Plus className="mr-2 h-4 w-4" /> Add Questionnaire
                            </Button>
                        </div>

                        {/* Table */}
                        <div className="overflow-hidden rounded-2xl border border-primary/20/80 bg-white/70 shadow-2xl backdrop-blur-xl dark:border-sidebar-accent dark:bg-brand-green-darker/50">
                            <div className="flex items-center justify-between border-b border-primary/20/70 px-5 py-3 dark:border-sidebar-accent/80">
                                <h3 className="text-sm font-semibold text-sidebar-accent dark:text-slate-100">Questionnaire Registry</h3>
                                <Badge variant="secondary" className="bg-brand-green-darker text-white dark:bg-brand-green-tint dark:text-foreground">
                                    {questionnaires.length} Records
                                </Badge>
                            </div>

                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader className="bg-gradient-to-r from-violet-600 to-primary">
                                        <TableRow>
                                            <TableHead className="px-5 py-3 font-semibold text-white">ID</TableHead>
                                            <TableHead className="px-5 py-3 font-semibold text-white">Title</TableHead>
                                            <TableHead className="px-5 py-3 font-semibold text-white">Description</TableHead>
                                            <TableHead className="px-5 py-3 text-center font-semibold text-white">Questions</TableHead>
                                            <TableHead className="px-5 py-3 text-center font-semibold text-white">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {isLoading && questionnaires.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={5} className="h-32 text-center">
                                                    <Loader2 className="mx-auto h-8 w-8 animate-spin text-violet-600" />
                                                    <p className="mt-2 text-sm text-slate-500">Loading...</p>
                                                </TableCell>
                                            </TableRow>
                                        ) : currentItems.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={5} className="h-32 text-center">
                                                    <ClipboardList className="mx-auto h-12 w-12 text-slate-300" />
                                                    <p className="mt-2 text-sm text-slate-500">No questionnaires found.</p>
                                                    <Button
                                                        onClick={handleOpenCreate}
                                                        variant="outline"
                                                        size="sm"
                                                        className="mt-3"
                                                    >
                                                        <Plus className="mr-1.5 h-4 w-4" /> Create First Questionnaire
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            currentItems.map((q) => (
                                                <TableRow
                                                    key={q.id}
                                                    className="border-b border-slate-100 hover:bg-violet-50/40 dark:border-sidebar-accent dark:hover:bg-violet-950/20"
                                                >
                                                    <TableCell className="px-5 py-3 font-mono text-xs text-sidebar-accent dark:text-slate-400">
                                                        {q.questionnaireId}
                                                    </TableCell>
                                                    <TableCell className="px-5 py-3 font-semibold text-sidebar-accent dark:text-white max-w-[200px]">
                                                        {q.title}
                                                    </TableCell>
                                                    <TableCell className="px-5 py-3 text-sm text-sidebar-accent dark:text-slate-400 max-w-[250px]">
                                                        <span className="line-clamp-2">{q.description || '—'}</span>
                                                    </TableCell>
                                                    <TableCell className="px-5 py-3 text-center">
                                                        <Badge variant="outline" className="border-primary/30 text-sidebar-accent dark:border-sidebar-accent">
                                                            {q._count.questions} Q
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="px-5 py-3 text-center">
                                                        <div className="flex items-center justify-center gap-2">
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                onClick={() => handleOpenEdit(q.id)}
                                                                className="h-8 w-8 p-0 border-primary/30 text-violet-600 hover:bg-violet-50 dark:border-sidebar-accent"
                                                                title="Edit"
                                                            >
                                                                <Edit className="h-3.5 w-3.5" />
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                onClick={() => handleDelete(q.id, q.title)}
                                                                className="h-8 w-8 p-0 border-primary/30 text-red-600 hover:bg-red-50 dark:border-sidebar-accent"
                                                                title="Delete"
                                                            >
                                                                <Trash2 className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </div>

                            {/* Pagination */}
                            {questionnaires.length > itemsPerPage && (
                                <div className="flex items-center justify-between border-t border-primary/20/70 px-5 py-4 dark:border-sidebar-accent/80">
                                    <p className="text-sm text-slate-500">
                                        Showing {indexOfFirst + 1}–{Math.min(indexOfFirst + itemsPerPage, questionnaires.length)} of {questionnaires.length}
                                    </p>
                                    <div className="flex gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setCurrentPage((p) => p - 1)}
                                            disabled={currentPage === 1}
                                            className="h-8 w-8 p-0"
                                        >
                                            <ChevronLeft className="h-4 w-4" />
                                        </Button>
                                        {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                                            <Button
                                                key={page}
                                                variant={currentPage === page ? 'default' : 'outline'}
                                                size="sm"
                                                onClick={() => setCurrentPage(page)}
                                                className={`h-8 w-8 p-0 ${currentPage === page ? 'bg-gradient-to-r from-violet-600 to-primary' : ''}`}
                                            >
                                                {page}
                                            </Button>
                                        ))}
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setCurrentPage((p) => p + 1)}
                                            disabled={currentPage === totalPages}
                                            className="h-8 w-8 p-0"
                                        >
                                            <ChevronRight className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </>
                )}

                {/* ── FORM VIEW ── */}
                {showForm && (
                    <div className="overflow-hidden rounded-2xl border border-primary/20/80 bg-white/70 shadow-2xl backdrop-blur-xl dark:border-sidebar-accent dark:bg-brand-green-darker/50">
                        {/* Form header */}
                        <div className="border-b border-primary/20/70 px-6 py-4 dark:border-sidebar-accent/80 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <ClipboardList className="h-5 w-5 text-violet-600" />
                                <h2 className="text-base font-semibold text-foreground dark:text-white">
                                    {editingId ? 'Edit Questionnaire' : 'Create Questionnaire'}
                                </h2>
                            </div>
                            <Button variant="ghost" size="sm" onClick={handleCloseForm}>
                                <X className="h-4 w-4 mr-1.5" /> Cancel
                            </Button>
                        </div>

                        <div className="p-6 space-y-6">
                            {/* Basic info */}
                            <div className="grid grid-cols-1 gap-5">
                                <div>
                                    <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Title <span className="text-red-500">*</span>
                                    </Label>
                                    <Input
                                        value={formTitle}
                                        onChange={(e) => setFormTitle(e.target.value)}
                                        placeholder="e.g., Credit Assessment, GRT, CGT..."
                                        className="mt-1.5 h-10 text-sm"
                                        autoFocus
                                    />
                                </div>
                                <div>
                                    <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Description
                                    </Label>
                                    <Textarea
                                        value={formDescription}
                                        onChange={(e) => setFormDescription(e.target.value)}
                                        placeholder="Brief description of this questionnaire's purpose..."
                                        className="mt-1.5 text-sm resize-none"
                                        rows={2}
                                    />
                                </div>
                            </div>

                            {/* Questions section */}
                            <div>
                                <div className="mb-3 flex items-center justify-between">
                                    <h3 className="text-sm font-semibold text-sidebar-accent dark:text-slate-100 flex items-center gap-2">
                                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-100 text-violet-700 text-xs font-bold dark:bg-violet-950/50 dark:text-violet-300">
                                            {formQuestions.length}
                                        </span>
                                        Questions
                                    </h3>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={handleAddQuestion}
                                        className="h-8 text-sm border-violet-300 text-violet-700 hover:bg-violet-50 dark:border-violet-700 dark:text-violet-300"
                                    >
                                        <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Question
                                    </Button>
                                </div>

                                <div className="space-y-3">
                                    {formQuestions.map((q, idx) => (
                                        <QuestionCard
                                            key={idx}
                                            index={idx}
                                            question={q}
                                            onChange={handleQuestionChange}
                                            onRemove={handleRemoveQuestion}
                                        />
                                    ))}
                                </div>

                                {formQuestions.length === 0 && (
                                    <div className="rounded-xl border-2 border-dashed border-primary/20 py-10 text-center dark:border-sidebar-accent">
                                        <p className="text-sm text-slate-400">No questions yet. Click "Add Question" to begin.</p>
                                    </div>
                                )}
                            </div>

                            {/* Action buttons */}
                            <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-5 dark:border-sidebar-accent">
                                <Button
                                    onClick={handleSave}
                                    disabled={isSaving}
                                    className="bg-gradient-to-r from-primary to-cyan-600 hover:from-sidebar-accent hover:to-cyan-700"
                                >
                                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Save className="h-4 w-4 mr-1.5" />}
                                    Save
                                </Button>
                                <Button type="button" variant="ghost" onClick={handleCloseForm} className="text-slate-500">
                                    Cancel
                                </Button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
