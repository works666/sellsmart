import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServerClient } from '../../../projects/src/storage/database/supabase-client.ts';
const db = createServerClient();
const safeQuery = async (query: PromiseLike<any>) => {
  try { const result = await query; return result.error ? { error: { code: result.error.code ?? 'unknown', status: result.status ?? null } } : result; }
  catch (error) { const value = error as { code?: unknown; status?: unknown }; return { error: { code: typeof value.code === 'string' ? value.code : 'thrown', status: value.status ?? null } }; }
};
const [promptConfig, provider, sessionQuery, totalQuery] = await Promise.all([
  safeQuery(db.from('designer_prompt_configs').select('id,config,revision,updated_at,updated_by').eq('id', 'project-one').maybeSingle()),
  safeQuery(db.from('designer_prompt_configs').select('id,config,revision,updated_at,updated_by').eq('id', 'global-ai-provider').maybeSingle()),
  safeQuery(db.from('project_one_preview_sessions').select('id,user_id,state,version,last_active_at').order('last_active_at', { ascending: false }).limit(100)),
  safeQuery(db.from('project_one_preview_sessions').select('id', { count: 'exact', head: true })),
]);
if (promptConfig.error || provider.error || sessionQuery.error || totalQuery.error) {
 console.log(JSON.stringify({generatedAt:new Date().toISOString(),status:'partial_or_unavailable',errors:{promptConfig:promptConfig.error,provider:provider.error,sessions:sessionQuery.error,sessionCount:totalQuery.error}},null,2)); process.exitCode=2;
} else {
 const promptRow=promptConfig.data, providerRow=provider.data, sessions=Array.isArray(sessionQuery.data)?sessionQuery.data:[];
 const groups=new Map<string,number>(); for(const row of sessions) groups.set(row.user_id,(groups.get(row.user_id)??0)+1);
 const samples=sessions.slice(0,3).map((row:any)=>{ const state=row.state&&typeof row.state==='object'?row.state:{}; const npcs=state.npcStates&&typeof state.npcStates==='object'?state.npcStates:{}; const conversations=state.conversations&&typeof state.conversations==='object'?state.conversations:{}; return {idPrefix:String(row.id).slice(0,8),version:row.version,lastActiveAt:row.last_active_at,stateKeys:Object.keys(state).sort(),npcIds:Object.keys(npcs).sort(),npcRuntimeKeys:Object.fromEntries(Object.entries(npcs).slice(0,5).map(([npcId,value]:[string,any])=>[npcId,Object.keys(value??{}).sort()])),conversationCounts:Object.fromEntries(Object.entries(conversations).map(([npcId,messages]:[string,any])=>[npcId,Array.isArray(messages)?messages.length:null])),conversationHasText:Object.values(conversations).some((messages:any)=>Array.isArray(messages)&&messages.length>0),memoryKeys:Object.fromEntries(Object.entries(npcs).slice(0,5).map(([npcId,value]:[string,any])=>[npcId,value?.workingMemory?.[0]&&typeof value.workingMemory[0]==='object'?Object.keys(value.workingMemory[0]).sort():[]])),relationshipStateKeys:Object.keys(state).filter((key:string)=>/attitude|support|affinity|relation|familiar|pleasant/i.test(key)).sort(),hasActiveMeeting:Boolean(state.activeMeeting)}; });
 const output={generatedAt:new Date().toISOString(),source:'Supabase read-only via createServerClient; no model requests; no row writes',designerPromptConfig:promptRow?{exists:true,id:promptRow.id,revision:promptRow.revision,updatedAt:promptRow.updated_at,updatedByPresent:Boolean(promptRow.updated_by),configKeys:Object.keys(promptRow.config??{}).sort()}:{exists:false},globalAiProvider:providerRow?{exists:true,id:providerRow.id,revision:providerRow.revision,updatedAt:providerRow.updated_at,updatedByPresent:Boolean(providerRow.updated_by),provider:providerRow.config?.provider??null}:{exists:false},previewSessions:{totalCount:totalQuery.count??null,scannedForUserGroups:sessions.length,userGroupCount:groups.size,sessionsPerUserGroup:[...groups.values()].sort((a,b)=>b-a),samples},boundaries:['user_id values and message contents were not output or written','the latest preview sessions cannot be identified as the current user without an authenticated user context; samples are the latest rows across users']};
 const outputPath=resolve('D:/WeiXun/tmp/system-evaluation-readback.json'); await writeFile(outputPath,JSON.stringify(output,null,2)+'\n',{flag:'w'}); console.log(JSON.stringify(output,null,2));
}
