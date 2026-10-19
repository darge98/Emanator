import type { Faculty } from '../domain/faculty.ts';

// The Engine reads inside the working folder without asking, so reads can't be *ask*.
const READ_CHOICES = ['allow', 'deny'] as const;

/** Files in the working folder; the Engine refuses any path outside it. */
export const filesFaculty: Faculty = {
  kind: 'faculty',
  name: 'files',
  title: 'Files',
  description: 'Only in the working folder. Reading cannot ask: it is allowed or denied.',
  tools: [
    {
      name: 'read_file',
      engine: true,
      title: 'Read a file',
      defaultPolicy: 'allow',
      choices: READ_CHOICES,
    },
    {
      name: 'find_files',
      engine: true,
      title: 'Find files by name',
      defaultPolicy: 'allow',
      choices: READ_CHOICES,
    },
    {
      name: 'search_files',
      engine: true,
      title: 'Search text in files',
      defaultPolicy: 'allow',
      choices: READ_CHOICES,
    },
    { name: 'write_file', engine: true, title: 'Create or overwrite a file', defaultPolicy: 'ask' },
    { name: 'edit_file', engine: true, title: 'Edit a file', defaultPolicy: 'ask' },
  ],
};
