import type {AutoJoinClient} from "./autoJoinClient.ts";
import type {AleoRecord} from "../aleoClient.ts";

export interface JoinStrategy {
  joinRecords(records: AleoRecord[], feePrivate: boolean): Promise<AleoRecord[]>;
  isSupportedProgram(programName: string): boolean;
}

export type JoinStrategyConstructor = {
  new (autoJoinClient: AutoJoinClient): JoinStrategy;
};
