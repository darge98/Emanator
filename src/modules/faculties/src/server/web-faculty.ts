import type { Faculty } from '../domain/faculty.ts';

/** Fetching can leak data; accepted until a Capability holds private data (docs/v1-scope.md). */
export const webFaculty: Faculty = {
  name: 'web',
  title: 'Web',
  description: 'Searching and reading web pages.',
  tools: [
    { name: 'web_search', engine: true, title: 'Search the web', defaultPolicy: 'allow' },
    { name: 'web_fetch', engine: true, title: 'Read a web page', defaultPolicy: 'allow' },
  ],
};
