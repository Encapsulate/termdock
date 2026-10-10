"use strict";

const tabsNode=document.querySelector("#tabs");
const viewsNode=document.querySelector("#terminal-views");
const note=document.querySelector("#note");
const frames=new Map();
let tabs=[];
let active=localStorage.getItem("termdock-active")||"main";
let shortcutTask=null;

const esc=value=>String(value).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[ch]);
const terminalUrl=id=>`/console/?arg=${encodeURIComponent(id)}`;

function showError(message){note.textContent=message;note.classList.add("error")}
function clearError(){note.classList.remove("error")}

function render(){
  tabsNode.innerHTML=tabs.map((tab,index)=>{
    const shortcut=index<9?index+1:index===9?0:null;
    const title=`${tab.running?"Session is running":"Session starts when opened"}${shortcut===null?"":` · Alt+${shortcut}`}`;
    return `<span class="tab ${tab.id===active?"active":""} ${tab.running?"running":""}" data-id="${tab.id}"><button class="select" type="button" title="${title}"><span class="dot"></span>${esc(tab.name)}</button><button class="close" type="button" aria-label="Close ${esc(tab.name)}" title="End this SSH session">×</button></span>`;
  }).join("")+`<button class="new" id="new-tab" type="button">+ New terminal</button>`;
}

function shortcutIndex(event){
  if(!event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return -1;
  const match=/^(?:Digit|Numpad)([0-9])$/.exec(event.code||"")||/^([0-9])$/.exec(event.key||"");
  if(!match)return -1;
  return match[1]==="0"?9:Number(match[1])-1;
}

function handleShortcut(event){
  const index=shortcutIndex(event);
  if(index<0)return;
  event.preventDefault();event.stopImmediatePropagation();
  if(tabs[index])activate(tabs[index].id);else openShortcut(index);
}

function focusFrame(frame){
  requestAnimationFrame(()=>{try{frame.contentWindow.focus();frame.contentDocument.querySelector(".xterm-helper-textarea")?.focus()}catch{}});
}

function ensureFrame(id){
  let frame=frames.get(id);
  if(frame)return frame;
  frame=document.createElement("iframe");
  frame.dataset.id=id;frame.title="SSH terminal";frame.allow="clipboard-read; clipboard-write";frame.src=terminalUrl(id);
  frame.addEventListener("load",()=>{try{frame.contentWindow.addEventListener("keydown",handleShortcut,true)}catch{}if(id===active)focusFrame(frame)});
  frames.set(id,frame);viewsNode.append(frame);return frame;
}

function activate(id,reload=false){
  if(!tabs.some(tab=>tab.id===id))id=tabs[0]?.id||"main";
  active=id;localStorage.setItem("termdock-active",id);render();
  const frame=ensureFrame(id);
  if(reload)frame.src=terminalUrl(id);
  frames.forEach((item,frameId)=>{item.hidden=frameId!==id});focusFrame(frame);
}

async function requestJson(url,options={}){
  const headers={"X-TermDock-Request":"1",...(options.headers||{})};
  const response=await fetch(url,{...options,headers});
  let body={};try{body=await response.json()}catch{}
  if(!response.ok)throw new Error(body.error||`Request failed (${response.status})`);
  return body;
}

async function createTab(){
  const tab=await requestJson("/api/tabs",{method:"POST"});
  if(!tabs.some(item=>item.id===tab.id))tabs.push(tab);
  return tab;
}

function openShortcut(index){
  if(shortcutTask)return;
  shortcutTask=(async()=>{try{while(tabs.length<=index)await createTab();activate(tabs[index].id);clearError()}catch(error){showError(error.message)}finally{shortcutTask=null}})();
}

async function load(){
  try{const body=await requestJson("/api/tabs");tabs=body.tabs||[];activate(active);clearError()}catch(error){showError(error.message)}
}

tabsNode.addEventListener("click",async event=>{
  if(event.target.closest("#new-tab")){
    try{const tab=await createTab();activate(tab.id);clearError()}catch(error){showError(error.message)}
    return;
  }
  const tabNode=event.target.closest(".tab");if(!tabNode)return;
  const id=tabNode.dataset.id;
  if(event.target.closest(".close")){
    const tab=tabs.find(item=>item.id===id);
    if(!confirm(`Close ${tab?.name||"this terminal"} and end its running SSH session?`))return;
    try{
      await requestJson(`/api/tabs/${encodeURIComponent(id)}`,{method:"DELETE"});
      tabs=tabs.filter(item=>item.id!==id);frames.get(id)?.remove();frames.delete(id);
      if(!tabs.length)await load();else activate(active===id?tabs[0].id:active);clearError();
    }catch(error){showError(error.message)}
  }else activate(id);
});

document.addEventListener("keydown",handleShortcut,true);
document.querySelector("#reconnect").addEventListener("click",()=>activate(active,true));
load();
setInterval(async()=>{try{const body=await requestJson("/api/tabs");tabs=body.tabs||tabs;render()}catch{}},15000);
