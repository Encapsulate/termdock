"use strict";

const tabsNode=document.querySelector("#tabs");
const viewsNode=document.querySelector("#terminal-views");
const note=document.querySelector("#note");
const keybar=document.querySelector("#keybar");
const frames=new Map();
const selectionCache=new Map();
let tabs=[];
let active=localStorage.getItem("termdock-active")||"main";
let shortcutTask=null;
let suppressInputOnce=false;
let tallestViewport=window.visualViewport?.height||window.innerHeight;
const modifiers={ctrl:false,alt:false,shift:false};
const modifierLocks={ctrl:false,alt:false,shift:false};

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

function handleCopyShortcut(event){
  if(event.termdockToolbarKey||!event.ctrlKey||!event.shiftKey||event.altKey||event.metaKey)return;
  if((event.code||"")!=="KeyC"&&(event.key||"").toLowerCase()!=="c")return;
  event.preventDefault();event.stopImmediatePropagation();
  void copyTerminalSelection(keybar.querySelector('[data-key="copy"]'));
}

function handlePasteShortcut(event){
  if(event.termdockToolbarKey||!event.ctrlKey||!event.shiftKey||event.altKey||event.metaKey)return;
  if((event.code||"")!=="KeyV"&&(event.key||"").toLowerCase()!=="v")return;
  // Keep Chrome's native paste default, but stop xterm's keydown handler from
  // canceling it before the browser can emit the trusted paste event.
  event.stopImmediatePropagation();
}

async function prepareTerminalPaste(event){
  const text=event.clipboardData?.getData("text/plain")||"";
  if(text){event.preventDefault();event.stopImmediatePropagation()}
  const tabId=active;
  try{
    await fetch(`/api/tabs/${encodeURIComponent(tabId)}/prepare-paste`,{
      method:"POST",headers:{"X-TermDock-Request":"1"}
    });
  }catch{return}
  if(!text||active!==tabId)return;
  const target=event.target;
  if(!(target instanceof target.ownerDocument.defaultView.HTMLTextAreaElement))return;
  const terminalWindow=target.ownerDocument.defaultView;
  target.focus();
  if(typeof terminalWindow.term?.paste==="function"){
    terminalWindow.term.paste(text);return;
  }
  target.value=text;
  target.dispatchEvent(new terminalWindow.InputEvent("input",{
    bubbles:true,inputType:"insertFromPaste",data:text
  }));
  target.value="";
}

function openTerminalMenu(event){
  event.preventDefault();event.stopImmediatePropagation();
}

function focusFrame(frame){
  requestAnimationFrame(()=>{try{frame.contentWindow.focus();frame.contentDocument.querySelector(".xterm-helper-textarea")?.focus()}catch{}});
}

function renderModifiers(){
  for(const name of Object.keys(modifiers)){
    const button=keybar.querySelector(`[data-modifier="${name}"]`);
    button.setAttribute("aria-pressed",String(modifiers[name]));
    button.dataset.locked=String(modifierLocks[name]);
    button.title=modifierLocks[name]?`${button.textContent} is locked; press again to release`:`Click to latch; double-click to lock`;
  }
}

function clearModifiers(){
  for(const name of Object.keys(modifiers))if(!modifierLocks[name])modifiers[name]=false;
  renderModifiers();
}

function emitTerminalKey(key,code,keyCode,forced={}){
  const frame=frames.get(active);
  try{
    const win=frame.contentWindow;
    const target=frame.contentDocument.querySelector(".xterm-helper-textarea");
    if(!target)return false;
    const ctrlKey=forced.ctrlKey??modifiers.ctrl;
    const altKey=forced.altKey??modifiers.alt;
    const shiftKey=forced.shiftKey??modifiers.shift;
    for(const type of ["keydown","keyup"]){
      const event=new win.KeyboardEvent(type,{key,code,ctrlKey,altKey,shiftKey,bubbles:true,cancelable:true});
      Object.defineProperties(event,{keyCode:{get:()=>keyCode},which:{get:()=>keyCode},termdockToolbarKey:{value:true}});
      target.dispatchEvent(event);
    }
    clearModifiers();focusFrame(frame);return true;
  }catch{return false}
}

function handleLatchedKey(event){
  if(event.termdockToolbarKey||(!modifiers.ctrl&&!modifiers.alt&&!modifiers.shift)||["Control","Alt","Shift","Meta"].includes(event.key))return;
  event.preventDefault();event.stopImmediatePropagation();
  suppressInputOnce=true;setTimeout(()=>{suppressInputOnce=false},0);
  emitTerminalKey(event.key,event.code,event.keyCode||event.which||0,{ctrlKey:modifiers.ctrl||event.ctrlKey,altKey:modifiers.alt||event.altKey,shiftKey:modifiers.shift||event.shiftKey});
}

