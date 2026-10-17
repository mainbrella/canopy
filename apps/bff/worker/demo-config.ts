// This deliberately public demo is isolated from all other BFF projects.
export const demoConfig = {
  apiOrigin: 'https://api.mainbrella.com',
  projectId: '90da3093-84b6-4cd7-a39a-a8afc39403b8',
  publicKey: 'bff_pk_1f9bb9fd543d6a5476ad7ce210577c2479d290a5cdc06282de9eb884d57005c4',
  table: 'messages',
} as const;

export const demoUsers = ['alice', 'bob'] as const;
export type DemoUser = typeof demoUsers[number];
