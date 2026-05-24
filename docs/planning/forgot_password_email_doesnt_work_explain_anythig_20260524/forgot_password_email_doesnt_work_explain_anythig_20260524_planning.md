# Forgot Password Email Doesn't Work — Plan

## Background
Clicking "reset password" on the Supabase reset password email sends the user to the normal login screen, nothing different happens. It should allow user to reset password.

## Problem
The Supabase password-reset email link is supposed to land the user on a dedicated reset-password page where they can enter a new password, but instead it routes them to the standard `/login` form. As a result there is currently no working way for a user to recover an account from a forgotten password. The fix needs to cover both the auth callback (`/auth/callback` or equivalent) handling the recovery-type tokens AND the existence of a reset-password UI that consumes the recovery session.
