import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations')
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            PUBLIC_URL: 'https://couchwarp.test',
            DISCORD_CLIENT_ID: 'discord-client',
            DISCORD_CLIENT_SECRET: 'discord-secret',
            // Off whatever .dev.vars holds, so tests never depend on local secrets.
            GOOGLE_CLIENT_ID: '',
            GOOGLE_CLIENT_SECRET: '',
            PUBLIC_ROOMS: 'on',
            ADMIN_USER_IDS: 'admin-1',
          },
        },
      }),
    ],
    test: { setupFiles: ['./test/apply-migrations.ts'] },
  }
})
