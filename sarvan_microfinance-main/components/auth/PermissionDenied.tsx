'use client';

import { AlertCircle, ShieldOff, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';

interface PermissionDeniedProps {
    message?: string;
    showBackButton?: boolean;
}

/**
 * Component to display when user doesn't have permission to access a resource
 */
export function PermissionDenied({
    message = "You don't have permission to access this resource.",
    showBackButton = true,
}: PermissionDeniedProps) {
    const router = useRouter();

    return (
        <div className="flex min-h-[60vh] items-center justify-center p-6">
            <div className="w-full max-w-md">
                <div className="rounded-2xl border-2 border-red-200 bg-gradient-to-br from-red-50 to-orange-50 p-8 shadow-xl dark:border-red-800 dark:from-red-950/20 dark:to-orange-950/20">
                    {/* Icon */}
                    <div className="mb-6 flex justify-center">
                        <div className="relative">
                            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-red-500 to-orange-600 shadow-lg shadow-red-500/30">
                                <ShieldOff className="h-10 w-10 text-white" />
                            </div>
                            <div className="absolute -right-1 -top-1 flex h-8 w-8 items-center justify-center rounded-full bg-red-600 shadow-lg">
                                <AlertCircle className="h-5 w-5 text-white" />
                            </div>
                        </div>
                    </div>

                    {/* Title */}
                    <h2 className="mb-3 text-center text-2xl font-bold text-red-900 dark:text-red-100">
                        Access Denied
                    </h2>

                    {/* Message */}
                    <p className="mb-6 text-center text-sm text-red-700 dark:text-red-300">
                        {message}
                    </p>

                    {/* Additional Info */}
                    <div className="mb-6 rounded-lg border border-red-300 bg-red-100/50 p-4 dark:border-red-700 dark:bg-red-900/20">
                        <p className="text-xs text-red-800 dark:text-red-200">
                            <strong>Note:</strong> If you believe you should have access to this resource,
                            please contact your system administrator or area manager.
                        </p>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-3">
                        {showBackButton && (
                            <Button
                                onClick={() => router.back()}
                                variant="default"
                                className="w-full bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700"
                            >
                                <ArrowLeft className="mr-2 h-4 w-4" />
                                Go Back
                            </Button>
                        )}
                        <Button
                            onClick={() => router.push('/dashboard')}
                            variant="outline"
                            className="w-full border-red-300 text-red-700 hover:bg-red-100 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900/20"
                        >
                            Go to Dashboard
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

/**
 * Inline permission denied message for smaller contexts
 */
export function InlinePermissionDenied({ message }: { message?: string }) {
    return (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/20">
            <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/50">
                    <ShieldOff className="h-4 w-4 text-red-600 dark:text-red-400" />
                </div>
                <div className="flex-1">
                    <h4 className="mb-1 text-sm font-semibold text-red-900 dark:text-red-100">
                        Access Restricted
                    </h4>
                    <p className="text-xs text-red-700 dark:text-red-300">
                        {message || "You don't have permission to perform this action."}
                    </p>
                </div>
            </div>
        </div>
    );
}
