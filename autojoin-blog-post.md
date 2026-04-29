# The Change Problem: How Autojoin Makes Privacy Practical on Aleo

## The Privacy Paradox

Aleo is built on a simple, powerful idea: your transactions should be private by default. No one should be able to look at a public ledger and see exactly what you own or where you spend it. In a world where blockchain analytics firms can trace funds across dozens of hops, that matters.

But privacy comes with an unexpected side effect — one that anyone who's ever paid with cash can relate to.

When you pay for something with paper bills, you hand over what you have and get change back. A five, two singles, a couple of quarters. Pay for a few more things and your pockets fill up with coins and crumpled ones. Eventually, making any purchase becomes a small exercise in arithmetic — you count out the exact change, or just use a big bill and accept even more change in return. The money is all there. It's just... fragmented.

Aleo's private records work exactly the same way.

---

## Records: Aleo's Private "Bills"

On Aleo, your balance isn't a simple number sitting in a public ledger. Instead, you hold a collection of **records** — cryptographic objects that are encrypted and only readable by you. Each record represents a specific amount of credits (or tokens). When you receive credits, you get a new record. When you spend them, that record is consumed and new records are created: one for the recipient, one back to you as change.

Over time — especially if you receive many small payments, or if frequent transactions keep generating change records — you can end up with dozens or even hundreds of individual records, each holding a small amount. This is called **record fragmentation**.

The problem: Aleo has a hard limit on how many records can be used as inputs to a single transaction. If your balance is spread across 200 records and you want to make a payment, you can't hand over 200 coins at once. You need to consolidate them first.

That's what autojoin is for.

---

## The Join Operation

Aleo's `credits.aleo` program exposes a native `join` function that takes two records and combines them into one. It's straightforward: call `join(recordA, recordB)`, and you get back a single record worth A + B.

The question is: if you have *N* records, what's the most efficient way to combine them?

---

## Strategy 1: The Sequential Approach

The most intuitive approach is to keep joining pairs of records one at a time, round by round:

```
Round 1:  join(r1, r2) → r12,  join(r3, r4) → r34,  join(r5, r6) → r56 ...
Round 2:  join(r12, r34) → r1234 ...
...and so on until one record remains.
```

This is what the `BasicAutoJoinStrategy` does. It's simple and easy to reason about. The code runs all pairs within a round in parallel (using `Promise.all`), so you're not waiting for one join to finish before starting another in the same round:

```typescript
const pairs: [AleoRecord, AleoRecord][] = [];
for (let i = 0; i + 1 < current.length; i += 2) {
  pairs.push([current[i], current[i + 1]]);
}

const joinedRecords = await Promise.all(pairs.map(async ([a, b]) => {
  const { transactionId, newRecord } = await this.join2(a, b);
  await this.aleoClient.waitForTransactionConfirmation(transactionId);
  return newRecord;
}));
```

The downside is that you still need **N − 1** total join transactions for N records. With 100 records, that's 99 transactions — each requiring a zero-knowledge proof to be generated and confirmed on-chain. At several seconds per transaction, this adds up quickly.

---

## Strategy 2: Batch Joins

Aleo actually supports more than just two-record joins. Through custom wrapper programs, you can call `join_3`, `join_4`, all the way up to `join_16` — functions that accept up to 16 records and combine them all in a single transaction.

This changes the math dramatically.

Each `join_N` call reduces N records down to 1, eliminating N − 1 records from your pile in a single step. With `join_16`, one transaction turns 16 records into 1. A hundred records that would take 99 sequential joins can be consolidated in just 7 batch transactions.

The `BatchAutoJoinStrategy` exploits this by grouping records into the largest possible batches, joining all batches in parallel, then repeating on the intermediate results:

```typescript
while (current.length > 1) {
  const batches: AleoRecord[][] = [];
  while (current.length > 0) {
    batches.push(current.splice(0, Math.min(current.length, 16)));
  }

  const joinedRecords = await Promise.all(batches.map(async (batch) => {
    const { transactionId, newRecord } = await this.joinN(batch);
    await this.aleoClient.waitForTransactionConfirmation(transactionId);
    return newRecord;
  }));

  current = joinedRecords;
}
```

For most real-world cases, this finishes in one or two rounds.

---

## Reusing Transaction Outputs

One of the more elegant aspects of the batch strategy: you don't need to re-fetch your records from the network between rounds. When a join transaction is confirmed, its output — the newly combined record — comes back directly in the transaction response. The code decrypts it immediately and feeds it into the next round:

