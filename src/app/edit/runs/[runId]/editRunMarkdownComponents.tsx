// react-markdown component map for the /edit variant tab.
// improvements_to_edit_page_evolution_20260630 Phase 3.
//
// XSS DEFENSE CONTRACT (do NOT relax without explicit review):
//   - NO rehype-raw (would enable inline HTML injection)
//   - NO allowDangerousHtml prop
//   - NO remark-html
//   - URL sanitization via sanitizeMarkdownUrl (allowlist: http/https/mailto)
//
// The variant content is LLM output on top of visitor-pasted text — a hostile
// input could steer the LLM to emit malicious markdown links or protocol-relative
// URLs. Component-map + urlTransform is the last line of defense.

'use client';

import type { Components } from 'react-markdown';

/** Component map: renders headings in font-display, prose in atlas-body, bold in
 *  gold accent, code/pre in mono. Matches the Midnight Scholar tokens used on
 *  the public /edit page (see design_style_guide.md). */
export const editRunMarkdownComponents: Components = {
  h1: ({ children, ...props }) => (
    <h1 {...props} className="font-display text-3xl text-[var(--text-primary)] mt-6 mb-3 first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children, ...props }) => (
    <h2 {...props} className="font-display text-2xl text-[var(--text-primary)] mt-5 mb-2">
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3 {...props} className="font-display text-xl text-[var(--text-primary)] mt-4 mb-2">
      {children}
    </h3>
  ),
  h4: ({ children, ...props }) => (
    <h4 {...props} className="font-display text-lg text-[var(--text-primary)] mt-3 mb-1">
      {children}
    </h4>
  ),
  p: ({ children, ...props }) => (
    <p {...props} className="atlas-body text-[var(--text-primary)] mb-3 leading-relaxed">
      {children}
    </p>
  ),
  strong: ({ children, ...props }) => (
    <strong {...props} className="font-semibold text-[var(--accent-gold)]">
      {children}
    </strong>
  ),
  em: ({ children, ...props }) => (
    <em {...props} className="italic text-[var(--text-primary)]">
      {children}
    </em>
  ),
  ul: ({ children, ...props }) => (
    <ul {...props} className="list-disc pl-6 mb-3 atlas-body text-[var(--text-primary)] space-y-1">
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol {...props} className="list-decimal pl-6 mb-3 atlas-body text-[var(--text-primary)] space-y-1">
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li {...props} className="leading-relaxed">
      {children}
    </li>
  ),
  code: ({ children, ...props }) => (
    <code {...props} className="font-mono text-sm bg-[var(--surface-secondary)] px-1 py-0.5 rounded text-[var(--text-primary)]">
      {children}
    </code>
  ),
  pre: ({ children, ...props }) => (
    <pre {...props} className="font-mono text-sm bg-[var(--surface-secondary)] p-3 rounded-book overflow-x-auto mb-3 text-[var(--text-primary)]">
      {children}
    </pre>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote {...props} className="border-l-4 border-[var(--accent-gold)] pl-4 my-3 atlas-body italic text-[var(--text-secondary)]">
      {children}
    </blockquote>
  ),
  a: ({ children, href, ...props }) => (
    // href already sanitized by react-markdown's urlTransform (sanitizeMarkdownUrl).
    // Render with rel/target hardening — external LLM-output links should never
    // control the /edit tab, and we want no referer leakage.
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow ugc"
      className="text-[var(--accent-gold)] underline hover:opacity-80"
    >
      {children}
    </a>
  ),
};
