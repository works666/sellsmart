import assert from 'node:assert/strict';
import { consumeChatCommunicationTime, createProjectOneState } from '../src/lib/game/state';

const onePoint = { ...createProjectOneState(), actionPoints: 1 };
assert.throws(
  () => consumeChatCommunicationTime(onePoint, 'email', true),
  /ACTION_POINTS_INSUFFICIENT/,
  'attachment preflight rejects a one-point written action before chat attachment or reply AI is reached',
);

const twoPoints = { ...createProjectOneState(), actionPoints: 2 };
const repliedWithAttachment = consumeChatCommunicationTime(twoPoints, 'email', true);
assert.equal(repliedWithAttachment.actionPoints, 0, 'a written reply with one or more attachments costs two AP');
const silentWithAttachment = consumeChatCommunicationTime(twoPoints, 'online', true);
assert.equal(silentWithAttachment.actionPoints, 0, 'a read-without-reply attachment send has the same two-AP action cost');
const textOnly = consumeChatCommunicationTime({ ...createProjectOneState(), actionPoints: 1 }, 'online', false);
assert.equal(textOnly.actionPoints, 0, 'text-only written communication retains its one-AP cost');

console.log('formal chat cost contracts passed');
