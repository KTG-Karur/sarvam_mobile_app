import { AssignPasswordForm } from "@/components/employees/password/AssignPasswordForm";

export default function AssignPasswordPage() {
    return (
        <div className="min-h-screen bg-background p-6 space-y-8">
            <div className="grid gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <section>
                    <AssignPasswordForm />
                </section>
            </div>
        </div>
    );
}

