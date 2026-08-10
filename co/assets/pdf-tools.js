// Lazy-loaded PDF signing workspace for Document Signature Tool · by tum1click
// v91: signature, inline text, redact/whiteout, draw/strike-through, highlight, PDF zoom, saved prefs

let pdfjsLib = null;
let PDFLib = null;
let fontkit = null;

const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
const PDFLIB_URL = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm';
const FONTKIT_URL = 'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/+esm';
const THAI_FONT_URL = 'https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts/unhinted/ttf/NotoSansThai/NotoSansThai-Regular.ttf';
const SARABUN_FONT_URL = 'https://cdn.jsdelivr.net/gh/google/fonts/ofl/sarabun/Sarabun-Regular.ttf';
const PREF_KEY = 'documentSignature.pdfSigner.v55';
const CUSTOM_SIG_KEY = 'documentSignature.customSignatures.v55';

async function loadDeps(){
  if(!pdfjsLib){
    pdfjsLib = await import(PDFJS_URL);
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  }
  if(!PDFLib) PDFLib = await import(PDFLIB_URL);
  if(!fontkit) fontkit = await import(FONTKIT_URL);
}
function cssPx(n){ return `${Math.round(n)}px`; }
function clamp(n,a,b){ return Math.max(a,Math.min(b,n)); }
function hexToRgb01(hex){
  const m=(hex||'#111111').replace('#','');
  return {r:(parseInt(m.slice(0,2),16)||0)/255,g:(parseInt(m.slice(2,4),16)||0)/255,b:(parseInt(m.slice(4,6),16)||0)/255};
}
function loadPrefs(){ try{return JSON.parse(localStorage.getItem(PREF_KEY)||'{}')}catch(e){return {}} }
function loadCustomSigs(){ try{return JSON.parse(localStorage.getItem(CUSTOM_SIG_KEY)||'[]')}catch(e){return []} }
function saveCustomSigs(list){ try{localStorage.setItem(CUSTOM_SIG_KEY,JSON.stringify((list||[]).slice(-30)))}catch(e){} }
function canvasFromDataUrl(dataUrl){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>{const c=document.createElement('canvas');c.width=img.naturalWidth||img.width;c.height=img.naturalHeight||img.height;c.getContext('2d').drawImage(img,0,0,c.width,c.height);resolve(c)};
    img.onerror=reject; img.src=dataUrl;
  });
}
async function imageFileToCleanDataUrl(file){
  const dataUrl=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file)});
  const src=await canvasFromDataUrl(dataUrl);
  const maxW=1000, scale=Math.min(1,maxW/src.width);
  const out=document.createElement('canvas');
  out.width=Math.max(1,Math.round(src.width*scale)); out.height=Math.max(1,Math.round(src.height*scale));
  const c=out.getContext('2d',{willReadFrequently:true});
  c.drawImage(src,0,0,out.width,out.height);
  const img=c.getImageData(0,0,out.width,out.height),d=img.data;
  for(let i=0;i<d.length;i+=4){
    const gray=.299*d[i]+.587*d[i+1]+.114*d[i+2];
    let a=clamp((210-gray)*2.45,0,255);
    if(a<25)a=0;
    d[i]=0;d[i+1]=0;d[i+2]=0;d[i+3]=a;
  }
  c.putImageData(img,0,0);
  return out.toDataURL('image/png');
}
function getOutputItems(ctx){
  const {$,tabs}=ctx;
  return tabs().map(t=>{const canvas=$(`out_${t.id}`);return {id:t.id,label:t.label,source:'output',canvas,ok:canvas&&canvas.width>1&&canvas.height>1}}).filter(x=>x.ok);
}

