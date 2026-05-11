export type RawEditMap = Record<string, string>;
export type RevertedRowMap = Record<string, boolean>;

export type PostMutationLocalState = {
  rawEdits: RawEditMap;
  revertedRows: RevertedRowMap;
  cleared: boolean;
};

export function resolvePostMutationLocalState(
  actionSucceeded: boolean,
  currentRawEdits: RawEditMap,
  currentRevertedRows: RevertedRowMap,
): PostMutationLocalState {
  if (!actionSucceeded) {
    return {
      rawEdits: currentRawEdits,
      revertedRows: currentRevertedRows,
      cleared: false,
    };
  }
  return {
    rawEdits: {},
    revertedRows: {},
    cleared: true,
  };
}
