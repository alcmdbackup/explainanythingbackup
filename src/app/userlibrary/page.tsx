/**
 * User Library Page - displays saved articles in a feed-style card layout.
 * Uses FeedCard component for visual consistency with the Explore page.
 */
'use client';

import { useState, useEffect } from 'react';
import { type UserSavedExplanationWithMetrics } from '@/lib/schemas/schemas';
import { getUserLibraryExplanationsAction } from '@/actions/actions';
import { logger } from '@/lib/client_utilities';
import FeedCard from '@/components/explore/FeedCard';
import Navigation from '@/components/Navigation';
import { supabase_browser } from '@/lib/supabase';

export default function UserLibraryPage() {
  const [explanations, setExplanations] = useState<UserSavedExplanationWithMetrics[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const { data: userData, error: userError } = await supabase_browser.auth.getUser();
        if (userError || !userData?.user?.id) {
          throw new Error('Could not get user information. Please log in.');
        }
        const result = await getUserLibraryExplanationsAction(userData.user.id);
        setExplanations(result);
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : 'Failed to load library';
        logger.error('Failed to load user library explanations:', { error: errorMessage });
        setError(errorMessage);
      }
    }
    load();
  }, []);

  return (
    <main className="min-h-screen bg-[var(--surface-primary)] paper-texture">
      <Navigation showSearchBar />

      <div className="pt-8 pb-16">
        <header className="max-w-3xl mx-auto px-4 mb-8 text-center">
          <h1 className="atlas-display-section text-[var(--text-primary)] atlas-animate-fade-up stagger-1">
            My Library
          </h1>
          <div className="title-flourish mt-4"></div>
        </header>

        {error && (
          <div className="max-w-3xl mx-auto px-4 mb-6" data-testid="library-error">
            <p className="text-[var(--destructive)] bg-[var(--surface-elevated)] p-4 rounded-md border-l-4 border-l-[var(--destructive)]">
              {error}
            </p>
          </div>
        )}

        {explanations.length === 0 && !error ? (
          <div className="max-w-3xl mx-auto px-4 text-center py-16" data-testid="library-empty-state">
            <svg className="w-16 h-16 mx-auto mb-4 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
            </svg>
            <p className="text-lg font-body text-[var(--text-primary)]">Nothing saved yet</p>
            <p className="text-[var(--text-muted)] mt-1">Save explanations you want to revisit.</p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-4 space-y-4">
            {explanations.map((exp, index) => (
              <FeedCard
                key={exp.id}
                explanation={{
                  id: exp.id,
                  explanation_title: exp.explanation_title,
                  content: exp.content,
                  summary_teaser: exp.summary_teaser,
                  timestamp: exp.timestamp,
                }}
                metrics={{
                  total_views: exp.total_views,
                  total_saves: exp.total_saves,
                }}
                savedDate={exp.saved_timestamp}
                index={index}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
