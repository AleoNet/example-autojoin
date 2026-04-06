# example-auto-join

A library and demo app for fetching and joining Aleo records using the [Provable SDK](https://github.com/ProvableHQ/sdk). Supports `credits.aleo` and token registry programs on both testnet and mainnet.

## AutoJoin Library

The library lives in `src/aleo/` and provides two main building blocks:

- **`AleoClient`** — wraps the Provable SDK to handle network initialization, JWT auth, record scanning, and delegated proving.
- **`AutoJoinClient`** — orchestrates joining records using a pluggable `JoinStrategy`.

### JoinStrategy

A `JoinStrategy` controls how records are joined. The included `BasicAutoJoinStrategy` supports `credits.aleo`, `usad_stablecoin.aleo`, `usdcx_stablecoin.aleo`, and their testnet equivalents. You can provide your own strategy by implementing the interface:

```ts
interface JoinStrategy {
  isSupportedProgram(programName: string): boolean;
  joinRecords(records: AleoRecord[]): Promise<AleoRecord>;
}
```

### Example: Fetch and Join Records

#### 1. Initialize the client

```ts
import { AleoClient } from './src/aleo/aleoClient';
import { AutoJoinClient } from './src/aleo/autojoin/autoJoinClient';
import { BasicAutoJoinStrategy } from './src/aleo/autojoin/strategies/basicAutoJoinStrategy';

const aleoClient = new AleoClient('testnet', {
  apiKey: 'YOUR_API_KEY',
  consumerId: 'YOUR_CONSUMER_ID',
  apiRoot: 'https://api.provable.com', // optional, this is the default
});

// Must be called before any other operations
await aleoClient.initNetwork();
```

#### 2. Derive an account from a private key

```ts
const account = aleoClient.accountFromPrivateKey('APrivateKey1zkp...');
```

#### 3. Register the account for record scanning

Registers the account's view key with the record scanner. Idempotent — safe to call multiple times.

```ts
await aleoClient.registerAccountForRecordScanning(account);
```

#### 4. Fetch unspent records

```ts
const records = await aleoClient.fetchUnspentRecords(
  account,
  ['credits.aleo'],             // one or more program names to filter by
  account.address().to_string() // optional; derived from account if omitted
);

for (const record of records) {
  console.log(record.programName);   // e.g. 'credits.aleo'
  console.log(record.transactionId); // transaction that created this record
  console.log(record.amount);        // microcredits as a string, undefined if not parseable
}
```

#### 5. Join records

Reduces any number of records down to one by pairing and joining them in parallel rounds.

```ts
const autoJoinClient = new AutoJoinClient(aleoClient, account, BasicAutoJoinStrategy);

const joinedRecord = await autoJoinClient.joinRecords(records);
console.log('Final record tx:', joinedRecord.transactionId);
```

`joinRecords` validates that all records share the same program, are owned by the same address, are supported by the strategy, and each have a `transactionId`. It throws a descriptive error if any condition is not met or if on-chain confirmation times out.

#### Using a custom strategy

```ts
import type { JoinStrategy } from './src/aleo/autojoin/joinStrategy';
import type { AutoJoinClient } from './src/aleo/autojoin/autoJoinClient';
import type { AleoRecord } from './src/aleo/aleoClient';

class MyJoinStrategy implements JoinStrategy {
  constructor(private readonly client: AutoJoinClient) {}

  isSupportedProgram(programName: string): boolean {
    return programName === 'my_token.aleo';
  }

  async joinRecords(records: AleoRecord[]): Promise<AleoRecord> {
    // custom join logic
  }
}

const autoJoinClient = new AutoJoinClient(aleoClient, account, MyJoinStrategy);
```

---

## Demo Frontend

The React demo app lets you enter a private key, browse unspent records for a selected program, and trigger a join across all loaded records.

### Setup

Copy the environment template and fill in your credentials:

```sh
cp .env.example .env
```

| Variable | Description |
|---|---|
| `VITE_PROVABLE_API_KEY` | Your Provable API key |
| `VITE_PROVABLE_CONSUMER_ID` | Your Provable consumer ID |
| `VITE_PROVABLE_API_ROOT` | API root URL (optional, defaults to `https://api.provable.com`) |
| `VITE_DEFAULT_PKEY` | Pre-fills the private key input (optional, development only) |

### Commands

```sh
# Install dependencies
pnpm install

# Start the development server (http://localhost:5173)
pnpm dev

# Type-check and build for production
pnpm build

# Preview the production build locally
pnpm preview
```
