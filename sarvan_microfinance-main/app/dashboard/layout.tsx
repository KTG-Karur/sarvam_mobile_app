'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { AppHeader } from '@/components/layout/AppHeader';
import { useTokenRefresh } from '@/app/hooks/use-token-refresh';
import { usePermissionHydration } from '@/app/hooks/usePermissionHydration';
import { CompletedSarvamLogo } from '@/components/SarvamLoginTransition';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  useTokenRefresh();
  usePermissionHydration();
  const { toast } = useToast();

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [isCrossfading, setIsCrossfading] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const flag = sessionStorage.getItem('sarvam_login_crossfade') === 'true';
        if (flag) {
          sessionStorage.removeItem('sarvam_login_crossfade');
          return true;
        }
      } catch {
        return false;
      }
    }
    return false;
  });

  useEffect(() => {
    if (isCrossfading) {
      const timer = setTimeout(() => {
        setIsCrossfading(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isCrossfading]);

  // Show "Login Successful" toast only after the dashboard has landed (crossfade complete)
  useEffect(() => {
    if (!isCrossfading) {
      try {
        const welcomeUser = sessionStorage.getItem('sarvam_login_toast');
        if (welcomeUser) {
          sessionStorage.removeItem('sarvam_login_toast');
          toast({
            title: 'Login Successful',
            description: `Welcome back, ${welcomeUser}!`,
          });
        }
      } catch {
        /* ignore */
      }
    }
  }, [isCrossfading, toast]);

  return (
    <>
      {isCrossfading && (
        <motion.div
          className="fixed inset-0 z-[150] flex flex-col items-center justify-center overflow-hidden pointer-events-none"
          style={{ backgroundColor: '#F7FBF8' }}
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: 'easeInOut' }}
          onAnimationComplete={() => setIsCrossfading(false)}
        >
          <CompletedSarvamLogo />
        </motion.div>
      )}

      <motion.div
        className="flex h-screen overflow-hidden bg-background"
        initial={isCrossfading ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18, ease: 'easeInOut' }}
      >
        {/* Mobile overlay backdrop — always mounted (not conditionally rendered) and faded via
            opacity, synced to the same 300ms as the sidebar's own slide transition in
            AppSidebar.tsx. Conditionally mounting it made the dimming vanish instantly on close
            while the sidebar kept sliding for another 300ms, which felt out of sync. */}
        <div
          className={cn(
            'fixed inset-0 z-20 bg-black/50 transition-opacity duration-300 ease-in-out lg:hidden',
            mobileSidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
          )}
          onClick={() => setMobileSidebarOpen(false)}
          aria-hidden="true"
        />

        {/* Sidebar */}
        <div className="print:hidden">
          <AppSidebar
            isMobileOpen={mobileSidebarOpen}
            onMobileClose={() => setMobileSidebarOpen(false)}
          />
        </div>

        {/* Main Content Area */}
        <div className="flex flex-1 flex-col overflow-hidden min-w-0">
          {/* Header */}
          <div className="print:hidden">
            <AppHeader onMobileMenuToggle={() => setMobileSidebarOpen((o) => !o)} isMobileSidebarOpen={mobileSidebarOpen} />
          </div>

          {/* Accent Bar — green to yellow */}
          <div className="h-1 bg-gradient-to-r from-primary via-secondary to-primary bg-[length:200%_100%] animate-shimmer print:hidden" />

          {/* Page Content
              NOTE: No padding-top here — sticky tab bars in child pages use
              `sticky top-0` and must be flush against this container's top edge.
              Individual pages add their own pt-X through their container wrappers. */}
          <main className="flex-1 overflow-y-auto bg-background px-3 sm:px-4 md:px-6 pb-3 sm:pb-4 md:pb-6">
            {children}
          </main>
        </div>
      </motion.div>
    </>
  );
}