export async function openPdfSigner(ctx){
  const drawOnlyMode = !!ctx.drawOnly;
  const initialPdfFile = ctx.initialPdfFile || null;
  await loadDeps();
  const {$}=ctx;
  const modal=$('pdfModal');
  if(!modal) return alert('ไม่พบหน้า PDF Signer');
  modal.style.display='flex';
  modal.classList.toggle('drawOnly', drawOnlyMode);

  const state=window.__pdfSignerState||(window.__pdfSignerState={
    pdfBytes:null,pdfDoc:null,pdfName:'signed.pdf',selected:null,placeMode:null,activeId:null,
    stamps:[],texts:[],redacts:[],draws:[],highlights:[],history:[],redoStack:[],pickHighlightPage:false,
    scale:1.35,customSigs:loadCustomSigs(),customCanvas:{},drawReady:false,drawShape:'pen',detectedFont:'Auto'
  });
  state.stamps=state.stamps||[]; state.texts=state.texts||[]; state.redacts=state.redacts||[]; state.draws=state.draws||[]; state.highlights=state.highlights||[]; state.history=state.history||[]; state.redoStack=state.redoStack||[];
  state.customSigs=state.customSigs||loadCustomSigs(); state.customCanvas=state.customCanvas||{};

  function savePrefs(){
    try{
      localStorage.setItem(PREF_KEY,JSON.stringify({
        stampWidth:+$('pdfStampWidth')?.value||180,
        intensity:+$('pdfIntensity')?.value||100,
        opacity:+$('pdfOpacity')?.value||100,
        rotation:+$('pdfRotation')?.value||0,
        fontSize:+$('pdfFontSize')?.value||16,
        textColor:$('pdfTextColor')?.value||'#111111',
        textInput:$('pdfTextInput')?.value||'',
        keepText:!!$('pdfKeepTextInput')?.checked,
        fontFamily:$('pdfFontFamily')?.value||'auto',
        drawShape:state.drawShape||'pen',
        penColor:$('pdfPenColor')?.value||'#111111',
        penSize:+$('pdfPenSize')?.value||4,
        penOpacity:+$('pdfPenOpacity')?.value||100,
        highlightColor:$('pdfHighlightColor')?.value||'#ffe600',
        highlightOpacity:+$('pdfHighlightOpacity')?.value||40,
        scale:state.scale||1.35
      }));
    }catch(e){}
  }
  function applyPrefs(){
    const p=loadPrefs();
    if(p.stampWidth&&$('pdfStampWidth')) $('pdfStampWidth').value=p.stampWidth;
    if(p.intensity&&$('pdfIntensity')) $('pdfIntensity').value=p.intensity;
    if(p.opacity&&$('pdfOpacity')) $('pdfOpacity').value=p.opacity;
    if(Number.isFinite(p.rotation)&&$('pdfRotation')) $('pdfRotation').value=p.rotation;
    if(p.fontSize&&$('pdfFontSize')) $('pdfFontSize').value=p.fontSize;
    if(p.textColor&&$('pdfTextColor')) $('pdfTextColor').value=p.textColor;
    if(p.textInput&&$('pdfTextInput')) $('pdfTextInput').value=p.textInput;
    if($('pdfKeepTextInput')) $('pdfKeepTextInput').checked=!!p.keepText;
    if(p.fontFamily&&$('pdfFontFamily')) $('pdfFontFamily').value=p.fontFamily;
    state.drawShape=p.drawShape||state.drawShape||'pen';
    syncDrawShapeButtons();
    if(p.penColor&&$('pdfPenColor')) $('pdfPenColor').value=p.penColor;
    if(p.penSize&&$('pdfPenSize')) $('pdfPenSize').value=p.penSize;
    if(p.penOpacity&&$('pdfPenOpacity')) $('pdfPenOpacity').value=p.penOpacity;
    if(p.highlightColor&&$('pdfHighlightColor')) $('pdfHighlightColor').value=p.highlightColor;
    if(p.highlightOpacity&&$('pdfHighlightOpacity')) $('pdfHighlightOpacity').value=p.highlightOpacity;
    if(p.scale) state.scale=p.scale;
  }
  function updateLabels(){
    if($('pdfStampWidthVal')) $('pdfStampWidthVal').textContent=$('pdfStampWidth').value+'px';
    if($('pdfIntensityVal')) $('pdfIntensityVal').textContent=$('pdfIntensity').value+'%';
    if($('pdfOpacityVal')) $('pdfOpacityVal').textContent=$('pdfOpacity').value+'%';
    if($('pdfRotationVal')) $('pdfRotationVal').textContent=$('pdfRotation').value+'°';
    if($('pdfFontSizeVal')) $('pdfFontSizeVal').textContent=$('pdfFontSize').value+'px';
    if($('pdfPenSizeVal')) $('pdfPenSizeVal').textContent=$('pdfPenSize').value+'px';
    if($('pdfPenOpacityVal')) $('pdfPenOpacityVal').textContent=$('pdfPenOpacity').value+'%';
    if($('pdfHighlightOpacityVal')) $('pdfHighlightOpacityVal').textContent=$('pdfHighlightOpacity').value+'%';
  }
  async function prepareCustomCanvases(){
    for(const s of state.customSigs){ if(!state.customCanvas[s.id]){ try{state.customCanvas[s.id]=await canvasFromDataUrl(s.dataUrl)}catch(e){} } }
  }
  function saveCustomLibrary(){ saveCustomSigs(state.customSigs); }
  async function addCustomFromFile(file,label='เพิ่มเอง'){
    if(!file) return;
    const dataUrl=await imageFileToCleanDataUrl(file);
    const id='custom_'+Math.random().toString(36).slice(2,9);
    const item={id,label:`sign${state.customSigs.length+1}`,dataUrl,createdAt:Date.now()};
    state.customSigs.push(item); state.customCanvas[id]=await canvasFromDataUrl(dataUrl);
    saveCustomLibrary(); refreshLibrary();
  }

  function cloneOverlayState(){
    return JSON.parse(JSON.stringify({
      stamps:state.stamps||[],
      texts:state.texts||[],
      redacts:state.redacts||[],
      draws:state.draws||[],
      highlights:state.highlights||[]
    }));
  }
  function pushHistory(label='edit'){
    state.history=state.history||[];
    state.redoStack=state.redoStack||[];
    state.history.push({label, data:cloneOverlayState()});
    state.redoStack=[];
    if(state.history.length>80) state.history.shift();
    updateUndoState();

  if(!modal.dataset.kbdUndoRedoBound){
    modal.dataset.kbdUndoRedoBound='1';
    window.addEventListener('keydown',(e)=>{
      if(modal.style.display==='none') return;
      const isUndo=(e.ctrlKey||e.metaKey) && !e.shiftKey && e.key.toLowerCase()==='z';
      const isRedo=((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='y') || ((e.ctrlKey||e.metaKey) && e.shiftKey && e.key.toLowerCase()==='z');
      if(isUndo){ e.preventDefault(); undoLast(); }
      if(isRedo){ e.preventDefault(); redoLast(); }
    });
  }

  }
  function restoreOverlayState(snap){
    if(!snap) return;
    state.stamps=snap.stamps||[];
    state.texts=snap.texts||[];
    state.redacts=snap.redacts||[];
    state.draws=snap.draws||[];
    state.highlights=snap.highlights||[];
    state.activeId=null;
    rerenderOverlays();
    updateUndoState();
  }
  function undoLast(){
    state.history=state.history||[];
    state.redoStack=state.redoStack||[];
    const last=state.history.pop();
    if(!last){
      if($('pdfSelectedSig')) $('pdfSelectedSig').textContent='ไม่มีรายการให้ Undo';
      updateUndoState();
      return;
    }
    state.redoStack.push({label:'redo', data:cloneOverlayState()});
    restoreOverlayState(last.data);
    if($('pdfSelectedSig')) $('pdfSelectedSig').textContent='Undo ล่าสุดแล้ว';
    updateUndoState();
  }
  function redoLast(){
    state.history=state.history||[];
    state.redoStack=state.redoStack||[];
    const next=state.redoStack.pop();
    if(!next){
      if($('pdfSelectedSig')) $('pdfSelectedSig').textContent='ไม่มีรายการให้ Redo';
      updateUndoState();
      return;
    }
    state.history.push({label:'undo', data:cloneOverlayState()});
    restoreOverlayState(next.data);
    if($('pdfSelectedSig')) $('pdfSelectedSig').textContent='Redo ล่าสุดแล้ว';
    updateUndoState();
  }

  function updateUndoState(){
    const noUndo=!(state.history&&state.history.length);
    const noRedo=!(state.redoStack&&state.redoStack.length);
    ['pdfUndoTopBtn'].forEach(id=>{const b=$(id); if(b) b.disabled=noUndo;});
    ['pdfRedoTopBtn'].forEach(id=>{const b=$(id); if(b) b.disabled=noRedo;});
  }

  function clearActive(){
    state.activeId=null;
    document.querySelectorAll('.pdfStamp,.pdfTextBox,.pdfRedactBox,.pdfHighlightBox,.pdfDrawPath').forEach(el=>el.classList.remove('active'));
  }

  function syncDrawShapeButtons(){
    document.querySelectorAll('.pdfShapeBtn,.pdfDrawToolBtn').forEach(b=>{
      const on=b.dataset.shape === (state.drawShape||'pen');
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  function setDrawShape(shape){
    state.drawShape=shape||'pen';
    syncDrawShapeButtons();
    savePrefs();
    const map={pen:'ปากกา',strike:'ขีดฆ่า',line:'เส้นตรง',arrow:'ลูกศร',rect:'สี่เหลี่ยม',circle:'วงกลม'};
    if($('pdfToolStatus')) $('pdfToolStatus').textContent='เครื่องมือวาด: '+(map[state.drawShape]||state.drawShape);
  }
  function normalizeFontName(name){
    const n=(name||'').toLowerCase();
    if(n.includes('sarabun')||n.includes('thsarabun')) return 'sarabun';
    if(n.includes('times')||n.includes('serif')) return 'times';
    if(n.includes('courier')||n.includes('mono')) return 'courier';
    if(n.includes('helvetica')||n.includes('arial')) return 'helvetica';
    return 'noto';
  }
  async function autoDetectPdfFont(){
    if(!state.pdfDoc) return;
    try{
      const page=await state.pdfDoc.getPage(1);
      const text=await page.getTextContent();
      const count={};
      (text.items||[]).forEach(it=>{
        const st=text.styles && text.styles[it.fontName];
        const fam=(st && (st.fontFamily || st.fontSubstitution || st.loadedName)) || it.fontName || '';
        const key=normalizeFontName(fam);
        count[key]=(count[key]||0)+String(it.str||'').length;
      });
      let best='noto',bestN=0;
      Object.entries(count).forEach(([k,v])=>{if(v>bestN){best=k;bestN=v;}});
      state.detectedFont=best;
      if($('pdfDetectedFontVal')) $('pdfDetectedFontVal').textContent='Auto: '+best;
      if($('pdfFontFamily') && !$('pdfFontFamily').dataset.userChanged) $('pdfFontFamily').value='auto';
    }catch(e){
      state.detectedFont='noto';
      if($('pdfDetectedFontVal')) $('pdfDetectedFontVal').textContent='Auto: noto';
    }
  }
  function chosenFontKey(item){
    const val=(item&&item.fontFamily)||($('pdfFontFamily')?.value)||'auto';
    return val==='auto' ? (state.detectedFont||'noto') : val;
  }

  function setActiveButton(){
    ['pdfTextModeBtn','pdfRedactModeBtn','pdfDrawModeBtn','pdfHighlightModeBtn'].forEach(id=>{const el=$(id); if(el) el.classList.remove('active')});
    if(state.placeMode==='text' && $('pdfTextModeBtn')) $('pdfTextModeBtn').classList.add('active');
    if(state.placeMode==='redact' && $('pdfRedactModeBtn')) $('pdfRedactModeBtn').classList.add('active');
    if(state.placeMode==='draw' && $('pdfDrawModeBtn')) $('pdfDrawModeBtn').classList.add('active');
    if(state.placeMode==='highlight' && $('pdfHighlightModeBtn')) $('pdfHighlightModeBtn').classList.add('active');
    const cross = ['redact','draw','highlight'].includes(state.placeMode);
    if($('pdfPages')) $('pdfPages').classList.toggle('pdfToolCrosshair', cross);
  }
  function syncTextPanel(item){
    if(!item)return;
    if($('pdfTextPanel')) $('pdfTextPanel').style.display='grid';
    if($('pdfTextInput')) $('pdfTextInput').value=item.text||'';
    if($('pdfFontSize')) $('pdfFontSize').value=item.fontSize||16;
    if($('pdfTextColor')) $('pdfTextColor').value=item.color||'#111111';
    if($('pdfFontFamily')) $('pdfFontFamily').value=item.fontFamily||'auto';
    if($('pdfOpacity')) $('pdfOpacity').value=Math.round((item.opacity??1)*100);
    if($('pdfRotation')) $('pdfRotation').value=item.rotation||0;
    updateLabels();
  }
  function syncStampPanel(item){
    if(!item)return;
    if($('pdfStampWidth')) $('pdfStampWidth').value=Math.round(item.w||180);
    if($('pdfIntensity')) $('pdfIntensity').value=Math.round((item.intensity??1)*100);
    if($('pdfOpacity')) $('pdfOpacity').value=Math.round((item.opacity??1)*100);
    if($('pdfRotation')) $('pdfRotation').value=item.rotation||0;
    updateLabels();
  }
  function syncPenPanel(item){
    if(!item)return;
    if(item.id && item.id.startsWith('hi_')){
      if($('pdfHighlightToolPanel')) $('pdfHighlightToolPanel').style.display='grid';
      if($('pdfHighlightColor')) $('pdfHighlightColor').value=item.color||'#ffe600';
      if($('pdfHighlightOpacity')) $('pdfHighlightOpacity').value=Math.round((item.opacity??.4)*100);
    }else{
      if($('pdfDrawToolPanel')) $('pdfDrawToolPanel').style.display='grid';
      if($('pdfPenColor')) $('pdfPenColor').value=item.color||'#111111';
      if($('pdfPenSize')) $('pdfPenSize').value=item.size||4;
      if($('pdfPenOpacity')) $('pdfPenOpacity').value=Math.round((item.opacity??1)*100);
    }
    updateLabels();
  }
  function activate(el,id){
    clearActive(); state.activeId=id; el.classList.add('active');
    const txt=state.texts.find(t=>t.id===id), sig=state.stamps.find(t=>t.id===id);
    const redact=state.redacts.find(t=>t.id===id), draw=state.draws.find(t=>t.id===id), hi=state.highlights.find(t=>t.id===id);
    if(txt){syncTextPanel(txt); if(window.__pdfSyncUnifiedPanels) window.__pdfSyncUnifiedPanels(); if($('pdfSelectedSig')) $('pdfSelectedSig').textContent='กำลังแก้ข้อความนี้';}
    else if(sig){syncStampPanel(sig); if($('pdfSelectedSig')) $('pdfSelectedSig').textContent='กำลังแก้ลายเซ็นนี้';}
    else if(redact){if($('pdfSelectedSig')) $('pdfSelectedSig').textContent='กำลังแก้กรอบปิด/ทับข้อความเดิม';}
    else if(draw){syncPenPanel(draw); if(window.__pdfSyncUnifiedPanels) window.__pdfSyncUnifiedPanels(); if($('pdfSelectedSig')) $('pdfSelectedSig').textContent='กำลังแก้เส้นวาด/ขีดฆ่า';}
    else if(hi){syncPenPanel(hi); if($('pdfSelectedSig')) $('pdfSelectedSig').textContent='กำลังแก้ไฮไลท์ข้อความ';}
  }
  function setPlaceMode(mode){
    state.placeMode=mode;
    if(mode!=='stamp'){
      state.selected=null;
      document.querySelectorAll('.sigPickBtn').forEach(x=>x.classList.remove('active'));
      if($('pdfSelectedSig')) $('pdfSelectedSig').textContent='ยังไม่ได้เลือกลายเซ็น';
    }
    setActiveButton();
  }

  function setupDrawPanel(){
    if(state.drawReady) return;
    state.drawReady=true;
    const panel=$('pdfDrawPanel'),canvas=$('sigDrawCanvas');
    if(!panel||!canvas) return;
    const ctx=canvas.getContext('2d');
    function fitCanvas(){
      const rect=canvas.getBoundingClientRect(), dpr=Math.max(2,window.devicePixelRatio||1);
      canvas.width=Math.max(900,Math.round(rect.width*dpr));
      canvas.height=Math.max(300,Math.round(rect.height*dpr));
      ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#111';
      ctx.shadowColor='rgba(0,0,0,.10)';ctx.shadowBlur=.25*dpr;
    }
    const clear=()=>{fitCanvas();ctx.clearRect(0,0,canvas.width,canvas.height)};
    clear();
    let drawing=false,points=[];
    const pt=e=>{const r=canvas.getBoundingClientRect(),p=e.pressure&&e.pressure>0?e.pressure:.55;return{x:(e.clientX-r.left)*(canvas.width/r.width),y:(e.clientY-r.top)*(canvas.height/r.height),p}};
    function addPoint(p){
      points.push(p);
      const dpr=Math.max(2,window.devicePixelRatio||1);
      if(points.length===2){
        ctx.lineWidth=(2.8+p.p*2.2)*dpr;ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);ctx.lineTo(points[1].x,points[1].y);ctx.stroke();return;
      }
      if(points.length<3)return;
      const a=points[points.length-3],b=points[points.length-2],c=points[points.length-1];
      const m1={x:(a.x+b.x)/2,y:(a.y+b.y)/2},m2={x:(b.x+c.x)/2,y:(b.y+c.y)/2};
      ctx.lineWidth=(2.8+b.p*2.2)*dpr;ctx.beginPath();ctx.moveTo(m1.x,m1.y);ctx.quadraticCurveTo(b.x,b.y,m2.x,m2.y);ctx.stroke();
    }
    canvas.addEventListener('pointerdown',e=>{e.preventDefault();drawing=true;points=[pt(e)];canvas.setPointerCapture(e.pointerId)});
    canvas.addEventListener('pointermove',e=>{if(!drawing)return;e.preventDefault();const evs=e.getCoalescedEvents?e.getCoalescedEvents():[e];evs.forEach(ev=>addPoint(pt(ev)))});
    canvas.addEventListener('pointerup',()=>{drawing=false;points=[]});
    canvas.addEventListener('pointercancel',()=>{drawing=false;points=[]});
    $('sigDrawClearBtn').onclick=clear;
    $('sigDrawCloseBtn').onclick=()=>{panel.style.display='none'; if(modal.classList.contains('drawOnly')){ modal.style.display='none'; modal.classList.remove('drawOnly'); }};
    $('sigDrawSaveBtn').onclick=async()=>{
      const dataUrl=canvas.toDataURL('image/png');
      const id='custom_'+Math.random().toString(36).slice(2,9);
      const item={id,label:`sign${state.customSigs.length+1}`,dataUrl,createdAt:Date.now()};
      state.customSigs.push(item);state.customCanvas[id]=await canvasFromDataUrl(dataUrl);
      saveCustomLibrary();refreshLibrary();clear();panel.style.display='none'; if(modal.classList.contains('drawOnly')){ modal.style.display='none'; modal.classList.remove('drawOnly'); }
    };
  }

  function refreshLibrary(){
    const lib=$('sigLibrary'); lib.innerHTML='';
    const items=[...getOutputItems(ctx),...(state.customSigs||[]).map(s=>({id:s.id,label:s.label,source:'custom',canvas:state.customCanvas[s.id],ok:!!state.customCanvas[s.id]})).filter(x=>x.ok)];
    if(!items.length){lib.innerHTML='<div class="hint">ยังไม่มีลายเซ็น: ใช้ผลลัพธ์ที่ครอปไว้ หรือกดถ่ายรูป/อัลบั้ม/วาดเอง</div>';return;}
    items.forEach(item=>{
      const btn=document.createElement('button');btn.className='sigPickBtn';btn.type='button';
      btn.innerHTML=`<span>${item.label}</span><span class="sigSourceTag">${item.source==='custom'?'เพิ่มเอง':'output'}</span><canvas></canvas>`;
      if(item.source==='custom'){
        const del=document.createElement('button');
        del.className='sigDeleteBtn';
        del.type='button';
        del.title='ลบลายเซ็นนี้ออกจากคลัง';
        del.textContent='×';
        del.onclick=(e)=>{
          e.preventDefault();
          e.stopPropagation();
          if(!confirm(`ลบลายเซ็น "${item.label}" ออกจากคลัง?`)) return;
          state.customSigs=(state.customSigs||[]).filter(s=>s.id!==item.id);
          if(state.customCanvas) delete state.customCanvas[item.id];
          if(state.selected&&state.selected.id===item.id){
            state.selected=null;
            setPlaceMode(null);
          }
          saveCustomLibrary();
          refreshLibrary();
          if($('pdfSelectedSig')) $('pdfSelectedSig').textContent='ลบลายเซ็นออกจากคลังแล้ว';
        };
        btn.appendChild(del);
      }
      const mini=btn.querySelector('canvas');mini.width=Math.min(220,item.canvas.width);mini.height=Math.max(1,Math.round(item.canvas.height*(mini.width/item.canvas.width)));mini.getContext('2d').drawImage(item.canvas,0,0,mini.width,mini.height);
      btn.onclick=()=>{state.selected={id:item.id,tabId:item.id,label:item.label,source:item.source};setPlaceMode('stamp');clearActive();[...lib.querySelectorAll('.sigPickBtn')].forEach(x=>x.classList.remove('active'));btn.classList.add('active');$('pdfSelectedSig').textContent=`พร้อมวาง: ${item.label}`};
      lib.appendChild(btn);
    });
  }
  function selectedCanvas(){ if(!state.selected)return null; return state.selected.source==='custom'?state.customCanvas[state.selected.id]:$(`out_${state.selected.id||state.selected.tabId}`); }

  async function loadPdf(file){
    state.pdfBytes=await file.arrayBuffer();state.pdfName=file.name.replace(/\.pdf$/i,'')+'_signed.pdf';
    state.pdfDoc=await pdfjsLib.getDocument({data:state.pdfBytes.slice(0)}).promise;
    state.stamps=[];state.texts=[];state.redacts=[];state.draws=[];state.highlights=[];state.activeId=null;state.placeMode=null;setActiveButton();
    await autoDetectPdfFont();
    await renderPages();
  }
  async function renderPages(){
    const wrap=$('pdfPages');wrap.innerHTML='';if(!state.pdfDoc)return;
    for(let p=1;p<=state.pdfDoc.numPages;p++){
      const page=await state.pdfDoc.getPage(p), viewport=page.getViewport({scale:state.scale});
      const pageBox=document.createElement('div');pageBox.className='pdfPageBox';pageBox.dataset.page=p;pageBox.style.width=cssPx(viewport.width);pageBox.style.height=cssPx(viewport.height);
      const canvas=document.createElement('canvas');canvas.className='pdfPageCanvas';canvas.width=Math.round(viewport.width);canvas.height=Math.round(viewport.height);canvas.style.width=cssPx(viewport.width);canvas.style.height=cssPx(viewport.height);
      await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
      const layer=document.createElement('div');layer.className='pdfStampLayer';layer.style.width=cssPx(viewport.width);layer.style.height=cssPx(viewport.height);
      pageBox.appendChild(canvas);pageBox.appendChild(layer);wrap.appendChild(pageBox);
      bindLayerInteractions(pageBox, layer, p);
    }
    setActiveButton();
  }

  function getMarkerHeight(layer){
    // Fallback only. Real highlight height is calculated from each text row.
    return Math.max(7, Math.min(14, Math.round(layer.clientHeight * 0.011)));
  }
  function findTextLineBands(layer, canvas, yA, yB, xA=0, xB=null){
    const bands=[];
    try{
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      const sx=canvas.width/layer.clientWidth, sy=canvas.height/layer.clientHeight;
      const yMin=Math.max(0, Math.floor(Math.min(yA,yB)*sy)-8);
      const yMax=Math.min(canvas.height-1, Math.ceil(Math.max(yA,yB)*sy)+8);
      const xMin=Math.max(0, Math.floor(Math.min(xA,xB??layer.clientWidth)*sx)-8);
      const xMax=Math.min(canvas.width-1, Math.ceil(Math.max(xA,xB??layer.clientWidth)*sx)+8);
      const rows=[];
      const stepY=1;
      const stepX=Math.max(1, Math.round(2.2*sx));

      for(let y=yMin; y<=yMax; y+=stepY){
        const row=ctx.getImageData(0,y,canvas.width,1).data;
        let dark=0, first=canvas.width, last=0;
        const xs=[];
        for(let x=xMin; x<=xMax; x+=stepX){
          const i=x*4;
          const gray=.299*row[i]+.587*row[i+1]+.114*row[i+2];
          // only real dark ink; yellow highlight itself is ignored
          if(gray<150){
            dark++;
            xs.push(x);
            if(x<first) first=x;
            if(x>last) last=x;
          }
        }
        // allow small digit groups on the right side
        if(dark>=1 && last-first>=2) rows.push({y,first,last,xs,dark});
      }

      const groups=[];
      rows.forEach(r=>{
        const g=groups[groups.length-1];
        if(g && r.y-g[g.length-1].y<=3) g.push(r);
        else groups.push([r]);
      });

      groups.forEach(g=>{
        if(g.length<2) return;
        const top=g[0].y/sy;
        const bottom=g[g.length-1].y/sy;
        const inkH=Math.max(1,bottom-top);
        let h=inkH + Math.max(1.5, Math.min(4, inkH*.22));
        h=Math.max(4.5, Math.min(16, h));
        const mid=(top+bottom)/2 + Math.min(1, h*.05);
        const y=mid-h/2;

        // Horizontal ink clusters: highlights only around actual text/number clusters.
        const allXs=[];
        g.forEach(r=>allXs.push(...r.xs));
        allXs.sort((a,b)=>a-b);
        const clusters=[];
        allXs.forEach(x=>{
          const c=clusters[clusters.length-1];
          const gap=Math.max(10*sx, stepX*5);
          if(c && x-c.last<=gap){ c.last=x; c.count++; }
          else clusters.push({first:x,last:x,count:1});
        });

        clusters.forEach(c=>{
          const first=c.first/sx, last=c.last/sx;
          const w=last-first;
          // tiny clusters are accepted if they look like page-number digits
          const isSmallDigitLike = w>=3 && w<=24 && g.length>=4 && c.count>=2;
          const isWordLike = w>10 && c.count>=2;
          if(isWordLike || isSmallDigitLike) bands.push({y,h,first,last,mid,inkH});
        });
      });
    }catch(e){}
    return bands;
  }
  function snapHighlightY(layer, canvas, yCss, xA=0, xB=null){
    const bands=findTextLineBands(layer,canvas,yCss-18,yCss+18,xA,xB);
    if(bands.length){
      bands.sort((a,b)=>Math.abs((a.y+a.h/2)-yCss)-Math.abs((b.y+b.h/2)-yCss));
      return bands[0].y + bands[0].h/2;
    }
    return yCss;
  }

  function highlightWholePage(pageBox, layer, pageNum){
    pushHistory('highlight-page');
    const canvas=pageBox.querySelector('.pdfPageCanvas');
    const bands=findTextLineBands(layer,canvas,0,layer.clientHeight,0,layer.clientWidth);
    let added=0;
    bands.forEach(b=>{
      const padX = (b.last-b.first)<25 ? 1.5 : 2.5;
      const item={id:'hi_'+Math.random().toString(36).slice(2,9),pageNum,x:Math.max(0,b.first-padX),y:b.y,w:Math.min(layer.clientWidth,b.last-b.first+padX*2),h:b.h,color:$('pdfHighlightColor')?.value||'#ffe600',opacity:(+$('pdfHighlightOpacity')?.value||40)/100};
      if(item.w<3 || item.h<4) return;
      state.highlights.push(item);renderHighlight(item);added++;
    });
    state.pickHighlightPage=false;
    $('pdfPages').classList.remove('pickPageMode');
    $('pdfSelectedSig').textContent=added?`ไฮไลท์ข้อความหน้านี้แล้ว ${added} ช่วง — รวมเลขด้านขวาแล้ว ถ้าไม่เอากด Undo`:'ไม่เจอตัวหนังสือชัดพอในหน้านี้';
    updateUndoState();
  }

  function bindLayerInteractions(pageBox, layer, pageNum){
    let drag=null;
    const removeMany=(items=[])=>items.forEach(it=>removeItem(it.id,true));
    const makeHighlight=(pageNum,x,y,w,h)=>{
      const item={id:'hi_'+Math.random().toString(36).slice(2,9),pageNum,x,y,w,h,color:$('pdfHighlightColor')?.value||'#ffe600',opacity:(+$('pdfHighlightOpacity')?.value||40)/100};
      state.highlights.push(item);
      renderHighlight(item);
      return item;
    };
    const updateMultiHighlight=(drag,x,y)=>{
      if(drag.items && drag.items.length) removeMany(drag.items);
      drag.items=[];
      const canvas=pageBox.querySelector('.pdfPageCanvas');
      const hDefault=getMarkerHeight(layer);
      const x1=Math.min(drag.x0,x), x2=Math.max(drag.x0,x);
      const y1=Math.min(drag.y0,y), y2=Math.max(drag.y0,y);
      const multi=Math.abs(y-drag.y0)>hDefault*1.35;
      // Text-selection style highlighting across multiple lines:
      // start line: from the point you started dragging to the end of that line
      // middle lines: full text segment
      // end line: from the start of that line to the point you released
      const scanLeft=0, scanRight=layer.clientWidth;
      const bands=findTextLineBands(layer,canvas,y1,y2,scanLeft,scanRight)
        .sort((a,b)=>a.mid-b.mid);

      if(bands.length){
        const down = y >= drag.y0;
        const startY = drag.y0;
        const endY = y;
        const startX = drag.x0;
        const endX = x;

        const nearest = (targetY)=>{
          let best=0,dist=Infinity;
          bands.forEach((b,i)=>{
            const d=Math.abs(b.mid-targetY);
            if(d<dist){dist=d;best=i;}
          });
          return best;
        };

        let startIdx = nearest(startY);
        let endIdx = nearest(endY);
        if(startIdx > endIdx){
          const tmp=startIdx; startIdx=endIdx; endIdx=tmp;
        }

        for(let i=startIdx;i<=endIdx;i++){
          const b=bands[i];
          let left=b.first-2, right=b.last+2;

          if(startIdx===endIdx){
            left=Math.max(Math.min(startX,endX), b.first-2);
            right=Math.min(Math.max(startX,endX), b.last+2);
          }else if(i===startIdx){
            if(down){
              left=Math.max(startX, b.first-2);
              right=b.last+2;
            }else{
              left=b.first-2;
              right=Math.min(endX, b.last+2);
            }
          }else if(i===endIdx){
            if(down){
              left=b.first-2;
              right=Math.min(endX, b.last+2);
            }else{
              left=Math.max(startX, b.first-2);
              right=b.last+2;
            }
          }

          left=Math.max(0,left);
          right=Math.min(layer.clientWidth,right);
          if(right-left>2.5) drag.items.push(makeHighlight(drag.pageNum,left,b.y,Math.max(2,right-left),b.h));
        }
        if(drag.items.length) return;
      }

      const snapY=snapHighlightY(layer,canvas,drag.y0,x1,x2);
      const h=hDefault;
      drag.items.push(makeHighlight(drag.pageNum,x1,snapY-h/2,Math.max(2,x2-x1),h));
    };

    pageBox.addEventListener('pointerdown', e=>{
      if(e.target.closest('.pdfStamp,.pdfTextBox,.pdfRedactBox,.pdfHighlightBox,.pdfDrawPath')) return;
      if(state.pickHighlightPage){ e.preventDefault(); e.stopPropagation(); highlightWholePage(pageBox, layer, pageNum); return; }
      clearActive();
      const rect=layer.getBoundingClientRect(), x=e.clientX-rect.left, y=e.clientY-rect.top;
      if(state.placeMode==='stamp'){
        const sig=selectedCanvas();if(!sig)return alert('เลือกลายเซ็นจากคลังก่อน');
        addStamp(pageNum,x,y);setPlaceMode(null);return;
      }
      if(state.placeMode==='text'){addText(pageNum,x,y);return;}
      if(state.placeMode==='redact'){
        pushHistory('redact');
        drag={kind:'redact',pageNum,x0:x,y0:y,el:null};
        e.preventDefault(); pageBox.setPointerCapture(e.pointerId); return;
      }
      if(state.placeMode==='highlight'){
        pushHistory('highlight');
        drag={kind:'highlight',pageNum,x0:x,y0:y,items:[]};
        e.preventDefault(); pageBox.setPointerCapture(e.pointerId); return;
      }
      if(state.placeMode==='draw'){
        pushHistory('draw');
        const shape=state.drawShape||'pen'; drag=shape==='pen'?{kind:'draw',shape,pageNum,points:[{x,y,p:.35}],path:null}:{kind:'drawShape',shape,pageNum,x0:x,y0:y,item:null};
        e.preventDefault(); pageBox.setPointerCapture(e.pointerId); return;
      }
    });
    pageBox.addEventListener('pointermove', e=>{
      if(!drag) return;
      const rect=layer.getBoundingClientRect(), x=e.clientX-rect.left, y=e.clientY-rect.top;
      if(drag.kind==='redact'){
        if(!drag.el){
          drag.item={id:'redact_'+Math.random().toString(36).slice(2,9),pageNum:drag.pageNum,x:drag.x0,y:drag.y0,w:1,h:1,color:'#ffffff',opacity:1};
          state.redacts.push(drag.item);
          drag.el=renderRedact(drag.item);
        }
        drag.item.x=Math.min(drag.x0,x); drag.item.y=Math.min(drag.y0,y);
        drag.item.w=Math.abs(x-drag.x0); drag.item.h=Math.abs(y-drag.y0);
        renderRedact(drag.item);
      }else if(drag.kind==='highlight'){
        updateMultiHighlight(drag,x,y);
      }else if(drag.kind==='draw'){
        const last=drag.points[drag.points.length-1]; const dist=Math.hypot(x-last.x,y-last.y); if(dist>1.8){drag.points.push({x,y,p:Math.min(1,Math.max(.25,dist/12))});}
        if(!drag.item){
          drag.item={id:'draw_'+Math.random().toString(36).slice(2,9),pageNum:drag.pageNum,shape:'pen',points:drag.points,color:$('pdfPenColor')?.value||'#111111',size:+$('pdfPenSize')?.value||4,opacity:(+$('pdfPenOpacity')?.value||100)/100,mode:'pen'};
          state.draws.push(drag.item);
        }else drag.item.points=drag.points;
        renderDraw(drag.item);
      }else if(drag.kind==='drawShape'){
        if(!drag.item){
          drag.item={id:'draw_'+Math.random().toString(36).slice(2,9),pageNum:drag.pageNum,shape:drag.shape,x:drag.x0,y:drag.y0,w:1,h:1,x1:drag.x0,y1:drag.y0,x2:x,y2:y,color:$('pdfPenColor')?.value||'#111111',size:+$('pdfPenSize')?.value||4,opacity:(+$('pdfPenOpacity')?.value||100)/100};
          state.draws.push(drag.item);
        }
        drag.item.x=Math.min(drag.x0,x); drag.item.y=Math.min(drag.y0,y); drag.item.w=Math.abs(x-drag.x0); drag.item.h=Math.abs(y-drag.y0); drag.item.x1=drag.x0; drag.item.y1=drag.y0; drag.item.x2=x; drag.item.y2=y;
        renderDraw(drag.item);
      }
    });
    pageBox.addEventListener('pointerup', ()=>{
      if(drag){
        if(drag.kind==='highlight'){
          if(!drag.items || !drag.items.length){
            // click without drag: create a short marker at the clicked row
            const h=getMarkerHeight(layer);
            drag.items=[makeHighlight(drag.pageNum,drag.x0,snapHighlightY(layer,pageBox.querySelector('.pdfPageCanvas'),drag.y0)-h/2,80,h)];
          }
          const first=drag.items[0];
          const el=first ? document.querySelector(`[data-edit-id="${first.id}"]`) : null;
          if(el) activate(el,first.id);
        }else if(drag.item){
          const minOk = drag.kind==='draw' ? drag.item.points.length>1 : (drag.kind==='drawShape' ? (Math.max(drag.item.w||0,drag.item.h||0)>4) : (drag.item.w>4 && drag.item.h>3));
          if(!minOk){
            removeItem(drag.item.id,true);
          }else{
            const el=document.querySelector(`[data-edit-id="${drag.item.id}"]`);
            if(el) activate(el,drag.item.id);
          }
        }
      }
      drag=null; savePrefs();
    });
    pageBox.addEventListener('pointercancel', ()=>{drag=null;});
  }
  function rerenderOverlays(){
    document.querySelectorAll('.pdfStampLayer').forEach(x=>x.innerHTML='');
    state.redacts.forEach(renderRedact);
    state.highlights.forEach(renderHighlight);
    state.draws.forEach(renderDraw);
    state.stamps.forEach(renderStamp);
    state.texts.forEach(renderText);
  }
  async function zoomPdf(delta){if(!state.pdfDoc)return;commitActiveText();state.scale=clamp((state.scale||1.35)+delta,.55,3.2);savePrefs();const old={l:$('pdfPages').scrollLeft,t:$('pdfPages').scrollTop};await renderPages();rerenderOverlays();$('pdfPages').scrollLeft=old.l;$('pdfPages').scrollTop=old.t;}
  async function fitPdf(){if(!state.pdfDoc)return;commitActiveText();const page=await state.pdfDoc.getPage(1),vp=page.getViewport({scale:1}),wrap=$('pdfPages');state.scale=clamp((wrap.clientWidth-70)/vp.width,.55,3);savePrefs();await renderPages();rerenderOverlays();}
  function commitActiveText(){const active=document.querySelector('.pdfTextBox.active .pdfTextContent');if(active&&state.activeId){const t=state.texts.find(x=>x.id===state.activeId);if(t)t.text=active.innerText;}}

  function addStamp(pageNum,x,y){
    pushHistory('add-stamp');
    const sig=selectedCanvas();if(!sig)return;
    const w=+$('pdfStampWidth').value||180,h=Math.max(12,w*(sig.height/sig.width));
    const s={id:'stamp_'+Math.random().toString(36).slice(2,9),pageNum,tabId:state.selected.id||state.selected.tabId,sigId:state.selected.id||state.selected.tabId,source:state.selected.source||'output',label:state.selected.label,x:x-w/2,y:y-h/2,w,h,rotation:+$('pdfRotation').value||0,opacity:+$('pdfOpacity').value/100,intensity:+$('pdfIntensity').value/100};
    state.stamps.push(s);renderStamp(s);clearActive();savePrefs();
  }
  function addText(pageNum,x,y){
    pushHistory('add-text');
    const current=($('pdfTextInput')&&$('pdfTextInput').value||'').trim(),fontSize=+$('pdfFontSize').value||16;
    const t={id:'text_'+Math.random().toString(36).slice(2,9),pageNum,text:current,x,y,w:Math.max(190,(current||'พิมพ์ตรงนี้').length*fontSize*.62 + 44),h:Math.max(30,fontSize*1.8),fontSize,color:$('pdfTextColor').value||'#111111',rotation:+$('pdfRotation').value||0,opacity:+$('pdfOpacity').value/100,fontFamily:$('pdfFontFamily')?.value||'auto'};
    state.texts.push(t);
    renderText(t);
    const el=document.querySelector(`[data-text-id="${t.id}"]`);
    if(el){
      activate(el,t.id);
      setTimeout(()=>{
        el.focus();
        const c=el.querySelector('.pdfTextContent'),r=document.createRange();
        r.selectNodeContents(c);r.collapse(false);
        const s=window.getSelection();s.removeAllRanges();s.addRange(r);
      },30);
    }

    // Text placement is one-shot. To place another, press "วางข้อความ" again.
    setPlaceMode(null);
    if($('pdfSelectedSig')) $('pdfSelectedSig').textContent='วางข้อความแล้ว: คลิกกล่องเพื่อแก้ / ลากจุดสีน้ำเงินซ้ายบนเพื่อย้าย';
    if(!($('pdfKeepTextInput')&&$('pdfKeepTextInput').checked) && $('pdfTextInput')) $('pdfTextInput').value='';
    savePrefs();
  }
  function makeStampImage(canvas,intensity){
    const out=document.createElement('canvas');out.width=canvas.width;out.height=canvas.height;const c=out.getContext('2d');c.drawImage(canvas,0,0);
    if(intensity!==1){const img=c.getImageData(0,0,out.width,out.height),d=img.data;for(let i=0;i<d.length;i+=4)if(d[i+3]>0)d[i+3]=clamp(d[i+3]*intensity,0,255);c.putImageData(img,0,0)}return out;
  }
  function editShell(el,item,type){
    if(!el.dataset.shellReady){
      el.dataset.shellReady='1';
      el.innerHTML += `<button class="pdfEditDelete" type="button">×</button><span class="pdfEditHandle"></span>`;
      bindEditBoxEvents(el,item,type);
    }
    el.dataset.editId=item.id;
  }
  function renderRedact(item){
    const layer=document.querySelector(`.pdfPageBox[data-page="${item.pageNum}"] .pdfStampLayer`);if(!layer)return null;
    let el=layer.querySelector(`[data-edit-id="${item.id}"]`);
    if(!el){el=document.createElement('div');el.className='pdfRedactBox';layer.appendChild(el);editShell(el,item,'redact');}
    el.style.left=cssPx(item.x);el.style.top=cssPx(item.y);el.style.width=cssPx(item.w);el.style.height=cssPx(item.h);el.style.background=item.color||'#fff';el.classList.toggle('active',state.activeId===item.id);return el;
  }
  function renderHighlight(item){
    const layer=document.querySelector(`.pdfPageBox[data-page="${item.pageNum}"] .pdfStampLayer`);if(!layer)return null;
    let el=layer.querySelector(`[data-edit-id="${item.id}"]`);
    if(!el){el=document.createElement('div');el.className='pdfHighlightBox';layer.appendChild(el);editShell(el,item,'highlight');}
    el.style.left=cssPx(item.x);el.style.top=cssPx(item.y);el.style.width=cssPx(item.w);el.style.height=cssPx(item.h);el.style.background=item.color||'#ffe600';el.style.opacity=item.opacity??.35;el.classList.toggle('active',state.activeId===item.id);return el;
  }

  function penWidthAt(i,n,base){
    if(n<=2) return base*.55;
    const t=i/(n-1);
    const endTaper=Math.sin(Math.PI*t); // 0 at both ends, 1 in middle
    return Math.max(base*.22, base*(.28 + .72*endTaper));
  }
  function svgPenSegments(points,size,color,opacity){
    if(!points || points.length<2) return '';
    let s='';
    const n=points.length;
    for(let i=1;i<n;i++){
      const a=points[i-1], b=points[i];
      const w=penWidthAt(i,n,size);
      s += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`;
    }
    return s;
  }


  function svgShapeMarkup(item,w,h){
    const col=item.color||'#111', op=item.opacity??1, sw=item.size||4;
    const x1=(item.x1??item.x)-item.x, y1=(item.y1??item.y)-item.y, x2=(item.x2??(item.x+item.w))-item.x, y2=(item.y2??(item.y+item.h))-item.y;
    if(item.shape==='line' || item.shape==='strike'){
      const yy=item.shape==='strike'?h/2:y2;
      return `<line x1="${item.shape==='strike'?0:x1}" y1="${item.shape==='strike'?yy:y1}" x2="${item.shape==='strike'?w:x2}" y2="${item.shape==='strike'?yy:y2}" stroke="${col}" stroke-width="${sw}" stroke-linecap="round" opacity="${op}"/>`;
    }
    if(item.shape==='arrow'){
      const angle=Math.atan2(y2-y1,x2-x1), len=Math.max(12,sw*5);
      const a1=angle-Math.PI/7,a2=angle+Math.PI/7;
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="${sw}" stroke-linecap="round" opacity="${op}"/>
      <line x1="${x2}" y1="${y2}" x2="${x2-len*Math.cos(a1)}" y2="${y2-len*Math.sin(a1)}" stroke="${col}" stroke-width="${sw}" stroke-linecap="round" opacity="${op}"/>
      <line x1="${x2}" y1="${y2}" x2="${x2-len*Math.cos(a2)}" y2="${y2-len*Math.sin(a2)}" stroke="${col}" stroke-width="${sw}" stroke-linecap="round" opacity="${op}"/>`;
    }
    if(item.shape==='rect') return `<rect x="${sw/2}" y="${sw/2}" width="${Math.max(1,w-sw)}" height="${Math.max(1,h-sw)}" fill="none" stroke="${col}" stroke-width="${sw}" opacity="${op}"/>`;
    if(item.shape==='circle') return `<ellipse cx="${w/2}" cy="${h/2}" rx="${Math.max(1,(w-sw)/2)}" ry="${Math.max(1,(h-sw)/2)}" fill="none" stroke="${col}" stroke-width="${sw}" opacity="${op}"/>`;
    return '';
  }

  function smoothPath(points){
    if(!points||points.length<2)return '';
    if(points.length===2)return `M${points[0].x},${points[0].y} L${points[1].x},${points[1].y}`;
    let d=`M${points[0].x},${points[0].y}`;
    for(let i=1;i<points.length-1;i++){
      const p=points[i],n=points[i+1],mx=(p.x+n.x)/2,my=(p.y+n.y)/2;
      d+=` Q${p.x},${p.y} ${mx},${my}`;
    }
    return d;
  }
  function renderDraw(item){
    const layer=document.querySelector(`.pdfPageBox[data-page="${item.pageNum}"] .pdfStampLayer`);
    if(!layer)return null;

    const base=item.size||4;
    let minX,minY,maxX,maxY,svg='';

    if((item.shape||'pen')==='pen'){
      if(!item.points || item.points.length<1) return null;
      const xs=item.points.map(p=>p.x),ys=item.points.map(p=>p.y),pad=base*4;
      minX=Math.min(...xs)-pad;minY=Math.min(...ys)-pad;maxX=Math.max(...xs)+pad;maxY=Math.max(...ys)+pad;
      const rel=item.points.map(p=>({x:p.x-minX,y:p.y-minY}));
      svg=svgPenSegments(rel,base,item.color||'#111',item.opacity??1);
    }else{
      const shapePad=(item.size||4)*2+10;
      minX=item.x-shapePad;minY=item.y-shapePad;maxX=item.x+Math.max(1,item.w)+shapePad;maxY=item.y+Math.max(1,item.h)+shapePad;
      const shifted={...item,x:item.x-minX,y:item.y-minY,x1:(item.x1??item.x)-minX,y1:(item.y1??item.y)-minY,x2:(item.x2??(item.x+item.w))-minX,y2:(item.y2??(item.y+item.h))-minY};
      svg=svgShapeMarkup(shifted,Math.max(1,maxX-minX),Math.max(1,maxY-minY));
    }

    const w=Math.max(1,maxX-minX), h=Math.max(1,maxY-minY);
    let el=layer.querySelector(`[data-edit-id="${item.id}"]`);
    if(!el){el=document.createElement('div');el.className='pdfDrawPath';layer.appendChild(el);editShell(el,item,'draw');}
    el.style.left=cssPx(minX);
    el.style.top=cssPx(minY);
    el.style.width=cssPx(w);
    el.style.height=cssPx(h);
    el.innerHTML=`<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${svg}</svg><button class="pdfEditDelete" type="button">×</button><span class="pdfEditHandle"></span>`;
    bindEditBoxEvents(el,item,'draw');
    el.dataset.editId=item.id;
    el.classList.toggle('active',state.activeId===item.id);
    return el;
  }
  function renderStamp(stamp){
    const layer=document.querySelector(`.pdfPageBox[data-page="${stamp.pageNum}"] .pdfStampLayer`);if(!layer)return;
    let el=layer.querySelector(`[data-stamp-id="${stamp.id}"]`);
    if(!el){el=document.createElement('div');el.className='pdfStamp';el.dataset.stampId=stamp.id;el.innerHTML=`<img draggable="false"><button class="pdfStampDelete" type="button">×</button><span class="pdfStampHandle"></span>`;layer.appendChild(el);bindBoxEvents(el,stamp,'stamp')}
    const sig=stamp.source==='custom'?state.customCanvas[stamp.sigId||stamp.tabId]:$(`out_${stamp.sigId||stamp.tabId}`);if(!sig)return;
    el.querySelector('img').src=makeStampImage(sig,stamp.intensity).toDataURL('image/png');
    el.style.left=cssPx(stamp.x);el.style.top=cssPx(stamp.y);el.style.width=cssPx(stamp.w);el.style.height=cssPx(stamp.h);el.style.opacity=stamp.opacity;el.style.transform=`rotate(${stamp.rotation}deg)`;el.classList.toggle('active',state.activeId===stamp.id);
  }
  function renderText(item){
    const layer=document.querySelector(`.pdfPageBox[data-page="${item.pageNum}"] .pdfStampLayer`);if(!layer)return;
    let el=layer.querySelector(`[data-text-id="${item.id}"]`);
    if(!el){
      el=document.createElement('div');
      el.className='pdfTextBox';
      el.dataset.textId=item.id;
      el.setAttribute('contenteditable','true');
      el.spellcheck=false;
      el.innerHTML=`<span class="pdfTextMoveHandle" contenteditable="false" title="ลากย้ายกล่องข้อความ">✥</span><span class="pdfTextContent"></span><button class="pdfStampDelete" type="button" contenteditable="false">×</button><span class="pdfStampHandle" contenteditable="false"></span>`;
      layer.appendChild(el);
      bindBoxEvents(el,item,'text');
      el.addEventListener('click',e=>{e.stopPropagation();activate(el,item.id)});
      el.addEventListener('focus',()=>activate(el,item.id));
      el.addEventListener('input',()=>{
        const c=el.querySelector('.pdfTextContent');
        item.text=c?c.innerText:el.innerText;
        el.classList.toggle('emptyText',!item.text.trim());
        if(state.activeId===item.id&&$('pdfTextInput'))$('pdfTextInput').value=item.text;
        savePrefs();
      });
      el.addEventListener('blur',()=>{
        const c=el.querySelector('.pdfTextContent');
        item.text=c?c.innerText:el.innerText;
        savePrefs();
      });
    }
    const content=el.querySelector('.pdfTextContent');
    if(document.activeElement!==el&&content)content.textContent=item.text||'';
    el.classList.toggle('emptyText',!(item.text||'').trim());
    el.style.left=cssPx(item.x);
    el.style.top=cssPx(item.y);
    el.style.width=cssPx(item.w);
    el.style.height='auto';
    el.style.minHeight=cssPx(item.h);
    el.style.fontSize=cssPx(item.fontSize);
    el.style.color=item.color;
    el.style.opacity=item.opacity;
    el.style.transform=`rotate(${item.rotation}deg)`;
    el.classList.toggle('active',state.activeId===item.id);
  }
  function removeItem(id, silent=false){
    if(!silent) pushHistory('delete');
    state.stamps=state.stamps.filter(s=>s.id!==id);state.texts=state.texts.filter(s=>s.id!==id);state.redacts=state.redacts.filter(s=>s.id!==id);state.draws=state.draws.filter(s=>s.id!==id);state.highlights=state.highlights.filter(s=>s.id!==id);
    document.querySelectorAll(`[data-edit-id="${id}"],[data-stamp-id="${id}"],[data-text-id="${id}"]`).forEach(x=>x.remove());
    updateUndoState();
  }
  function bindEditBoxEvents(el,obj,type){
    const del=el.querySelector('.pdfEditDelete'),handle=el.querySelector('.pdfEditHandle');
    if(!del||!handle)return;
    del.onclick=e=>{e.stopPropagation();removeItem(obj.id)};
    let mode=null,start=null,orig=null;
    el.onpointerdown=e=>{if(e.target===del)return;pushHistory('move-resize');activate(el,obj.id);e.preventDefault();e.stopPropagation();mode=e.target===handle?'resize':'move';start={x:e.clientX,y:e.clientY};orig=JSON.parse(JSON.stringify(obj));el.setPointerCapture(e.pointerId)};
    el.onpointermove=e=>{if(!mode)return;const dx=e.clientX-start.x,dy=e.clientY-start.y;if(type==='draw'){
        if((obj.shape||'pen')==='pen') obj.points=orig.points.map(p=>({x:p.x+dx,y:p.y+dy}));
        else if(mode==='move'){obj.x=orig.x+dx;obj.y=orig.y+dy;obj.x1=orig.x1+dx;obj.y1=orig.y1+dy;obj.x2=orig.x2+dx;obj.y2=orig.y2+dy;}
        else {obj.w=Math.max(8,orig.w+dx);obj.h=Math.max(8,orig.h+dy);obj.x2=obj.x+obj.w;obj.y2=obj.y+obj.h;}
      }else if(mode==='move'){obj.x=orig.x+dx;obj.y=orig.y+dy}else{obj.w=Math.max(8,orig.w+dx);obj.h=Math.max(8,orig.h+dy)}if(type==='redact')renderRedact(obj);else if(type==='highlight')renderHighlight(obj);else renderDraw(obj)};
    el.onpointerup=()=>{mode=null;savePrefs()};el.onpointercancel=()=>{mode=null};
  }
  function bindBoxEvents(el,obj,type){
    const del=el.querySelector('.pdfStampDelete'),handle=el.querySelector('.pdfStampHandle'),moveHandle=el.querySelector('.pdfTextMoveHandle');
    del.onclick=e=>{e.stopPropagation();removeItem(obj.id)};
    let mode=null,start=null,orig=null;
    el.addEventListener('pointerdown',e=>{
      if(e.target===del)return;
      const isTextMove = type==='text' && e.target===moveHandle;
      const isResize = e.target===handle;
      activate(el,obj.id);

      // Text body = edit cursor only. Move by the blue handle, resize by bottom-right.
      if(type==='text' && !isTextMove && !isResize) return;

      pushHistory('move-resize');
      e.preventDefault();e.stopPropagation();
      mode=isResize?'resize':'move';
      start={x:e.clientX,y:e.clientY};
      orig={...obj};
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove',e=>{
      if(!mode)return;
      const dx=e.clientX-start.x,dy=e.clientY-start.y;
      if(mode==='move'){obj.x=orig.x+dx;obj.y=orig.y+dy}
      else{const nw=Math.max(24,orig.w+dx);obj.w=nw;obj.h=type==='stamp'?Math.max(12,orig.h*(nw/orig.w)):Math.max(18,orig.h+dy)}
      type==='stamp'?renderStamp(obj):renderText(obj);
    });
    el.addEventListener('pointerup',()=>{mode=null;savePrefs()});
    el.addEventListener('pointercancel',()=>{mode=null});
  }
  function updateActiveOrDefaults(){
    const sig=state.stamps.find(s=>s.id===state.activeId),txt=state.texts.find(t=>t.id===state.activeId),draw=state.draws.find(t=>t.id===state.activeId),hi=state.highlights.find(t=>t.id===state.activeId);
    if(sig){sig.opacity=+$('pdfOpacity').value/100;sig.intensity=+$('pdfIntensity').value/100;sig.rotation=+$('pdfRotation').value;const ratio=sig.h/sig.w;sig.w=+$('pdfStampWidth').value||sig.w;sig.h=Math.max(12,sig.w*ratio);renderStamp(sig)}
    if(txt){txt.opacity=+$('pdfOpacity').value/100;txt.rotation=+$('pdfRotation').value;txt.fontSize=+$('pdfFontSize').value;txt.color=$('pdfTextColor').value;txt.text=$('pdfTextInput').value;txt.fontFamily=$('pdfFontFamily')?.value||'auto';txt.w=Math.max(txt.w,(txt.text||'พิมพ์ตรงนี้').length*txt.fontSize*.62 + 44);txt.h=Math.max(30,txt.fontSize*1.8);renderText(txt)}
    if(draw){draw.color=$('pdfPenColor').value;draw.size=+$('pdfPenSize').value;draw.opacity=+$('pdfPenOpacity').value/100;renderDraw(draw)}
    if(hi){hi.color=$('pdfHighlightColor')?.value||'#ffe600';hi.opacity=(+$('pdfHighlightOpacity')?.value||40)/100;renderHighlight(hi)}
    savePrefs();
  }
  async function detectLines(){
    if(!$('pdfPages')) return;
    state.pickHighlightPage = !state.pickHighlightPage;
    $('pdfPages').classList.toggle('pickPageMode', state.pickHighlightPage);
    $('pdfSelectedSig').textContent = state.pickHighlightPage
      ? 'เลือกหน้า: คลิกหน้า PDF ที่ต้องการไฮไลท์ข้อความทั้งหน้า'
      : 'ยกเลิกโหมดเลือกหน้าแล้ว';
  }

  function selectedTextItem(){
    return (state.texts||[]).find(t=>t.id===state.activeId);
  }
  function duplicateSelectedText(){
    const t=selectedTextItem();
    if(!t){ if($('pdfSelectedSig')) $('pdfSelectedSig').textContent='เลือกกล่องข้อความก่อน Duplicate'; return; }
    pushHistory('duplicate-text');
    const cp={...t,id:'text_'+Math.random().toString(36).slice(2,9),x:t.x+18,y:t.y+18};
    state.texts.push(cp);
    renderText(cp);
    const el=document.querySelector(`[data-text-id="${cp.id}"]`);
    if(el) activate(el,cp.id);
    if($('pdfSelectedSig')) $('pdfSelectedSig').textContent='Duplicate ข้อความแล้ว';
    savePrefs();
  }
  function setSelectedTextAsDefault(){
    const t=selectedTextItem();
    const val=t ? t.text : ($('pdfTextInput')?.value||'');
    if($('pdfTextInput')) $('pdfTextInput').value=val;
    if($('pdfKeepTextInput')) $('pdfKeepTextInput').checked=true;
    if($('pdfSelectedSig')) $('pdfSelectedSig').textContent='ตั้งเป็นข้อความเริ่มต้นแล้ว';
    savePrefs();
  }

  async function exportPdf(){
    if(!state.pdfBytes)return alert('เปิดไฟล์ PDF ก่อน');commitActiveText();
    if(!state.stamps.length&&!state.texts.length&&!state.redacts.length&&!state.draws.length&&!state.highlights.length)return alert('ยังไม่ได้วางลายเซ็น ข้อความ หรือเครื่องหมาย');
    const {PDFDocument,degrees,rgb}=PDFLib;const doc=await PDFDocument.load(state.pdfBytes.slice(0));doc.registerFontkit(fontkit.default||fontkit);
    const notoBytes=await fetch(THAI_FONT_URL).then(r=>r.arrayBuffer());
    const sarabunBytes=await fetch(SARABUN_FONT_URL).then(r=>r.arrayBuffer()).catch(()=>notoBytes);
    const fontCache={noto:await doc.embedFont(notoBytes),sarabun:await doc.embedFont(sarabunBytes)};
    const {StandardFonts}=PDFLib;
    fontCache.helvetica=await doc.embedFont(StandardFonts.Helvetica);
    fontCache.times=await doc.embedFont(StandardFonts.TimesRoman);
    fontCache.courier=await doc.embedFont(StandardFonts.Courier);
    const pages=doc.getPages(),cache=new Map();
    function mapBox(o,page){const layer=document.querySelector(`.pdfPageBox[data-page="${o.pageNum}"] .pdfStampLayer`),bw=layer.clientWidth,bh=layer.clientHeight,pw=page.getWidth(),ph=page.getHeight();return {bw,bh,pw,ph,x:(o.x/bw)*pw,y:ph-((o.y+o.h)/bh)*ph,w:(o.w/bw)*pw,h:(o.h/bh)*ph};}
    for(const r of state.redacts){const page=pages[r.pageNum-1],m=mapBox(r,page);page.drawRectangle({x:m.x,y:m.y,width:m.w,height:m.h,color:rgb(1,1,1),opacity:1});}
    for(const h of state.highlights){const page=pages[h.pageNum-1],m=mapBox(h,page),col=hexToRgb01(h.color||'#ffe600');page.drawRectangle({x:m.x,y:m.y,width:m.w,height:m.h,color:rgb(col.r,col.g,col.b),opacity:h.opacity??.35});}
    for(const d of state.draws){
      const page=pages[d.pageNum-1],layer=document.querySelector(`.pdfPageBox[data-page="${d.pageNum}"] .pdfStampLayer`),bw=layer.clientWidth,bh=layer.clientHeight,pw=page.getWidth(),ph=page.getHeight(),col=hexToRgb01(d.color||'#111');
      const thick=(d.size||4)/bh*ph;
      if((d.shape||'pen')==='pen'){
        const n=d.points.length,base=d.size||4;
        for(let i=1;i<n;i++){const a=d.points[i-1],b=d.points[i];page.drawLine({start:{x:(a.x/bw)*pw,y:ph-(a.y/bh)*ph},end:{x:(b.x/bw)*pw,y:ph-(b.y/bh)*ph},thickness:(penWidthAt(i,n,base)/bh)*ph,color:rgb(col.r,col.g,col.b),opacity:d.opacity??1});}
      }else if(d.shape==='line' || d.shape==='strike' || d.shape==='arrow'){
        const yA=d.shape==='strike'?d.y+d.h/2:(d.y1??d.y), yB=d.shape==='strike'?d.y+d.h/2:(d.y2??(d.y+d.h));
        const xA=d.shape==='strike'?d.x:(d.x1??d.x), xB=d.shape==='strike'?d.x+d.w:(d.x2??(d.x+d.w));
        const sx=(xA/bw)*pw, sy=ph-(yA/bh)*ph, ex=(xB/bw)*pw, ey=ph-(yB/bh)*ph;
        page.drawLine({start:{x:sx,y:sy},end:{x:ex,y:ey},thickness:thick,color:rgb(col.r,col.g,col.b),opacity:d.opacity??1});
        if(d.shape==='arrow'){
          const ang=Math.atan2(ey-sy,ex-sx), len=Math.max(10,thick*5);
          for(const a of [ang-Math.PI*.85,ang+Math.PI*.85]){
            page.drawLine({start:{x:ex,y:ey},end:{x:ex+len*Math.cos(a),y:ey+len*Math.sin(a)},thickness:thick,color:rgb(col.r,col.g,col.b),opacity:d.opacity??1});
          }
        }
      }else if(d.shape==='rect'){
        page.drawRectangle({x:(d.x/bw)*pw,y:ph-((d.y+d.h)/bh)*ph,width:(d.w/bw)*pw,height:(d.h/bh)*ph,borderColor:rgb(col.r,col.g,col.b),borderWidth:thick,opacity:d.opacity??1});
      }else if(d.shape==='circle'){
        page.drawEllipse({x:((d.x+d.w/2)/bw)*pw,y:ph-(((d.y+d.h/2)/bh)*ph),xScale:(d.w/2/bw)*pw,yScale:(d.h/2/bh)*ph,borderColor:rgb(col.r,col.g,col.b),borderWidth:thick,opacity:d.opacity??1});
      }
    }
    for(const s of state.stamps){const canvas=s.source==='custom'?state.customCanvas[s.sigId||s.tabId]:$(`out_${s.sigId||s.tabId}`);if(!canvas)continue;const key=`${s.sigId||s.tabId}_${s.intensity}`;let img=cache.get(key);if(!img){img=await doc.embedPng(makeStampImage(canvas,s.intensity).toDataURL('image/png'));cache.set(key,img)}const page=pages[s.pageNum-1],m=mapBox(s,page);page.drawImage(img,{x:m.x,y:m.y,width:m.w,height:m.h,opacity:s.opacity,rotate:degrees(s.rotation)})}
    for(const t of state.texts){if(!(t.text||'').trim())continue;const page=pages[t.pageNum-1],m=mapBox(t,page),col=hexToRgb01(t.color);page.drawText(t.text,{x:m.x,y:m.y,size:(t.fontSize/m.bh)*m.ph,font:fontCache[chosenFontKey(t)]||fontCache.noto,color:rgb(col.r,col.g,col.b),opacity:t.opacity,rotate:degrees(t.rotation)})}
    const bytes=await doc.save();const blob=new Blob([bytes],{type:'application/pdf'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=state.pdfName||'signed.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  }



  function ensureShapeToolDelegation(){
    if(modal.dataset.shapeToolDelegated === '1') return;
    modal.dataset.shapeToolDelegated = '1';
    modal.addEventListener('click', (e)=>{
      const b = e.target.closest('.pdfShapeBtn,.pdfDrawToolBtn');
      if(!b) return;
      e.preventDefault();
      e.stopPropagation();
      setDrawShape(b.dataset.shape || 'pen');
      setPlaceMode('draw');
      if($('pdfDrawToolPanel')) $('pdfDrawToolPanel').style.display='grid';
      const map={pen:'ปากกา',strike:'ขีดฆ่า',line:'เส้นตรง',arrow:'ลูกศร',rect:'สี่เหลี่ยม',circle:'วงกลม'};
      const msg='โหมดวาด: '+(map[state.drawShape]||state.drawShape)+' — ลากบน PDF ได้เลย';
      if($('pdfToolStatus')) $('pdfToolStatus').textContent=msg;
      if($('pdfSelectedSig')) $('pdfSelectedSig').textContent=msg;
    }, true);
  }

  function ensurePdfEditToolbarDelegation(){
    if(modal.dataset.pdfEditDelegated === '1') return;
    modal.dataset.pdfEditDelegated = '1';

    modal.addEventListener('click', (e)=>{
      const btn = e.target.closest('#pdfRedactModeBtn,#pdfDrawModeBtn,#pdfHighlightModeBtn,#pdfTextModeBtn,#pdfDetectLinesBtn,.pdfDrawToolBtn');
      if(!btn) return;

      e.preventDefault();
      e.stopPropagation();

      const showTools = () => {
        if($('pdfDrawToolPanel')) $('pdfDrawToolPanel').style.display = 'grid';
      };
      const setStatus = (txt) => {
        if($('pdfToolStatus')) $('pdfToolStatus').textContent = txt;
        if($('pdfSelectedSig')) $('pdfSelectedSig').textContent = txt;
      };

      if(btn.classList && btn.classList.contains('pdfDrawToolBtn')){
        const shape = btn.dataset.shape || 'pen';
        setDrawShape(shape);
        setPlaceMode('draw');
        if($('pdfDrawToolPanel')) $('pdfDrawToolPanel').style.display = 'grid';
        const map={pen:'ปากกา',strike:'ขีดฆ่า',line:'เส้นตรง',arrow:'ลูกศร',rect:'สี่เหลี่ยม',circle:'วงกลม'};
        setStatus('โหมดวาด: '+(map[shape]||shape)+' — ลากบน PDF ได้เลย');
        return;
      }


      if(btn.id === 'pdfRedactModeBtn'){
        const on = state.placeMode !== 'redact';
        setPlaceMode(on ? 'redact' : null);
        if(on){
          setStatus('โหมดปิด/ทับข้อความเดิม: ลากกรอบสีขาวทับข้อความเก่า');
        }else{
          setStatus('ปิดโหมดปิด/ทับข้อความเดิมแล้ว');
        }
        return;
      }

      if(btn.id === 'pdfDrawModeBtn'){
        const on = state.placeMode !== 'draw';
        setPlaceMode(on ? 'draw' : null);
        if(on){
          showTools();
          setStatus('โหมดวาด: เลือกเครื่องมือย่อย แล้วลากบน PDF');
        }else{
          setStatus('ปิดโหมดวาด/ขีดฆ่าแล้ว');
        }
        return;
      }

      if(btn.id === 'pdfHighlightModeBtn'){
        const on = state.placeMode !== 'highlight';
        setPlaceMode(on ? 'highlight' : null);
        if(on){
          if($('pdfHighlightToolPanel')) $('pdfHighlightToolPanel').style.display='grid';
          setStatus('โหมดไฮไลท์ข้อความ: ลากกรอบไฮไลท์ข้อความบน PDF');
        }else{
          setStatus('ปิดโหมดไฮไลท์ข้อความแล้ว');
        }
        return;
      }

      if(btn.id === 'pdfTextModeBtn'){
        const on = state.placeMode !== 'text';
        setPlaceMode(on ? 'text' : null);
        if($('pdfTextPanel')) $('pdfTextPanel').style.display = on ? 'grid' : 'none';
        if(on) setStatus('โหมดวางข้อความ: คลิกบน PDF เพื่อวางได้หลายจุด');
        else setStatus('ปิดโหมดวางข้อความแล้ว');
        return;
      }

      if(btn.id === 'pdfDetectLinesBtn'){
        detectLines();
        return;
      }
    }, true);
  }


  function consolidatePdfToolsUI(){
    const side = modal.querySelector('.pdfSide');
    if(!side || side.querySelector('.pdfUnifiedTools')) return;

    const textBtn=$('pdfTextModeBtn'), textPanel=$('pdfTextPanel');
    const redactBtn=$('pdfRedactModeBtn');
    const highlightBtn=$('pdfHighlightModeBtn'), highlightPanel=$('pdfHighlightToolPanel');
    const drawBtn=$('pdfDrawModeBtn'), drawPanel=$('pdfDrawToolPanel');
    if(!textBtn || !redactBtn || !highlightBtn || !drawBtn) return;

    const oldSections = new Set();
    [textBtn,textPanel,redactBtn,highlightBtn,highlightPanel,drawBtn,drawPanel].forEach(el=>{
      const sec = el && el.closest('.pdfToolSection');
      if(sec) oldSections.add(sec);
    });

    const box=document.createElement('div');
    box.className='pdfToolSection pdfUnifiedTools';
    box.innerHTML=`
      <div class="pdfToolHead"><span>2</span><b>เครื่องมือเอกสาร</b><small>เลือกเครื่องมือ แล้วกล่องตั้งค่าจะแสดงตรงนี้</small></div>
      <div class="pdfToolGrid" id="pdfUnifiedToolGrid"></div>
      <div class="pdfUnifiedPanels" id="pdfUnifiedPanels"></div>
    `;

    const grid=box.querySelector('#pdfUnifiedToolGrid');
    const panels=box.querySelector('#pdfUnifiedPanels');

    grid.appendChild(textBtn);
    grid.appendChild(redactBtn);
    grid.appendChild(highlightBtn);
    grid.appendChild(drawBtn);

    if(textPanel) panels.appendChild(textPanel);
    if(highlightPanel) panels.appendChild(highlightPanel);
    if(drawPanel) panels.appendChild(drawPanel);

    // Insert right after Open PDF button area, before signature box if possible
    const firstToolSection = side.querySelector('.pdfToolSection');
    if(firstToolSection) side.insertBefore(box, firstToolSection);
    else side.appendChild(box);

    oldSections.forEach(sec=>sec.classList.add('pdfOldToolSectionHidden'));

    function syncPanels(){
      const mode = state.placeMode;
      if(textPanel) textPanel.style.display = mode==='text' || (state.activeId||'').startsWith('text_') ? 'grid' : 'none';
      if(highlightPanel) highlightPanel.style.display = mode==='highlight' || (state.activeId||'').startsWith('hi_') ? 'grid' : 'none';
      if(drawPanel) drawPanel.style.display = mode==='draw' || (state.activeId||'').startsWith('draw_') ? 'grid' : 'none';
    }

    box.addEventListener('click', (e)=>{
      const b=e.target.closest('#pdfTextModeBtn,#pdfRedactModeBtn,#pdfHighlightModeBtn,#pdfDrawModeBtn,.pdfDrawToolBtn');
      if(!b) return;
      setTimeout(syncPanels, 0);
    }, true);

    window.__pdfSyncUnifiedPanels = syncPanels;
    syncPanels();
  }

  applyPrefs(); await prepareCustomCanvases(); updateLabels(); refreshLibrary();
  consolidatePdfToolsUI();
  updateUndoState();
  bindShapeToolButtonsV63();
  ensurePdfEditToolbarDelegation();
  ensureShapeToolDelegation();
  $('pdfFileInput').onchange=e=>{const f=e.target.files&&e.target.files[0];if(f)loadPdf(f)};
  if(initialPdfFile){ await loadPdf(initialPdfFile); }
  if($('pdfOpenBtn')) $('pdfOpenBtn').onclick=()=>{ $('pdfFileInput').value=''; $('pdfFileInput').click(); };
  $('pdfExportBtn').onclick=exportPdf;$('pdfRefreshLibBtn').onclick=refreshLibrary;$('pdfCloseBtn').onclick=()=>{modal.style.display='none'; modal.classList.remove('drawOnly')};

  // v91: header action buttons
  if($('pdfExportTopBtn')) $('pdfExportTopBtn').onclick = exportPdf;
  if($('pdfCloseTopBtn')) $('pdfCloseTopBtn').onclick = ()=>{ modal.style.display='none'; modal.classList.remove('drawOnly'); };
  if($('pdfUndoTopBtn')) $('pdfUndoTopBtn').onclick = undoLast;
  if($('pdfRedoTopBtn')) $('pdfRedoTopBtn').onclick = redoLast;

  if($('pdfZoomInBtn'))$('pdfZoomInBtn').onclick=()=>zoomPdf(.15);if($('pdfZoomOutBtn'))$('pdfZoomOutBtn').onclick=()=>zoomPdf(-.15);if($('pdfZoomFitBtn'))$('pdfZoomFitBtn').onclick=fitPdf;
  if($('pdfTextModeBtn'))$('pdfTextModeBtn').onclick=()=>{const on=state.placeMode!=='text';setPlaceMode(on?'text':null);$('pdfTextPanel').style.display=on?'grid':'none';if(on)$('pdfSelectedSig').textContent='โหมดวางข้อความ: คลิก PDF เพื่อวางครั้งเดียว'; if(window.__pdfSyncUnifiedPanels) window.__pdfSyncUnifiedPanels();};
  if($('pdfRedactModeBtn'))$('pdfRedactModeBtn').onclick=()=>{const on=state.placeMode!=='redact';setPlaceMode(on?'redact':null);$('pdfDrawToolPanel').style.display=on?'grid':'none';if(on)$('pdfSelectedSig').textContent='โหมดปิด/ทับข้อความเดิม: ลากกรอบสีขาวทับข้อความเก่า'};
  if($('pdfDrawModeBtn'))$('pdfDrawModeBtn').onclick=()=>{const on=state.placeMode!=='draw';setPlaceMode(on?'draw':null);$('pdfDrawToolPanel').style.display=on?'grid':'none';if(on){bindShapeToolButtonsV63();syncDrawShapeButtons();$('pdfSelectedSig').textContent='โหมดวาด: เลือกเครื่องมือย่อย แล้วลากบน PDF';} if(window.__pdfSyncUnifiedPanels) window.__pdfSyncUnifiedPanels();};
  if($('pdfHighlightModeBtn'))$('pdfHighlightModeBtn').onclick=()=>{const on=state.placeMode!=='highlight';setPlaceMode(on?'highlight':null);$('pdfDrawToolPanel').style.display=on?'grid':'none';if(on)$('pdfSelectedSig').textContent='โหมดไฮไลท์ข้อความ: ลากกรอบไฮไลท์ข้อความบน PDF'};
  if($('pdfDetectLinesBtn'))$('pdfDetectLinesBtn').onclick=detectLines;
  if($('pdfDuplicateTextBtn'))$('pdfDuplicateTextBtn').onclick=duplicateSelectedText;
  if($('pdfSetDefaultTextBtn'))$('pdfSetDefaultTextBtn').onclick=setSelectedTextAsDefault;
  if($('pdfKeepTextInput'))$('pdfKeepTextInput').onchange=savePrefs;
  
  ['pdfOpacity','pdfIntensity','pdfRotation','pdfStampWidth','pdfFontSize','pdfTextColor','pdfTextInput','pdfFontFamily','pdfPenColor','pdfPenSize','pdfPenOpacity','pdfHighlightColor','pdfHighlightOpacity'].forEach(id=>{const el=$(id);if(el)el.oninput=()=>{updateLabels();updateActiveOrDefaults()}});
  if($('sigCameraBtn'))$('sigCameraBtn').onclick=()=>$('sigCameraInput').click();if($('sigAlbumBtn'))$('sigAlbumBtn').onclick=()=>$('sigFileInput').click();if($('sigCameraInput'))$('sigCameraInput').onchange=e=>addCustomFromFile(e.target.files&&e.target.files[0],'ถ่ายรูป');if($('sigFileInput'))$('sigFileInput').onchange=e=>addCustomFromFile(e.target.files&&e.target.files[0],'ไฟล์');if($('sigDrawBtn'))$('sigDrawBtn').onclick=()=>{setupDrawPanel();$('pdfDrawPanel').style.display=$('pdfDrawPanel').style.display==='none'?'grid':'none'};

  if(drawOnlyMode){
    setupDrawPanel();
    if($('pdfDrawPanel')) $('pdfDrawPanel').style.display='grid';
    modal.classList.add('drawOnly');
  }


  // v63 hard-bind drawing shape buttons every time the PDF signer opens
  function bindShapeToolButtonsV63(){
    document.querySelectorAll('.pdfShapeBtn,.pdfDrawToolBtn').forEach((btn)=>{
      if(btn.dataset.boundV63 === '1') return;
      btn.dataset.boundV63 = '1';
      const choose = (e)=>{
        e.preventDefault();
        e.stopPropagation();
        state.drawShape = btn.dataset.shape || 'pen';
        if(typeof syncDrawShapeButtons === 'function') syncDrawShapeButtons();
        if(typeof setPlaceMode === 'function') setPlaceMode('draw');
        if($('pdfDrawToolPanel')) $('pdfDrawToolPanel').style.display='grid';
        const map={pen:'ปากกา',strike:'ขีดฆ่า',line:'เส้นตรง',arrow:'ลูกศร',rect:'สี่เหลี่ยม',circle:'วงกลม'};
        const msg='โหมดวาด: '+(map[state.drawShape]||state.drawShape)+' — ลากบน PDF ได้เลย';
        if($('pdfToolStatus')) $('pdfToolStatus').textContent=msg;
        if($('pdfSelectedSig')) $('pdfSelectedSig').textContent=msg;
        if(typeof savePrefs === 'function') savePrefs();
      };
      btn.addEventListener('click', choose, true);
      btn.addEventListener('pointerdown', (e)=>{ e.stopPropagation(); }, true);
    });
  }

  bindShapeToolButtonsV63();
  
  // v64 fallback: draw tool buttons are direct top-level tool buttons
  document.querySelectorAll('.pdfDrawToolBtn').forEach(btn=>{
    btn.onclick=(e)=>{
      e.preventDefault();
      e.stopPropagation();
      const shape=btn.dataset.shape||'pen';
      setDrawShape(shape);
      setPlaceMode('draw');
      if($('pdfDrawToolPanel')) $('pdfDrawToolPanel').style.display='grid';
      const map={pen:'ปากกา',strike:'ขีดฆ่า',line:'เส้นตรง',arrow:'ลูกศร',rect:'สี่เหลี่ยม',circle:'วงกลม'};
      const msg='โหมดวาด: '+(map[shape]||shape)+' — ลากบน PDF ได้เลย';
      if($('pdfToolStatus')) $('pdfToolStatus').textContent=msg;
      if($('pdfSelectedSig')) $('pdfSelectedSig').textContent=msg;
    };
  });

  window.__pdfSignerRefresh=refreshLibrary;
  window.__pdfSetEditMode=(mode)=>{
    setPlaceMode(mode);
    if(['redact','draw','highlight'].includes(mode) && $('pdfDrawToolPanel')) $('pdfDrawToolPanel').style.display='grid';
    if(mode==='text' && $('pdfTextPanel')) $('pdfTextPanel').style.display='grid';
    if($('pdfToolStatus')) $('pdfToolStatus').textContent='เปิดโหมด '+mode;
  };
}
