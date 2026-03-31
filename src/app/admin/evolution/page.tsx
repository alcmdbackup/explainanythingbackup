// Redirects /admin/evolution to the evolution dashboard since there's no index page.
import { redirect } from 'next/navigation';

export default function EvolutionIndexPage() {
  redirect('/admin/evolution-dashboard');
}
