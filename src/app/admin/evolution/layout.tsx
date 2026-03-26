/**
 * Shared layout for all /admin/evolution/* routes.
 * Ensures Next.js layout nesting so that not-found and error pages
 * render within the admin shell (sidebar stays visible).
 */

export default function EvolutionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
