"use strict";

const tabsNode=document.querySelector("#tabs");
const viewsNode=document.querySelector("#terminal-views");
const note=document.querySelector("#note");
const keybar=document.querySelector("#keybar");
const frames=new Map();
let tabs=[];
let active=localStorage.getItem("termdock-active")||"main";
let shortcutTask=null;
let suppressInputOnce=false;
const modifiers={ctrl:false,alt:false};

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
  if(event.termdockToolbarKey)return;
  const index=shortcutIndex(event);
  if(index<0)return;
  event.preventDefault();event.stopImmediatePropagation();
  if(tabs[index])activate(tabs[index].id);else openShortcut(index);
}

function focusFrame(frame){
  requestAnimationFrame(()=>{try{frame.contentWindow.focus();frame.contentDocument.querySelector(".xterm-helper-textarea")?.focus()}catch{}});
}

function renderModifiers(){
  keybar.querySelector('[data-modifier="ctrl"]').setAttribute("aria-pressed",String(modifiers.ctrl));
  keybar.querySelector('[data-modifier="alt"]').setAttribute("aria-pressed",String(modifiers.alt));
}

function clearModifiers(){
  modifiers.ctrl=false;modifiers.alt=false;renderModifiers();
}

function emitTerminalKey(key,code,keyCode,forced={}){
  const frame=frames.get(active);
  try{
    const win=frame.contentWindow;
    const target=frame.contentDocument.querySelector(".xterm-helper-textarea");
    if(!target)return false;
    const ctrlKey=forced.ctrlKey??modifiers.ctrl;
    const altKey=forced.altKey??modifiers.alt;
    for(const type of ["keydown","keyup"]){
      const event=new win.KeyboardEvent(type,{key,code,ctrlKey,altKey,bubbles:true,cancelable:true});
      Object.defineProperties(event,{keyCode:{get:()=>keyCode},which:{get:()=>keyCode},termdockToolbarKey:{value:true}});
      target.dispatchEvent(event);
    }
    clearModifiers();focusFrame(frame);return true;
  }catch{return false}
}

function handleLatchedKey(event){
  if(event.termdockToolbarKey||(!modifiers.ctrl&&!modifiers.alt)||["Control","Alt","Shift","Meta"].includes(event.key))return;
  event.preventDefault();event.stopImmediatePropagation();
  suppressInputOnce=true;setTimeout(()=>{suppressInputOnce=false},0);
  emitTerminalKey(event.key,event.code,event.keyCode||event.which||0,{ctrlKey:modifiers.ctrl||event.ctrlKey,altKey:modifiers.alt||event.altKey});
}

function handleLatchedInput(event){
  if(suppressInputOnce){event.preventDefault();event.stopImmediatePropagation();suppressInputOnce=false;return}
  if((!modifiers.ctrl&&!modifiers.alt)||!event.data)return;
  event.preventDefault();event.stopImmediatePropagation();
  const key=event.data[0];
  const upper=key.toUpperCase();
  emitTerminalKey(key,/^[A-Z]$/.test(upper)?`Key${upper}`:"",upper.charCodeAt(0));
}

function installTouchScroll(frame){
  try{
    const doc=frame.contentDocument;
    const win=frame.contentWindow;
    const viewport=doc.querySelector(".xterm-viewport");
    if(!viewport)return false;
    if(doc.documentElement.dataset.termdockTouchScroll)return true;
    doc.documentElement.dataset.termdockTouchScroll="true";
    viewport.style.overscrollBehavior="contain";
    viewport.style.webkitOverflowScrolling="touch";
    let lastCenterY=null;
    const centerY=touches=>Array.from(touches).reduce((sum,touch)=>sum+touch.clientY,0)/touches.length;
    const reset=()=>{lastCenterY=null};
    win.addEventListener("touchstart",event=>{
      if(event.touches.length<2){reset();return}
      lastCenterY=centerY(event.touches);
      event.preventDefault();event.stopImmediatePropagation();
    },{capture:true,passive:false});
    win.addEventListener("touchmove",event=>{
      if(event.touches.length<2){reset();return}
      const nextCenterY=centerY(event.touches);
      if(lastCenterY!==null){
        const screen=doc.querySelector(".xterm-screen")||viewport;
        screen.dispatchEvent(new win.WheelEvent("wheel",{
          deltaY:(lastCenterY-nextCenterY)*2,deltaMode:0,
          clientX:event.touches[0].clientX,clientY:event.touches[0].clientY,
          bubbles:true,cancelable:true,
        }));
      }
      lastCenterY=nextCenterY;
      event.preventDefault();event.stopImmediatePropagation();
    },{capture:true,passive:false});
    win.addEventListener("touchend",event=>{if(event.touches.length<2)reset()},{capture:true});
    win.addEventListener("touchcancel",reset,{capture:true});
    return true;
  }catch{return false}
}

