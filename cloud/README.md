# Pod Cloud Worker

Deploy your own Cloudflare Worker to access Pod from anywhere.

Worker source lives in `cloud/` (own `tsconfig.json`; excluded from root `tsc`).

## Setup

```bash
# 1. Login to Cloudflare
bun x wrangler login

# 2. Install dependencies
cd cloud
bun install

# 3. Create KV & D1, then paste IDs into wrangler.toml
bun x wrangler kv namespace create KV
bun x wrangler d1 create proxy-db

# 4. Init database & deploy
bun x wrangler d1 execute proxy-db --remote --file=./migrations/0001_init.sql
bun run deploy
```

Copy your Worker URL → Pod Dashboard → **Endpoint** → **Setup Cloud** → paste → **Save** → **Enable Cloud**.

Set `CLOUD_URL` (or `NEXT_PUBLIC_CLOUD_URL`) on the Pod service to that Worker URL.
