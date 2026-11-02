/** Compatibility guard for old clients that still submit the removed command. */
export function assertMultiplayerCommandAllowed(
  gameMode: 'solo' | 'multiplayer',
  commandType: string,
): void {
  if (gameMode === 'multiplayer' && commandType === 'advance_phase') {
    throw new Error('GAME_PHASE_DESIGN_REMOVED');
  }
}

/** A joined company may write only while its shared room is running. */
export function assertMultiplayerRoomRunning(
  gameMode: 'solo' | 'multiplayer',
  roomStatus: string | null | undefined,
): void {
  if (gameMode === 'multiplayer' && roomStatus !== 'running') {
    throw new Error('MULTIPLAYER_ROOM_NOT_RUNNING');
  }
}
