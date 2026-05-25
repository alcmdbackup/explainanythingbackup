// Interactive reset-password form (client component).
// Form is gated on (a) PASSWORD_RECOVERY auth event having fired and (b) the
// current user not being the demo guest. On submit calls updateUser({password})
// using the recovery session, then routes to / where the user is signed in
// with their new password.

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { supabase_browser } from '@/lib/supabase';
import { useIsGuest } from '@/hooks/useUserAuth';

import { resetPasswordSchema, type ResetPasswordInput } from '../login/validation';

export function ResetPasswordForm() {
  const router = useRouter();
  const isGuest = useIsGuest();
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isRecoverySession, setIsRecoverySession] = useState(false);

  // Subscribe to auth state changes — PASSWORD_RECOVERY fires when the user
  // arrives via a recovery link and the session is established. Without this
  // event, do not let the form submit (defense in depth even if the server
  // gate didn't fire).
  useEffect(() => {
    const { data: subscription } = supabase_browser.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecoverySession(true);
      }
    });
    return () => {
      subscription.subscription.unsubscribe();
    };
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  const onSubmit = async (data: ResetPasswordInput) => {
    setIsLoading(true);
    setFormError(null);
    try {
      const { error } = await supabase_browser.auth.updateUser({
        password: data.password,
      });
      if (error) {
        setFormError(error.message);
        setIsLoading(false);
        return;
      }
      router.push('/');
      router.refresh();
    } catch {
      setFormError('An unexpected error occurred. Please try again.');
      setIsLoading(false);
    }
  };

  const formEnabled = isRecoverySession && !isGuest;

  return (
    <div className="min-h-screen bg-[var(--surface-primary)] flex flex-col vignette-overlay paper-texture">
      <div className="flex-1 flex items-center justify-center px-4">
        <main className="w-full max-w-md">
          <div className="text-center mb-12">
            <Link href="/" className="inline-block mb-6 atlas-animate-fade-up">
              <svg
                className="w-10 h-10 text-[var(--accent-gold)] mx-auto"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path
                  d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
            <h1 className="atlas-display text-[var(--text-primary)] mb-4 atlas-animate-fade-up stagger-1">
              Choose a New Password
            </h1>
            <p className="atlas-ui text-[var(--text-muted)] tracking-wide atlas-animate-fade-up stagger-2">
              {formEnabled ? 'Enter your new password below' : 'Verifying your reset link…'}
            </p>
          </div>

          {!formEnabled ? (
            <div
              data-testid="reset-password-invalid"
              className="p-4 text-sm bg-[var(--surface-elevated)] border-l-4 border-l-[var(--destructive)] border border-[var(--border-default)] rounded-r-page text-[var(--text-primary)] font-body atlas-animate-fade-up"
            >
              <p className="mb-3">This reset link is invalid, expired, or already used.</p>
              <Link
                href="/forgot-password"
                data-testid="reset-password-request-new"
                className="text-[var(--accent-gold)] hover:text-[var(--accent-copper)] transition-colors gold-underline"
              >
                Request a new reset link
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 auth-content">
              {formError && (
                <div
                  data-testid="reset-password-error"
                  className="p-4 text-sm bg-[var(--surface-elevated)] border-l-4 border-l-[var(--destructive)] border border-[var(--border-default)] rounded-r-page text-[var(--destructive)] font-body atlas-animate-fade-up"
                >
                  {formError}
                </div>
              )}

              <div className="space-y-2 atlas-animate-fade-up stagger-3">
                <Label htmlFor="password" className="atlas-ui text-[var(--text-secondary)]">
                  New password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    data-testid="reset-password-new"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    disabled={isLoading}
                    className="h-12 px-4 text-base font-body pr-12"
                    {...register('password')}
                    aria-invalid={!!errors.password}
                    aria-describedby={errors.password ? 'password-error' : undefined}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--accent-gold)] transition-colors"
                    disabled={isLoading}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
                {errors.password && (
                  <p id="password-error" className="text-sm text-[var(--destructive)] atlas-ui">
                    {errors.password.message}
                  </p>
                )}
              </div>

              <div className="space-y-2 atlas-animate-fade-up stagger-4">
                <Label htmlFor="confirmPassword" className="atlas-ui text-[var(--text-secondary)]">
                  Confirm new password
                </Label>
                <Input
                  id="confirmPassword"
                  data-testid="reset-password-confirm"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  disabled={isLoading}
                  className="h-12 px-4 text-base font-body"
                  {...register('confirmPassword')}
                  aria-invalid={!!errors.confirmPassword}
                  aria-describedby={errors.confirmPassword ? 'confirm-error' : undefined}
                />
                {errors.confirmPassword && (
                  <p id="confirm-error" className="text-sm text-[var(--destructive)] atlas-ui">
                    {errors.confirmPassword.message}
                  </p>
                )}
              </div>

              <div className="atlas-animate-fade-up stagger-5">
                <Button
                  type="submit"
                  variant="scholar"
                  size="lg"
                  data-testid="reset-password-submit"
                  className="w-full"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <Spinner variant="quill" size={18} className="mr-2" />
                      Updating…
                    </>
                  ) : (
                    'Update Password'
                  )}
                </Button>
              </div>
            </form>
          )}
        </main>
      </div>
    </div>
  );
}
