// Lazy-loaded refine tools for Signature Cleaner Pro
// โหลดเฉพาะตอนกด "ปรับให้อ่านชัด" เพื่อลดภาระหน้าแรก

export function autoAdjustReadable(ctx){
  const {$, buildCleanCanvas, drawOutput, handleControls, openZoomTab, currentZoomTab, setRefineValues} = ctx;
  const tab = currentZoomTab();
  if(!tab) return;

  const saved = {
    th:+$('threshold').value,
    ct:+$('contrast').value,
    bd:+$('bold').value,
    nz:+$('noise').value,
    sh:$('sharpen') ? +$('sharpen').value : 35,
    fi:$('fillInk') ? +$('fillInk').value : 25,
    ink:$('inkMode') ? $('inkMode').value : 'black'
  };

  const candidates = [
    {zoomThreshold:168, zoomContrast:138, zoomBold:0.8, zoomNoise:4,  zoomSharpen:72, zoomFillInk:42},
    {zoomThreshold:176, zoomContrast:148, zoomBold:0.9, zoomNoise:6,  zoomSharpen:78, zoomFillInk:50},
    {zoomThreshold:184, zoomContrast:156, zoomBold:1.0, zoomNoise:8,  zoomSharpen:84, zoomFillInk:58},
    {zoomThreshold:192, zoomContrast:162, zoomBold:1.1, zoomNoise:10, zoomSharpen:88, zoomFillInk:64},
    {zoomThreshold:200, zoomContrast:166, zoomBold:1.2, zoomNoise:12, zoomSharpen:90, zoomFillInk:70},
    {zoomThreshold:188, zoomContrast:170, zoomBold:0.6, zoomNoise:7,  zoomSharpen:92, zoomFillInk:56},
    {zoomThreshold:196, zoomContrast:174, zoomBold:0.7, zoomNoise:9,  zoomSharpen:94, zoomFillInk:62}
  ];

  const setRaw = (c)=>{
    $('threshold').value=c.zoomThreshold;
    $('contrast').value=c.zoomContrast;
    $('bold').value=c.zoomBold;
    $('noise').value=c.zoomNoise;
    if($('sharpen')) $('sharpen').value=c.zoomSharpen;
    if($('fillInk')) $('fillInk').value=c.zoomFillInk;
    if($('inkMode')) $('inkMode').value='black';
    buildCleanCanvas();
    drawOutput(tab);
  };

  const scoreCanvas = ()=>{
    const canvas=$(`out_${tab.id}`);
    if(!canvas || canvas.width<=1 || canvas.height<=1) return -Infinity;
    const c2d=canvas.getContext('2d',{willReadFrequently:true});
    const img=c2d.getImageData(0,0,canvas.width,canvas.height).data;
    const w=canvas.width,h=canvas.height;
    let ink=0, strong=0, weak=0, noise=0, edge=0;
    const rowHits=new Uint16Array(h);
    const colHits=new Uint16Array(w);

    for(let y=0;y<h;y++){
      for(let x=0;x<w;x++){
        const i=(y*w+x)*4;
        const a=img[i+3];
        if(a>18){
          ink++;
          rowHits[y]++; colHits[x]++;
          const gray=.299*img[i]+.587*img[i+1]+.114*img[i+2];
          if(a>185 && gray<75) strong++;
          if(a<95 || gray>145) weak++;
          const left=x>0?img[i-4+3]:0;
          const right=x<w-1?img[i+4+3]:0;
          const up=y>0?img[i-w*4+3]:0;
          const down=y<h-1?img[i+w*4+3]:0;
          const neighbors=(left>18)+(right>18)+(up>18)+(down>18);
          if(neighbors<=1) noise++;
          if(neighbors>=2 && neighbors<=3) edge++;
        }
      }
    }

    if(ink<20) return -Infinity;

    let activeRows=0, activeCols=0;
    for(const v of rowHits) if(v>0) activeRows++;
    for(const v of colHits) if(v>0) activeCols++;

    const area=w*h;
    const density=ink/area;
    const strongRatio=strong/ink;
    const weakRatio=weak/ink;
    const noiseRatio=noise/ink;
    const spread=(activeRows/h + activeCols/w)/2;

    let score = 0;
    score += strongRatio * 72;
    score += spread * 24;
    score += Math.min(edge/ink, 0.72) * 18;
    score -= weakRatio * 60;
    score -= noiseRatio * 48;
    if(density < 0.006) score -= (0.006-density)*3600;
    if(density > 0.16) score -= (density-0.16)*260;

    return score;
  };

  let best=null, bestScore=-Infinity;
  for(const c of candidates){
    setRaw(c);
    const s=scoreCanvas();
    if(s>bestScore){
      bestScore=s;
      best=c;
    }
  }

  if(!best){
    $('threshold').value=saved.th;
    $('contrast').value=saved.ct;
    $('bold').value=saved.bd;
    $('noise').value=saved.nz;
    if($('sharpen')) $('sharpen').value=saved.sh;
    if($('fillInk')) $('fillInk').value=saved.fi;
    if($('inkMode')) $('inkMode').value=saved.ink;
    buildCleanCanvas();
    drawOutput(tab);
    openZoomTab(tab);
    return;
  }

  setRefineValues(best);
  if($('filterPreset')) $('filterPreset').value='balanced';
  handleControls();
}
