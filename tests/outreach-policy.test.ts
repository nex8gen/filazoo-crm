import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSend } from "../lib/outreach-policy.ts";
const base={email:"buyer@example.com",verified:true,unsubscribed:false,suppressed:false,sentToday:0,dailyLimit:20,bounceRate:0,bouncePausePercent:3,dryRun:true};
test("blocks suppressed addresses",()=>{assert.equal(evaluateSend({...base,suppressed:true}).allowed,false)});test("blocks unverified addresses",()=>{assert.equal(evaluateSend({...base,verified:false}).allowed,false)});test("blocks the daily limit",()=>{assert.equal(evaluateSend({...base,sentToday:20}).allowed,false)});test("pauses above bounce threshold",()=>{assert.equal(evaluateSend({...base,bounceRate:3.1}).allowed,false)});test("keeps an eligible message in dry-run",()=>{assert.equal(evaluateSend(base).mode,"dry-run")});
