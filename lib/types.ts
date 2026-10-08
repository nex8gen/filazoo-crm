export const pipelineStages=["New","Contacted","Replied","Interested","Big order","Won","Lost"] as const;
export type PipelineStage=(typeof pipelineStages)[number];
export type Company={id:string;name:string;initials:string;domain:string;country:string;segment:string;fitScore:number;stage:PipelineStage;nextAction:string;tags:string[];contact:string;email:string;summary:string};
export type EmailDraft={id:string;company:string;contact:string;subject:string;preview:string;step:number;scheduledFor:string;status:"Needs approval"|"Scheduled"|"Draft"};
