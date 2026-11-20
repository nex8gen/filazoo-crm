import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { AlipaySdk } from "alipay-sdk";
import * as protocol from "../lib/alipay-auth/protocol.ts";

const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
test("Alipay OAuth RSA2 response verification rejects missing signatures and altered identity", () => {
  const sdk = new AlipaySdk({ appId: "2021007121675450", privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), alipayPublicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(), signType: "RSA2", keyType: "PKCS8", camelcase: false });
  const payload = { access_token: "test-only-token", open_id: "verified-open-id-12345" };
  const signature = sign("RSA-SHA256", Buffer.from(JSON.stringify(payload)), pair.privateKey).toString("base64");
  const responseKey = "alipay_system_oauth_token_response";
  const verify = (data: unknown, signatureValue: string) => (sdk as unknown as { checkResponseSign: (response: string, key: string, signature: string) => void }).checkResponseSign(JSON.stringify({ [responseKey]: data, sign: signatureValue }), responseKey, signatureValue);
  assert.doesNotThrow(() => verify(payload, signature));
  assert.throws(() => verify({ ...payload, open_id: "attacker-open-id-12345" }, signature));
  assert.throws(() => verify(payload, ""));
});
test("OAuth exchange fails closed when either signing key is missing, before constructing the SDK", async () => {
  for (const missing of ["ALIPAY_PRIVATE_KEY", "ALIPAY_PUBLIC_KEY"]) {
    let constructed = false;
    const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
    const environment = { ALIPAY_LOGIN_ENABLED: "true", ALIPAY_APP_ID: "2021007121675450", ALIPAY_OAUTH_CLIENT_SECRET: protocol.opaqueToken(), ALIPAY_OAUTH_SUBJECT_KEY: protocol.opaqueToken(), ALIPAY_PRIVATE_KEY: "private", ALIPAY_PUBLIC_KEY: "public", [missing]: "" };
    const deps: Record<string, unknown> = { "server-only": {}, "node:fs": { readFileSync }, "alipay-sdk": { AlipaySdk: class { constructor() { constructed = true; } } }, "../env.ts": { env: { NEXT_PUBLIC_APP_URL: "https://crm.example", NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co" } }, "./protocol.ts": protocol };
    const code = ts.transpileModule(readFileSync("lib/alipay-auth/server.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, require: (name: string) => deps[name], process: { env: environment }, URL });
    await assert.rejects(exports.verifiedAlipaySubject(protocol.opaqueToken()), /signing keys are not configured/);
    assert.equal(constructed, false);
  }
});
