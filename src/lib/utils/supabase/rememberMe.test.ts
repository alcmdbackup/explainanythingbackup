/**
 * @jest-environment jsdom
 */
import {
  getRememberMe,
  setRememberMe,
  clearRememberMe,
  clearSupabaseLocalStorage,
} from './rememberMe';

describe('rememberMe', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  describe('getRememberMe', () => {
    it('should return true by default when no preference is stored', () => {
      expect(getRememberMe()).toBe(true);
    });

    it('should return true when preference is explicitly set to true', () => {
      localStorage.setItem('supabase_remember_me', 'true');
      expect(getRememberMe()).toBe(true);
    });

    it('should return false when preference is set to false', () => {
      localStorage.setItem('supabase_remember_me', 'false');
      expect(getRememberMe()).toBe(false);
    });

    it('should return true for any value other than "false"', () => {
      localStorage.setItem('supabase_remember_me', 'yes');
      expect(getRememberMe()).toBe(true);

      localStorage.setItem('supabase_remember_me', '');
      expect(getRememberMe()).toBe(true);
    });
  });

  describe('setRememberMe', () => {
    it('should store true preference', () => {
      setRememberMe(true);
      expect(localStorage.getItem('supabase_remember_me')).toBe('true');
    });

    it('should store false preference', () => {
      setRememberMe(false);
      expect(localStorage.getItem('supabase_remember_me')).toBe('false');
    });

    it('should overwrite existing preference', () => {
      setRememberMe(true);
      expect(localStorage.getItem('supabase_remember_me')).toBe('true');

      setRememberMe(false);
      expect(localStorage.getItem('supabase_remember_me')).toBe('false');
    });
  });

  describe('clearRememberMe', () => {
    it('should remove the preference from localStorage', () => {
      localStorage.setItem('supabase_remember_me', 'true');
      expect(localStorage.getItem('supabase_remember_me')).toBe('true');

      clearRememberMe();
      expect(localStorage.getItem('supabase_remember_me')).toBeNull();
    });

    it('should not throw when preference does not exist', () => {
      expect(() => clearRememberMe()).not.toThrow();
    });
  });

  describe('clearSupabaseLocalStorage', () => {
    it('should remove all keys starting with "sb-"', () => {
      localStorage.setItem('sb-auth-token', 'token123');
      localStorage.setItem('sb-refresh-token', 'refresh123');
      localStorage.setItem('sb-user', 'user-data');
      localStorage.setItem('other-key', 'other-value');
      localStorage.setItem('supabase_remember_me', 'true');

      clearSupabaseLocalStorage();

      expect(localStorage.getItem('sb-auth-token')).toBeNull();
      expect(localStorage.getItem('sb-refresh-token')).toBeNull();
      expect(localStorage.getItem('sb-user')).toBeNull();
      expect(localStorage.getItem('other-key')).toBe('other-value');
      expect(localStorage.getItem('supabase_remember_me')).toBe('true');
    });

    it('should not throw when no sb- keys exist', () => {
      localStorage.setItem('other-key', 'value');
      expect(() => clearSupabaseLocalStorage()).not.toThrow();
      expect(localStorage.getItem('other-key')).toBe('value');
    });

    it('should handle empty localStorage', () => {
      expect(() => clearSupabaseLocalStorage()).not.toThrow();
    });
  });
});