function handleLatchedInput(event){
  if(suppressInputOnce){event.preventDefault();event.stopImmediatePropagation();suppressInputOnce=false;return}
  if((!modifiers.ctrl&&!modifiers.alt&&!modifiers.shift)||!event.data)return;
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
    const terminal=doc.querySelector(".xterm");
    if(!terminal)return false;
    if(doc.documentElement.dataset.termdockMouseSelection)return true;
    doc.documentElement.dataset.termdockMouseSelection="true";
    terminal.style.touchAction="none";
    let ignoreMouseUntil=0;
    let touchPending=null;
    let touchSelecting=false;
    let touchSelectionVersion=0;
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
    // Desktop mouse events must reach ttyd/tmux unchanged. tmux owns the
    // selection and keeps it highlighted after release. This bridge exists
    // only to translate one-finger touch gestures into selection events.
    for(const type of ["mousedown","mousemove","mouseup","click"]){
      win.addEventListener(type,event=>{
        if(Date.now()>=ignoreMouseUntil||event.termdockSelectionEvent)return;
        event.preventDefault();event.stopImmediatePropagation();
      },{capture:true,passive:false});
    }
    // Keep right-button events available to the terminal while suppressing
    // the browser's unrelated context-menu popup over the terminal canvas.
    win.addEventListener("contextmenu",openTerminalMenu,true);
    win.addEventListener("mousedown",event=>{
      if(event.button===0)selectionCache.delete(active);
    },{capture:true});
    win.addEventListener("mouseup",event=>{
      if(event.button===0)setTimeout(()=>{void cacheTerminalSelection(active)},40);
    });
    const fromTouch=(type,touch,target,buttons)=>({
      type,target,clientX:touch.clientX,clientY:touch.clientY,
      screenX:touch.screenX,screenY:touch.screenY,button:0,buttons,detail:1,
      ctrlKey:false,altKey:false,metaKey:false,shiftKey:false,
    });
    const touchCell=touch=>{
      const screen=doc.querySelector(".xterm-screen");
      const terminalWindow=frame.contentWindow;
      const term=terminalWindow.term;
      if(!screen||!term)return null;
      const rect=screen.getBoundingClientRect();
      const column=Math.max(0,Math.min(term.cols-1,Math.floor((touch.clientX-rect.left)*term.cols/rect.width)));
      const visibleRow=Math.max(0,Math.min(term.rows-1,Math.floor((touch.clientY-rect.top)*term.rows/rect.height)));
      return {column,row:(term.buffer?.active?.viewportY||0)+visibleRow};
    };
    const selectTouchRange=(start,end)=>{
      const term=frame.contentWindow.term;
      if(!term||!start||!end)return null;
      let first=start,last=end;
      if(first.row>last.row||(first.row===last.row&&first.column>last.column)){
        first=end;last=start;
      }
      const length=Math.max(1,(last.row-first.row)*term.cols+last.column-first.column);
      term.select(first.column,first.row,length);
      return {column:first.column,row:first.row,length,text:term.getSelection()};
    };
    const resetTouch=()=>{touchPending=null;touchSelecting=false};
    win.addEventListener("touchstart",event=>{
      if(event.touches.length!==1){resetTouch();return}
      const touch=event.touches[0];
      touchSelectionVersion+=1;
      touchPending={...fromTouch("mousedown",touch,event.target,1),cell:touchCell(touch)};touchSelecting=false;
      event.preventDefault();event.stopImmediatePropagation();
    },{capture:true,passive:false});
    win.addEventListener("touchmove",event=>{
      if(event.touches.length!==1){resetTouch();return}
      if(!touchPending)return;
      const touch=event.touches[0];
      if(!touchSelecting&&Math.hypot(touch.clientX-touchPending.clientX,touch.clientY-touchPending.clientY)>=4){
        touchSelecting=true;
      }
      if(touchSelecting)selectTouchRange(touchPending.cell,touchCell(touch));
      event.preventDefault();event.stopImmediatePropagation();
    },{capture:true,passive:false});
    win.addEventListener("touchend",event=>{
      if(!touchPending||event.touches.length)return;
      const touch=event.changedTouches[0];
      const target=doc.elementFromPoint(touch.clientX,touch.clientY)||touchPending.target;
      const current=fromTouch("mouseup",touch,target,0);
      if(touchSelecting){
        const retained=selectTouchRange(touchPending.cell,touchCell(touch));
        const version=touchSelectionVersion;
        if(retained?.text)selectionCache.set(active,retained.text);
        for(const delay of [0,250])setTimeout(()=>{
          if(version===touchSelectionVersion&&retained?.text&&!frame.contentWindow.term.getSelection()){
            frame.contentWindow.term.select(retained.column,retained.row,retained.length);
          }
        },delay);
      }else{
        dispatch(touchPending,touchPending.target);dispatch(current,target);
        doc.querySelector(".xterm-helper-textarea")?.focus();
      }
      ignoreMouseUntil=Date.now()+800;resetTouch();
      event.preventDefault();event.stopImmediatePropagation();
    },{capture:true,passive:false});
    win.addEventListener("touchcancel",resetTouch,{capture:true});
    win.addEventListener("blur",resetTouch);
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
    let text=frame?.contentWindow.term?.getSelection?.()||frame?.contentWindow.getSelection()?.toString()||selectionCache.get(active)||"";
    if(!text)text=await readTerminalSelection();
    if(!text){flashKey(button,"Select text");return false}
    await writeClipboard(text,frame);
    flashKey(button,"Copied");return true;
  }catch{flashKey(button,"Copy failed");return false}
}

