'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { clearSession } from '@/lib/sessionId';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Spinner } from '@/components/ui/spinner';

import { login, signup } from './actions';
import { loginSchema, type LoginInput } from './validation';

/**
 * Login Page
 * Full-page hero-style authentication experience
 */
export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSignup, setIsSignup] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Clear any stale session when landing on login page
  useEffect(() => {
    clearSession();
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
  } = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
      rememberMe: false,
    },
  });

  const rememberMe = watch('rememberMe');

  const handleModeToggle = () => {
    setIsTransitioning(true);
    setFormError(null);
    setSignupSuccess(false);
    setTimeout(() => {
      setIsSignup(!isSignup);
      setIsTransitioning(false);
    }, 200);
  };

  const onSubmit = async (data: LoginInput) => {
    setIsLoading(true);
    setFormError(null);
    setSignupSuccess(false);

    try {
      const formData = new FormData();
      formData.append('email', data.email);
      formData.append('password', data.password);
      formData.append('rememberMe', String(data.rememberMe));

      const result = isSignup ? await signup(formData) : await login(formData);

      if (result?.error) {
        setFormError(result.error);
      } else if (result?.success) {
        setSignupSuccess(true);
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
          {/* Hero Header */}
          <div className="text-center mb-12">
            <Link href="/" className="inline-block mb-6 atlas-animate-fade-up">
              <svg
                className="w-10 h-10 text-[var(--accent-gold)] mx-auto"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Link>

            <h1 className="atlas-display text-[var(--text-primary)] mb-4 atlas-animate-fade-up stagger-1">
              {isSignup ? 'Begin Your Journey' : 'Welcome Back'}
            </h1>

            <p className="atlas-ui text-[var(--text-muted)] tracking-wide atlas-animate-fade-up stagger-2">
              {isSignup
                ? 'Create your scholarly account'
                : 'Continue your exploration'}
            </p>
          </div>

          {/* Auth Form */}
          <form
            onSubmit={handleSubmit(onSubmit)}
            className={`space-y-6 auth-content ${isTransitioning ? 'auth-content-exit' : ''}`}
          >
            {/* Error Message */}
            {formError && (
              <div
                data-testid="login-error"
                className="p-4 text-sm bg-[var(--surface-elevated)] border-l-4 border-l-[var(--destructive)] border border-[var(--border-default)] rounded-r-page text-[var(--destructive)] font-serif atlas-animate-fade-up"
              >
                {formError}
              </div>
            )}

            {/* Success Message */}
            {signupSuccess && (
              <div
                data-testid="signup-success"
                className="p-4 text-sm bg-[var(--surface-elevated)] border-l-4 border-l-[var(--accent-gold)] border border-[var(--border-default)] rounded-r-page text-[var(--accent-gold)] font-serif atlas-animate-fade-up"
              >
                Check your email for a confirmation link to complete your registration.
              </div>
            )}

            {/* Email Field */}
            <div className="space-y-2 atlas-animate-fade-up stagger-3">
              <Label htmlFor="email" className="atlas-ui text-[var(--text-secondary)]">
                Email
              </Label>
              <Input
                id="email"
                data-testid="login-email"
                type="email"
                placeholder="you@example.com"
                disabled={isLoading}
                className="h-12 px-4 text-base font-serif"
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

            {/* Password Field */}
            <div className="space-y-2 atlas-animate-fade-up stagger-4">
              <Label htmlFor="password" className="atlas-ui text-[var(--text-secondary)]">
                Password
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  data-testid="login-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  disabled={isLoading}
                  className="h-12 px-4 text-base font-serif pr-12"
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
                  {showPassword ? (
                    <EyeOff className="h-5 w-5" />
                  ) : (
                    <Eye className="h-5 w-5" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p id="password-error" className="text-sm text-[var(--destructive)] atlas-ui">
                  {errors.password.message}
                </p>
              )}
            </div>

            {/* Remember Me / Forgot Password */}
            {!isSignup && (
              <div className="flex items-center justify-between atlas-animate-fade-up stagger-5">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="rememberMe"
                    checked={rememberMe}
                    onCheckedChange={(checked) =>
                      setValue('rememberMe', checked as boolean)
                    }
                    disabled={isLoading}
                  />
                  <Label
                    htmlFor="rememberMe"
                    className="text-sm atlas-ui font-normal cursor-pointer text-[var(--text-secondary)]"
                  >
                    Remember me
                  </Label>
                </div>

                <Link
                  href="/forgot-password"
                  className="text-sm atlas-ui text-[var(--text-muted)] hover:text-[var(--accent-gold)] transition-colors"
                  tabIndex={isLoading ? -1 : 0}
                >
                  <span className="gold-underline">Forgot password?</span>
                </Link>
              </div>
            )}

            {/* Submit Button */}
            <div className="atlas-animate-fade-up stagger-6">
              <Button
                type="submit"
                variant="scholar"
                size="lg"
                data-testid="login-submit"
                className="w-full"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Spinner variant="quill" size={18} className="mr-2" />
                    {isSignup ? 'Creating account...' : 'Signing in...'}
                  </>
                ) : (
                  <>{isSignup ? 'Create Account' : 'Sign In'}</>
                )}
              </Button>
            </div>

            {/* Divider */}
            <div className="relative w-full my-2 atlas-animate-fade-up stagger-7">
              <div className="flex items-center">
                <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[var(--border-default)] to-transparent"></div>
                <span className="px-4 atlas-ui text-[var(--text-muted)] uppercase tracking-widest text-xs">
                  or
                </span>
                <div className="flex-1 h-px bg-gradient-to-l from-transparent via-[var(--border-default)] to-transparent"></div>
              </div>
            </div>

            {/* Toggle Mode */}
            <div className="atlas-animate-fade-up stagger-7">
              <button
                type="button"
                data-testid="signup-toggle"
                onClick={handleModeToggle}
                disabled={isLoading}
                className="w-full text-center text-sm atlas-ui text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors py-2 disabled:opacity-50"
              >
                {isSignup ? (
                  <>Already have an account? <span className="gold-underline text-[var(--accent-gold)]">Sign in</span></>
                ) : (
                  <>New here? <span className="gold-underline text-[var(--accent-gold)]">Create account</span></>
                )}
              </button>
            </div>
          </form>

          {/* Decorative Footer Line */}
          <div className="mt-12 flex justify-center atlas-animate-fade-up stagger-7">
            <div className="w-16 h-px bg-gradient-to-r from-transparent via-[var(--accent-gold)] to-transparent"></div>
          </div>
        </main>
      </div>
    </div>
  );
}
