import { relations } from "drizzle-orm/relations";
import { projectScenarios, gameSessions, affinityScores, decisionMakers, chatMessages } from "./schema";

export const gameSessionsRelations = relations(gameSessions, ({one, many}) => ({
	projectScenario: one(projectScenarios, {
		fields: [gameSessions.scenarioId],
		references: [projectScenarios.id]
	}),
	affinityScores: many(affinityScores),
	chatMessages: many(chatMessages),
}));

export const projectScenariosRelations = relations(projectScenarios, ({many}) => ({
	gameSessions: many(gameSessions),
}));

export const affinityScoresRelations = relations(affinityScores, ({one}) => ({
	gameSession: one(gameSessions, {
		fields: [affinityScores.sessionId],
		references: [gameSessions.id]
	}),
	decisionMaker: one(decisionMakers, {
		fields: [affinityScores.decisionMakerId],
		references: [decisionMakers.id]
	}),
}));

export const decisionMakersRelations = relations(decisionMakers, ({many}) => ({
	affinityScores: many(affinityScores),
	chatMessages: many(chatMessages),
}));

export const chatMessagesRelations = relations(chatMessages, ({one}) => ({
	gameSession: one(gameSessions, {
		fields: [chatMessages.sessionId],
		references: [gameSessions.id]
	}),
	decisionMaker: one(decisionMakers, {
		fields: [chatMessages.decisionMakerId],
		references: [decisionMakers.id]
	}),
}));