// Re-export from hallOfFameUtils for backward compatibility.
// New code should import from './hallOfFameUtils' directly.

export {
  addEntryToHallOfFame as addEntryToBank,
  type HallOfFameInsertParams as BankInsertParams,
  type HallOfFameInsertResult as BankInsertResult,
} from './hallOfFameUtils';
