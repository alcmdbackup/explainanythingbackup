// Interactive forgot-password form (client component).
// Submits an email to requestPasswordReset action. On success renders a
// generic "check your inbox" message (intentionally masked — doesn't reveal
// whether the email is registered, to prevent enumeration).

'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';

import { requestPasswordReset } from '../login/actions';
import { forgotPasswordSchema, type ForgotPasswordInput } from '../login/validation';

export function ForgotPasswordForm() {
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = async (data: ForgotPasswordInput) => {
    setIsLoading(true);
    setFormError(null);
    try {
      const formData = new FormData();
      formData.append('email', data.email);
      const result = await requestPasswordReset(formData);
      if (result?.error) {
        setFormError(result.error);
      } else if (result?.success) {
        setSubmitted(true);
      }
    } catch {
      setFormError('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

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
              Reset Your Password
            </h1>
            <p className="atlas-ui text-[var(--text-muted)] tracking-wide atlas-animate-fade-up stagger-2">
              Enter your email and we&apos;ll send a reset link
            </p>
          </div>

          {submitted ? (
            <div
              data-testid="forgot-password-success"
              className="p-4 text-sm bg-[var(--surface-elevated)] border-l-4 border-l-[var(--accent-gold)] border border-[var(--border-default)] rounded-r-page text-[var(--text-primary)] font-body atlas-animate-fade-up"
            >
              If an account exists for that email, a reset link has been sent. Check your inbox.
            </div>
          ) : (
            <form
              onSubmit={handleSubmit(onSubmit)}
              className="space-y-6 auth-content"
            >
              {formError && (
                <div
                  data-testid="forgot-password-error"
                  className="p-4 text-sm bg-[var(--surface-elevated)] border-l-4 border-l-[var(--destructive)] border border-[var(--border-default)] rounded-r-page text-[var(--destructive)] font-body atlas-animate-fade-up"
                >
                  {formError}
                </div>
              )}

              <div className="space-y-2 atlas-animate-fade-up stagger-3">
                <Label htmlFor="email" className="atlas-ui text-[var(--text-secondary)]">
                  Email
                </Label>
                <Input
                  id="email"
                  data-testid="forgot-password-email"
                  type="email"
                  placeholder="you@example.com"
                  disabled={isLoading}
                  className="h-12 px-4 text-base font-body"
                  {...register('email')}
                  aria-invalid={!!errors.email}
                  aria-describedby={errors.email ? 'email-error' : undefined}
                />
                {errors.email && (
                  <p id="email-error" className="text-sm text-[var(--destructive)] atlas-ui">
                    {errors.email.message}
                  </p>
                )}
              </div>

              <div className="atlas-animate-fade-up stagger-4">
                <Button
                  type="submit"
                  variant="scholar"
                  size="lg"
                  data-testid="forgot-password-submit"
                  className="w-full"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <Spinner variant="quill" size={18} className="mr-2" />
                      Sending...
                    </>
                  ) : (
                    'Send Reset Link'
                  )}
                </Button>
              </div>
            </form>
          )}

          <div className="atlas-animate-fade-up stagger-5 mt-8 text-center">
            <Link
              href="/login"
              data-testid="back-to-login"
              className="text-sm atlas-ui text-[var(--text-muted)] hover:text-[var(--accent-gold)] transition-colors"
            >
              Back to sign in
            </Link>
          </div>
        </main>
      </div>
    </div>
  );
}
