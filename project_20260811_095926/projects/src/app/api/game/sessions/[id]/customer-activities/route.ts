import { NextRequest, NextResponse } from 'next/server';
import { authGuard } from '@/lib/auth/guard';
import { customerActivityMutationSchema } from '@/lib/contracts/game';
import {
  commitGameCommand,
  getCommittedGameCommand,
  assertOwnedMultiplayerRoomRunning,
  processPendingCustomerActivityDetections,
  processSubmittedCustomerActivityEvaluations,
  synchronizeOwnedGameTimer,
} from '@/lib/game/repository';
import {
  saveCustomerActivityDraft,
  startCustomerActivityPlanning,
  submitCustomerActivityPlan,
  toPublicCustomerActivityTask,
} from '@/lib/game/customer-activities';
import {
  isCustomerActivityPlanning,
  hasUnsettledCustomerActivityEvaluations,
  pauseProjectTimerForCustomerActivity,
  resumeProjectTimerAfterCustomerActivity,
  synchronizeProjectTimer,
  toPlayerVisibleGameState,
} from '@/lib/game/state';

export const runtime = 'nodejs';

function failure(code: string, status: number, state?: Awaited<ReturnType<typeof synchronizeOwnedGameTimer>>['state']) {
  return NextResponse.json({
    error: code,
    ...(state ? {
      activities: state.customerActivities.tasks.map(toPublicCustomerActivityTask),
      serverNow: Date.now(),
      version: state.version,
      state: toPlayerVisibleGameState(state),
    } : {}),
  }, { status });
}

