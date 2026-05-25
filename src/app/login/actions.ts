// Server actions for the /login, /forgot-password, and /reset-password forms.
// All actions are Sentry-wrapped and return { success?, error? }.

'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';
import * as Sentry from '@sentry/nextjs';

import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { logger } from '@/lib/server_utilities';
import { loginSchema, forgotPasswordSchema } from './validation';

type AuthResult = {
  error?: string;
  success?: boolean;
};

export async function login(formData: FormData): Promise<AuthResult | never> {
  return Sentry.withServerActionInstrumentation(
    'login',
    { formData, recordResponse: true },
    async () => {
      const supabase = await createSupabaseServerClient();

      // Validate inputs with Zod
      const validatedFields = loginSchema.safeParse({
        email: formData.get('email'),
        password: formData.get('password'),
        rememberMe: formData.get('rememberMe') === 'true',
      });

      if (!validatedFields.success) {
        logger.error('Login validation failed', {
          errors: validatedFields.error.flatten().fieldErrors,
        });
        return { error: 'Invalid email or password format' };
      }

      const { email, password, rememberMe } = validatedFields.data;

      try {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          logger.error('Login failed', {
            email,
            errorMessage: error.message,
            errorCode: error.code,
          });

          // Return user-friendly error message
          if (error.message.includes('Invalid')) {
            return { error: 'Invalid email or password' };
          }

          return { error: 'Login failed. Please try again.' };
        }

        // Handle remember me - extend session duration
        if (rememberMe) {
          // Note: Supabase handles session persistence automatically
          // The remember me flag is logged for tracking purposes
          logger.info('User logged in with remember me', { email });
        } else {
          logger.info('User logged in', { email });
        }

        revalidatePath('/', 'layout');
        redirect('/');
      } catch (error) {
        unstable_rethrow(error);
        logger.error('Unexpected error during login', {
          email,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return { error: 'An unexpected error occurred. Please try again.' };
      }
    }
  );
}

export async function signup(formData: FormData): Promise<AuthResult | never> {
  return Sentry.withServerActionInstrumentation(
    'signup',
    { formData, recordResponse: true },
    async () => {
      const supabase = await createSupabaseServerClient();

      // For signup, we use basic validation (more complex password validation in signupSchema)
      const validatedFields = loginSchema.safeParse({
        email: formData.get('email'),
        password: formData.get('password'),
        rememberMe: false,
      });

      if (!validatedFields.success) {
        logger.error('Signup validation failed', {
          errors: validatedFields.error.flatten().fieldErrors,
        });
        return { error: 'Invalid email or password format' };
      }

      const { email, password } = validatedFields.data;

      try {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });

        if (error) {
          logger.error('Signup failed', {
            email,
            errorMessage: error.message,
            errorCode: error.code,
          });

          // Return user-friendly error messages
          if (error.message.includes('already registered')) {
            return { error: 'An account with this email already exists' };
          }

          if (error.message.includes('password')) {
            return { error: 'Password does not meet requirements' };
          }

          return { error: 'Signup failed. Please try again.' };
        }

        logger.info('User signed up successfully', { email });

        revalidatePath('/', 'layout');
        return { success: true };
      } catch (error) {
        unstable_rethrow(error);
        logger.error('Unexpected error during signup', {
          email,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return { error: 'An unexpected error occurred. Please try again.' };
      }
    }
  );
}

export async function requestPasswordReset(formData: FormData): Promise<AuthResult | never> {
  return Sentry.withServerActionInstrumentation(
    'requestPasswordReset',
    { formData, recordResponse: true },
    async () => {
      const validated = forgotPasswordSchema.safeParse({
        email: formData.get('email'),
      });

      if (!validated.success) {
        logger.error('Password reset validation failed', {
          errors: validated.error.flatten().fieldErrors,
        });
        return { error: 'Invalid email format' };
      }

      // Resolve origin for the redirect URL. Server actions receive Origin in
      // request headers from the browser POST. If absent (rare; non-browser
      // callers), fail loudly rather than send a recovery email pointing at
      // a wrong host.
      const h = await headers();
      const origin = h.get('origin');
      if (!origin) {
        logger.error('Password reset: missing Origin header');
        return { error: 'Unable to determine site URL' };
      }

      const supabase = await createSupabaseServerClient();
      const { email } = validated.data;
      const redirectTo = `${origin}/auth/confirm?next=/reset-password`;

      try {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo,
        });

        if (error) {
          // Log but mask — never reveal whether the email is registered.
          // Supabase itself doesn't distinguish in its response, but log here
          // for operator visibility into rate-limits / provider hiccups.
          logger.error('Password reset request failed', {
            email,
            errorMessage: error.message,
            errorCode: error.code,
          });
        } else {
          logger.info('Password reset requested', { email });
        }

        // Always return success to prevent email enumeration via response shape.
        revalidatePath('/', 'layout');
        return { success: true };
      } catch (error) {
        unstable_rethrow(error);
        logger.error('Unexpected error during password reset request', {
          email,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // Still mask — return success even on unexpected error.
        return { success: true };
      }
    }
  );
}

export async function signOut(): Promise<void | never> {
  return Sentry.withServerActionInstrumentation(
    'signOut',
    { recordResponse: true },
    async () => {
      const supabase = await createSupabaseServerClient();

      try {
        const { error } = await supabase.auth.signOut();

        if (error) {
          logger.error('Signout failed', {
            errorMessage: error.message,
            errorCode: error.code,
          });
          redirect('/error');
        }

        logger.info('User signed out successfully');

        revalidatePath('/', 'layout');
        redirect('/');
      } catch (error) {
        unstable_rethrow(error);
        logger.error('Unexpected error during signout', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        redirect('/error');
      }
    }
  );
}
