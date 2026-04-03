import {type Account, AleoClient, type AleoNetwork, type OwnedRecord, type ProgramManager} from "../aleoClient.ts";
import type {JoinStrategyConstructor} from "./joinStrategy.ts";

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

  async getProgramManager(): Promise<ProgramManager> {
    if (this.programManager) return this.programManager;
    this.programManager = await this.aleoClient.getProgramManagerForAccount(this.account);
    return this.programManager;
  }

  async joinRecords(records: OwnedRecord[]): Promise<OwnedRecord> {
    if (records.length === 0) throw new Error('No records found');
    if (records.length === 1) return records[0];
    const joinStrategy = new this.joinStrategyClass(this);
    joinStrategy.validateRecordsForJoining(records);
    return await joinStrategy.joinRecords(records);
  }
}
