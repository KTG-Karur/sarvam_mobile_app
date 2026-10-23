import { AllPasswordsList } from "@/components/employees/password/AllPasswordsList";

export default function AllPasswordsPage() {
    return (
        <div className="min-h-screen bg-background p-6 space-y-8">
            <div className="grid gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <section>
                    <AllPasswordsList />
                </section>
            </div>
        </div>
    );
}

