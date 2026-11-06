import checkpoint from './checkpoint.cjs';
export default checkpoint;
export const {
  captureCheckpoint,
  isCheckpointCurrent,
  needsAdoption,
  renderCheckpoint,
} = checkpoint;
