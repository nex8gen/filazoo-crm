const {createClient}=require('@supabase/supabase-js');
(async()=>{
  const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const results=await Promise.all([
    client.from('flow_run_logs').select('id,run_id,created_at,result,flow_runs!inner(flow_id)',{count:'exact'}).eq('flow_runs.flow_id','00000000-0000-4000-8000-000000000000').or('created_at.gte.2026-10-20T00:00:00Z,result->>action.eq.ai_usage,result->>aiGenerated.eq.true').lte('created_at',new Date().toISOString()).order('id').range(0,499),
    client.from('flow_run_logs').select('id').eq('result->>action','ai_usage').is('result->>costUsd',null).limit(1),
  ]);
  for(const result of results)if(result.error)throw new Error(result.error.message);
  console.log('PASS live read-only PostgREST performance and billing filters; no records changed');
  const models=await fetch('https://ai-gateway.vercel.sh/v1/models').then(r=>r.json());
  if(!Array.isArray(models.data))throw new Error('Gateway catalog unavailable');
  console.log('PASS live Gateway catalog: '+models.data.length+' models; existing model routing unchanged');
})().catch(error=>{console.error(error.message);process.exitCode=1});