async function cacheTerminalSelection(tabId){
  try{
    const text=await readTerminalSelection(tabId);
    if(text)selectionCache.set(tabId,text);
  }catch{}
}

async function readTerminalSelection(tabId=active){
  const response=await fetch(`/api/tabs/${encodeURIComponent(tabId)}/selection`,{
    headers:{"X-TermDock-Request":"1"}
  });
  if(!response.ok)throw new Error("copy failed");
  return (await response.json()).text||"";
}

async function writeClipboard(text,frame){
  const field=document.createElement("textarea");
  field.value=text;field.readOnly=true;
  field.style.cssText="position:fixed;left:-9999px;top:0;opacity:0";
  document.body.append(field);field.focus({preventScroll:true});field.select();
  const copied=document.execCommand("copy");field.remove();focusFrame(frame);
  if(copied)return;
  if(window.isSecureContext&&navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);return}
  throw new Error("copy failed");
}

function syncViewportHeight(){
  const height=window.visualViewport?.height||window.innerHeight;
  tallestViewport=Math.max(tallestViewport,height);
  document.documentElement.style.setProperty("--viewport-height",`${Math.round(height)}px`);
  document.body.classList.toggle("compact-mobile",window.innerWidth<=650&&height<=560);
  document.body.classList.toggle("portal-keyboard-open",window.innerWidth<=650&&tallestViewport-height>150);
}

function ensureFrame(id){
  let frame=frames.get(id);
  if(frame)return frame;
  frame=document.createElement("iframe");
  frame.dataset.id=id;frame.title="SSH terminal";frame.allow="clipboard-read; clipboard-write";frame.src=terminalUrl(id);
  frame.addEventListener("load",()=>{try{frame.contentWindow.addEventListener("keydown",handleCopyShortcut,true);frame.contentWindow.addEventListener("keydown",handlePasteShortcut,true);frame.contentWindow.addEventListener("keydown",handleShortcut,true);frame.contentWindow.addEventListener("keydown",handleLatchedKey,true);frame.contentWindow.addEventListener("beforeinput",handleLatchedInput,true);frame.contentWindow.addEventListener("paste",prepareTerminalPaste,true);installMouseSelection(frame);installTouchScroll(frame);setTimeout(()=>{installMouseSelection(frame);installTouchScroll(frame)},250);setTimeout(()=>{installMouseSelection(frame);installTouchScroll(frame)},1000)}catch{}if(id===active)focusFrame(frame)});
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
keybar.addEventListener("dblclick",event=>{if(event.target.closest("[data-modifier]"))event.preventDefault()});
keybar.addEventListener("click",async event=>{
  const button=event.target.closest("button");if(!button)return;
  const modifier=button.dataset.modifier;
  if(modifier){
    if(event.detail>=2){modifiers[modifier]=true;modifierLocks[modifier]=true}
    else if(modifierLocks[modifier]){modifiers[modifier]=false;modifierLocks[modifier]=false}
    else modifiers[modifier]=!modifiers[modifier];
    renderModifiers();focusFrame(frames.get(active));return;
  }
  if(button.dataset.key==="tab")emitTerminalKey("Tab","Tab",9);
  if(button.dataset.key==="copy")await copyTerminalSelection(button);
  if(button.dataset.key==="clear")emitTerminalKey("l","KeyL",76,{ctrlKey:true,altKey:false,shiftKey:false});
  if(button.dataset.key==="up")emitTerminalKey("ArrowUp","ArrowUp",38);
  if(button.dataset.key==="down")emitTerminalKey("ArrowDown","ArrowDown",40);
});

document.addEventListener("keydown",handleShortcut,true);
document.addEventListener("keydown",handleCopyShortcut,true);
document.addEventListener("keydown",handlePasteShortcut,true);
document.querySelector("#reconnect").addEventListener("click",()=>activate(active,true));
syncViewportHeight();
window.addEventListener("resize",syncViewportHeight);
window.visualViewport?.addEventListener("resize",syncViewportHeight);
window.visualViewport?.addEventListener("scroll",syncViewportHeight);
window.addEventListener("orientationchange",()=>{
  tallestViewport=window.visualViewport?.height||window.innerHeight;
  setTimeout(syncViewportHeight,250);
});
load();
setInterval(async()=>{try{const body=await requestJson("/api/tabs");tabs=body.tabs||tabs;render()}catch{}},15000);
