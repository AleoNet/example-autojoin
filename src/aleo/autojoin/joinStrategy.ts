import type {OwnedRecord} from "@provablehq/sdk/mainnet.js";
import type {AutoJoinClient} from "./autoJoinClient.ts";

export interface JoinStrategy {
  joinRecords(records: OwnedRecord[]): Promise<OwnedRecord>;
  isSupportedProgram(programName: string): boolean;
}

export type JoinStrategyConstructor = {
  new (autoJoinClient: AutoJoinClient): JoinStrategy;
};
