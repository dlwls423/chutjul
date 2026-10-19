import assert from "node:assert/strict";
import { configuredAiProvider, createEmbeddings, generateStructuredText } from "../lib/ai-runtime.ts";

const originalFetch=globalThis.fetch;
const originalProvider=process.env.AI_PROVIDER;
try{
  process.env.AI_PROVIDER="ollama";
  assert.equal(configuredAiProvider(),"ollama");
  const calls=[];
  globalThis.fetch=async(url,init)=>{
    calls.push({url:String(url),body:JSON.parse(String(init?.body||"{}"))});
    if(String(url).endsWith("/api/chat"))return Response.json({message:{content:'{"ok":true}'}});
    if(String(url).endsWith("/api/embed"))return Response.json({embeddings:[[.1,.2,.3],[.3,.2,.1]]});
    throw new Error(`unexpected url ${url}`);
  };
  const generated=await generateStructuredText({instructions:"system",input:"input",schema:{type:"object"},schemaName:"test"});
  assert.equal(generated,'{"ok":true}');
  assert.equal(calls[0].body.stream,false);
  assert.deepEqual(calls[0].body.format,{type:"object"});
  assert.deepEqual(await createEmbeddings(["a","b"],3),[[.1,.2,.3],[.3,.2,.1]]);
  await assert.rejects(()=>createEmbeddings(["a","b"],1536),/EMBEDDING_DIMENSION_MISMATCH/);
  console.log("ai runtime regression: ok");
}finally{
  globalThis.fetch=originalFetch;
  if(originalProvider===undefined)delete process.env.AI_PROVIDER;else process.env.AI_PROVIDER=originalProvider;
}
