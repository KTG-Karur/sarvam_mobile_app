'use client';

import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import type { LucideIcon } from 'lucide-react';

interface StatCardProps {
    title: string;
    value: string | number;
    icon: LucideIcon;
    subtitle?: string;
    trend?: {
        value: number;
        isPositive: boolean;
    };
    color?: 'blue' | 'green' | 'purple' | 'orange';
}

const colorClasses = {
    blue: 'bg-primary',
    green: 'bg-green-500',
    purple: 'bg-purple-500',
    orange: 'bg-orange-500',
};

export function StatCard({
    title,
    value,
    icon: Icon,
    subtitle,
    trend,
    color = 'blue',
}: StatCardProps) {
    return (
        <Card className="overflow-hidden border-0 shadow-lg transition-all duration-200 hover:shadow-xl">
            <CardContent className="p-0">
                <div className="flex items-center">
                    {/* Icon Section */}
                    <div
                        className={cn(
                            'flex h-24 w-24 items-center justify-center',
                            colorClasses[color]
                        )}
                    >
                        <Icon className="h-10 w-10 text-white" />
                    </div>

                    {/* Content Section */}
                    <div className="flex-1 p-4">
                        <p className="text-sm font-medium text-sidebar-accent dark:text-slate-400">
                            {title}
                        </p>
                        <div className="mt-1 flex items-baseline gap-2">
                            <h3 className="text-3xl font-bold text-foreground dark:text-white">
                                {value}
                            </h3>
                            {trend && (
                                <span
                                    className={cn(
                                        'text-sm font-medium',
                                        trend.isPositive ? 'text-green-600' : 'text-red-600'
                                    )}
                                >
                                    {trend.isPositive ? '+' : ''}
                                    {trend.value}%
                                </span>
                            )}
                        </div>
                        {subtitle && (
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                {subtitle}
                            </p>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
