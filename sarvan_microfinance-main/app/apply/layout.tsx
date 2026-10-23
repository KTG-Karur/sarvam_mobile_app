// Minimal standalone layout for the public, unauthenticated /apply/* routes —
// deliberately no AppSidebar/dashboard chrome and no auth guard. The root
// layout (app/layout.tsx) still supplies the brand theme + fonts, so pages
// here look on-brand without inheriting anything session-specific.
export default function ApplyLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-green-50 dark:from-background dark:via-background dark:to-background">
            {children}
        </div>
    );
}
