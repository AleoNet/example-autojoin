import {type Account, AleoClient, type AleoNetwork, type OwnedRecord, type ProgramManager} from "../aleoClient.ts";
import type {JoinStrategy, JoinStrategyConstructor} from "./joinStrategy.ts";

export class AutoJoinClient {
  readonly aleoClient: AleoClient<AleoNetwork>;
  readonly account: Account;
  readonly accountAddress: string;
  private programManager?: ProgramManager;
  private readonly joinStrategyClass: JoinStrategyConstructor;

  constructor(aleoClient: AleoClient<AleoNetwork>, account: Account, joinStrategyClass: JoinStrategyConstructor) {
    this.aleoClient = aleoClient;
    this.account = account;
    this.accountAddress = account.address().to_string();
    this.joinStrategyClass = joinStrategyClass;
  }

  /** Throws if records are not appropriate for joining. */
  private static validateRecordsForJoining(records: OwnedRecord[], joinStrategy: JoinStrategy) {
    if (records.some(r => r.program_name !== records[0].program_name)) throw new Error('All records must be same program');
    if (records[0].program_name === undefined) throw new Error('All records must have a program name');
    if (! joinStrategy.isSupportedProgram(records[0].program_name)) throw new Error('Unsupported program record');
    if (records.some(r => r.owner !== records[0].owner)) throw new Error('All records must be owned by same owner');
    if (records.some(r => !r.transaction_id)) throw new Error('All records must have a transaction_id');
    if (records.some(r => !r.commitment)) throw new Error('All records must have a commitment');
    const commitments = records.map(r => r.commitment!);
    if (new Set(commitments).size !== commitments.length) throw new Error('All records must have unique commitments');
  }

  async getProgramManager(): Promise<ProgramManager> {
    if (this.programManager) return this.programManager;
    this.programManager = await this.aleoClient.getProgramManagerForAccount(this.account);
    return this.programManager;
  }

  async joinRecords(records: OwnedRecord[]): Promise<OwnedRecord> {
    if (records.length === 0) throw new Error('No records found');
    if (records.length === 1) return records[0];
    const joinStrategy = new this.joinStrategyClass(this);
    AutoJoinClient.validateRecordsForJoining(records, joinStrategy);
    return await joinStrategy.joinRecords(records);
  }
}
