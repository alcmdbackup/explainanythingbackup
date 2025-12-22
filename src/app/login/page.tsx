'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Spinner } from '@/components/ui/spinner';

import { login, signup } from './actions';
import { loginSchema, type LoginInput } from './validation';

/**
 * Login Page
 * Elegant authentication experience
 */
export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSignup, setIsSignup] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);

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
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface-primary)] p-4 relative">
      {/* Decorative background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[var(--accent-gold)]/5 rounded-full blur-3xl"></div>
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-[var(--accent-copper)]/5 rounded-full blur-3xl"></div>
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Header flourish */}
        <div className="text-center mb-6">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="h-px w-8 bg-gradient-to-r from-transparent to-[var(--accent-gold)]"></div>
            <svg
              className="w-8 h-8 text-[var(--accent-gold)]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <div className="h-px w-8 bg-gradient-to-l from-transparent to-[var(--accent-gold)]"></div>
          </div>
          <Link href="/" className="inline-block">
            <h1 className="text-2xl font-display font-bold text-[var(--text-primary)] tracking-tight">
              <span className="text-[var(--accent-gold)]">Explain</span>
              <span>Anything</span>
            </h1>
          </Link>
        </div>

        <Card className="scholar-card">
          <CardHeader className="space-y-1 text-center">
            <CardTitle className="text-xl font-display">
              {isSignup ? 'Create account' : 'Sign in'}
            </CardTitle>
            <CardDescription className="font-serif">
              {isSignup
                ? 'Create your account'
                : 'Welcome back'}
            </CardDescription>
          </CardHeader>

          <form onSubmit={handleSubmit(onSubmit)}>
            <CardContent className="space-y-4">
              {formError && (
                <div
                  data-testid="login-error"
                  className="p-3 text-sm bg-[var(--surface-elevated)] border-l-4 border-l-[var(--destructive)] border border-[var(--border-default)] rounded-r-page text-[var(--destructive)] font-serif"
                >
                  {formError}
                </div>
              )}

              {signupSuccess && (
                <div
                  data-testid="signup-success"
                  className="p-3 text-sm bg-[var(--surface-elevated)] border-l-4 border-l-[var(--accent-gold)] border border-[var(--border-default)] rounded-r-page text-[var(--accent-gold)] font-serif"
                >
                  Check your email for a confirmation link to complete your registration.
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="email" className="font-sans">Email</Label>
                <Input
                  id="email"
                  data-testid="login-email"
                  type="email"
                  placeholder="you@example.com"
                  disabled={isLoading}
                  {...register('email')}
                  aria-invalid={!!errors.email}
                  aria-describedby={errors.email ? 'email-error' : undefined}
                />
                {errors.email && (
                  <p id="email-error" className="text-sm text-[var(--destructive)] font-sans">
                    {errors.email.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="font-sans">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    data-testid="login-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    disabled={isLoading}
                    {...register('password')}
                    aria-invalid={!!errors.password}
                    aria-describedby={errors.password ? 'password-error' : undefined}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--accent-gold)] transition-colors"
                    disabled={isLoading}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                {errors.password && (
                  <p id="password-error" className="text-sm text-[var(--destructive)] font-sans">
                    {errors.password.message}
                  </p>
                )}
              </div>

              {!isSignup && (
                <div className="flex items-center justify-between">
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
                      className="text-sm font-sans font-normal cursor-pointer text-[var(--text-secondary)]"
                    >
                      Remember me
                    </Label>
                  </div>

                  <Link
                    href="/forgot-password"
                    className="text-sm font-sans text-[var(--text-muted)] hover:text-[var(--accent-gold)] transition-colors gold-underline"
                    tabIndex={isLoading ? -1 : 0}
                  >
                    Forgot password?
                  </Link>
                </div>
              )}
            </CardContent>

            <CardFooter className="flex flex-col space-y-4">
              <Button
                type="submit"
                data-testid="login-submit"
                className="w-full"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Spinner variant="quill" size={16} className="mr-2" />
                    {isSignup ? 'Creating account...' : 'Signing in...'}
                  </>
                ) : (
                  <>{isSignup ? 'Create Account' : 'Sign in'}</>
                )}
              </Button>

              <div className="relative w-full">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-[var(--border-default)]" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-[var(--surface-secondary)] px-2 text-[var(--text-muted)] font-sans">or</span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                data-testid="signup-toggle"
                className="w-full"
                onClick={() => setIsSignup(!isSignup)}
                disabled={isLoading}
              >
                {isSignup ? 'Already have an account? Sign in' : 'New here? Create account'}
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
