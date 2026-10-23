import { ResetPasswordForm } from "@/components/employees/password/ResetPasswordForm";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";

export default function ResetPasswordPage() {
    return (
        <ProtectedRoute>
            <div className="min-h-screen bg-background p-6 space-y-8">
                <div className="grid gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <section>
                        <ResetPasswordForm />
                    </section>
                </div>
            </div>
        </ProtectedRoute>
    );
}

