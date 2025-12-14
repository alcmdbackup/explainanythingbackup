'use server';

import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';

import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { logger } from '@/lib/server_utilities';
import { loginSchema } from './validation';

type AuthResult = {
  error?: string;
  success?: boolean;
};

export async function login(formData: FormData): Promise<AuthResult | never> {
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

export async function signup(formData: FormData): Promise<AuthResult | never> {
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

export async function signOut(): Promise<void | never> {
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
