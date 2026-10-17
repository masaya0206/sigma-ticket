(() => {
  if (window.__MPConnectionStatusLoaded) return;
  window.__MPConnectionStatusLoaded = true;
  const SUPABASE_HEALTH = "https://gsniytemgrbtgfywhqlu.supabase.co/auth/v1/health";
  const PING_MS = 8000, TIMEOUT_MS = 4200, OFFLINE_AFTER_FAILS = 3, ONLINE_AFTER_SUCCESSES = 2;
  let failures = 0, successes = 0, state = "checking", lastOk = null;
  function ensureBar(){
    if(document.getElementById("mpConnectionStatusBar")) return;
    const style=document.createElement("style");
    style.textContent=`#mpConnectionStatusBar{position:fixed;z-index:2147483000;top:max(7px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:7px;max-width:calc(100vw - 24px);min-height:28px;padding:6px 11px;border-radius:999px;font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic",sans-serif;font-size:11px;line-height:1.2;font-weight:900;box-shadow:0 5px 18px rgba(0,0,0,.12);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);transition:.18s ease;user-select:none}#mpConnectionStatusBar[data-state="online"]{color:#137333;background:rgba(236,253,243,.94);border:1px solid rgba(21,128,61,.16)}#mpConnectionStatusBar[data-state="unstable"]{color:#8a5a00;background:rgba(255,248,221,.97);border:1px solid rgba(154,103,0,.20)}#mpConnectionStatusBar[data-state="offline"]{color:#a50e18;background:rgba(255,240,240,.98);border:1px solid rgba(181,18,27,.20);cursor:pointer}#mpConnectionStatusBar[data-state="checking"]{color:#555;background:rgba(245,245,245,.94);border:1px solid rgba(0,0,0,.08)}#mpConnectionStatusBar .mp-conn-detail{display:none;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#mpConnectionStatusBar[data-state="offline"] .mp-conn-detail,#mpConnectionStatusBar[data-state="unstable"] .mp-conn-detail{display:inline}@media(max-width:430px){#mpConnectionStatusBar{font-size:10px;max-width:calc(100vw - 18px)}#mpConnectionStatusBar .mp-conn-detail{max-width:210px}}`;
    document.head.appendChild(style);
    const bar=document.createElement("div");bar.id="mpConnectionStatusBar";bar.dataset.state="checking";bar.setAttribute("role","status");bar.setAttribute("aria-live","polite");bar.innerHTML='<span class="mp-conn-main">確認中</span><span class="mp-conn-detail"></span>';
    bar.addEventListener("click",()=>{if(bar.dataset.state==="offline"&&!location.pathname.endsWith("/home.html")) location.href="./home.html";});
    // 画面の一番上へ入れ、レイアウト領域を確保する。
    // fixedではなくstickyなので、ページタイトルやボタンに重ならない。
    document.body.prepend(bar);
  }
  function textFor(next){if(next==="online")return["🟢 オンライン",""];if(next==="unstable")return["🟠 通信不安定","操作に失敗する場合はポータルへ"];if(next==="offline")return["🔴 オフライン",location.pathname.endsWith("/home.html")?"非常用オフライン機能を利用できます":"タップしてポータルへ"];return["通信確認中",""];}
  function setState(next){state=next;ensureBar();const bar=document.getElementById("mpConnectionStatusBar"),t=textFor(next);bar.dataset.state=next;bar.querySelector(".mp-conn-main").textContent=t[0];bar.querySelector(".mp-conn-detail").textContent=t[1];window.dispatchEvent(new CustomEvent("mp:connection-status",{detail:{state,lastOk}}));}
  async function probe(){if(!navigator.onLine){failures=OFFLINE_AFTER_FAILS;successes=0;setState("offline");return;}const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),TIMEOUT_MS);try{const response=await fetch(SUPABASE_HEALTH+"?t="+Date.now(),{method:"GET",cache:"no-store",signal:controller.signal});if(!response.ok)throw new Error("health "+response.status);failures=0;successes++;lastOk=Date.now();setState(state==="online"||successes>=ONLINE_AFTER_SUCCESSES?"online":"checking");}catch(_){successes=0;failures++;setState(failures>=OFFLINE_AFTER_FAILS?"offline":"unstable");}finally{clearTimeout(timeout);}}
  window.MatchPointConnection={getState:()=>state,getLastOk:()=>lastOk,checkNow:probe};window.addEventListener("online",probe);window.addEventListener("offline",()=>setState("offline"));document.addEventListener("visibilitychange",()=>{if(!document.hidden)probe();});const start=()=>{ensureBar();probe();setInterval(probe,PING_MS);};if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();
})();
