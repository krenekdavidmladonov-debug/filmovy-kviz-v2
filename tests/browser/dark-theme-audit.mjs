/* global document, window, getComputedStyle */
// Measures actual painted UI text, including opacity and translucent ancestor surfaces.
// Content canvases, images, QR and native PDF documents are deliberately separate.
export async function auditDarkUi(page) {
  return page.evaluate(async () => {
    // Measure settled hover/selection colors; infinite loading indicators keep running.
    await Promise.allSettled(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished));
    const rgba = value => { const v = value.match(/[\d.]+/g)?.map(Number) ?? [0,0,0,0]; return [v[0],v[1],v[2],v[3] ?? 1]; };
    const over = (a,b) => [0,1,2].map(i => a[i]*a[3]+b[i]*(1-a[3])).concat(1);
    const lum = c => c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
    const ratio = (a,b) => (Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
    const background = el => {
      const chain=[];for(let p=el;p;p=p.parentElement)chain.unshift(p);
      let color=[11,18,32,1];for(const p of chain)color=over(rgba(getComputedStyle(p).backgroundColor),color);return color;
    };
    const failures=[], combinations=new Map();let checked=0;
    const modal=document.querySelector('dialog:modal');
    for(const el of document.body.querySelectorAll('*')) {
      if(modal&&!modal.contains(el))continue; // The backdrop makes the rest of the app inert.
      if(el.closest('.slide-renderer,.results-canvas,.final-canvas,iframe,svg,[hidden],:disabled,[aria-disabled="true"]'))continue;
      const s=getComputedStyle(el), rect=el.getBoundingClientRect();
      if(!rect.width||!rect.height||s.visibility!=='visible'||s.display==='none')continue;
      const own=[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim();
      const input=el.matches('input:not([type="radio"]):not([type="checkbox"]):not([type="range"]),textarea,select');
      if(!own&&!input)continue;
      let opacity=1;for(let p=el;p;p=p.parentElement)opacity*=Number(getComputedStyle(p).opacity);
      if(opacity===0)continue;
      const bg=background(el),fg=rgba(s.color);fg[3]*=opacity;
      const actual=ratio(over(fg,bg),bg),size=parseFloat(s.fontSize),large=size>=24||(size>=18.667&&parseInt(s.fontWeight)>=700),minimum=large?3:4.5;
      const key=[s.color,bg.join(','),minimum].join('|');checked++;
      combinations.set(key,{foreground:s.color,background:bg,ratio:actual,minimum});
      if(actual<minimum)failures.push({tag:el.tagName,className:el.className,ratio:actual,minimum});
      if(input&&el.getAttribute('placeholder')) {
        const ps=getComputedStyle(el,'::placeholder'),pf=rgba(ps.color);pf[3]*=Number(ps.opacity)*opacity;
        const pr=ratio(over(pf,bg),bg);if(pr<4.5)failures.push({placeholder:true,tag:el.tagName,className:el.className,ratio:pr,minimum:4.5});
      }
    }
    return {checked,combinations:[...combinations.values()],failures,rootBackground:getComputedStyle(document.documentElement).backgroundColor,colorScheme:getComputedStyle(document.documentElement).colorScheme,horizontalOverflow:document.documentElement.scrollWidth>window.innerWidth+1};
  });
}

export async function installPaintProbe(context) {
  await context.addInitScript(() => {
    window.__darkPaints=[];
    const sample=()=>{if(document.body)window.__darkPaints.push({html:getComputedStyle(document.documentElement).backgroundColor,body:getComputedStyle(document.body).backgroundColor});if(window.__darkPaints.length<180)window.requestAnimationFrame(sample);};
    window.requestAnimationFrame(sample);
  });
}