```typescript
const firstOutput = transaction.execution?.transitions?.[records.length - 2]?.outputs?.[0];

const newRecord = this.aleoClient.recordCipherTextStringToAleoRecord(
  firstOutput.value,
  this.account,
  records[0].programName,
  transaction.id,
);
```

This keeps the pipeline fast. The tradeoff is that it requires robust retry logic — if a proving request fails or a broadcast times out mid-pipeline, the process needs to recover gracefully rather than losing track of where it was:

```typescript
async submitProvingRequestwithRetries(provingRequest, retries, attempts = 0) {
  try {
    return await this.submitProvingRequest(provingRequest);
  } catch (e) {
    if (retries <= 0) throw e;
    await sleep(5000 * (attempts + 1)); // exponential backoff
    return this.submitProvingRequestwithRetries(provingRequest, retries - 1, attempts + 1);
  }
}
```

---

## The Private Fee Problem

So far, we've assumed fees are paid publicly — deducted from a visible on-chain balance. But Aleo also supports **private fees**, where the transaction fee itself is paid using a private credits record, keeping even your fee payments hidden from observers.

Private fees introduce a hard constraint: Aleo transactions accept a maximum of **16 record inputs total**, and the fee record counts as one of them. That means with a private fee, the largest join you can run in a single transaction is `join_15` — 15 records in, 1 fee record, 16 total inputs.

For N records with private fees, the number of `join_15` operations needed is:

```
Math.floor((N - 1) / 14)
```

…plus one final join to mop up whatever's left:

```
join_( ((N - 1) % 14) + 1 )
```

The denominator is 14, not 15, because each `join_15` call reduces your record count by 14: it takes 15 records in and returns 1, netting you 14 fewer records.

### Exact Amounts, No Rounding

Here's where things get precise. When paying a private fee, the fee record you provide must contain *exactly* the right number of microcredits — not a rounded estimate.

- **Too little**: the transaction fails outright.
- **Too much**: the leftover microcredits become a tiny "dust" record sitting in your wallet. You've solved fragmentation by creating more fragmentation.

The solution is to prepare perfectly sized fee records ahead of time:

1. **Calculate** the total fee cost across all planned operations.
2. **Find** a credits record large enough to cover the total.
3. **Split** it once to carve out a "master fee record" of exactly the right total amount.
4. **Split** the master repeatedly to produce individual per-operation fee records, each sized for exactly one join.

This works because fees on Aleo are **consistent and deterministic**. There's no gas auction, no variability based on network congestion. The fee for a given function is determined entirely by the computational complexity of the zero-knowledge circuit being executed — fixed at compile time. So you can calculate your exact spend before submitting a single transaction.

---

## A Note on Split Operations

Splitting records is central to the private fee strategy — you split before you join. But there's a cost worth understanding.

Join operations are priced like any normal Aleo transaction: a standard execution fee based on the function's circuit complexity.

Split operations carry an additional **implicit fee** — a small amount deducted directly from the record being split, built into the protocol itself rather than charged as a separate line item. This distinction matters when calculating your fee budget. If you only account for join fees and ignore the implicit cost of the splits needed to prepare them, you'll find yourself short.

On the bright side, because Aleo's fees are deterministic, this implicit cost is also predictable and can be factored into the pre-calculation.

---

## Putting It All Together

Here's the full lifecycle of a private-fee batch autojoin for 30 records:

1. **Calculate** that you need `Math.floor(29 / 14) = 2` calls to `join_15`, plus one final `join_2` (since `(29 % 14) + 1 = 2`).
2. **Estimate** the fee for each operation type.
3. **Prepare** 3 fee records: 2 sized for `join_15`, 1 for `join_2`.
4. **Group** the 30 records into two batches of 15. Join each batch in parallel with its dedicated fee record. You now have 2 intermediate records.
5. **Join** those 2 intermediate records using the final fee record. You have 1 record.

30 fragmented records. 3 transactions. One clean balance.

---

## Why This Matters

Record fragmentation is one of the less-discussed UX challenges of building on privacy-preserving blockchains. It's not a flaw in the privacy model — it's a natural consequence of how private state works. The same property that makes records unreadable to outside observers also means they can't be aggregated passively by the protocol the way a public balance can.

But that doesn't mean users have to manage it manually. Autojoin is a concrete example of how thoughtful tooling can bridge the gap between "private by design" and "usable in practice" — taking the pocket full of coins and turning it into one clean bill, quietly and efficiently, in the background.

The code for this project is open source and available for anyone building on Aleo who needs to handle record consolidation in their application.
