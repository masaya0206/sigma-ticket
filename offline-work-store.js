(()=>{
  const DB_NAME='sigma_offline_work_v1';
  const DB_VERSION=2;

  function openDb(){
    return new Promise((resolve,reject)=>{
      const r=indexedDB.open(DB_NAME,DB_VERSION);
      r.onupgradeneeded=()=>{
        const db=r.result;
        if(!db.objectStoreNames.contains('meta'))db.createObjectStore('meta',{keyPath:'key'});
        if(!db.objectStoreNames.contains('events'))db.createObjectStore('events',{keyPath:'event_id'});
      };
      r.onsuccess=()=>resolve(r.result);
      r.onerror=()=>reject(r.error);
    });
  }

  async function setMeta(key,value){
    const db=await openDb();
    return await new Promise((resolve,reject)=>{
      const t=db.transaction('meta','readwrite');
      t.objectStore('meta').put({key,value});
      t.oncomplete=()=>resolve(value);
      t.onerror=()=>reject(t.error);
    });
  }

  async function getMeta(key,def=null){
    const db=await openDb();
    return await new Promise((resolve,reject)=>{
      const t=db.transaction('meta','readonly');
      const r=t.objectStore('meta').get(key);
      r.onsuccess=()=>resolve(r.result?.value??def);
      r.onerror=()=>reject(r.error);
    });
  }

  async function saveSnapshot(data){
    await setMeta('snapshot',{...data,saved_at:new Date().toISOString()});
    if(data?.current_work_state) await setMeta('local_work_state',data.current_work_state);
    return data;
  }
  async function getSnapshot(){return await getMeta('snapshot',null);}

  async function getLocalWorkState(){
    return await getMeta('local_work_state',{working:false,role:null,clock_in:null});
  }
  async function setLocalWorkState(v){return await setMeta('local_work_state',v);}

  async function addEvent(ev){
    const db=await openDb();
    return await new Promise((resolve,reject)=>{
      const t=db.transaction('events','readwrite');
      t.objectStore('events').put({
        ...ev,
        sync_status:ev.sync_status||'pending',
        created_local_at:new Date().toISOString()
      });
      t.oncomplete=()=>resolve(ev);
      t.onerror=()=>reject(t.error);
    });
  }

  async function listEvents(){
    const db=await openDb();
    return await new Promise((resolve,reject)=>{
      const t=db.transaction('events','readonly');
      const r=t.objectStore('events').getAll();
      r.onsuccess=()=>resolve((r.result||[]).sort((a,b)=>
        String(a.occurred_at).localeCompare(String(b.occurred_at)) ||
        String(a.event_id).localeCompare(String(b.event_id))
      ));
      r.onerror=()=>reject(r.error);
    });
  }
  async function listPendingEvents(){return (await listEvents()).filter(x=>x.sync_status!=='synced');}

  async function patchEvent(id,patch){
    const db=await openDb();
    return await new Promise((resolve,reject)=>{
      const t=db.transaction('events','readwrite');
      const s=t.objectStore('events');
      const g=s.get(id);
      g.onsuccess=()=>{ if(g.result) s.put({...g.result,...patch}); };
      t.oncomplete=()=>resolve();
      t.onerror=()=>reject(t.error);
    });
  }
  async function markEventSynced(id,result){
    return patchEvent(id,{sync_status:'synced',synced_at:new Date().toISOString(),server_result:result,sync_error:null});
  }
  async function markEventError(id,msg){return patchEvent(id,{sync_status:'pending',sync_error:msg});}

  function parseTime(v){return new Date(v).getTime();}
  function resolveRoleFromSnapshot(snapshot,atIso,maxGapMinutes=120){
    const at=parseTime(atIso);
    const shifts=(snapshot?.shifts||[])
      .filter(x=>parseTime(x.ends_at)>parseTime(x.starts_at))
      .sort((a,b)=>parseTime(a.starts_at)-parseTime(b.starts_at));

    const active=shifts.filter(x=>parseTime(x.starts_at)<=at&&parseTime(x.ends_at)>=at);
    if(active.length) return active[0].role;

    const next=shifts
      .filter(x=>parseTime(x.starts_at)>at&&parseTime(x.starts_at)-at<=maxGapMinutes*60000)
      .sort((a,b)=>parseTime(a.starts_at)-parseTime(b.starts_at))[0];
    if(next) return next.role;

    const prev=shifts
      .filter(x=>parseTime(x.ends_at)<at&&at-parseTime(x.ends_at)<=maxGapMinutes*60000)
      .sort((a,b)=>parseTime(b.ends_at)-parseTime(a.ends_at))[0];
    return prev?.role||null;
  }

  function bytesToB64url(bytes){
    let s='';
    const u8=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
    for(let i=0;i<u8.length;i++) s+=String.fromCharCode(u8[i]);
    return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  function b64urlToBytes(s){
    s=String(s||'').replace(/-/g,'+').replace(/_/g,'/');
    while(s.length%4) s+='=';
    const bin=atob(s);
    const out=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i);
    return out;
  }

  function uuid(){
    return crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  async function ensureQrSigningIdentity(){
    let id=await getMeta('qr_signing_identity',null);
    if(id?.key_id && id?.private_jwk && id?.public_jwk) return id;

    const pair=await crypto.subtle.generateKey(
      {name:'ECDSA',namedCurve:'P-256'},
      true,
      ['sign','verify']
    );
    const private_jwk=await crypto.subtle.exportKey('jwk',pair.privateKey);
    const public_jwk=await crypto.subtle.exportKey('jwk',pair.publicKey);
    id={
      key_id:uuid(),
      private_jwk,
      public_jwk,
      created_at:new Date().toISOString()
    };
    await setMeta('qr_signing_identity',id);
    return id;
  }

  async function getQrSigningIdentity(){return await getMeta('qr_signing_identity',null);}

  function currentSlotEpoch(nowMs=Date.now()){
    return Math.floor(nowMs/30000)*30;
  }

  async function createAttendanceQrPayload(nowMs=Date.now()){
    const id=await ensureQrSigningIdentity();
    const slot_epoch=currentSlotEpoch(nowMs);
    const canonical=`MPA2|attendance|${id.key_id}|${slot_epoch}`;
    const key=await crypto.subtle.importKey(
      'jwk',id.private_jwk,
      {name:'ECDSA',namedCurve:'P-256'},
      false,
      ['sign']
    );
    const sig=await crypto.subtle.sign(
      {name:'ECDSA',hash:'SHA-256'},
      key,
      new TextEncoder().encode(canonical)
    );
    return {
      payload:`MPA2|${id.key_id}|${slot_epoch}|${bytesToB64url(sig)}`,
      key_id:id.key_id,
      slot_epoch,
      signature:bytesToB64url(sig),
      canonical
    };
  }

  async function validateQrPayload(payload,readAtIso){
    const snapshot=await getSnapshot();
    if(!snapshot) throw new Error('オフライン勤務データが保存されていません');

    const parts=String(payload||'').trim().split('|');
    if(parts.length!==4 || parts[0]!=='MPA2') throw new Error('勤怠QRではありません');

    const key_id=parts[1];
    const slot_epoch=Number(parts[2]);
    const signature=parts[3];
    if(!key_id || !Number.isFinite(slot_epoch) || !signature) throw new Error('QRの形式が不正です');

    const readMs=new Date(readAtIso).getTime();
    const slotMs=slot_epoch*1000;
    if(Math.abs(readMs-slotMs)>90000) throw new Error('QRの有効時間を過ぎています');

    const row=(snapshot.qr_public_keys||[]).find(x=>x.key_id===key_id && x.active!==false);
    if(!row?.public_jwk) throw new Error('このQRの公開鍵が端末に保存されていません。オンライン時にポータルを開いて最新版を保存してください。');

    const pub=await crypto.subtle.importKey(
      'jwk',row.public_jwk,
      {name:'ECDSA',namedCurve:'P-256'},
      false,
      ['verify']
    );
    const canonical=`MPA2|attendance|${key_id}|${slot_epoch}`;
    const ok=await crypto.subtle.verify(
      {name:'ECDSA',hash:'SHA-256'},
      pub,
      b64urlToBytes(signature),
      new TextEncoder().encode(canonical)
    );
    if(!ok) throw new Error('QRの署名を確認できませんでした');

    return {
      qr_version:'MPA2',
      key_id,
      slot_epoch,
      slot_at:new Date(slotMs).toISOString(),
      signature,
      canonical
    };
  }

  // v85との互換用。今後はQRバンクを使わない。
  async function saveManagerQrBank(data){return await setMeta('manager_qr_bank',{...data,saved_at:new Date().toISOString()});}
  async function getManagerQrBank(){return await getMeta('manager_qr_bank',null);}
  async function getManagerQrBankMeta(){return null;}

  window.SigmaOfflineWorkStore={
    saveSnapshot,getSnapshot,
    getLocalWorkState,setLocalWorkState,
    addEvent,listEvents,listPendingEvents,markEventSynced,markEventError,
    resolveRoleFromSnapshot,validateQrPayload,
    ensureQrSigningIdentity,getQrSigningIdentity,createAttendanceQrPayload,currentSlotEpoch,
    saveManagerQrBank,getManagerQrBank,getManagerQrBankMeta,
    setMeta,getMeta
  };
})();
