'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase_browser } from '@/lib/supabase';

// Hardcoded admin emails - add more as needed
const ADMIN_EMAILS = ['abecha@gmail.com'];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase_browser.auth.getUser();

      if (!user?.email || !ADMIN_EMAILS.includes(user.email)) {
        router.replace('/');
        return;
      }

      setIsAuthorized(true);
      setIsLoading(false);
    };

    checkAuth();
  }, [router]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-[var(--text-muted)]">Loading...</div>
      </div>
    );
  }

  if (!isAuthorized) {
    return null;
  }

  return <>{children}</>;
}
