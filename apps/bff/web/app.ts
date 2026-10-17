import './app.css';
import { createSampleTables, functionSource, navigation, sampleLogs, type Row } from './app-data.ts';

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const badge = (text: string, tone = '') => {
  if (text === 'Disabled' || text === 'Invited') tone = '';
  if (text === 'Suspended') tone = 'error';
  return `<span class="bff-state ${tone ? `bff-state-${tone}` : ''}">${escape(text)}</span>`;
};
const button = (text: string, action: string, value = '', primary = false) => `<button type="button" class="${primary ? 'button button-small' : 'dashboard-retry'}" data-action="${action}" data-value="${escape(value)}">${escape(text)}</button>`;
const mono = (text: string) => `<code>${escape(text)}</code>`;
const sub = (text: string) => `<span class="bff-cell-detail">${escape(text)}</span>`;
const table = (headers: string[], rows: string[][], caption: string, className = '') => rows.length ? `<div class="bff-table-scroll ${className}" tabindex="0" role="region" aria-label="${escape(caption)}"><table class="bff-table"><caption class="visually-hidden">${escape(caption)}</caption><thead><tr>${headers.map(h => `<th scope="col">${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="bff-empty">No matching results.</p>';
const heading = (title: string, description: string, actions = '') => `<div class="bff-section-heading"><div><h2 id="bff-view-title" tabindex="-1">${escape(title)}</h2><p class="bff-muted">${escape(description)}</p></div><div class="bff-actions">${actions}</div></div>`;
type EditorField = { name: string; label: string; value?: string; type?: string; options?: string[]; required?: boolean; hint?: string };
type Editor = { title: string; fields: EditorField[]; submit?: string; note?: string; save: (values: Row) => void };
type Environment = 'production' | 'staging';

export function initializeBff({ readSession }: { readSession: () => Promise<{ user: { id?: string } } | null> }) {
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const main = el('main');
  const content = el('bff-content');
  const view = el('bff-view');
  const nav = el('bff-navigation');
  const loading = el('bff-loading');
  const error = el('bff-error');
  const retry = el<HTMLButtonElement>('bff-retry');
  const signIn = el('bff-signin');
  const dialog = el<HTMLDialogElement>('bff-dialog');
  const dialogBody = el('bff-dialog-body');
  const feedback = el('bff-feedback');
  let environment: Environment = 'production';
  const environments = { production: createSampleTables(), staging: createSampleTables(true) };
  const drafts: Record<string, Row> = {};
  const invitedUsers: Record<Environment, Row[]> = { production: [], staging: [] };
  const localFiles: Record<Environment, Row[]> = { production: [], staging: [] };
  let section = 'overview';
  let tab = '';
  let selectedTable = 'trips';
  let selectedBucket = 'trip-photos';
  let selectedFunction = 'join-trip';
  let search = '';
  let logLevel = 'all';
  let usagePeriod = 'month';
  let sql = "SELECT id, title, destination, status\nFROM trips\nORDER BY starts_at DESC\nLIMIT 6;";
  let sqlResults = false;
  let functionResult = false;
  let searchQuery = '';
  let searchComplete = false;
  let activeEditor: Editor | null = null;
  let sessionVersion = 0;
  let userId: string | undefined;
  let authenticated = false;
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
  let source = functionSource;
  const tables = () => environments[environment];
  const draft = (key: string, field: string, fallback: string) => drafts[`${environment}:${key}`]?.[field] ?? fallback;
  const saveDraft = (key: string, values: Row) => { drafts[`${environment}:${key}`] = values; };
  const stats = () => environment === 'production' ? ['128,406', '1,284', '2.0 GB', '99.94%'] : ['1,206', '3', '18.4 MB', '100%'];

  function announce(message: string) {
    clearTimeout(feedbackTimer);
    feedback.textContent = message;
    feedbackTimer = setTimeout(() => { feedback.textContent = ''; }, 7000);
  }

  function tabs(items: [string, string][], fallback: string) {
    if (!items.some(([id]) => id === tab)) tab = fallback;
    return `<div class="bff-local-tabs" aria-label="${escape(section)} views">${items.map(([id, label]) => `<button type="button" class="bff-tab" data-action="tab" data-value="${id}" aria-pressed="${tab === id}">${escape(label)}</button>`).join('')}</div>`;
  }

  function dataRows(rows: Row[], columns: string[], editable = false) {
    return rows.map(row => [...columns.map(column => column === 'status' ? badge(row[column], row[column] === 'published' ? 'good' : '') : escape(row[column] || '—')), ...(editable ? [button('Edit', 'edit-row', row.id)] : [])]);
  }

  function overview() {
    const numbers = stats();
    return heading('Project overview', `${draft('project', 'name', 'Trailhead')} · ${environment === 'production' ? 'Production' : 'Staging'} · Sample snapshot: October 16, 2026`) +
      `<dl class="bff-metrics">${['API requests · 24h', 'Registered users', 'File storage', 'Success rate · 24h'].map((label, i) => `<div><dt>${label}</dt><dd>${numbers[i]}</dd></div>`).join('')}</dl>
      <div class="bff-overview-columns"><section><div class="bff-subheading"><h3>API requests</h3><span class="bff-muted">Last 24 hours · UTC</span></div>
      <div class="bff-chart" role="img" aria-label="Sample API requests per hour, rising from 2,100 to a peak of 8,400, then ending at 5,200.">${[24, 21, 18, 16, 17, 24, 34, 43, 58, 67, 62, 71, 86, 93, 78, 88, 100, 92, 79, 68, 72, 63, 66, 62].map(height => `<span style="--bar:${height}%"></span>`).join('')}</div><div class="bff-chart-labels"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span></div></section>
      <section><h3>Resources</h3><dl class="bff-resource-list">${[['Database', `${tables().length} tables · 84.6 MB`, 'database'], ['Authentication', 'Email, Google, Apple', 'auth'], ['Storage', '3 buckets · 2,480 files', 'storage'], ['Functions', '4 deployed · 38 ms median', 'functions'], ['Realtime', '12 channels · 47 connections', 'realtime']].map(([title, detail, target]) => `<div><dt><a href="#${target}">${title}</a></dt><dd>${detail}</dd></div>`).join('')}</dl></section></div>
      <section class="bff-section"><div class="bff-subheading"><h3>Recent activity</h3><a href="#logs" class="text-link">View logs</a></div>${table(['Time', 'Event', 'Actor'], [
        ['10:42', 'Ava joined Point Reyes weekend', 'ava@example.com'],
        ['10:40', `${badge('Retrying', 'warning')} Trip reminder delivery failed`, 'send-trip-reminder'],
        ['09:18', 'Migration 012_add_trip_visibility applied', 'maya@example.com'],
        ['Yesterday', 'join-trip deployed · version 8', 'maya@example.com'],
      ], 'Recent sample project activity', 'bff-activity-table')}</section>
      <section class="bff-section"><h3>Project connection</h3><div class="bff-connection-row"><code>${projectURL()}</code>${button('Copy URL', 'copy-url')}${button('Client example', 'connect')}</div></section>`;
  }

  function database() {
    const selected = tables().find(item => item.name === selectedTable) ?? tables()[0];
    selectedTable = selected.name;
    let html = heading('Database', 'SQLite tables, schema, migrations, and recovery.', button('New table', 'new-table', '', true));
    html += tabs([['rows', 'Table editor'], ['schema', 'Schema'], ['migrations', 'Migrations'], ['backups', 'Backups']], 'rows');
    if (tab === 'migrations') return html + table(['Migration', 'Applied', 'Status', ''], [
      ['012_add_trip_visibility', 'Today, 09:18', badge('Applied', 'good'), button('View SQL', 'migration', '012')],
      ['011_index_trip_members', 'Oct 14, 16:30', badge('Applied', 'good'), button('View SQL', 'migration', '011')],
      ['010_create_invitations', 'Oct 12, 11:04', badge('Applied', 'good'), button('View SQL', 'migration', '010')],
    ], 'Database migrations') + `<div class="bff-toolbar">${button('Create migration', 'new-migration')}${button('Import schema', 'import-schema')}</div>`;
    if (tab === 'backups') return html + `<dl class="bff-detail-list"><div><dt>Point-in-time recovery</dt><dd>Enabled · 30-day retention</dd></div><div><dt>Latest restore point</dt><dd>Oct 16, 2026, 10:40 UTC</dd></div><div><dt>Scheduled exports</dt><dd>Daily at 03:00 UTC · SQLite format</dd></div></dl>` + table(['Backup', 'Size', 'Status', ''], [
      ['trailhead-2026-10-16.sqlite', '84.6 MB', badge('Complete', 'good'), button('Restore preview', 'restore', '2026-10-16')],
      ['trailhead-2026-10-15.sqlite', '83.9 MB', badge('Complete', 'good'), button('Restore preview', 'restore', '2026-10-15')],
    ], 'Sample database backups') + `<div class="bff-toolbar">${button('Export sample data', 'export')}${button('Recovery settings', 'backup-settings')}</div>`;
    html += `<div class="bff-toolbar"><label for="bff-table-select">Table</label><select id="bff-table-select">${tables().map(item => `<option value="${escape(item.name)}" ${item.name === selectedTable ? 'selected' : ''}>${escape(item.name)} (${item.count.toLocaleString()})</option>`).join('')}</select><span class="bff-muted">${selected.count.toLocaleString()} rows</span><a class="text-link" href="#permissions">Row policies</a></div>`;
    if (tab === 'schema') return html + table(['Column', 'Type', 'Constraints'], selected.columns.map((column, i) => [mono(column), column.endsWith('_bytes') ? 'INTEGER' : 'TEXT', i === 0 ? badge('Primary key') : column.endsWith('_id') ? `Foreign key${sub(column === 'trip_id' ? 'trips.id' : 'profiles.id')}` : '—']), `${selectedTable} schema`) + `<div class="bff-toolbar">${button('Add column', 'add-column')}${button('Indexes', 'indexes')}${button('Relationships', 'relationships')}</div>`;
    const rows = selected.rows.filter(row => Object.values(row).some(value => value.toLowerCase().includes(search.toLowerCase())));
    return html + `<div class="bff-toolbar"><label class="visually-hidden" for="bff-row-search">Filter rows</label><input id="bff-row-search" type="search" placeholder="Filter sample rows…" value="${escape(search)}" /><div class="bff-actions">${button('Insert row', 'insert-row')}${button('Import CSV', 'import-csv')}${button('Export', 'export')}</div></div>` + table([...selected.columns, ''], dataRows(rows, selected.columns, true), `${selectedTable} sample rows`, 'bff-data-table') + `<p class="bff-footnote">Showing ${rows.length} sample rows of ${selected.count.toLocaleString()}. All edits stay in this preview.</p>`;
  }

  function sqlEditor() {
    const selected = tables().find(item => item.name === 'trips')!;
    return heading('SQL editor', 'Write queries and inspect sample results.', button('Query examples', 'sql-examples')) +
      `<label for="bff-sql" class="bff-editor-label">Query · SQLite</label><textarea id="bff-sql" class="bff-code-editor" rows="7" spellcheck="false">${escape(sql)}</textarea><div class="bff-toolbar">${button('Preview results', 'run-sql', '', true)}${button('Save query', 'save-query')}<span class="bff-muted">SQL is not executed in this preview.</span></div>` +
      (sqlResults ? `<div class="bff-subheading"><h3>Sample results</h3><span class="bff-muted">Fixed fixture · ${selected.rows.length} rows</span></div>${table(['id', 'title', 'destination', 'status'], dataRows(selected.rows, ['id', 'title', 'destination', 'status']), 'SQL sample results')}<p class="bff-footnote">These rows demonstrate the result view and do not depend on the query above.</p>` : '<p class="bff-empty">Preview results to see the result table.</p>') +
      `<section class="bff-section"><h3>Saved queries</h3><div class="bff-toolbar">${button('Upcoming trips', 'load-query', 'upcoming')}${button('Members per trip', 'load-query', 'members')}${button('Daily signups', 'load-query', 'signups')}${draft('query', 'name', '') ? button(draft('query', 'name', ''), 'load-query', 'custom') : ''}</div></section>`;
  }

  function authentication() {
    let html = heading('Authentication', `${environment === 'production' ? '1,284 registered users · 218' : '3 registered users · 3'} active this week`, button('Invite user', 'invite-user', '', true));
    html += tabs([['users', 'Users'], ['providers', 'Sign-in methods'], ['sessions', 'Sessions']], 'users');
    if (tab === 'providers') return html + table(['Provider', 'Status', 'Configuration', ''], [
      ['Email & password', badge(draft('provider-email', 'status', 'Enabled'), 'good'), 'Email verification required', button('Configure', 'provider', 'email')],
      ['Google', badge(draft('provider-google', 'status', 'Enabled'), 'good'), 'Web OAuth client', button('Configure', 'provider', 'google')],
      ['Apple', badge(draft('provider-apple', 'status', 'Enabled'), 'good'), 'Web & iOS', button('Configure', 'provider', 'apple')],
      ['Passkeys', badge(draft('provider-passkeys', 'status', 'Disabled')), 'WebAuthn', button('Configure', 'provider', 'passkeys')],
      ['Anonymous sign-in', badge(draft('provider-anonymous', 'status', 'Disabled')), 'Guest sessions', button('Configure', 'provider', 'anonymous')],
    ], 'Authentication providers') + `<section class="bff-section"><h3>Security & redirects</h3><dl class="bff-detail-list"><div><dt>Site URL</dt><dd>${escape(draft('auth-settings', 'url', 'https://trailhead.example.com'))}</dd></div><div><dt>Session lifetime</dt><dd>${escape(draft('auth-settings', 'lifetime', '7 days'))}</dd></div><div><dt>Multi-factor authentication</dt><dd>${escape(draft('auth-settings', 'mfa', 'Optional · TOTP'))}</dd></div></dl>${button('Edit auth settings', 'auth-settings')}</section>`;
    if (tab === 'sessions') return html + table(['User', 'Device', 'Last active', ''], [
      ['Maya Chen', 'Safari · macOS', 'Today, 10:42', button('Inspect', 'session', 'Maya Chen')],
      ['Theo Williams', 'Trailhead iOS · iPhone', 'Today, 10:38', button('Inspect', 'session', 'Theo Williams')],
      ['Ava Patel', 'Chrome · Android', 'Today, 10:31', button('Inspect', 'session', 'Ava Patel')],
    ], 'Sample user sessions');
    const users = [...tables().find(item => item.name === 'profiles')!.rows, ...invitedUsers[environment]].filter(row => Object.values(row).join(' ').toLowerCase().includes(search.toLowerCase()));
    return html + `<div class="bff-toolbar"><label class="visually-hidden" for="bff-user-search">Search users</label><input id="bff-user-search" type="search" placeholder="Search by name or email…" value="${escape(search)}" /></div>` + table(['User', 'Provider', 'Status', 'Last sign-in', ''], users.map((row, i) => [`${escape(row.name)}${sub(row.email)}`, ['Email', 'Google', 'Apple'][i % 3], badge(row.status || 'Verified', 'good'), escape(row.last_sign_in || 'Never'), button('Manage', 'manage-user', row.id)]), 'Project users');
  }

  function permissions() {
    return heading('Permissions', 'Row policies run before data reaches your application.', button('New policy', 'new-policy', '', true)) + table(['Resource', 'Operation', 'Rule', 'Status', ''], [
      ['trips', 'SELECT', 'Published trips or trip owner', badge(draft('policy-trips', 'status', 'Enforced'), 'good'), button('Edit', 'policy', 'trips')],
      ['trips', 'INSERT / UPDATE / DELETE', 'Authenticated owner only', badge('Enforced', 'good'), button('Edit', 'policy', 'owner')],
      ['messages', 'SELECT / INSERT', 'Members of the same trip', badge('Enforced', 'good'), button('Edit', 'policy', 'messages')],
      ['profiles', 'UPDATE', 'User can update own profile', badge('Enforced', 'good'), button('Edit', 'policy', 'profiles')],
      ['storage:trip-photos', 'UPLOAD / DELETE', 'Trip members / file owner', badge('Enforced', 'good'), button('Edit', 'policy', 'storage')],
    ], 'Row and storage access policies') + `<section class="bff-section"><div class="bff-subheading"><h3>Policy simulator</h3>${button('Test access', 'test-policy')}</div><p class="bff-muted">Inspect a sample request as an authenticated user or anonymous visitor.</p></section><section class="bff-section"><h3>Application roles</h3>${table(['Role', 'Access'], [['organizer', 'Create trips, manage members, and edit own trips'], ['member', 'Join published trips, message members, upload files'], ['anonymous', 'Read published trips only']], 'Application roles')}</section>`;
  }

  function storage() {
    const buckets = [['trip-photos', 'Private', '1.9 GB', '1,280'], ['avatars', 'Public', '84.2 MB', '1,186'], ['exports', 'Private', '18.4 MB', '14']];
    const files: Row[] = selectedBucket === 'trip-photos' ? [
      { name: 'point-reyes/campsite.jpg', type: 'Image · JPEG', size: '2.4 MB', owner: 'ava@example.com' },
      { name: 'point-reyes/route.gpx', type: 'GPS track', size: '48.2 KB', owner: 'maya@example.com' },
      { name: 'mount-tam/sunrise.webp', type: 'Image · WebP', size: '842 KB', owner: 'theo@example.com' },
      { name: 'big-sur/coastal-trail.mp4', type: 'Video · MP4', size: '24.6 MB', owner: 'maya@example.com' },
    ] : selectedBucket === 'avatars' ? [{ name: 'usr_maya/avatar.webp', type: 'Image · WebP', size: '42 KB', owner: 'maya@example.com' }, { name: 'usr_ava/avatar.webp', type: 'Image · WebP', size: '38 KB', owner: 'ava@example.com' }] : [{ name: 'trips-2026-10-16.csv', type: 'CSV export', size: '182 KB', owner: 'system' }];
    files.push(...localFiles[environment].filter(file => file.bucket === selectedBucket));
    return heading('Storage', 'Buckets, files, media, and access rules.', button('New bucket', 'new-bucket', '', true)) +
      table(['Bucket', 'Access', 'Size', 'Files', ''], buckets.map(([name, access, size, count]) => [mono(name), badge(access), size, count, button(selectedBucket === name ? 'Selected' : 'Browse', 'bucket', name)]), 'Storage buckets') +
      `<section class="bff-section"><div class="bff-subheading"><h3>${escape(selectedBucket)}</h3><div class="bff-actions">${button('Bucket settings', 'bucket-settings')}${button('Upload file', 'upload-file')}</div></div>${table(['File', 'Type', 'Size', 'Uploaded by', ''], files.map(file => [escape(file.name), escape(file.type), escape(file.size), escape(file.owner), button('Details', 'file', file.name)]), 'Sample stored files')}</section>`;
  }

  function functions() {
    const names = ['join-trip', 'send-invitation', 'generate-thumbnail', 'stripe-webhook'];
    return heading('Functions', 'Project-scoped JavaScript and TypeScript.', button('New function', 'new-function', '', true)) + table(['Function', 'Trigger', 'Version', 'Invocations · 24h', ''], names.map((name, i) => [mono(name), ['RPC · authenticated', 'Database insert', 'Storage upload', 'HTTP webhook'][i], `v${[8, 4, 3, 2][i]}`, ['8,412', '246', '182', '64'][i], button(selectedFunction === name ? 'Selected' : 'Open', 'function', name)]), 'Deployed sample functions') +
      `<section class="bff-section"><div class="bff-subheading"><h3>${escape(selectedFunction)}.ts</h3><span class="bff-muted">${escape(draft(`function-${selectedFunction}`, 'status', 'Deployed yesterday'))}</span></div><label class="visually-hidden" for="bff-function-source">Function source</label><textarea id="bff-function-source" class="bff-code-editor" rows="12" spellcheck="false">${escape(source)}</textarea><div class="bff-toolbar">${button('Preview invocation', 'test-function')}${button('Save draft', 'save-function')}${button('Secrets', 'secrets')}<span class="bff-muted">Code is not executed or deployed.</span></div>${functionResult ? `<pre class="bff-code-output">${escape(JSON.stringify({ sample: true, status: 200, data: { trip_id: 'trip_038', user_id: 'usr_ava', role: 'member' } }, null, 2))}</pre>` : ''}</section>`;
  }

  function realtime() {
    let html = heading('Realtime & live objects', 'Live subscriptions, presence, and persistent room state.');
    html += tabs([['channels', 'Channels'], ['objects', 'Live objects']], 'channels');
    if (tab === 'objects') return html + table(['Object', 'Class', 'Connections', 'State', ''], [
      [mono('trip_038'), 'TripRoom', '8', '12 KB · 164 messages', button('Inspect', 'object', 'trip_038')],
      [mono('trip_037'), 'TripRoom', '6', '8 KB · 92 messages', button('Inspect', 'object', 'trip_037')],
    ], 'Persistent live objects') + `<div class="bff-toolbar">${button('New object class', 'new-object')}</div><p class="bff-footnote">Each live object owns its state independently of the project database.</p>`;
    return html + table(['Channel', 'Subscriptions', 'Connections', 'Status', ''], [
      [mono('trip:trip_038'), 'messages, trip_members', '8', badge('Connected', 'good'), button('Inspect', 'channel', 'trip_038')],
      [mono('trip:trip_037'), 'messages, trip_members', '6', badge('Connected', 'good'), button('Inspect', 'channel', 'trip_037')],
      [mono('public:trips'), 'trips · published only', '33', badge('Connected', 'good'), button('Inspect', 'channel', 'public')],
    ], 'Sample realtime channels') + `<section class="bff-section"><h3>Recent events</h3>${table(['Time', 'Channel', 'Event', 'User'], [['10:42:18', 'trip:trip_038', 'member.joined', 'Ava Patel'], ['10:40:31', 'trip:trip_038', 'message.created', 'Maya Chen'], ['10:38:11', 'trip:trip_037', 'presence.enter', 'Theo Williams']], 'Sample realtime events')}</section><div class="bff-toolbar">${button('Subscription settings', 'realtime-settings')}</div>`;
  }

  function automations() {
    let html = heading('Automations', 'Queues, workflows, schedules, and webhook delivery.', button('Create automation', 'new-automation', '', true));
    html += tabs([['jobs', 'Jobs & queues'], ['workflows', 'Workflows'], ['schedules', 'Schedules'], ['webhooks', 'Webhooks']], 'jobs');
    if (tab === 'workflows') return html + table(['Workflow', 'Trigger', 'In progress', 'Last completed', ''], [['trip-reminder', '24h before trip', '12', 'Today, 10:30', button('Inspect run', 'workflow')], ['new-member-onboarding', 'User created', '3', 'Today, 09:54', button('Inspect run', 'workflow')]], 'Sample workflows');
    if (tab === 'schedules') return html + table(['Schedule', 'Expression', 'Next run · UTC', 'Status', ''], [['daily-trip-digest', mono('0 8 * * *'), 'Tomorrow, 08:00', badge('Enabled', 'good'), button('Edit', 'schedule', 'digest')], ['cleanup-expired-invitations', mono('0 */6 * * *'), 'Today, 12:00', badge('Enabled', 'good'), button('Edit', 'schedule', 'cleanup')]], 'Scheduled jobs');
    if (tab === 'webhooks') return html + table(['Endpoint', 'Events', 'Last response', ''], [[mono('https://trailhead.example.com/hooks/bff'), 'trip.created, member.joined', badge('200 OK', 'good'), button('Configure', 'webhook')]], 'Outgoing webhooks') + `<section class="bff-section"><h3>Recent deliveries</h3>${table(['Event', 'Time', 'Status', ''], [['member.joined · evt_0192', '10:42:18', badge('Delivered', 'good'), button('View payload', 'webhook-payload')], ['trip.created · evt_0191', '09:24:02', badge('Delivered', 'good'), button('View payload', 'webhook-payload')]], 'Webhook deliveries')}</section>`;
    return html + table(['Queue', 'Pending', 'Completed · 24h', 'Failed', ''], [['notifications', '12', '2,418', '1', button('Configure', 'queue', 'notifications')], ['media-processing', '0', '182', '0', button('Configure', 'queue', 'media-processing')]], 'Background queues') + `<section class="bff-section"><h3>Recent jobs</h3>${table(['Job', 'Status', 'Attempt', 'Updated', ''], [[mono('send-trip-reminder'), badge(draft('retry-job', 'status', 'Retrying'), 'warning'), '2 of 3', '10:40:06', button('Inspect', 'job')], [mono('generate-thumbnail'), badge('Completed', 'good'), '1 of 3', '10:39:55', button('Inspect', 'completed-job')]], 'Recent background jobs')}</section>`;
  }

  function notifications() {
    let html = heading('Notifications', 'Transactional email, push, and delivery history.', button('New template', 'new-template', '', true));
    html += tabs([['templates', 'Templates'], ['deliveries', 'Delivery history'], ['preferences', 'Preferences']], 'templates');
    if (tab === 'deliveries') return html + table(['Recipient', 'Template', 'Channel', 'Status', 'Time'], [['ava@example.com', 'trip-invitation', 'Email', badge('Delivered', 'good'), '10:42'], ['sam@example.com', 'trip-reminder', 'Email', badge('Retrying', 'warning'), '10:40'], ['theo@example.com', 'new-message', 'Push', badge('Delivered', 'good'), '10:38']], 'Sample notification history');
    if (tab === 'preferences') return html + `<dl class="bff-detail-list"><div><dt>Sender</dt><dd>${escape(draft('notification-settings', 'sender', 'Trailhead <hello@trailhead.example.com>'))}</dd></div><div><dt>Email domain</dt><dd>trailhead.example.com · ${badge('Sample verified')}</dd></div><div><dt>Push providers</dt><dd>APNs, Firebase Cloud Messaging · Sample configuration</dd></div><div><dt>Default preferences</dt><dd>Email for invitations and reminders; push for messages.</dd></div></dl>${button('Edit delivery settings', 'notification-settings')}`;
    return html + table(['Template', 'Channel', 'Last edited', ''], [[mono('trip-invitation'), 'Email', 'Oct 14, 2026', button('Edit & preview', 'email-template', 'trip-invitation')], [mono('trip-reminder'), 'Email + push', 'Oct 12, 2026', button('Edit & preview', 'email-template', 'trip-reminder')], [mono('welcome'), 'Email', 'Oct 08, 2026', button('Edit & preview', 'email-template', 'welcome')]], 'Notification templates');
  }

  function searchAI() {
    return heading('Search & AI', 'Full-text indexes, vector search, and model usage.', button('Create index', 'new-index', '', true)) + table(['Index', 'Source', 'Type', 'Documents', 'Status', ''], [[mono('trip_search'), 'trips.title, destination', 'Full-text · FTS5', '38', badge('Ready', 'good'), button('Configure', 'search-index', 'trip_search')], [mono('trail_guides'), 'storage:guides', 'Vector · 768 dimensions', '124', badge('Ready', 'good'), button('Configure', 'search-index', 'trail_guides')]], 'Search indexes') +
      `<section class="bff-section"><h3>Search playground</h3><form id="bff-search-form" class="bff-toolbar"><label class="visually-hidden" for="bff-search-query">Search query</label><input id="bff-search-query" name="query" required placeholder="Try “coastal weekend”" value="${escape(searchQuery)}" /><label class="visually-hidden" for="bff-search-mode">Search mode</label><select id="bff-search-mode" name="mode"><option>Semantic</option><option>Full-text</option></select><button class="button button-small" type="submit">Preview search</button></form>${searchComplete ? table(['Sample match', 'Source', 'Similarity'], [['Point Reyes weekend', 'trips / trip_038', '0.94'], ['Big Sur coastal trail', 'trips / trip_036', '0.89']], 'Fixed sample search matches') + '<p class="bff-footnote">Fixed sample results; no index or model is queried.</p>' : ''}</section><section class="bff-section"><h3>AI models</h3>${table(['Purpose', 'Model', 'Usage · month'], [['Embeddings', mono('@cf/baai/bge-base-en-v1.5'), '124 documents indexed'], ['Text generation', mono('@cf/meta/llama-3.1-8b-instruct'), '38,420 tokens']], 'Sample AI model usage')}${button('Model settings', 'model-settings')}</section>`;
  }

  function payments() {
    return heading('Payments', 'App subscriptions, entitlements, and billing webhooks.', button('Integration settings', 'payment-settings')) +
      `<dl class="bff-detail-list"><div><dt>Provider</dt><dd>Stripe · ${badge('Sample connection')}</dd></div><div><dt>Account</dt><dd>Trailhead · Test mode</dd></div><div><dt>Webhook</dt><dd>stripe-webhook · 64 events processed today</dd></div></dl>` + table(['Plan', 'Price', 'Active subscriptions', 'Entitlements'], [['Explorer', 'Free', '1,242', 'Join trips · 100 MB uploads'], ['Trailhead Plus', '$8 / month', '42', 'Unlimited trips · 5 GB uploads · Offline maps']], 'Sample app subscription plans') + `<section class="bff-section"><h3>Recent billing events</h3>${table(['Time', 'Event', 'Customer', 'Status'], [['10:38', 'invoice.paid', 'maya@example.com', badge('Processed', 'good')], ['09:12', 'customer.subscription.created', 'ava@example.com', badge('Processed', 'good')]], 'Sample Stripe events')}</section><p class="bff-footnote">These are your app’s customer subscriptions. BFF project usage is shown under Usage.</p>`;
  }

  function logs() {
    const rows = sampleLogs.filter(row => (logLevel === 'all' || row[6] === logLevel) && row.join(' ').toLowerCase().includes(search.toLowerCase()));
    return heading('Logs', 'Request and function activity · Oct 16, 2026 · UTC', button('Export logs', 'export-logs')) + `<div class="bff-toolbar"><label class="visually-hidden" for="bff-log-search">Filter logs</label><input id="bff-log-search" type="search" placeholder="Filter by path, user, or status…" value="${escape(search)}" /><label for="bff-log-level">Level</label><select id="bff-log-level">${['all', 'info', 'warning', 'error'].map(level => `<option ${level === logLevel ? 'selected' : ''} value="${level}">${level === 'all' ? 'All levels' : level[0].toUpperCase() + level.slice(1)}</option>`).join('')}</select></div>` + table(['Time', 'Status', 'Method', 'Path', 'Duration', ''], rows.map(row => [row[0], badge(row[1], row[6] === 'error' ? 'error' : row[6] === 'warning' ? 'warning' : 'good'), row[2], mono(row[3]), row[4], button('Inspect', 'log', row[3])]), 'Sample request logs') + `<section class="bff-section"><h3>Audit trail</h3>${table(['Time', 'Action', 'Actor'], [['09:18', 'database.migration.applied', 'Maya Chen'], ['Yesterday, 16:24', 'function.deployed · join-trip v8', 'Maya Chen'], ['Oct 14, 11:06', 'team.member.invited', 'Maya Chen']], 'Project audit events')}</section>`;
  }

  function usage() {
    const daily = usagePeriod === 'day';
    return heading('Usage', `${daily ? 'October 16' : 'October 1–16'}, 2026 · Sample usage and costs`) + `<div class="bff-toolbar"><label for="bff-usage-period">Period</label><select id="bff-usage-period"><option value="month" ${!daily ? 'selected' : ''}>This month</option><option value="day" ${daily ? 'selected' : ''}>Today</option></select></div><dl class="bff-metrics bff-usage-summary"><div><dt>Estimated spend</dt><dd>${daily ? '$0.74' : '$8.42'}</dd></div><div><dt>Monthly spending limit</dt><dd>$${escape(draft('spend', 'limit', '25'))}</dd></div><div><dt>Billing alerts</dt><dd>${escape(draft('spend', 'alert', '80'))}%</dd></div></dl>` +
      table(['Resource', 'Used', 'Included · month', 'Usage', 'Estimated cost'], [
        ['API requests', daily ? '128,406' : '1.84M', '5M', '<meter value="37" max="100" aria-label="API requests: 37% of monthly allowance">37%</meter>', daily ? '$0.12' : '$1.20'],
        ['Database reads', daily ? '412K' : '6.2M', '25M', '<meter value="25" max="100" aria-label="Database reads: 25% of monthly allowance">25%</meter>', daily ? '$0.04' : '$0.62'],
        ['Database writes', daily ? '3,812' : '48.6K', '100K', '<meter value="49" max="100" aria-label="Database writes: 49% of monthly allowance">49%</meter>', daily ? '$0.05' : '$0.80'],
        ['File storage', '2.0 GB', '10 GB', '<meter value="20" max="100" aria-label="File storage: 20% of allowance">20%</meter>', daily ? '$0.10' : '$1.60'],
        ['Functions', daily ? '8,904' : '184K', '1M', '<meter value="18" max="100" aria-label="Functions: 18% of monthly allowance">18%</meter>', daily ? '$0.21' : '$2.40'],
        ['Realtime messages', daily ? '24,812' : '412K', '2M', '<meter value="21" max="100" aria-label="Realtime messages: 21% of monthly allowance">21%</meter>', daily ? '$0.08' : '$0.96'],
        ['Email & AI', daily ? '182 emails · 2.4K tokens' : '2,418 emails · 38.4K tokens', 'Usage based', '—', daily ? '$0.14' : '$0.84'],
      ], 'Illustrative project usage; meters show monthly allowance usage') + `<div class="bff-toolbar">${button('Edit spending controls', 'spend')}${button('Download sample report', 'usage-report')}</div><p class="bff-footnote">Illustrative allowances and costs, not published BFF pricing. No amount is charged.</p>`;
  }

  function templates() {
    return heading('Templates', 'Backend modules with schema, policies, functions, and client examples.') + table(['Template', 'Includes', 'Status', ''], [
      ['Community', 'Profiles, posts, messages, moderation', badge('Available'), button('Review module', 'module', 'Community')],
      ['SaaS', 'Organizations, invitations, roles, billing', badge('Installed', 'good'), button('Review module', 'module', 'SaaS')],
      ['Multiplayer', 'Lobbies, presence, rooms, leaderboards', badge('Available'), button('Review module', 'module', 'Multiplayer')],
      ['AI application', 'Documents, indexing, search, conversations', badge('Available'), button('Review module', 'module', 'AI application')],
    ], 'Backend templates') + `<section class="bff-section"><h3>Installed modules</h3><p class="bff-muted">SaaS · v1.2 · Installed Oct 2, 2026 by Maya Chen</p><p class="bff-footnote">Module review shows proposed resources. This preview does not install code or modify infrastructure.</p></section>`;
  }

  function settings() {
    let html = heading('Settings', 'Project configuration and developer access.');
    html += tabs([['general', 'General'], ['keys', 'API keys'], ['team', 'Team & organizations'], ['secrets', 'Secrets'], ['flags', 'Feature flags']], 'general');
    if (tab === 'keys') return html + `<p class="bff-footnote">All keys below are nonfunctional sample values.</p>` + table(['Key', 'Access', 'Value', ''], [['Publishable', 'Respects user permissions', mono('bff_pk_sample_trailhead_not_a_real_key'), button('Copy', 'copy-key', 'public')], ['Service role', 'Server only · bypasses row policies', mono('bff_sk_sample_••••••••••••'), button('Reveal sample', 'reveal-key')]], 'Sample project API keys') + `<div class="bff-toolbar">${button('Create scoped key', 'new-key')}${button('Rotate service key', 'rotate-key')}</div>`;
    if (tab === 'team') return html + table(['Member', 'Role', 'Access', ''], [['Maya Chen' + sub('maya@example.com'), 'Owner', 'All environments', button('Manage', 'team-member', 'Maya Chen')], ['Theo Williams' + sub('theo@example.com'), 'Developer', 'All environments', button('Manage', 'team-member', 'Theo Williams')], ['Jules Rivera' + sub('jules@example.com'), 'Viewer', 'Production', button('Manage', 'team-member', 'Jules Rivera')]], 'Project team') + `<div class="bff-toolbar">${button('Invite team member', 'invite-team')}</div><section class="bff-section"><h3>Application organizations</h3>${table(['Organization', 'Members', 'Plan'], [['Bay Area Hikers', '18', 'Trailhead Plus'], ['Weekend Wanderers', '8', 'Explorer']], 'Sample application organizations')}${button('Organization settings', 'org-settings')}</section>`;
    if (tab === 'secrets') return html + table(['Name', 'Value', 'Updated', ''], [['STRIPE_SECRET_KEY', '••••••••••••', 'Oct 14', button('Edit', 'secret', 'STRIPE_SECRET_KEY')], ['STRIPE_WEBHOOK_SECRET', '••••••••••••', 'Oct 14', button('Edit', 'secret', 'STRIPE_WEBHOOK_SECRET')], ['PUSH_SIGNING_KEY', '••••••••••••', 'Oct 08', button('Edit', 'secret', 'PUSH_SIGNING_KEY')]], 'Sample secret names; no real secrets stored') + `<div class="bff-toolbar">${button('Add secret', 'secret', '')}</div><p class="bff-footnote">Sample names only. Do not enter real credentials in this preview.</p>`;
    if (tab === 'flags') return html + table(['Flag', 'Enabled', 'Rollout', ''], [[mono('collaborative-packing'), draft('flag-packing', 'enabled', 'Yes'), draft('flag-packing', 'rollout', '100') + '%', button('Edit', 'flag', 'packing')], [mono('ai-trip-suggestions'), draft('flag-ai', 'enabled', 'Yes'), draft('flag-ai', 'rollout', '10') + '%', button('Edit', 'flag', 'ai')]], 'Sample feature flags') + `<div class="bff-toolbar">${button('Create flag', 'flag', 'new')}</div>`;
    return html + `<dl class="bff-detail-list"><div><dt>Project name</dt><dd>${escape(draft('project', 'name', 'Trailhead'))}</dd></div><div><dt>Project ID</dt><dd><code>prj_trailhead_7f3a</code></dd></div><div><dt>Environment</dt><dd>${environment === 'production' ? 'Production' : 'Staging'} · Separate sample data</dd></div><div><dt>API URL</dt><dd><code>${projectURL()}</code></dd></div><div><dt>Custom domain</dt><dd>${escape(draft('domain', 'hostname', 'api.trailhead.example.com'))} · ${badge('Sample verified')}</dd></div><div><dt>Created</dt><dd>October 2, 2026</dd></div></dl><div class="bff-toolbar">${button('Edit project', 'edit-project')}${button('Custom domain', 'domain')}${button('Environment settings', 'environment-settings')}</div><section class="bff-section"><h3>Rate limits & bot protection</h3><p class="bff-muted">${escape(draft('rate-limits', 'rate', '120'))} requests per minute per user · Turnstile on sign-up</p>${button('Configure', 'rate-limits')}</section><section class="bff-section"><h3>Export & project lifecycle</h3><div class="bff-toolbar">${button('Export sample project', 'export-project')}${button('Pause project', 'pause-project')}${button('Delete project', 'delete-project')}</div></section>`;
  }

  const renderers: Record<string, () => string> = { overview, database, sql: sqlEditor, auth: authentication, permissions, storage, functions, realtime, automations, notifications, search: searchAI, payments, logs, usage, templates, settings };

  function projectURL() { return `https://trailhead${environment === 'staging' ? '-staging' : ''}.bff.example.com`; }

  function render(focus = false) {
    if (!authenticated) return;
    const focused = document.activeElement instanceof HTMLElement && view.contains(document.activeElement) ? document.activeElement : null;
    nav.innerHTML = `<label class="bff-mobile-nav" for="bff-section-select">Workspace</label><select class="bff-mobile-nav" id="bff-section-select">${navigation.map(group => `${group.label ? `<optgroup label="${group.label}">` : ''}${group.items.map(([id, label]) => `<option value="${id}" ${section === id ? 'selected' : ''}>${escape(label)}</option>`).join('')}${group.label ? '</optgroup>' : ''}`).join('')}</select>` + navigation.map(group => `<div class="bff-nav-group">${group.label ? `<p>${group.label}</p>` : ''}${group.items.map(([id, label]) => `<a href="#${id}" ${section === id ? 'aria-current="page"' : ''}>${escape(label)}</a>`).join('')}</div>`).join('');
    view.innerHTML = renderers[section]();
    el('bff-project-name').textContent = draft('project', 'name', 'Trailhead');
    el('bff-project-description').textContent = draft('project', 'description', 'Collaborative trip planning');
    if (focus) el('bff-view-title').focus();
    else if (focused?.id) el(focused.id)?.focus({ preventScroll: true });
    else if (focused?.dataset.action) Array.from(view.querySelectorAll<HTMLElement>('[data-action]')).find(item => item.dataset.action === focused.dataset.action && item.dataset.value === focused.dataset.value)?.focus({ preventScroll: true });
  }

  function openDialog(title: string, body: string) {
    el('bff-dialog-title').textContent = title;
    dialogBody.innerHTML = body;
    if (!dialog.open) dialog.showModal();
  }

  function editor(config: Editor) {
    activeEditor = config;
    const fields = config.fields.map(field => {
      const id = `bff-field-${field.name}`;
      const attributes = `id="${escape(id)}" name="${escape(field.name)}" ${field.required === false ? '' : 'required'} ${field.hint ? `aria-describedby="${id}-hint"` : ''}`;
      const value = field.value ?? '';
      let input = field.options ? `<select ${attributes}>${field.options.map(option => `<option ${option === value ? 'selected' : ''}>${escape(option)}</option>`).join('')}</select>` : field.type === 'textarea' ? `<textarea ${attributes} rows="5">${escape(value)}</textarea>` : `<input ${attributes} type="${field.type || 'text'}" value="${escape(value)}" ${field.type === 'number' ? 'min="0" max="1000000"' : 'maxlength="2000"'} />`;
      return `<div class="bff-field"><label for="${id}">${escape(field.label)}</label>${input}${field.hint ? `<p id="${id}-hint" class="bff-muted">${escape(field.hint)}</p>` : ''}</div>`;
    }).join('');
    openDialog(config.title, `<form id="bff-editor-form">${config.note ? `<p class="bff-dialog-note">${escape(config.note)}</p>` : ''}${fields}<p id="bff-editor-error" class="dashboard-error" role="alert" hidden></p><div class="bff-toolbar"><button type="submit" class="button button-small">${escape(config.submit || 'Save in preview')}</button>${button('Cancel', 'close-dialog')}</div></form>`);
  }

  function settingsEditor(key: string, title: string, fields: EditorField[], note?: string) {
    editor({ title, fields: fields.map(field => ({ ...field, value: draft(key, field.name, field.value || '') })), note, save(values) { saveDraft(key, values); announce(`${title} saved in this preview.`); } });
  }

  function inspect(title: string, data: unknown, note = 'Sample data only.') {
    activeEditor = null;
    openDialog(title, `<p class="bff-dialog-note">${escape(note)}</p><pre class="bff-code-output">${escape(typeof data === 'string' ? data : JSON.stringify(data, null, 2))}</pre>`);
  }

  function connection() {
    inspect('Connect to your project', `// Illustrative SDK API; package is not published.\nimport { createClient } from "@mainbrella/bff";\n\nconst app = createClient(\n  "${projectURL()}",\n  "bff_pk_sample_trailhead_not_a_real_key"\n);\n\nconst trips = await app.db("trips")\n  .select("id, title, destination")\n  .eq("status", "published");`, 'Sample endpoint and key. This code illustrates the proposed client API.');
  }

  function editRow(id?: string) {
    const selected = tables().find(item => item.name === selectedTable)!;
    const row = selected.rows.find(item => item.id === id);
    editor({ title: row ? `Edit ${selectedTable} row` : `Insert into ${selectedTable}`, fields: selected.columns.map(name => ({ name, label: name, value: row?.[name] || (name === 'id' ? `sample_${selected.count + 1}` : ''), required: name === 'id', ...(name === 'status' ? { options: ['draft', 'published', 'completed'] } : {}) })), save(values) {
      if (selected.rows.some(item => item !== row && item.id === values.id)) throw new Error('A row with this ID already exists. Choose a unique ID.');
      if (row) Object.assign(row, values);
      else { selected.rows.unshift(values); selected.count++; }
      announce('Sample row saved.');
    } });
  }

  function download(filename: string, text: string, type = 'application/json') {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    announce('Sample export downloaded.');
  }

  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); announce('Copied to clipboard.'); }
    catch { inspect('Copy manually', value, 'Clipboard access is unavailable. Select and copy this value.'); }
  }

  function action(name: string, value: string) {
    const selected = () => tables().find(item => item.name === selectedTable)!;
    switch (name) {
      case 'close-dialog': dialog.close(); return;
      case 'connect': connection(); return;
      case 'projects': openDialog('Projects', `<div class="bff-project-list"><strong>${escape(draft('project', 'name', 'Trailhead'))}</strong><p class="bff-muted">Collaborative trip planning · 2 environments</p><div class="bff-toolbar">${button('Production', 'select-environment', 'production')}${button('Staging', 'select-environment', 'staging')}</div></div><div class="bff-toolbar">${button('New project', 'create-project')}</div>`); return;
      case 'select-environment': dialog.close(); selectEnvironment(value as Environment); return;
      case 'tab': tab = value; search = ''; render(); return;
      case 'copy-url': void copy(projectURL()); return;
      case 'copy-key': void copy('bff_pk_sample_trailhead_not_a_real_key'); return;
      case 'reveal-key': inspect('Sample service-role key', 'bff_sk_sample_trailhead_not_a_real_key', 'Server use only. A real service-role key bypasses user permissions. This sample grants no access.'); return;
      case 'edit-row': editRow(value); return;
      case 'insert-row': editRow(); return;
      case 'new-table': editor({ title: 'Create table', fields: [{ name: 'name', label: 'Table name', hint: 'Lowercase letters, numbers, and underscores. Start with a letter.' }], note: 'The sample table starts with an id column.', save(values) {
        if (!/^[a-z][a-z0-9_]{0,62}$/.test(values.name)) throw new Error('Use a lowercase table name starting with a letter.');
        if (tables().some(item => item.name === values.name)) throw new Error('A table with this name already exists.');
        tables().push({ name: values.name, count: 0, columns: ['id'], rows: [] }); selectedTable = values.name; tab = 'rows'; announce('Sample table created.');
      } }); return;
      case 'add-column': editor({ title: 'Add column', fields: [{ name: 'name', label: 'Column name' }, { name: 'type', label: 'Type', options: ['TEXT', 'INTEGER', 'REAL', 'BLOB'] }], save(values) {
        if (!/^[a-z][a-z0-9_]{0,62}$/.test(values.name) || selected().columns.includes(values.name)) throw new Error('Choose a unique lowercase column name.');
        selected().columns.push(values.name); announce('Sample column added.');
      } }); return;
      case 'export': download(`${selectedTable}-sample.json`, JSON.stringify(selected().rows, null, 2)); return;
      case 'export-project': download('trailhead-sample-project.json', JSON.stringify({ sample: true, environment, tables: tables(), functions: { [selectedFunction]: source } }, null, 2)); return;
      case 'export-logs': download('trailhead-sample-logs.json', JSON.stringify(sampleLogs, null, 2)); return;
      case 'usage-report': download('trailhead-sample-usage.json', JSON.stringify({ sample: true, period: usagePeriod, estimatedCost: usagePeriod === 'day' ? 0.74 : 8.42 }, null, 2)); return;
      case 'run-sql': sqlResults = true; render(); return;
      case 'save-query': settingsEditor('query', 'Save query', [{ name: 'name', label: 'Query name', value: 'Upcoming trips' }, { name: 'sql', label: 'SQL', value: sql, type: 'textarea' }], 'Saved in memory for this preview only.'); return;
      case 'load-query': sql = value === 'custom' ? draft('query', 'sql', sql) : value === 'upcoming' ? "SELECT * FROM trips WHERE starts_at >= '2026-10-16' LIMIT 6;" : value === 'members' ? 'SELECT trip_id, COUNT(*) AS members\nFROM trip_members GROUP BY trip_id;' : 'SELECT date(created_at), COUNT(*)\nFROM profiles GROUP BY date(created_at);'; sqlResults = false; render(); return;
      case 'sql-examples': inspect('Query examples', "-- Upcoming trips\nSELECT * FROM trips WHERE status = 'published';\n\n-- Members per trip\nSELECT trip_id, COUNT(*) FROM trip_members\nGROUP BY trip_id;"); return;
      case 'import-csv': case 'import-schema': editor({ title: name === 'import-csv' ? 'Import CSV' : 'Import schema', fields: [{ name: 'source', label: name === 'import-csv' ? 'CSV content' : 'SQLite schema', type: 'textarea', value: name === 'import-csv' ? 'id,title,status\ntrip_039,Lost Coast weekend,draft' : 'CREATE TABLE packing_items (id TEXT PRIMARY KEY, trip_id TEXT, name TEXT);' }], submit: 'Review import', note: 'Preview the import step. No data is imported or SQL executed.', save(values) { inspect('Import review', values.source, 'Source received for preview. A real import would validate and apply this content.'); } }); return;
      case 'migration': inspect('Migration SQL', value === '012' ? "ALTER TABLE trips ADD COLUMN visibility TEXT NOT NULL DEFAULT 'members';\nCREATE INDEX idx_trips_visibility ON trips(visibility);" : value === '011' ? 'CREATE INDEX idx_trip_members_trip_id ON trip_members(trip_id);' : 'CREATE TABLE invitations (id TEXT PRIMARY KEY, trip_id TEXT, email TEXT, status TEXT, expires_at TEXT);'); return;
      case 'new-migration': settingsEditor('migration', 'Create migration', [{ name: 'name', label: 'Migration name', value: '013_add_packing_items' }, { name: 'sql', label: 'SQL', type: 'textarea', value: 'CREATE TABLE packing_items (id TEXT PRIMARY KEY, name TEXT);' }], 'Draft only. SQL will not be applied.'); return;
      case 'indexes': inspect(`${selectedTable} indexes`, [{ name: `sqlite_autoindex_${selectedTable}_1`, columns: ['id'], unique: true }, { name: `idx_${selectedTable}_lookup`, columns: [selected().columns[1]], unique: false }]); return;
      case 'relationships': inspect('Database relationships', { 'trips.organizer_id': 'profiles.id', 'trip_members.trip_id': 'trips.id', 'trip_members.user_id': 'profiles.id', 'messages.trip_id': 'trips.id', 'messages.user_id': 'profiles.id' }); return;
      case 'restore': editor({ title: 'Restore database', fields: [{ name: 'confirmation', label: 'Type Trailhead to review this restore' }], submit: 'Review restore', note: `Restore point: ${value}, 03:00 UTC. A real restore would replace current database data.`, save(values) { if (values.confirmation !== 'Trailhead') throw new Error('Enter Trailhead to continue.'); inspect('Restore review', { project: 'Trailhead', environment, restorePoint: value, status: 'Preview only; no data changed' }); } }); return;
      case 'backup-settings': settingsEditor('backups', 'Recovery settings', [{ name: 'schedule', label: 'Export schedule', value: 'Daily at 03:00 UTC' }, { name: 'retention', label: 'Retention', options: ['7 days', '14 days', '30 days'], value: '30 days' }]); return;
      case 'invite-user': editor({ title: 'Invite application user', fields: [{ name: 'name', label: 'Name' }, { name: 'email', label: 'Email', type: 'email' }], submit: 'Add sample invitation', note: 'No invitation email will be sent.', save(values) { invitedUsers[environment].push({ ...values, id: `invited_${invitedUsers[environment].length}`, status: 'Invited' }); announce('Sample user invitation added. No email sent.'); } }); return;
      case 'manage-user': { const user = [...tables().find(item => item.name === 'profiles')!.rows, ...invitedUsers[environment]].find(item => item.id === value)!; editor({ title: `Manage ${user.name}`, fields: [{ name: 'name', label: 'Name', value: user.name }, { name: 'role', label: 'Role', options: ['member', 'organizer', 'admin'], value: user.role || 'member' }, { name: 'status', label: 'Account status', options: ['Verified', 'Suspended', 'Invited'], value: user.status || 'Verified' }], save(values) { Object.assign(user, values); announce('Sample user updated.'); } }); return; }
      case 'provider': settingsEditor(`provider-${value}`, `${value[0].toUpperCase() + value.slice(1)} sign-in`, [{ name: 'status', label: 'Status', options: ['Enabled', 'Disabled'], value: value === 'passkeys' || value === 'anonymous' ? 'Disabled' : 'Enabled' }, { name: 'client', label: 'Sample client ID', value: `sample-${value}-client`, required: false }], 'Configuration preview. Do not enter real OAuth credentials.'); return;
      case 'auth-settings': settingsEditor('auth-settings', 'Authentication settings', [{ name: 'url', label: 'Site URL', type: 'url', value: 'https://trailhead.example.com' }, { name: 'lifetime', label: 'Session lifetime', options: ['1 day', '7 days', '30 days'], value: '7 days' }, { name: 'mfa', label: 'Multi-factor authentication', options: ['Optional · TOTP', 'Required · TOTP', 'Disabled'], value: 'Optional · TOTP' }, { name: 'redirects', label: 'Allowed redirect URLs', type: 'textarea', value: 'https://trailhead.example.com/auth/callback\ntrailhead://auth/callback' }]); return;
      case 'session': inspect(`${value} session`, { user: value, session: 'sess_sample_7e21', created: '2026-10-15T18:20:00Z', expires: '2026-10-22T18:20:00Z', mfa: true }); return;
      case 'policy': case 'new-policy': settingsEditor(`policy-${value || 'new'}`, name === 'new-policy' ? 'Create row policy' : 'Edit row policy', [{ name: 'resource', label: 'Resource', value: value || 'trips' }, { name: 'operation', label: 'Operation', options: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'], value: 'SELECT' }, { name: 'rule', label: 'Rule expression', type: 'textarea', value: "row.status === 'published' || row.organizer_id === auth.user.id" }, { name: 'status', label: 'Status', options: ['Enforced', 'Disabled'], value: 'Enforced' }], 'Illustrative policy syntax. This rule is not evaluated.'); return;
      case 'test-policy': editor({ title: 'Policy simulator', fields: [{ name: 'user', label: 'User', options: ['usr_ava', 'usr_maya', 'anonymous'] }, { name: 'operation', label: 'Operation', options: ['SELECT', 'DELETE'] }], submit: 'Preview decision', save(values) { const allowed = values.operation === 'SELECT' || values.user === 'usr_maya'; inspect('Sample policy decision', { ...values, resource: 'trips/trip_038', result: allowed ? 'Allowed' : 'Denied', reason: values.operation === 'SELECT' ? 'Published trip is readable' : allowed ? 'User is the trip organizer' : 'Only the trip organizer can delete this row' }, 'Fixed sample scenario for the published Point Reyes trip.'); } }); return;
      case 'bucket': selectedBucket = value; render(); return;
      case 'new-bucket': settingsEditor('new-bucket', 'Create bucket', [{ name: 'name', label: 'Bucket name', value: 'trip-documents' }, { name: 'access', label: 'Access', options: ['Private', 'Public'] }, { name: 'limit', label: 'Maximum file size (MB)', type: 'number', value: '25' }], 'Bucket configuration draft; no storage is provisioned.'); return;
      case 'bucket-settings': settingsEditor(`bucket-${selectedBucket}`, `${selectedBucket} settings`, [{ name: 'access', label: 'Access', options: ['Private', 'Public'], value: selectedBucket === 'avatars' ? 'Public' : 'Private' }, { name: 'limit', label: 'Maximum file size (MB)', type: 'number', value: '25' }, { name: 'types', label: 'Allowed file types', value: 'image/*, video/mp4, application/pdf, application/gpx+xml' }, { name: 'image', label: 'Image transformations', options: ['Enabled', 'Disabled'], value: 'Enabled' }]); return;
      case 'upload-file': editor({ title: `Upload to ${selectedBucket}`, fields: [{ name: 'name', label: 'File', type: 'file' }], submit: 'Add sample file', note: 'Only the filename is used. No file contents are read or uploaded.', save(values) { const name = values.name.split(/[\\/]/).pop()!; localFiles[environment].push({ bucket: selectedBucket, name, type: 'Sample upload', size: '—', owner: 'You' }); announce('Sample file added. Nothing uploaded.'); } }); return;
      case 'file': inspect('File details', { bucket: selectedBucket, path: value, access: selectedBucket === 'avatars' ? 'Public' : 'Signed URL required', contentType: value.endsWith('.mp4') ? 'video/mp4' : value.endsWith('.gpx') ? 'application/gpx+xml' : 'image/webp', cacheControl: 'max-age=3600', uploadedAt: '2026-10-16T10:39:54Z', signedUrl: `${projectURL()}/storage/${selectedBucket}/${value}?token=sample_not_valid` }); return;
      case 'function': selectedFunction = value; source = draft(`function-${value}`, 'source', value === 'join-trip' ? functionSource : `export default async function handler(input, ctx) {\n  // ${value} · illustrative function source\n  const user = ctx.auth.requireUser();\n  return { ok: true, userId: user.id };\n}`); functionResult = false; render(); return;
      case 'test-function': functionResult = true; render(); return;
      case 'save-function': saveDraft(`function-${selectedFunction}`, { status: 'Draft saved in preview', source }); announce('Function draft saved locally. No code executed.'); render(); return;
      case 'new-function': settingsEditor('new-function', 'Create function', [{ name: 'name', label: 'Function name', value: 'publish-trip' }, { name: 'trigger', label: 'Trigger', options: ['Authenticated RPC', 'HTTP endpoint', 'Database change', 'Storage upload', 'Schedule'] }, { name: 'source', label: 'TypeScript source', type: 'textarea', value: 'export default async function handler(input, ctx) {\n  return { ok: true };\n}' }], 'Function draft only; no runtime is created.'); return;
      case 'secrets': section = 'settings'; tab = 'secrets'; location.hash = 'settings'; render(true); return;
      case 'channel': case 'object': inspect(name === 'object' ? 'Live object inspector' : 'Channel inspector', { id: value, class: 'TripRoom', connections: value === 'trip_038' ? 8 : 6, presence: [{ user: 'usr_maya', status: 'online' }, { user: 'usr_ava', status: 'typing' }], state: { tripId: value, messages: 164, updatedAt: '2026-10-16T10:42:18Z' }, authorization: 'Trip members only' }); return;
      case 'new-object': settingsEditor('object-class', 'New live object class', [{ name: 'name', label: 'Class name', value: 'PackingList' }, { name: 'source', label: 'JavaScript source', type: 'textarea', value: 'export class PackingList extends LiveObject {\n  async addItem(name) { /* ... */ }\n}' }], 'Illustrative API. No class is executed.'); return;
      case 'realtime-settings': settingsEditor('realtime', 'Subscription settings', [{ name: 'tables', label: 'Enabled tables', value: 'trips, messages, trip_members' }, { name: 'presence', label: 'Presence', options: ['Enabled', 'Disabled'] }, { name: 'auth', label: 'Channel authorization', value: 'Trip membership required' }]); return;
      case 'new-automation': settingsEditor('automation', 'Create automation', [{ name: 'name', label: 'Name', value: 'notify-trip-members' }, { name: 'trigger', label: 'Trigger', options: ['Database change', 'Schedule', 'Webhook', 'Manual'] }, { name: 'function', label: 'Function', value: 'send-invitation' }, { name: 'retries', label: 'Maximum attempts', type: 'number', value: '3' }]); return;
      case 'workflow': inspect('trip-reminder · run_0184', { status: 'Waiting', started: '2026-10-15T10:30:00Z', steps: [{ name: 'load-trip', status: 'Completed' }, { name: 'wait-until-24h-before', status: 'Waiting', resumeAt: '2026-10-23T08:00:00Z' }, { name: 'send-reminder', status: 'Pending' }] }); return;
      case 'schedule': settingsEditor(`schedule-${value}`, 'Edit schedule', [{ name: 'cron', label: 'Cron expression · UTC', value: value === 'digest' ? '0 8 * * *' : '0 */6 * * *' }, { name: 'status', label: 'Status', options: ['Enabled', 'Disabled'] }]); return;
      case 'queue': settingsEditor(`queue-${value}`, `${value} queue`, [{ name: 'retries', label: 'Maximum attempts', type: 'number', value: '3' }, { name: 'delay', label: 'Retry delay (seconds)', type: 'number', value: '60' }, { name: 'deadletter', label: 'Dead-letter queue', value: `${value}-failed` }]); return;
      case 'job': case 'completed-job': inspect('Job details', { id: 'job_sample_0184', function: name === 'job' ? 'send-trip-reminder' : 'generate-thumbnail', status: name === 'job' ? 'Retrying' : 'Completed', input: { tripId: 'trip_038' }, attempts: name === 'job' ? 2 : 1, lastError: name === 'job' ? 'Email provider timeout; next retry in 60 seconds' : null }); return;
      case 'webhook': settingsEditor('webhook', 'Outgoing webhook', [{ name: 'url', label: 'Endpoint URL', type: 'url', value: 'https://trailhead.example.com/hooks/bff' }, { name: 'events', label: 'Events', value: 'trip.created, member.joined' }, { name: 'signature', label: 'Signing', options: ['HMAC-SHA256'] }], 'Delivery configuration only. No HTTP request will be sent.'); return;
      case 'webhook-payload': inspect('Webhook payload', { id: 'evt_0192', type: 'member.joined', createdAt: '2026-10-16T10:42:18Z', data: { tripId: 'trip_038', userId: 'usr_ava' } }); return;
      case 'email-template': case 'new-template': settingsEditor(`email-${value || 'new'}`, value || 'New notification template', [{ name: 'name', label: 'Template name', value: value || 'trip-update' }, { name: 'subject', label: 'Subject', value: value === 'welcome' ? 'Welcome to Trailhead, {{name}}' : 'You’re invited to {{trip.title}}' }, { name: 'body', label: 'Message', type: 'textarea', value: 'Hi {{name}},\n\n{{organizer.name}} invited you to {{trip.title}}.\nJoin your group and start planning.\n\nSee you outside,\nThe Trailhead team' }], 'Template draft. No notification will be sent.'); return;
      case 'notification-settings': settingsEditor('notification-settings', 'Delivery settings', [{ name: 'sender', label: 'Email sender', value: 'Trailhead <hello@trailhead.example.com>' }, { name: 'reply', label: 'Reply-to', type: 'email', value: 'support@trailhead.example.com' }, { name: 'push', label: 'Push notifications', options: ['Enabled', 'Disabled'] }]); return;
      case 'new-index': case 'search-index': settingsEditor(`index-${value || 'new'}`, value || 'Create search index', [{ name: 'name', label: 'Index name', value: value || 'trip_guides' }, { name: 'type', label: 'Index type', options: ['Full-text', 'Vector'], value: value === 'trail_guides' ? 'Vector' : 'Full-text' }, { name: 'source', label: 'Source', value: 'trips.title, trips.destination' }], 'Index definition only; no data is indexed.'); return;
      case 'model-settings': settingsEditor('model', 'Model settings', [{ name: 'generation', label: 'Text generation model', value: '@cf/meta/llama-3.1-8b-instruct' }, { name: 'embedding', label: 'Embedding model', value: '@cf/baai/bge-base-en-v1.5' }, { name: 'quota', label: 'Daily token limit per user', type: 'number', value: '10000' }]); return;
      case 'payment-settings': settingsEditor('payments', 'Stripe integration', [{ name: 'mode', label: 'Mode', options: ['Test mode', 'Live mode'] }, { name: 'secret', label: 'Secret reference', value: 'STRIPE_SECRET_KEY' }, { name: 'webhook', label: 'Webhook function', value: 'stripe-webhook' }], 'Sample configuration. No Stripe account is connected.'); return;
      case 'log': inspect('Request details', { requestId: 'req_sample_a82f', environment, path: value, user: value.includes('reminder') ? 'system' : 'usr_ava', region: 'SJC', durationMs: value.includes('reminder') ? 2041 : 42, message: value.includes('reminder') ? 'Email provider timeout. Retry scheduled.' : 'Sample request completed.' }); return;
      case 'spend': settingsEditor('spend', 'Spending controls', [{ name: 'limit', label: 'Monthly spending limit (USD)', type: 'number', value: '25' }, { name: 'alert', label: 'Alert threshold (%)', type: 'number', value: '80' }, { name: 'overage', label: 'At limit', options: ['Pause billable operations', 'Continue with overages'] }], 'Illustrative controls. This preview does not change account billing.'); return;
      case 'module': inspect(`${value} module`, { template: value, version: '1.2', resources: { tables: ['profiles', 'organizations', 'memberships', 'invitations'], policies: 8, functions: ['invite-member', 'accept-invitation'], clientExamples: ['Web', 'iOS', 'Android'] }, conflicts: 'Existing profiles table would be reused', status: 'Review only; nothing installed' }); return;
      case 'edit-project': settingsEditor('project', 'Project details', [{ name: 'name', label: 'Project name', value: 'Trailhead' }, { name: 'description', label: 'Description', value: 'Collaborative trip planning' }]); return;
      case 'domain': settingsEditor('domain', 'Custom domain', [{ name: 'hostname', label: 'Hostname', value: 'api.trailhead.example.com' }], 'DNS preview: CNAME your hostname to trailhead.bff.example.com. No domain is registered or verified.'); return;
      case 'environment-settings': inspect('Project environments', { production: { project: 'Trailhead', isolatedDatabase: true, endpoint: 'https://trailhead.bff.example.com' }, staging: { isolatedDatabase: true, endpoint: 'https://trailhead-staging.bff.example.com' } }, 'Switch environments in the project toolbar to browse separate sample datasets.'); return;
      case 'rate-limits': settingsEditor('rate-limits', 'Rate limits & bot protection', [{ name: 'rate', label: 'Requests per minute per user', type: 'number', value: '120' }, { name: 'turnstile', label: 'Turnstile protection', options: ['Sign-up only', 'All unauthenticated writes', 'Disabled'] }]); return;
      case 'invite-team': settingsEditor('team-invite', 'Invite team member', [{ name: 'email', label: 'Email', type: 'email' }, { name: 'role', label: 'Role', options: ['Viewer', 'Developer', 'Admin'] }, { name: 'environment', label: 'Access', options: ['All environments', 'Staging only'] }], 'Invitation draft. No email will be sent.'); return;
      case 'team-member': settingsEditor(`team-${value}`, value, [{ name: 'role', label: 'Role', options: ['Owner', 'Admin', 'Developer', 'Viewer'], value: value === 'Maya Chen' ? 'Owner' : 'Developer' }, { name: 'access', label: 'Environment access', options: ['All environments', 'Staging only'] }]); return;
      case 'org-settings': settingsEditor('org', 'Application organizations', [{ name: 'creation', label: 'Who can create an organization', options: ['Any authenticated user', 'Admins only'] }, { name: 'roles', label: 'Available roles', value: 'owner, admin, member' }]); return;
      case 'secret': settingsEditor(`secret-${value || 'new'}`, value ? 'Edit secret' : 'Add secret', [{ name: 'name', label: 'Secret name', value }, { name: 'value', label: 'Sample value', type: 'password', value: 'sample_value_not_real' }], 'Use placeholder values only. This form is an in-memory preview.'); return;
      case 'new-key': settingsEditor('key', 'Create scoped API key', [{ name: 'name', label: 'Key name', value: 'CI migrations' }, { name: 'scope', label: 'Scope', options: ['Database admin', 'Read only', 'Storage only', 'Functions only'] }, { name: 'expires', label: 'Expires', options: ['30 days', '90 days', '1 year'] }], 'Key configuration preview. No credential will be issued.'); return;
      case 'rotate-key': editor({ title: 'Rotate service key', fields: [{ name: 'confirmation', label: 'Type ROTATE to review' }], submit: 'Review rotation', note: 'A real rotation invalidates the old service key. Update your server integrations first.', save(values) { if (values.confirmation !== 'ROTATE') throw new Error('Enter ROTATE to continue.'); inspect('Key rotation review', { status: 'Preview only', newKey: 'bff_sk_sample_rotated_not_real', oldKeyRevoked: false }); } }); return;
      case 'flag': settingsEditor(`flag-${value}`, 'Feature flag', [{ name: 'name', label: 'Flag name', value: value === 'packing' ? 'collaborative-packing' : value === 'ai' ? 'ai-trip-suggestions' : 'new-feature' }, { name: 'enabled', label: 'Enabled', options: ['Yes', 'No'] }, { name: 'rollout', label: 'Rollout percentage', type: 'number', value: value === 'ai' ? '10' : '100' }]); return;
      case 'create-project': editor({ title: 'Create project', fields: [{ name: 'name', label: 'Project name', value: 'My next app' }, { name: 'template', label: 'Starting template', options: ['Empty project', 'Community', 'SaaS', 'Multiplayer', 'AI application'] }], submit: 'Review project', note: 'Project creation preview. No infrastructure will be provisioned.', save(values) { inspect('New project review', { ...values, database: 'Isolated SQLite database', storage: 'Private project bucket', authentication: 'Email enabled by default', environment: 'Production', status: 'Preview only; project not created' }); } }); return;
      case 'pause-project': case 'delete-project': editor({ title: name === 'pause-project' ? 'Pause project' : 'Delete project', fields: [{ name: 'confirmation', label: 'Type Trailhead to review' }], submit: 'Review action', note: name === 'delete-project' ? 'A real deletion permanently removes project data and services.' : 'A real pause makes your app backend unavailable.', save(values) { if (values.confirmation !== 'Trailhead') throw new Error('Enter Trailhead to continue.'); inspect('Project action review', { action: name, project: 'Trailhead', environment, status: 'Preview only; project unchanged' }); } }); return;
    }
  }

  document.addEventListener('click', event => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
    if (!target || !authenticated) return;
    action(target.dataset.action!, target.dataset.value || '');
  });
  document.addEventListener('submit', event => {
    const form = event.target as HTMLFormElement;
    if (!authenticated) return;
    if (form.getAttribute('id') === 'bff-search-form') {
      event.preventDefault();
      searchQuery = String(new FormData(form).get('query') || '');
      searchComplete = true;
      render();
    }
    // A row's `name="id"` input shadows the form.id DOM property.
    if (form.getAttribute('id') !== 'bff-editor-form' || !activeEditor) return;
    event.preventDefault();
    const values: Row = {};
    for (const [name, value] of new FormData(form)) values[name] = typeof value === 'string' ? value.trim() : value.name;
    const previous = activeEditor;
    try {
      previous.save(values);
      if (activeEditor === previous) { dialog.close(); activeEditor = null; }
      render();
    } catch (caught) {
      const message = el('bff-editor-error');
      message.textContent = caught instanceof Error ? caught.message : 'Could not save this preview. Please try again.';
      message.hidden = false;
    }
  });
  view.addEventListener('input', event => {
    const target = event.target as HTMLInputElement;
    if (target.id === 'bff-sql') { sql = target.value; sqlResults = false; return; }
    if (target.id === 'bff-function-source') { source = target.value; functionResult = false; return; }
    if (!['bff-row-search', 'bff-user-search', 'bff-log-search'].includes(target.id)) return;
    const position = target.selectionStart;
    search = target.value;
    render();
    const next = el<HTMLInputElement>(target.id);
    next.focus();
    if (position !== null) next.setSelectionRange(position, position);
  });
  view.addEventListener('change', event => {
    const target = event.target as HTMLSelectElement;
    if (target.id === 'bff-table-select') { selectedTable = target.value; search = ''; }
    else if (target.id === 'bff-log-level') logLevel = target.value;
    else if (target.id === 'bff-usage-period') usagePeriod = target.value;
    else return;
    render();
  });
  nav.addEventListener('change', event => {
    const target = event.target as HTMLSelectElement;
    if (target.id === 'bff-section-select') location.hash = target.value;
  });
  function selectEnvironment(next: Environment) {
    environment = next;
    el<HTMLSelectElement>('bff-environment').value = next;
    search = ''; sqlResults = false; functionResult = false;
    selectedFunction = 'join-trip';
    source = draft('function-join-trip', 'source', functionSource);
    render(); announce(`Switched to ${environment} sample data.`);
  }
  el('bff-environment').addEventListener('change', event => {
    selectEnvironment((event.target as HTMLSelectElement).value as Environment);
  });
  function navigate(focus = false) {
    const requested = location.hash.slice(1);
    const next = Object.hasOwn(renderers, requested) ? requested : 'overview';
    if (next !== section) { section = next; tab = ''; search = ''; }
    render(focus);
  }
  window.addEventListener('hashchange', () => navigate(true));
  dialog.addEventListener('click', event => {
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    }
  });

  function hideWorkspace() {
    authenticated = false;
    content.hidden = true;
    dialog.close();
    view.replaceChildren();
    feedback.textContent = '';
    clearTimeout(feedbackTimer);
  }

  async function load() {
    const version = ++sessionVersion;
    main.setAttribute('aria-busy', 'true');
    error.hidden = true; retry.hidden = true; signIn.hidden = true; loading.hidden = false;
    try {
      const session = await readSession();
      if (version !== sessionVersion) return;
      if (!session?.user) { hideWorkspace(); signIn.hidden = false; return; }
      userId = session.user.id;
      authenticated = true;
      content.hidden = false;
      navigate();
    } catch {
      if (version !== sessionVersion) return;
      hideWorkspace();
      error.textContent = 'Could not check your session. Check your connection and try again.';
      error.hidden = false; retry.hidden = false;
    } finally {
      if (version === sessionVersion) { main.setAttribute('aria-busy', 'false'); loading.hidden = true; }
    }
  }
  retry.addEventListener('click', () => { void load(); });
  window.addEventListener('auth-change', event => {
    const user = (event as CustomEvent<{ user: { id?: string } | null }>).detail?.user;
    if (user && (!authenticated || user.id === userId)) return;
    sessionVersion++;
    hideWorkspace();
    if (user) window.location.reload();
    else { loading.hidden = true; signIn.hidden = false; main.setAttribute('aria-busy', 'false'); }
  });
  void load();
}
