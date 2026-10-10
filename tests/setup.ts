// Deterministic fake env for unit tests. Never real secrets.
Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key-0000000000',
  NEXT_PUBLIC_APP_URL: 'https://app.example.com',
  ACTION_TOKEN_SECRET: 'test-action-token-secret-1234',
  CRON_SECRET: 'test-cron-secret-123456',
  VAANI_TOOL_SECRET: 'test-tool-secret-123456',
  VAANI_WEBHOOK_SECRET: 'test-webhook-secret-12345',
})
