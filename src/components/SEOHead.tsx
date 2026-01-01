/**
 * Client-side SEO metadata injection for dynamic pages.
 * Updates document head with title and meta tags for social sharing and search engines.
 *
 * Note: For optimal SEO, consider migrating to a server-rendered route with generateMetadata.
 * This client-side approach works for social bots that execute JavaScript.
 */
'use client';

import { useEffect } from 'react';

interface SEOHeadProps {
    title?: string;
    description?: string;
    keywords?: string[];
}

export function SEOHead({ title, description, keywords }: SEOHeadProps) {
    useEffect(() => {
        // Update document title
        if (title) {
            document.title = `${title} | ExplainAnything`;
        }

        // Helper to update or create meta tag
        const setMetaTag = (name: string, content: string) => {
            if (!content) return;

            // Try both name and property attributes (OpenGraph uses property)
            let meta = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement;
            if (!meta) {
                meta = document.querySelector(`meta[property="${name}"]`) as HTMLMetaElement;
            }

            if (meta) {
                meta.content = content;
            } else {
                meta = document.createElement('meta');
                // OpenGraph tags use property, others use name
                if (name.startsWith('og:')) {
                    meta.setAttribute('property', name);
                } else {
                    meta.setAttribute('name', name);
                }
                meta.content = content;
                document.head.appendChild(meta);
            }
        };

        // Update meta description
        if (description) {
            setMetaTag('description', description);
            setMetaTag('og:description', description);
            setMetaTag('twitter:description', description);
        }

        // Update Open Graph title
        if (title) {
            setMetaTag('og:title', title);
            setMetaTag('twitter:title', title);
        }

        // Update keywords
        if (keywords && keywords.length > 0) {
            setMetaTag('keywords', keywords.join(', '));
        }

        // Cleanup function to restore original title when unmounting
        // Note: We don't restore meta tags as they may be needed for navigation
    }, [title, description, keywords]);

    return null;
}
