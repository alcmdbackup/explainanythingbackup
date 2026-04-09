// Redirects /admin/evolution to the experiments list as the default evolution page.
import { redirect } from 'next/navigation';

export default function EvolutionIndexPage() {
  redirect('/admin/evolution/experiments');
}