function installMouseSelection(frame){
  try{
    const doc=frame.contentDocument;
    const win=frame.contentWindow;
    if(!doc.querySelector(".xterm"))return false;
    if(doc.documentElement.dataset.termdockMouseSelection)return true;
    doc.documentElement.dataset.termdockMouseSelection="true";
    let pending=null;
    let selecting=false;
    let suppressClick=false;
    const snapshot=event=>({
      type:event.type,target:event.target,clientX:event.clientX,clientY:event.clientY,
      screenX:event.screenX,screenY:event.screenY,button:event.button,buttons:event.buttons,
      detail:event.detail||1,ctrlKey:event.ctrlKey,altKey:event.altKey,
      metaKey:event.metaKey,shiftKey:event.shiftKey,
    });
    const dispatch=(source,target,forceSelection=false)=>{
      const event=new win.MouseEvent(source.type,{
        bubbles:true,cancelable:true,view:win,
        clientX:source.clientX,clientY:source.clientY,screenX:source.screenX,screenY:source.screenY,
        button:source.button,buttons:source.buttons,detail:source.detail,
        ctrlKey:source.ctrlKey,altKey:source.altKey,metaKey:source.metaKey,
        shiftKey:forceSelection||source.shiftKey,
      });
      Object.defineProperty(event,"termdockSelectionEvent",{value:true});
      target.dispatchEvent(event);
    };
    win.addEventListener("mousedown",event=>{
      if(event.termdockSelectionEvent||event.button!==0||event.shiftKey||!event.target.closest?.(".xterm"))return;
      pending=snapshot(event);selecting=false;
      event.preventDefault();event.stopImmediatePropagation();
    },{capture:true,passive:false});
    win.addEventListener("mousemove",event=>{
      if(!pending||event.termdockSelectionEvent)return;
      if(!(event.buttons&1)){pending=null;selecting=false;return}
      if(!selecting&&Math.hypot(event.clientX-pending.clientX,event.clientY-pending.clientY)>=4){
        selecting=true;dispatch(pending,pending.target,true);
      }
      if(selecting)dispatch(snapshot(event),event.target,true);
      event.preventDefault();event.stopImmediatePropagation();
    },{capture:true,passive:false});
    win.addEventListener("mouseup",event=>{
      if(!pending||event.termdockSelectionEvent)return;
      event.preventDefault();event.stopImmediatePropagation();
      const current=snapshot(event);
      if(selecting){
        dispatch(current,event.target,true);suppressClick=true;
        setTimeout(()=>{suppressClick=false},0);
      }else{
        dispatch(pending,pending.target);dispatch(current,event.target);
      }
      pending=null;selecting=false;
    },{capture:true,passive:false});
    win.addEventListener("click",event=>{
      if(!suppressClick)return;
      suppressClick=false;event.preventDefault();event.stopImmediatePropagation();
    },true);
    win.addEventListener("blur",()=>{pending=null;selecting=false});
    return true;
  }catch{return false}
}

function flashKey(button,label){
  const original=button.dataset.label||button.textContent;
  button.dataset.label=original;button.textContent=label;
  clearTimeout(button.termdockFlashTimer);
  button.termdockFlashTimer=setTimeout(()=>{button.textContent=original},1400);
}

async function copyTerminalSelection(button){
  const frame=frames.get(active);
  try{
    const text=frame?.contentWindow.getSelection()?.toString()||"";
    if(!text){flashKey(button,"Select text");return false}
    try{await navigator.clipboard.writeText(text)}catch{
      if(!frame.contentDocument.execCommand("copy"))throw new Error("copy failed");
    }
    flashKey(button,"Copied");return true;
  }catch{flashKey(button,"Copy failed");return false}
}

function syncViewportHeight(){
  const height=window.visualViewport?.height||window.innerHeight;
  document.documentElement.style.setProperty("--viewport-height",`${Math.round(height)}px`);
  document.body.classList.toggle("compact-mobile",window.innerWidth<=650&&height<=560);
}

function ensureFrame(id){
  let frame=frames.get(id);
  if(frame)return frame;
  frame=document.createElement("iframe");
  frame.dataset.id=id;frame.title="SSH terminal";frame.allow="clipboard-read; clipboard-write";frame.src=terminalUrl(id);
  frame.addEventListener("load",()=>{try{frame.contentWindow.addEventListener("keydown",handleShortcut,true);frame.contentWindow.addEventListener("keydown",handleLatchedKey,true);frame.contentWindow.addEventListener("beforeinput",handleLatchedInput,true);installTouchScroll(frame);installMouseSelection(frame);setTimeout(()=>{installTouchScroll(frame);installMouseSelection(frame)},250);setTimeout(()=>{installTouchScroll(frame);installMouseSelection(frame)},1000)}catch{}if(id===active)focusFrame(frame)});
  frames.set(id,frame);viewsNode.append(frame);return frame;
}

function activate(id,reload=false){
  if(!tabs.some(tab=>tab.id===id))id=tabs[0]?.id||"main";
  active=id;localStorage.setItem("termdock-active",id);clearModifiers();render();
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

keybar.addEventListener("pointerdown",event=>{if(event.target.closest("button"))event.preventDefault()});
keybar.addEventListener("click",async event=>{
  const button=event.target.closest("button");if(!button)return;
  const modifier=button.dataset.modifier;
  if(modifier){modifiers[modifier]=!modifiers[modifier];renderModifiers();focusFrame(frames.get(active));return}
  if(button.dataset.key==="tab")emitTerminalKey("Tab","Tab",9);
  if(button.dataset.key==="copy")await copyTerminalSelection(button);
  if(button.dataset.key==="clear")emitTerminalKey("l","KeyL",76,{ctrlKey:true,altKey:false});
});

document.addEventListener("keydown",handleShortcut,true);
document.querySelector("#reconnect").addEventListener("click",()=>activate(active,true));
syncViewportHeight();
window.addEventListener("resize",syncViewportHeight);
window.visualViewport?.addEventListener("resize",syncViewportHeight);
window.visualViewport?.addEventListener("scroll",syncViewportHeight);
load();
setInterval(async()=>{try{const body=await requestJson("/api/tabs");tabs=body.tabs||tabs;render()}catch{}},15000);
