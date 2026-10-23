'use client';

import { useRef } from 'react';
import { GroupsList } from '@/components/groups/GroupsList';
import { motion } from 'framer-motion';

export default function GroupsPage() {
    const refreshRef = useRef<(() => void) | null>(null);

    return (
        <div className="min-h-screen bg-gradient-to-br from-background via-green-50/30 to-purple-50/20 dark:from-background dark:via-brand-green-darker dark:to-green-950 p-6">
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="max-w-7xl mx-auto"
            >
                {/* Page Header */}
                <div className="mb-8">
                    <motion.h1
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.5, delay: 0.1 }}
                        className="text-2xl sm:text-3xl md:text-4xl font-bold bg-gradient-to-r from-primary via-purple-600 to-pink-600 bg-clip-text text-transparent mb-2"
                    >
                        Groups
                    </motion.h1>
                    <motion.p
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.5, delay: 0.2 }}
                        className="text-sidebar-accent dark:text-slate-400 text-lg"
                    >
                        Create and manage groups here — client assignment only picks among existing groups
                    </motion.p>
                </div>

                {/* Groups List Component */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.5, delay: 0.3 }}
                >
                    <GroupsList refreshRef={refreshRef} />
                </motion.div>
            </motion.div>
        </div>
    );
}
