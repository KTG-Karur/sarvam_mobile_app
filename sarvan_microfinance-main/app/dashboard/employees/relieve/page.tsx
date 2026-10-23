import { RelieveEmployeeForm } from "@/components/employees/relieve/RelieveEmployeeForm";

export default function RelieveEmployeePage() {
    return (
        <div className="min-h-screen bg-background p-6 space-y-8">
            <div className="grid gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <section>
                    <RelieveEmployeeForm />
                </section>
            </div>
        </div>
    );
}

