// /forgot-password route — server-shell that renders the interactive form.
// Unlike /login, this page does NOT redirect signed-in users: a guest auto-login
// session shouldn't block someone from requesting a reset link for their real
// account. The form itself takes any email and asks Supabase to send a recovery
// email there.

import { ForgotPasswordForm } from './ForgotPasswordForm';

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
