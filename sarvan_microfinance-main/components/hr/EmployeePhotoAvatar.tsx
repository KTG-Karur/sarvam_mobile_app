'use client';

import { UserCircle } from 'lucide-react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { useSignedUrl } from '@/hooks/useSignedUrl';
import { cn } from '@/lib/utils';

/**
 * Round employee photo for pickers and cards. `photoKey` is the stored photo
 * from GET /api/hr/employees (the same photo as the employee ID card — see
 * app/lib/hr/employee-photo.ts); the bucket is private, so it's resolved to a
 * signed URL here. Falls back to a generic icon while loading or when absent.
 */
export function EmployeePhotoAvatar({ photoKey, name, className }: {
    photoKey?: string | null;
    name: string;
    className?: string;
}) {
    const src = useSignedUrl(photoKey ?? null);
    return (
        <Avatar className={cn('shrink-0', className)}>
            {src && <AvatarImage src={src} alt={name} className="object-cover" />}
            <AvatarFallback className="bg-gradient-to-br from-primary to-primary text-white">
                <UserCircle className="h-1/2 w-1/2" />
            </AvatarFallback>
        </Avatar>
    );
}
