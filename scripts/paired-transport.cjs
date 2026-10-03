"use strict";
// Loopback HTTP for local qualification; LAN and cross-network endpoints require
// ordinary verified HTTPS. This module never opens firewall rules or tunnels.
const http=require("node:http"),https=require("node:https");
function endpoint(raw){
  let url;try{url=new URL(String(raw));}catch{throw new Error("Enter a coordinator address.");}
  const local=["127.0.0.1","localhost","[::1]"].includes(url.hostname);
  if((url.protocol!=="https:"&&!(url.protocol==="http:"&&local))||url.username||url.password||url.search||url.hash||url.pathname!=="/")throw new Error("Use HTTPS for another PC, or HTTP on loopback only.");
  return url.origin;
}
function answer(response,status,value){response.writeHead(status,{"Content-Type":"application/json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});response.end(JSON.stringify(value));}
function bodyOf(request){return new Promise((resolve,reject)=>{let size=0,text="";request.on("data",chunk=>{size+=chunk.length;if(size>16384){reject(Object.assign(new Error("Request is too large."),{status:413}));request.destroy();return;}text+=chunk;});request.on("end",()=>{try{const value=JSON.parse(text);if(!value||typeof value!=="object"||Array.isArray(value))throw new Error();resolve(value);}catch{reject(Object.assign(new Error("Request must be a JSON object."),{status:400}));}});request.on("error",reject);});}
async function startServer({coordinator,host="127.0.0.1",port=0,tls=null,advertisedUrl=null}={}){
  if(!coordinator)throw new Error("Coordinator is required.");
  if(!["127.0.0.1","localhost","::1"].includes(host)&&!tls)throw new Error("A LAN coordinator requires a TLS certificate and key.");
  if(tls&&(!tls.key||!tls.cert))throw new Error("Choose a TLS certificate and key.");
  if(!Number.isInteger(port)||port<0||port>65535)throw new Error("Choose a valid port.");
  if(advertisedUrl&&endpoint(advertisedUrl).startsWith("http:")&&tls)throw new Error("The advertised address must use HTTPS.");
  let pairAttempts=[];const sockets=new Set();
  const routes={poll:auth=>coordinator.poll(auth),start:(auth,value)=>coordinator.start(auth,value),heartbeat:(auth,value)=>coordinator.heartbeat(auth,value),progress:(auth,value)=>coordinator.progress(auth,value),finish:(auth,value)=>coordinator.finish(auth,value),uncertain:(auth,value)=>coordinator.uncertain(auth,value)};
  const handle=async(request,response)=>{
    try{
      if(request.method==="GET"&&request.url==="/v1/health")return answer(response,200,{ok:true,protocol:1});
      if(request.method!=="POST"||!/^\/v1\/(pair|poll|start|heartbeat|progress|finish|uncertain)$/.test(request.url??""))return answer(response,404,{ok:false,error:"Unknown coordinator request."});
      const value=await bodyOf(request),action=request.url.slice(4);
      if(action==="pair"){
        const now=Date.now();pairAttempts=pairAttempts.filter(at=>now-at<60000);if(pairAttempts.length>=30)return answer(response,429,{ok:false,error:"Pairing is busy. Try again in a minute."});pairAttempts.push(now);
        return answer(response,200,{ok:true,...await coordinator.pair(value)});
      }
      const token=/^Bearer ([A-Za-z0-9_-]{40,80})$/.exec(request.headers.authorization??"")?.[1];
      if(!token)return answer(response,401,{ok:false,error:"Worker authentication is required."});
      const auth={workerId:value.workerId,instanceId:value.instanceId,token};
      return answer(response,200,{ok:true,...await routes[action](auth,value)});
    }catch(error){if(!response.destroyed&&!response.headersSent)answer(response,error.status??500,{ok:false,error:error.status?error.message:"Coordinator storage or transport failed. Existing work is held."});}
  };
  const server=tls?https.createServer(tls,handle):http.createServer(handle);
  server.requestTimeout=10000;server.headersTimeout=10000;server.maxRequestsPerSocket=100;
  server.on("connection",socket=>{if(sockets.size>=32){socket.destroy();return;}sockets.add(socket);socket.on("close",()=>sockets.delete(socket));});
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(port,host,()=>{server.removeListener("error",reject);resolve();});});
  const bound=server.address();
  const url=advertisedUrl?endpoint(advertisedUrl):`${tls?"https":"http"}://${host==="::1"?"[::1]":host}:${bound.port}`;
  return {url,close:async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}
function client({url,workerId=null,token=null,instanceId=null,fetchImpl=globalThis.fetch}={}){
  const base=endpoint(url);
  return async(action,payload={})=>{
    if(!["pair","poll","start","heartbeat","progress","finish","uncertain"].includes(action))throw new Error("Unsupported worker request.");
    const response=await fetchImpl(`${base}/v1/${action}`,{method:"POST",headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({...payload,...(workerId?{workerId,instanceId}:{})}),redirect:"error",signal:AbortSignal.timeout(10000)});
    const reader=response.body?.getReader();if(!reader)throw new Error("Coordinator response has no body.");
    let size=0;const chunks=[];
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>32768)throw new Error("Coordinator response is too large.");chunks.push(Buffer.from(value));}}
    catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
    let result;try{result=JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{throw Object.assign(new Error(`Coordinator returned an invalid response (HTTP ${response.status}).`),{status:response.status});}if(!response.ok||result?.ok!==true)throw Object.assign(new Error(result?.error||"Coordinator did not accept the request."),{status:response.status});return result;
  };
}
module.exports={endpoint,startServer,client};
