/**
 * @jest-environment node
 */

/**
 * Tests for login server actions - authentication operations
 */

// Mock dependencies
jest.mock('@/lib/utils/supabase/server');
jest.mock('next/navigation', () => {
  const mocks = jest.requireActual('@/__mocks__/next/navigation');
  return {
    redirect: mocks.redirect,
  };
});
jest.mock('next/cache', () => {
  const mocks = jest.requireActual('@/__mocks__/next/cache');
  return {
    revalidatePath: mocks.revalidatePath,
  };
});

import { login, signup, signOut } from './actions';
import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createMockFormData, createSupabaseAuthError } from '@/testing/utils/phase9-test-helpers';

const mockCreateSupabaseServerClient = createSupabaseServerClient as jest.MockedFunction<typeof createSupabaseServerClient>;

describe('Login Actions', () => {
  let mockSupabaseClient: any;
  let mockSignInWithPassword: jest.Mock;
  let mockSignUp: jest.Mock;
  let mockSignOut: jest.Mock;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    // Spy on console.error
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    // Setup default mocks
    mockSignInWithPassword = jest.fn().mockResolvedValue({
      data: { user: { id: 'test-user-id' }, session: {} },
      error: null,
    });

    mockSignUp = jest.fn().mockResolvedValue({
      data: { user: { id: 'new-user-id' }, session: null },
      error: null,
    });

    mockSignOut = jest.fn().mockResolvedValue({
      error: null,
    });

    mockSupabaseClient = {
      auth: {
        signInWithPassword: mockSignInWithPassword,
        signUp: mockSignUp,
        signOut: mockSignOut,
      },
    };

    mockCreateSupabaseServerClient.mockResolvedValue(mockSupabaseClient);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('login', () => {
    it('should sign in with valid credentials and redirect to root', async () => {
      const formData = createMockFormData({
        email: 'test@example.com',
        password: 'password123',
      });

      await expect(login(formData)).rejects.toThrow('NEXT_REDIRECT: /');

      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
      });
      expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
      expect(redirect).toHaveBeenCalledWith('/');
    });

    it('should revalidate path before redirecting', async () => {
      const formData = createMockFormData({
        email: 'user@test.com',
        password: 'pass',
      });

      await expect(login(formData)).rejects.toThrow('NEXT_REDIRECT: /');

      // Verify order: revalidate then redirect
      const revalidateCall = (revalidatePath as jest.Mock<any, any>).mock.invocationCallOrder[0];
      const redirectCall = (redirect as unknown as jest.Mock<any, any>).mock.invocationCallOrder[0];
      expect(revalidateCall).toBeLessThan(redirectCall);
    });

    it('should redirect to error page on invalid credentials', async () => {
      const error = createSupabaseAuthError('invalid_credentials');
      mockSignInWithPassword.mockResolvedValue(error);

      const formData = createMockFormData({
        email: 'wrong@example.com',
        password: 'wrongpass',
      });

      await expect(login(formData)).rejects.toThrow('NEXT_REDIRECT: /error');

      expect(consoleErrorSpy).toHaveBeenCalledWith('Login error:', error.error.message, error.error);
      expect(revalidatePath).not.toHaveBeenCalled();
      expect(redirect).toHaveBeenCalledWith('/error');
    });

    it('should handle missing email in FormData', async () => {
      const formData = createMockFormData({
        password: 'password123',
      });

      await expect(login(formData)).rejects.toThrow('NEXT_REDIRECT');

      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: null,
        password: 'password123',
      });
    });

    it('should handle missing password in FormData', async () => {
      const formData = createMockFormData({
        email: 'test@example.com',
      });

      await expect(login(formData)).rejects.toThrow('NEXT_REDIRECT');

      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: null,
      });
    });

    it('should handle empty string credentials', async () => {
      const formData = createMockFormData({
        email: '',
        password: '',
      });

      await expect(login(formData)).rejects.toThrow('NEXT_REDIRECT');

      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: '',
        password: '',
      });
    });

    it('should handle network errors from Supabase', async () => {
      mockSignInWithPassword.mockRejectedValue(new Error('Network error'));

      const formData = createMockFormData({
        email: 'test@example.com',
        password: 'password123',
      });

      await expect(login(formData)).rejects.toThrow('Network error');
    });

    it('should handle special characters in credentials', async () => {
      const formData = createMockFormData({
        email: 'test+special@example.com',
        password: 'P@$$w0rd!',
      });

      await expect(login(formData)).rejects.toThrow('NEXT_REDIRECT: /');

      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: 'test+special@example.com',
        password: 'P@$$w0rd!',
      });
    });
  });

  describe('signup', () => {
    it('should sign up with valid credentials and redirect to root', async () => {
      const formData = createMockFormData({
        email: 'newuser@example.com',
        password: 'securepass123',
      });

      await expect(signup(formData)).rejects.toThrow('NEXT_REDIRECT: /');

      expect(mockSignUp).toHaveBeenCalledWith({
        email: 'newuser@example.com',
        password: 'securepass123',
      });
      expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
      expect(redirect).toHaveBeenCalledWith('/');
    });

    it('should revalidate path before redirecting', async () => {
      const formData = createMockFormData({
        email: 'new@test.com',
        password: 'pass',
      });

      await expect(signup(formData)).rejects.toThrow('NEXT_REDIRECT: /');

      const revalidateCall = (revalidatePath as jest.Mock<any, any>).mock.invocationCallOrder[0];
      const redirectCall = (redirect as unknown as jest.Mock<any, any>).mock.invocationCallOrder[0];
      expect(revalidateCall).toBeLessThan(redirectCall);
    });

    it('should redirect to error page on duplicate email', async () => {
      const error = createSupabaseAuthError('email_exists');
      mockSignUp.mockResolvedValue(error);

      const formData = createMockFormData({
        email: 'existing@example.com',
        password: 'password123',
      });

      await expect(signup(formData)).rejects.toThrow('NEXT_REDIRECT: /error');

      expect(consoleErrorSpy).toHaveBeenCalledWith('Signup error:', error.error.message, error.error);
      expect(revalidatePath).not.toHaveBeenCalled();
      expect(redirect).toHaveBeenCalledWith('/error');
    });

    it('should redirect to error page on weak password', async () => {
      const error = createSupabaseAuthError('weak_password');
      mockSignUp.mockResolvedValue(error);

      const formData = createMockFormData({
        email: 'user@example.com',
        password: '123',
      });

      await expect(signup(formData)).rejects.toThrow('NEXT_REDIRECT: /error');

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(redirect).toHaveBeenCalledWith('/error');
    });

    it('should handle missing email in FormData', async () => {
      const formData = createMockFormData({
        password: 'password123',
      });

      await expect(signup(formData)).rejects.toThrow('NEXT_REDIRECT');

      expect(mockSignUp).toHaveBeenCalledWith({
        email: null,
        password: 'password123',
      });
    });

    it('should handle missing password in FormData', async () => {
      const formData = createMockFormData({
        email: 'new@example.com',
      });

      await expect(signup(formData)).rejects.toThrow('NEXT_REDIRECT');

      expect(mockSignUp).toHaveBeenCalledWith({
        email: 'new@example.com',
        password: null,
      });
    });

    it('should handle invalid email format', async () => {
      const error = createSupabaseAuthError('invalid_credentials');
      mockSignUp.mockResolvedValue(error);

      const formData = createMockFormData({
        email: 'notanemail',
        password: 'password123',
      });

      await expect(signup(formData)).rejects.toThrow('NEXT_REDIRECT: /error');
    });

    it('should handle network errors', async () => {
      mockSignUp.mockRejectedValue(new Error('Network error'));

      const formData = createMockFormData({
        email: 'new@example.com',
        password: 'password123',
      });

      await expect(signup(formData)).rejects.toThrow('Network error');
    });
  });

  describe('signOut', () => {
    it('should sign out successfully and redirect to root', async () => {
      await expect(signOut()).rejects.toThrow('NEXT_REDIRECT: /');

      expect(mockSignOut).toHaveBeenCalled();
      expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
      expect(redirect).toHaveBeenCalledWith('/');
    });

    it('should revalidate path before redirecting', async () => {
      await expect(signOut()).rejects.toThrow('NEXT_REDIRECT: /');

      const revalidateCall = (revalidatePath as jest.Mock<any, any>).mock.invocationCallOrder[0];
      const redirectCall = (redirect as unknown as jest.Mock<any, any>).mock.invocationCallOrder[0];
      expect(revalidateCall).toBeLessThan(redirectCall);
    });

    it('should redirect to error page on signout failure', async () => {
      const error = createSupabaseAuthError('invalid_credentials');
      mockSignOut.mockResolvedValue(error);

      await expect(signOut()).rejects.toThrow('NEXT_REDIRECT: /error');

      expect(consoleErrorSpy).toHaveBeenCalledWith('Signout error:', error.error.message, error.error);
      expect(revalidatePath).not.toHaveBeenCalled();
      expect(redirect).toHaveBeenCalledWith('/error');
    });

    it('should handle when not authenticated', async () => {
      // Even if not authenticated, signOut should complete
      mockSignOut.mockResolvedValue({ error: null });

      await expect(signOut()).rejects.toThrow('NEXT_REDIRECT: /');

      expect(mockSignOut).toHaveBeenCalled();
      expect(redirect).toHaveBeenCalledWith('/');
    });

    it('should handle network errors', async () => {
      mockSignOut.mockRejectedValue(new Error('Network error'));

      await expect(signOut()).rejects.toThrow('Network error');
    });

    it('should clear session by revalidating layout', async () => {
      await expect(signOut()).rejects.toThrow('NEXT_REDIRECT: /');

      expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    });
  });

  describe('createSupabaseServerClient error handling', () => {
    it('should throw when createSupabaseServerClient fails in login', async () => {
      mockCreateSupabaseServerClient.mockRejectedValue(new Error('Failed to create client'));

      const formData = createMockFormData({
        email: 'test@example.com',
        password: 'password',
      });

      await expect(login(formData)).rejects.toThrow('Failed to create client');
    });

    it('should throw when createSupabaseServerClient fails in signup', async () => {
      mockCreateSupabaseServerClient.mockRejectedValue(new Error('Failed to create client'));

      const formData = createMockFormData({
        email: 'test@example.com',
        password: 'password',
      });

      await expect(signup(formData)).rejects.toThrow('Failed to create client');
    });

    it('should throw when createSupabaseServerClient fails in signOut', async () => {
      mockCreateSupabaseServerClient.mockRejectedValue(new Error('Failed to create client'));

      await expect(signOut()).rejects.toThrow('Failed to create client');
    });
  });
});
