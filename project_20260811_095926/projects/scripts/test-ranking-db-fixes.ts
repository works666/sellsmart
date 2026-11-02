import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRankingQuery, summarizeRoomResults } from '../src/app/api/ranking/route';

const roomId = '123e4567-e89b-12d3-a456-426614174000';

assert.deepEqual(
  parseRankingQuery(new URLSearchParams(`tab=room&roomId=${roomId}&range=month&page=2&pageSize=5&track=gov`)),
  {
    tab: 'room',
    range: 'month',
    track: 'gov',
    page: 2,
    pageSize: 5,
    roomId,
    roomCode: null,
    error: null,
  },
);
assert.equal(parseRankingQuery(new URLSearchParams('roomCode=r-8821')).roomCode, 'R-8821');
assert.equal(parseRankingQuery(new URLSearchParams('room=not valid')).error, 'ROOM_SCOPE_INVALID');
assert.equal(
  parseRankingQuery(new URLSearchParams(`roomId=${roomId}&roomCode=R-8821`)).error,
  'ROOM_SCOPE_CONFLICT',
);

assert.deepEqual(summarizeRoomResults([]), { avgScore: 0, maxScore: 0, totalCount: 0 });
assert.deepEqual(
  summarizeRoomResults([
    { status: 'playing', total_score: 99 },
    { status: 'won', total_score: 81 },
    { status: 'lost', total_score: 57 },
  ]),
  { avgScore: 69, maxScore: 81, totalCount: 2 },
);

const migration = readFileSync(
  new URL('../supabase/migrations/20260904000100_fix_game_completion_timestamp.sql', import.meta.url),
  'utf8',
);
assert.match(migration, /finished_at = CASE[\s\S]*game_sessions\.status = 'playing'/);
assert.match(migration, /next_status IN \('won', 'lost'\)/);
assert.match(migration, /ELSE game_sessions\.finished_at/);

console.log('ranking and game completion timestamp tests passed');