async function refreshActivityState(sessionId: string, userId: string) {
  let session = await synchronizeOwnedGameTimer(sessionId, userId);
  session = await processPendingCustomerActivityDetections(sessionId, userId).catch(() => session);
  session = await processSubmittedCustomerActivityEvaluations(sessionId, userId).catch(() => session);
  return session;
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = authGuard(request);
  if (!guard.ok || !guard.session) return guard.response!;
  const { id } = await context.params;
  try {
    const session = await refreshActivityState(id, guard.session.userId);
    return NextResponse.json({
      success: true,
      activities: session.state.customerActivities.tasks.map(toPublicCustomerActivityTask),
      serverNow: Date.now(),
      version: session.state.version,
      state: toPlayerVisibleGameState(session.state),
    });
  } catch {
    return failure('GAME_SESSION_NOT_FOUND', 404);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = authGuard(request);
  if (!guard.ok || !guard.session) return guard.response!;
  const parsed = customerActivityMutationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'CUSTOMER_ACTIVITY_MUTATION_INVALID', details: parsed.error.flatten() }, { status: 400 });
  const { id } = await context.params;

  let currentState: Awaited<ReturnType<typeof synchronizeOwnedGameTimer>>['state'] | undefined;
  try {
    let session = await synchronizeOwnedGameTimer(id, guard.session.userId);
    currentState = session.state;
    const replay = await getCommittedGameCommand(id, parsed.data.commandId);
    if (replay) {
      session = await processPendingCustomerActivityDetections(id, guard.session.userId).catch(() => session);
      session = await processSubmittedCustomerActivityEvaluations(id, guard.session.userId).catch(() => session);
      currentState = session.state;
      return NextResponse.json({
        success: true,
        activity: session.state.customerActivities.tasks.find((task) => task.id === parsed.data.taskId)
          ? toPublicCustomerActivityTask(session.state.customerActivities.tasks.find((task) => task.id === parsed.data.taskId)!)
          : null,
        activities: session.state.customerActivities.tasks.map(toPublicCustomerActivityTask),
        serverNow: Date.now(),
        version: session.state.version,
        state: toPlayerVisibleGameState(session.state),
        replayed: true,
      });
    }

    session = await processPendingCustomerActivityDetections(id, guard.session.userId).catch(() => session);
    session = await processSubmittedCustomerActivityEvaluations(id, guard.session.userId).catch(() => session);
    currentState = session.state;
    const existingTask = session.state.customerActivities.tasks.find((task) => task.id === parsed.data.taskId);
    if (!existingTask) return failure('CUSTOMER_ACTIVITY_NOT_FOUND', 404, session.state);
    if ((parsed.data.action === 'save' || parsed.data.action === 'submit') && existingTask.status === 'submitted') {
      return NextResponse.json({
        success: true,
        activity: toPublicCustomerActivityTask(existingTask),
        activities: session.state.customerActivities.tasks.map(toPublicCustomerActivityTask),
        serverNow: Date.now(),
        version: session.state.version,
        state: toPlayerVisibleGameState(session.state),
      });
    }
    await assertOwnedMultiplayerRoomRunning(id, session.state);
    if (session.state.status !== 'playing') return failure('GAME_ALREADY_FINISHED', 409, session.state);
    if (session.state.version !== parsed.data.expectedVersion) return failure('STATE_VERSION_CONFLICT', 409, session.state);
    if (parsed.data.action === 'start' && hasUnsettledCustomerActivityEvaluations(session.state)) {
      return failure('CUSTOMER_ACTIVITY_EVALUATION_PENDING', 409, session.state);
    }

    const now = Date.now();
    let nextState = session.state;
    let eventType: string;
    let commandType: string;
    let result: Record<string, unknown>;

    if (parsed.data.action === 'start') {
      if (existingTask.status !== 'pending') return failure('CUSTOMER_ACTIVITY_NOT_PENDING', 409, session.state);
      if (session.state.activeMeeting || session.state.activePhoneCall) return failure('INTERACTION_ALREADY_ACTIVE', 409, session.state);
      const customerActivities = startCustomerActivityPlanning(session.state.customerActivities, parsed.data.taskId, now);
      if (!customerActivities.tasks.some((task) => task.id === parsed.data.taskId && task.status === 'planning')) {
        return failure('CUSTOMER_ACTIVITY_NOT_NEXT', 409, session.state);
      }
      nextState = pauseProjectTimerForCustomerActivity({ ...session.state, customerActivities }, now);
      eventType = 'customer_activity.plan_started';
      commandType = 'customer_activity.start';
      result = { taskId: parsed.data.taskId };
    } else if (parsed.data.action === 'save') {
      if (!isCustomerActivityPlanning(session.state)) return failure('CUSTOMER_ACTIVITY_NOT_PLANNING', 409, session.state);
      const saved = saveCustomerActivityDraft(session.state.customerActivities, parsed.data.taskId, parsed.data.draft, now);
      const updatedTask = saved.state.tasks.find((task) => task.id === parsed.data.taskId);
      if (!saved.accepted && updatedTask?.status !== 'submitted') return failure('CUSTOMER_ACTIVITY_SAVE_REJECTED', 409, session.state);
      nextState = { ...session.state, customerActivities: saved.state };
      if (updatedTask?.status === 'submitted') {
        const deadlineAt = updatedTask.deadlineAt ?? now;
        nextState = resumeProjectTimerAfterCustomerActivity(nextState, deadlineAt);
        nextState = synchronizeProjectTimer(nextState, now, true);
        eventType = 'customer_activity.plan_auto_submitted';
        commandType = 'customer_activity.timeout_submit';
        result = { taskId: parsed.data.taskId, submitReason: 'timeout' };
      } else {
        eventType = 'customer_activity.plan_saved';
        commandType = 'customer_activity.save';
        result = { taskId: parsed.data.taskId, saved: true };
      }
    } else {
      if (existingTask.status !== 'planning') return failure('CUSTOMER_ACTIVITY_NOT_PLANNING', 409, session.state);
      let activities = session.state.customerActivities;
      if (parsed.data.draft !== undefined) {
        const saved = saveCustomerActivityDraft(activities, parsed.data.taskId, parsed.data.draft, now);
        activities = saved.state;
      }
      activities = submitCustomerActivityPlan(activities, parsed.data.taskId, now);
      const submittedTask = activities.tasks.find((task) => task.id === parsed.data.taskId);
      if (!submittedTask || submittedTask.status !== 'submitted') return failure('CUSTOMER_ACTIVITY_SUBMIT_REJECTED', 409, session.state);
      const resumeAt = submittedTask.submitReason === 'timeout' ? submittedTask.deadlineAt! : submittedTask.submittedAt!;
      nextState = resumeProjectTimerAfterCustomerActivity({ ...session.state, customerActivities: activities }, resumeAt);
      nextState = synchronizeProjectTimer(nextState, now, true);
      eventType = submittedTask.submitReason === 'timeout' ? 'customer_activity.plan_auto_submitted' : 'customer_activity.plan_submitted';
      commandType = submittedTask.submitReason === 'timeout' ? 'customer_activity.timeout_submit' : 'customer_activity.submit';
      result = { taskId: parsed.data.taskId, submitReason: submittedTask.submitReason };
    }

    const committed = await commitGameCommand({
      sessionId: id,
      commandId: parsed.data.commandId,
      commandType,
      expectedVersion: parsed.data.expectedVersion,
      state: nextState,
      eventType,
      eventPayload: { taskId: parsed.data.taskId, action: parsed.data.action },
      result,
    });
    let responseState = committed.state;
    currentState = responseState;
    if (committed.state.customerActivities.tasks.some((task) => task.status === 'submitted' && !task.evaluation)) {
      responseState = (await processSubmittedCustomerActivityEvaluations(id, guard.session.userId).catch(() => null))?.state ?? responseState;
    }
    currentState = responseState;
    return NextResponse.json({
      success: true,
      activity: responseState.customerActivities.tasks.find((task) => task.id === parsed.data.taskId)
        ? toPublicCustomerActivityTask(responseState.customerActivities.tasks.find((task) => task.id === parsed.data.taskId)!)
        : null,
      activities: responseState.customerActivities.tasks.map(toPublicCustomerActivityTask),
      serverNow: Date.now(),
      version: responseState.version,
      state: toPlayerVisibleGameState(responseState),
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'CUSTOMER_ACTIVITY_MUTATION_FAILED';
    const status = code === 'STATE_VERSION_CONFLICT' || code === 'COMMAND_IN_PROGRESS' || code === 'MULTIPLAYER_ROOM_NOT_RUNNING' ? 409 : 400;
    if (code === 'STATE_VERSION_CONFLICT') {
      const latest = await synchronizeOwnedGameTimer(id, guard.session.userId).catch(() => null);
      return failure(code, status, latest?.state ?? currentState);
    }
    return failure(code, status, currentState);
  }
}
