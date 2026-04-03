import {
  type Account,
  AleoClient,
  type AleoNetwork,
  type OwnedRecord,
  type ProgramManager,
} from './aleoClient.ts';

export class AleoAutoJoin {
  private readonly aleoClient: AleoClient<AleoNetwork>;
  private readonly account: Account;
  private readonly accountAddress: string;
  private programManager?: ProgramManager;

  constructor(aleoClient: AleoClient<AleoNetwork>, account: Account) {
    this.aleoClient = aleoClient;
    this.account = account;
    this.accountAddress = account.address().to_string();
  }

  /** Throws if records are not appropriate for joining. */
  static validateRecordsForJoining(records: OwnedRecord[]) {
    if (records.some(r => r.program_name !== records[0].program_name)) throw new Error('All records must be same program');
    if (records[0].program_name === undefined) throw new Error('All records must have a program name');
    if (records.some(r => r.owner !== records[0].owner)) throw new Error('All records must be owned by same owner');
    if (records.some(r => !r.transaction_id)) throw new Error('All records must have a transaction_id');
    if (records.some(r => !r.commitment)) throw new Error('All records must have a commitment');
    const commitments = records.map(r => r.commitment!);
    if (new Set(commitments).size !== commitments.length) throw new Error('All records must have unique commitments');
  }

  async joinRecords(records: OwnedRecord[]): Promise<OwnedRecord> {
    if (records.length === 0) throw new Error('No records found');
    if (records.length === 1) return records[0];
    AleoAutoJoin.validateRecordsForJoining(records);

    const programName = records[0].program_name!;
    let current = records;

    while (current.length > 1) {
      // Pair up records, potentially leaving the last one unpaired
      const pairs: [OwnedRecord, OwnedRecord][] = [];
      for (let i = 0; i + 1 < current.length; i += 2) {
        pairs.push([current[i], current[i + 1]]);
      }

      // Track commitments of the input records that were consumed
      const consumedCommitments = new Set(
        pairs.flatMap(([a, b]) => [a.commitment!.trim(), b.commitment!.trim()])
      );

      // Join each pair in parallel, collect resulting transaction IDs
      const joinTxIds = await Promise.all(pairs.map(([a, b]) => this.join2(a, b)));

      // Validate with retry: up to 6 attempts, 5s apart (30s total)
      const MAX_ATTEMPTS = 6;
      const RETRY_DELAY_MS = 5000;
      let validated = false;
      let stillPresent: string[] = [];
      let notFound: string[] = [];
      await new Promise<void>(resolve => setTimeout(resolve, RETRY_DELAY_MS * 2));

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const fresh = await this.aleoClient.fetchUnspentRecords(
          this.account, [programName], this.accountAddress, false
        );
        const freshCommitments = new Set(fresh.map(r => r.ownedRecord.commitment!.trim()));
        const freshTxIds = new Set(fresh.map(r => r.ownedRecord.transaction_id!.trim()));

        stillPresent = [...consumedCommitments].filter(c => freshCommitments.has(c));
        notFound = joinTxIds.filter(txId => !freshTxIds.has(txId));

        if (stillPresent.length === 0 && notFound.length === 0) {
          current = fresh.map(r => r.ownedRecord);
          validated = true;
          break;
        }

        if (attempt < MAX_ATTEMPTS - 1) {
          await new Promise<void>(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }

      if (!validated) {
        console.log('consumed', consumedCommitments);
        console.log('joinTxs', joinTxIds);
        console.log('still present', stillPresent);
        console.log('not found', notFound);
        throw new Error('Timed out after 30s waiting for join confirmation');
      }
    }

    return current[0];
  }

  async join2(recordA: OwnedRecord, recordB: OwnedRecord): Promise<string> {
    console.log(`join2: ${recordA.transaction_id}/${recordB.transaction_id}`);
    const programManager = await this.getProgramManager();
    const provingRequest = await programManager.provingRequest({
      programName: recordA.program_name!,
      functionName: 'join',
      priorityFee: 0,
      privateFee: false,
      inputs: [
        this.aleoClient.decryptRecord(recordA, this.account).toString(),
        this.aleoClient.decryptRecord(recordB, this.account).toString(),
      ],
      broadcast: true,
    });
    const {transaction, broadcast_result} = await this.aleoClient.submitProvingRequest(provingRequest);
    if (broadcast_result?.status !== "Accepted") throw new Error(`Broadcast status not accepted: ${broadcast_result}`);
    if (!transaction?.id) throw new Error(`Transaction invalid: ${transaction}`);
    return transaction.id.trim();
  }

  private async getProgramManager(): Promise<ProgramManager> {
    if (this.programManager) return this.programManager;
    this.programManager = await this.aleoClient.getProgramManagerForAccount(this.account);
    return this.programManager;
  }
}