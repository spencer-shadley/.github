import {writeFileSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
const repo='spencer-shadley/.github';
const branch='feat/gh32-revision23-cutover-composed';
const git=(...args)=>execFileSync('git',args,{windowsHide:true,maxBuffer:16*1024*1024});
const str=(...args)=>git(...args).toString('utf8').trim();
function api(method,route,body){
 if(body)writeFileSync('.ops/git-api-body.json',JSON.stringify(body));
 const result=spawnSync('C:/Program Files/GitHub CLI/gh.exe',['api','--method',method,`repos/${repo}/${route}`,...(body?['--input','.ops/git-api-body.json']:[])],{input:body?JSON.stringify(body):undefined,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});
 if(result.status!==0)throw new Error(`${method} ${route}: ${result.stderr} ${result.stdout}`);
 return JSON.parse(result.stdout);
}
const remote=api('GET',`git/ref/heads/${branch}`).object.sha;
const head=str('rev-parse','HEAD');
if(spawnSync('git',['merge-base','--is-ancestor',remote,head],{windowsHide:true}).status!==0)throw new Error('Refuses non-fast-forward');
const commits=str('rev-list','--reverse','--topo-order',`${remote}..${head}`).split('\n').filter(Boolean);
const person=line=>{
 const match=line.match(/^(.*) <([^>]*)> (\d+) ([+-]\d{4})$/);
 if(!match)throw new Error('Unsupported commit identity');
 const [,name,email,epoch,zone]=match;
 const sign=zone[0]==='-'?-1:1;
 const minutes=sign*(Number(zone.slice(1,3))*60+Number(zone.slice(3)));
 const local=new Date(Number(epoch)*1000+minutes*60000).toISOString().slice(0,19);
 return {name,email,date:local+zone.slice(0,3)+':'+zone.slice(3)};
};
for(const commit of commits){
if(spawnSync('git',['merge-base','--is-ancestor',commit,'origin/main'],{windowsHide:true}).status===0){console.log('existing-main '+commit);continue;}
 const raw=git('cat-file','commit',commit).toString('utf8');
 const split=raw.indexOf('\n\n'); const headers=raw.slice(0,split).split('\n');
 if(headers.some(h=>h.startsWith('gpgsig ')||h.startsWith('encoding ')))throw new Error('Unsupported signed/encoded commit');
 const tree=headers.find(h=>h.startsWith('tree ')).slice(5);
 const parents=headers.filter(h=>h.startsWith('parent ')).map(h=>h.slice(7));
 // Main's commits are already on the server; only recreate our unpublished descendants.
 if(spawnSync('git',['merge-base','--is-ancestor',commit,'origin/main'],{windowsHide:true}).status===0){console.log(`existing-main ${commit}`);continue;}
 const baseTree=str('rev-parse',`${parents[0]}^{tree}`);
 const changed=str('diff-tree','-r','--raw','--no-commit-id',parents[0],commit).split('\n').filter(Boolean);
 const entries=[];
 for(const row of changed){
  const [meta,path]=row.split('\t'); const fields=meta.split(' '); const mode=fields[1],sha=fields[3],status=fields[4];
  if(status==='D'){entries.push({path,mode:fields[0].slice(1),type:'blob',sha:null});continue;}
  if(!['100644','100755'].includes(mode))throw new Error(`Unsupported mode ${mode}`);
  const uploaded=api('POST','git/blobs',{content:git('cat-file','blob',sha).toString('base64'),encoding:'base64'});
  if(uploaded.sha!==sha)throw new Error('Blob hash mismatch');
  entries.push({path,mode,type:'blob',sha});
 }
 const uploadedTree=api('POST','git/trees',{base_tree:baseTree,tree:entries});
 if(uploadedTree.sha!==tree)throw new Error(`Tree mismatch for ${commit}`);
 const uploadedCommit=api('POST','git/commits',{message:raw.slice(split+2),tree,parents,author:person(headers.find(h=>h.startsWith('author ')).slice(7)),committer:person(headers.find(h=>h.startsWith('committer ')).slice(10))});
 if(uploadedCommit.sha!==commit)throw new Error(`Commit hash mismatch: expected ${commit}, got ${uploadedCommit.sha}; ref untouched`);
 console.log(`verified-object ${commit}`);
}
if(api('GET',`git/ref/heads/${branch}`).object.sha!==remote)throw new Error('Remote branch moved; ref untouched');
const updated=api('PATCH',`git/refs/heads/${branch}`,{sha:head,force:false});
if(updated.object.sha!==head)throw new Error('Readback mismatch');
console.log(`fast-forwarded ${branch} ${remote} -> ${head}`);


