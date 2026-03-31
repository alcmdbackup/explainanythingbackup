// Catch-all route for unknown evolution paths. Triggers evolution/not-found.tsx within the admin layout.
import { notFound } from 'next/navigation';

export default function EvolutionCatchAll() {
  notFound();
}
