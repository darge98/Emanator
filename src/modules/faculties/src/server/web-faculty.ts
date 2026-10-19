import type { Faculty } from '../domain/faculty.ts';

/**
 * Fetching a page can carry private data out, e.g. mail an injected instruction put in the URL,
 * so it asks first now that Capabilities hold such data (docs/v1-scope.md).
 */
export const webFaculty: Faculty = {
  kind: 'faculty',
  name: 'web',
  title: 'Web',
  description: 'Searching and reading web pages.',
  tools: [
    { name: 'web_search', engine: true, title: 'Search the web', defaultPolicy: 'allow' },
    { name: 'web_fetch', engine: true, title: 'Read a web page', defaultPolicy: 'ask' },
  ],
};
