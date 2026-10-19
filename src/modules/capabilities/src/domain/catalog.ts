import type { Capability } from './capability.ts';

/**
 * A Capability the Harness knows how to set up: its server, scopes and OAuth client come
 * from `.env` and Compose, so the Owner only connects it.
 */
export interface CatalogEntry {
  id: string;
  /** Also the Capability's slug, so its Tool names are known in advance. */
  slug: string;
  title: string;
  description: string;
  /** Which icon the dashboard shows; a generic plug when it doesn't know it. */
  icon: string;
  /** What has to be running for the entry to work, said to the Owner as is. */
  requires?: string;
  scopes: readonly string[];
  /** The server's address: a variable that overrides it, else the default. */
  url: { variable: string; base: string; path: string };
  /** Variables holding the pre-registered OAuth client. */
  client?: { idVariable: string; secretVariable: string };
  /** Hosts its sign-in may reach besides the server; its client secret reaches no one else. */
  signInHosts?: readonly string[];
  /**
   * The server's Tools that belong to this entry, by name; all of them when omitted. It lets
   * one server, such as workspace-mcp, serve several entries.
   */
  tools?: readonly string[];
}

/** A catalog entry as the dashboard shows it. */
export interface CatalogItem {
  id: string;
  title: string;
  description: string;
  icon: string;
  requires?: string;
  /** Variables missing from `.env`: until they are set the entry can't connect. */
  missing: string[];
  /** The Capability made from the entry, once the Owner connected it. */
  capability?: Capability;
}

/** workspace-mcp serves several Google products from one container, one entry each below. */
const WORKSPACE_MCP = {
  requires:
    'Needs the workspace-mcp service, which `docker compose up -d` starts with the Harness.',
  url: { variable: 'WORKSPACE_MCP_URL', base: 'http://workspace-mcp:8000', path: '/mcp' },
  client: { idVariable: 'GOOGLE_CLIENT_ID', secretVariable: 'GOOGLE_CLIENT_SECRET' },
  // Google's authorization server and its token endpoint.
  signInHosts: ['accounts.google.com', 'oauth2.googleapis.com'],
} as const;

// workspace-mcp checks each token through Google's userinfo, which needs these two.
const GOOGLE_IDENTITY = ['openid', 'https://www.googleapis.com/auth/userinfo.email'];

function google(scope: string): string {
  return `https://www.googleapis.com/auth/${scope}`;
}

// Each entry's scopes are those of a workspace-mcp permission level in compose.yaml, which
// adds up the levels below it. Its Tools are named one by one, from the pinned commit: their
// names share no pattern, and a Tool a new commit adds stays out until it is reviewed.
export const CATALOG: readonly CatalogEntry[] = [
  {
    id: 'gmail',
    slug: 'gmail',
    title: 'Gmail',
    icon: 'gmail',
    description: 'Search, read, organize, draft and send your mail',
    ...WORKSPACE_MCP,
    // `gmail:send`. Not `full`: its filters act on their own later, out of an Approval's sight.
    scopes: [
      ...GOOGLE_IDENTITY,
      ...['gmail.readonly', 'gmail.labels', 'gmail.modify', 'gmail.compose', 'gmail.send'].map(
        google,
      ),
    ],
    tools: [
      'search_gmail_messages',
      'get_gmail_message_content',
      'get_gmail_messages_content_batch',
      'get_gmail_thread_content',
      'get_gmail_threads_content_batch',
      'get_gmail_attachment_content',
      'list_gmail_labels',
      'manage_gmail_label',
      'modify_gmail_message_labels',
      'batch_modify_gmail_message_labels',
      'draft_gmail_message',
      'send_gmail_message',
    ],
  },
  {
    id: 'calendar',
    slug: 'calendar',
    title: 'Google Calendar',
    icon: 'calendar',
    description: 'Read and manage your calendars and events',
    ...WORKSPACE_MCP,
    // `calendar:full`.
    scopes: [
      ...GOOGLE_IDENTITY,
      ...['calendar.readonly', 'calendar', 'calendar.events'].map(google),
    ],
    tools: [
      'list_calendars',
      'get_events',
      'query_freebusy',
      'manage_event',
      'manage_out_of_office',
      'manage_focus_time',
      'create_calendar',
    ],
  },
  {
    id: 'drive',
    slug: 'drive',
    title: 'Google Drive',
    icon: 'drive',
    description: 'Find, read and edit your files, Docs, Sheets, Slides and Forms',
    ...WORKSPACE_MCP,
    // `drive:full docs:full sheets:full slides:full forms:full`: Docs, Sheets, Slides and
    // Forms are files in Drive, so one grant covers them.
    scopes: [
      ...GOOGLE_IDENTITY,
      ...[
        'drive.readonly',
        'drive',
        'drive.file',
        'documents.readonly',
        'documents',
        'spreadsheets.readonly',
        'spreadsheets',
        'presentations.readonly',
        'presentations',
        'forms.body.readonly',
        'forms.responses.readonly',
        'forms.body',
      ].map(google),
    ],
    tools: [
      // Drive
      'search_drive_files',
      'list_drive_items',
      'get_drive_file_content',
      'get_drive_file_download_url',
      'get_drive_file_permissions',
      'check_drive_file_public_access',
      'get_drive_shareable_link',
      'create_drive_file',
      'create_drive_folder',
      'copy_drive_file',
      'update_drive_file',
      'import_to_google_doc',
      'import_to_google_sheets',
      'import_to_google_slides',
      'manage_drive_access',
      'set_drive_file_permissions',
      // Docs, without debug_docs_runtime_info, which reports the server's own source files.
      'search_docs',
      'list_docs_in_folder',
      'get_doc_content',
      'get_doc_as_markdown',
      'inspect_doc_structure',
      'debug_table_structure',
      'create_doc',
      'modify_doc_text',
      'find_and_replace_doc',
      'insert_doc_elements',
      'insert_doc_image',
      'create_table_with_data',
      'update_paragraph_style',
      'update_doc_headers_footers',
      'batch_update_doc',
      'manage_doc_tab',
      'export_doc_to_pdf',
      'list_document_comments',
      'manage_document_comment',
      // Sheets
      'list_spreadsheets',
      'get_spreadsheet_info',
      'read_sheet_values',
      'list_sheet_tables',
      'create_spreadsheet',
      'create_sheet',
      'modify_sheet_values',
      'append_table_rows',
      'format_sheet_range',
      'manage_conditional_formatting',
      'manage_named_range',
      'manage_sheet_tab',
      'resize_sheet_dimensions',
      'move_sheet_rows',
      'list_spreadsheet_comments',
      'manage_spreadsheet_comment',
      // Slides
      'get_presentation',
      'get_page',
      'get_page_thumbnail',
      'create_presentation',
      'batch_update_presentation',
      'list_presentation_comments',
      'manage_presentation_comment',
      // Forms
      'get_form',
      'get_form_response',
      'list_form_responses',
      'create_form',
      'batch_update_form',
      'set_publish_settings',
    ],
  },
  {
    id: 'tasks',
    slug: 'tasks',
    title: 'Google Tasks',
    icon: 'tasks',
    description: 'Read and manage your task lists and tasks',
    ...WORKSPACE_MCP,
    // `tasks:full`, which unlike `manage` can also delete.
    scopes: [...GOOGLE_IDENTITY, ...['tasks.readonly', 'tasks'].map(google)],
    tools: [
      'list_task_lists',
      'get_task_list',
      'list_tasks',
      'get_task',
      'manage_task',
      'manage_task_list',
    ],
  },
];
