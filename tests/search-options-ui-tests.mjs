import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=await fs.readFile(new URL('../frontend/app.js',import.meta.url),'utf8');
const elements=Object.fromEntries(Object.entries({search:'project','filter-folder':'Work','filter-tag':'Ideas','filter-scope':'content','filter-exclude':' meeting, draft '}).map(([key,value])=>[key,{value}]));
elements.filters={hidden:true}; elements['search-error']={hidden:true};
elements['filter-toggle']={setAttribute(name,value){this[name]=value;}};
let saveCallback, renders=0, stashes=0;
const requests=[];
let stored=[];
const state={online:true,searchSerial:0,notes:new Map(),pending:{},searches:[]};
const ctx=vm.createContext({state,$:id=>elements[id],highlight(){},onlineOnly(){if(!state.online)throw Error('offline');},notify(){},render(){renders++;},stash:async()=>{stashes++;},inputDialog(title,label,callback){saveCallback=callback;},api:async(path,method,payload)=>{
 requests.push({path,method,payload});
 if(path==='/searches'&&method==='POST'){stored=[{id:'saved-1',...payload}];return {id:'saved-1'};}
 if(path==='/searches')return {searches:stored};
 if(path==='/search')return {results:[{id:'matching-note',content:'project plans'}],highlight_terms:['project']};
 throw Error(path);
}});
vm.runInContext(source.slice(source.indexOf('function readSearchFilters('),source.indexOf('function editorContext(')),ctx);
await ctx.search();
assert.equal(requests[0].payload.filters.exclude,'meeting, draft');
assert.equal(requests[0].payload.filters.scope,'content');
ctx.saveSearch();
elements.search.value='changed while naming';
await assert.rejects(()=>saveCallback('   '),/Enter a name/);
await saveCallback('  Work projects  ');
assert.equal(stored[0].name,'Work projects');
assert.equal(stored[0].query,'project');
assert.equal(stored[0].filters.exclude,'meeting, draft');
for(const e of Object.values(elements))if('value' in e)e.value='';
await ctx.openSavedSearch(stored[0]);
assert.equal(elements.search.value,'project');
assert.equal(elements['filter-scope'].value,'content');
assert.equal(elements['filter-exclude'].value,'meeting, draft');
assert.equal(elements['filter-folder'].value,'Work');
assert.equal(elements['filter-tag'].value,'Ideas');
assert.equal(elements.filters.hidden,false);
assert.equal(elements['filter-toggle']['aria-expanded'],'true');
assert.equal(requests.at(-1).path,'/search');
assert.equal(requests.at(-1).payload.filters.exclude,'meeting, draft');
assert.ok(renders>0&&stashes>0);
await ctx.openSavedSearch({query:'legacy',filters:{}});
assert.equal(elements['filter-scope'].value,'all');
assert.equal(elements['filter-exclude'].value,'');
state.online=false;
assert.throws(()=>ctx.saveSearch(),/offline/);
console.log('PASS: content/exclusions sent, named search saved, captured filters restored, legacy searches and offline errors');

state.online=true;
state.view='trash';
await ctx.search();
assert.equal(requests.at(-1).payload.filters.category,'trash');
ctx.saveSearch();
await saveCallback('Trash search');
state.view='all';
await ctx.openSavedSearch(stored[0]);
assert.equal(state.view,'trash');
assert.equal(requests.at(-1).payload.filters.category,'trash');
state.view='archive';
await ctx.search();
assert.equal(requests.at(-1).payload.filters.category,'archived');
state.view='all';
await ctx.search();
assert.equal(requests.at(-1).payload.filters.category,'active');
console.log('PASS: Archive/Trash search scope, saved category restoration, ordinary searches remain active');

// The visible panel list runs the same restore function as the sidebar.
elements['saved-filter-list']={};
ctx.handle=fn=>fn;
const chosen=stored[0];
state.searches=[chosen];
vm.runInContext(source.slice(source.indexOf('  $("saved-filter-list").onclick ='),
  source.indexOf('  $("filter-toggle").onclick =')),ctx);
await elements['saved-filter-list'].onclick({target:{closest:()=>({dataset:{savedSearch:chosen.id}})}});
assert.equal(elements.search.value,chosen.query);
assert.equal(elements['filter-exclude'].value,chosen.filters.exclude);
assert.equal(requests.at(-1).payload.filters.scope,chosen.filters.scope);
console.log('PASS: visible saved-search list click restores and runs the saved options');

// Limit handling blocks opening/sending another save; deletion opens a slot again.
let notices=[];ctx.notify=message=>notices.push(message);
state.searches=Array.from({length:5},(_,i)=>({id:'limit-'+i,name:'Saved '+i}));
let dialogs=0;ctx.inputDialog=()=>{dialogs++;};
ctx.saveSearch();assert.equal(dialogs,0);assert.match(notices.at(-1),/up to 5/);
state.searches.pop();ctx.saveSearch();assert.equal(dialogs,1);
for(const [view,category] of [['favorites','favorites'],['recent','recent'],['reminders','reminders'],['archive','archived'],['trash','trash'],['all','active']]){
 state.view=view;await ctx.search();assert.equal(requests.at(-1).payload.filters.category,category);
 await ctx.openSavedSearch({query:'project',filters:{category,scope:'content'}});
 assert.equal(state.view,view);assert.equal(requests.at(-1).payload.filters.category,category);
}
console.log('PASS: five-search UI limit, deletion frees a slot, every tab and saved tab scope are restored');
