export type Row = Record<string, string>;
export type SampleTable = { name: string; count: number; columns: string[]; rows: Row[] };

export const navigation = [
  { label: '', items: [['overview', 'Overview']] },
  { label: 'Build', items: [['database', 'Database'], ['sql', 'SQL editor'], ['auth', 'Authentication'], ['permissions', 'Permissions'], ['storage', 'Storage'], ['functions', 'Functions']] },
  { label: 'Run', items: [['realtime', 'Realtime & live objects'], ['automations', 'Automations'], ['notifications', 'Notifications'], ['search', 'Search & AI'], ['payments', 'Payments']] },
  { label: 'Manage', items: [['logs', 'Logs'], ['usage', 'Usage'], ['templates', 'Templates'], ['settings', 'Settings']] },
];

export function createSampleTables(staging = false): SampleTable[] {
  const trips = [
    { id: 'trip_038', title: 'Point Reyes weekend', destination: 'Point Reyes, CA', starts_at: '2026-10-24', organizer_id: 'usr_maya', status: 'published' },
    { id: 'trip_037', title: 'Sunrise at Mount Tam', destination: 'Marin County, CA', starts_at: '2026-10-18', organizer_id: 'usr_theo', status: 'published' },
    { id: 'trip_036', title: 'Big Sur coastal trail', destination: 'Big Sur, CA', starts_at: '2026-11-07', organizer_id: 'usr_maya', status: 'draft' },
    { id: 'trip_035', title: 'Desolation Wilderness overnight', destination: 'Lake Tahoe, CA', starts_at: '2026-10-31', organizer_id: 'usr_ava', status: 'published' },
    { id: 'trip_034', title: 'Redwood grove walk', destination: 'Oakland, CA', starts_at: '2026-10-11', organizer_id: 'usr_jules', status: 'completed' },
    { id: 'trip_033', title: 'A quiet weekend in Yosemite', destination: 'Yosemite, CA', starts_at: '2026-10-03', organizer_id: 'usr_theo', status: 'completed' },
  ];
  const tables: SampleTable[] = [
    { name: 'trips', count: staging ? 2 : 38, columns: Object.keys(trips[0]), rows: staging ? trips.slice(0, 2).map(row => ({ ...row, status: 'draft' })) : trips },
    { name: 'profiles', count: staging ? 3 : 1284, columns: ['id', 'name', 'email', 'role', 'last_sign_in'], rows: [
      { id: 'usr_maya', name: 'Maya Chen', email: 'maya@example.com', role: 'organizer', last_sign_in: 'Today, 10:42' },
      { id: 'usr_theo', name: 'Theo Williams', email: 'theo@example.com', role: 'organizer', last_sign_in: 'Today, 10:38' },
      { id: 'usr_ava', name: 'Ava Patel', email: 'ava@example.com', role: 'member', last_sign_in: 'Today, 10:31' },
      { id: 'usr_jules', name: 'Jules Rivera', email: 'jules@example.com', role: 'member', last_sign_in: 'Today, 09:58' },
      { id: 'usr_sam', name: 'Sam Okafor', email: 'sam@example.com', role: 'member', last_sign_in: 'Yesterday, 18:12' },
    ] },
    { name: 'trip_members', count: staging ? 4 : 246, columns: ['id', 'trip_id', 'user_id', 'role', 'joined_at'], rows: [
      { id: 'mem_246', trip_id: 'trip_038', user_id: 'usr_maya', role: 'organizer', joined_at: '2026-10-15 14:06' },
      { id: 'mem_245', trip_id: 'trip_038', user_id: 'usr_ava', role: 'member', joined_at: '2026-10-15 15:22' },
      { id: 'mem_244', trip_id: 'trip_037', user_id: 'usr_theo', role: 'organizer', joined_at: '2026-10-14 09:10' },
    ] },
    { name: 'messages', count: staging ? 8 : 8612, columns: ['id', 'trip_id', 'user_id', 'body', 'created_at'], rows: [
      { id: 'msg_8612', trip_id: 'trip_038', user_id: 'usr_ava', body: 'I can bring the extra tent. Who needs a ride?', created_at: '2026-10-16 10:42' },
      { id: 'msg_8611', trip_id: 'trip_038', user_id: 'usr_maya', body: 'Meet at the trailhead at 8. Forecast looks good!', created_at: '2026-10-16 10:40' },
      { id: 'msg_8610', trip_id: 'trip_037', user_id: 'usr_theo', body: 'Route and packing list are in the shared folder.', created_at: '2026-10-16 10:38' },
    ] },
    { name: 'trip_files', count: staging ? 2 : 412, columns: ['id', 'trip_id', 'path', 'uploaded_by', 'size_bytes'], rows: [
      { id: 'file_412', trip_id: 'trip_038', path: 'point-reyes/route.gpx', uploaded_by: 'usr_maya', size_bytes: '48210' },
      { id: 'file_411', trip_id: 'trip_038', path: 'point-reyes/campsite.jpg', uploaded_by: 'usr_ava', size_bytes: '2481092' },
      { id: 'file_410', trip_id: 'trip_037', path: 'mount-tam/packing-list.pdf', uploaded_by: 'usr_theo', size_bytes: '186412' },
    ] },
    { name: 'invitations', count: staging ? 1 : 64, columns: ['id', 'trip_id', 'email', 'status', 'expires_at'], rows: [
      { id: 'inv_064', trip_id: 'trip_038', email: 'sam@example.com', status: 'pending', expires_at: '2026-10-23' },
      { id: 'inv_063', trip_id: 'trip_037', email: 'ava@example.com', status: 'accepted', expires_at: '2026-10-21' },
    ] },
  ];
  return staging ? tables.map(table => ({ ...table, rows: table.rows.slice(0, table.count) })) : tables;
}

export const sampleLogs = [
  ['10:42:18', '200', 'POST', '/rpc/join-trip', '42 ms', 'usr_ava', 'info'],
  ['10:42:17', '200', 'GET', '/db/trips?status=published', '18 ms', 'usr_ava', 'info'],
  ['10:41:53', '200', 'POST', '/auth/token', '64 ms', 'usr_theo', 'info'],
  ['10:41:32', '403', 'DELETE', '/db/trips/trip_038', '8 ms', 'usr_sam', 'warning'],
  ['10:40:06', '500', 'POST', '/jobs/send-trip-reminder', '2,041 ms', 'system', 'error'],
  ['10:39:54', '201', 'PUT', '/storage/trip-photos/campsite.jpg', '126 ms', 'usr_ava', 'info'],
  ['10:38:11', '200', 'GET', '/realtime/trip_037', '12 ms', 'usr_theo', 'info'],
];

export const functionSource = `export default async function joinTrip({ tripId }, ctx) {
  const user = ctx.auth.requireUser();
  const trip = await ctx.db("trips").get(tripId);
  if (trip.status !== "published") {
    throw new Error("This trip is not open yet.");
  }
  return ctx.db("trip_members").insert({
    trip_id: tripId,
    user_id: user.id,
    role: "member"
  });
}`;
