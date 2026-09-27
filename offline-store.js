(function(){
  const DB_NAME = 'sigma-offline-v1';
  const DB_VERSION = 1;
  const STORE_TICKETS = 'tickets';
  const STORE_USES = 'uses';
  const STORE_META = 'meta';

  function reqToPromise(req){
    return new Promise((resolve,reject)=>{
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error || new Error('IndexedDB error'));
    });
  }

  function txDone(tx){
    return new Promise((resolve,reject)=>{
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error || new Error('IndexedDB transaction error'));
      tx.onabort=()=>reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
  }

  async function db(){
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB_NAME,DB_VERSION);
      req.onupgradeneeded=()=>{
        const d=req.result;
        if(!d.objectStoreNames.contains(STORE_TICKETS)){
          d.createObjectStore(STORE_TICKETS,{keyPath:'ticket_code'});
        }
        if(!d.objectStoreNames.contains(STORE_USES)){
          const s=d.createObjectStore(STORE_USES,{keyPath:'local_id'});
          s.createIndex('sync_status','sync_status',{unique:false});
          s.createIndex('ticket_code','ticket_code',{unique:false});
        }
        if(!d.objectStoreNames.contains(STORE_META)){
          d.createObjectStore(STORE_META,{keyPath:'key'});
        }
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error || new Error('IndexedDBを開けませんでした'));
    });
  }

  function normalizeTicketCode(value){
    const raw=String(value||'').trim();
    if(!raw) return '';
    try{
      const u=new URL(raw);
      const code=u.searchParams.get('code');
      return code ? code.trim() : raw;
    }catch(_){
      return raw;
    }
  }

  function randomId(){
    if(globalThis.crypto?.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
  }

  function getDeviceId(){
    const key='sigma_offline_device_id';
    let id=localStorage.getItem(key);
    if(!id){
      id=randomId();
      localStorage.setItem(key,id);
    }
    return id;
  }

  async function setMeta(key,value){
    const d=await db();
    const tx=d.transaction(STORE_META,'readwrite');
    tx.objectStore(STORE_META).put({key,value});
    await txDone(tx);
  }

  async function getMeta(key,defaultValue=null){
    const d=await db();
    const tx=d.transaction(STORE_META,'readonly');
    const row=await reqToPromise(tx.objectStore(STORE_META).get(key));
    return row ? row.value : defaultValue;
  }

  async function getAllUses(){
    const d=await db();
    const tx=d.transaction(STORE_USES,'readonly');
    return await reqToPromise(tx.objectStore(STORE_USES).getAll());
  }

  async function saveSnapshot(snapshot,operator){
    const tickets=Array.isArray(snapshot?.tickets)?snapshot.tickets:[];
    const uses=await getAllUses();
    const usedMap=new Map();
    for(const u of uses){
      if(u?.ticket_code && u.sync_status!=='synced') usedMap.set(String(u.ticket_code),u);
    }

    const d=await db();
    const tx=d.transaction([STORE_TICKETS,STORE_META],'readwrite');
    const ts=tx.objectStore(STORE_TICKETS);
    const ms=tx.objectStore(STORE_META);
    ts.clear();

    for(const row of tickets){
      if(!row?.ticket_code) continue;
      const code=normalizeTicketCode(row.ticket_code);
      const localUse=usedMap.get(code);
      ts.put({
        ticket_code:code,
        status:localUse ? 'used' : String(row.status||''),
        product_name:row.product_name||'',
        presale_price:Number(row.presale_price||row.sale_price_snapshot||0),
        sales_channel_v2:row.sales_channel_v2||row.channel||'',
        redemption_item:localUse?.item || row.redemption_item || null,
        used_at:localUse?.used_at || row.used_at || null,
        snapshot_status:String(row.status||''),
        snapshot_at:snapshot?.snapshot_at||new Date().toISOString()
      });
    }

    const savedAt=new Date().toISOString();
    ms.put({key:'snapshot_at',value:snapshot?.snapshot_at||savedAt});
    ms.put({key:'saved_at',value:savedAt});
    ms.put({key:'ticket_count',value:tickets.length});
    if(operator) ms.put({key:'operator',value:operator});
    ms.put({key:'device_id',value:getDeviceId()});
    await txDone(tx);
    return {ticket_count:tickets.length,saved_at:savedAt,snapshot_at:snapshot?.snapshot_at||savedAt};
  }

  async function getTicket(value){
    const code=normalizeTicketCode(value);
    if(!code) return null;
    const d=await db();
    const tx=d.transaction(STORE_TICKETS,'readonly');
    return await reqToPromise(tx.objectStore(STORE_TICKETS).get(code));
  }

  async function markUsed(value,item){
    const code=normalizeTicketCode(value);
    if(!code) throw new Error('チケットコードがありません');
    if(!['fried_rice','sesame_pair'].includes(item)) throw new Error('交換商品が不正です');

    const d=await db();
    const tx=d.transaction([STORE_TICKETS,STORE_USES,STORE_META],'readwrite');
    const ts=tx.objectStore(STORE_TICKETS);
    const us=tx.objectStore(STORE_USES);
    const ms=tx.objectStore(STORE_META);
    const ticket=await reqToPromise(ts.get(code));
    if(!ticket) throw new Error('この端末に保存されていないチケットです');
    if(ticket.status!=='active') throw new Error(ticket.status==='used'?'すでに使用済みです':'現在使用できないチケットです');

    const usedAt=new Date().toISOString();
    const localId=randomId();
    const operatorRow=await reqToPromise(ms.get('operator'));
    const deviceId=getDeviceId();
    const use={
      local_id:localId,
      ticket_code:code,
      item,
      used_at:usedAt,
      device_id:deviceId,
      operator:operatorRow?.value||null,
      sync_status:'pending',
      sync_error:null,
      synced_at:null,
      server_result:null
    };

    ticket.status='used';
    ticket.redemption_item=item;
    ticket.used_at=usedAt;
    ticket.local_use_id=localId;
    ts.put(ticket);
    us.put(use);
    await txDone(tx);
    return use;
  }

  async function countTickets(){
    const d=await db();
    const tx=d.transaction(STORE_TICKETS,'readonly');
    return await reqToPromise(tx.objectStore(STORE_TICKETS).count());
  }

  async function listUsesByStatus(statuses){
    const wanted=new Set(Array.isArray(statuses)?statuses:[statuses]);
    const rows=await getAllUses();
    return rows.filter(x=>wanted.has(x.sync_status)).sort((a,b)=>String(a.used_at).localeCompare(String(b.used_at)));
  }

  async function updateUse(localId,patch){
    const d=await db();
    const tx=d.transaction(STORE_USES,'readwrite');
    const s=tx.objectStore(STORE_USES);
    const row=await reqToPromise(s.get(localId));
    if(!row) return null;
    Object.assign(row,patch||{});
    s.put(row);
    await txDone(tx);
    return row;
  }

  async function stats(){
    const [ticketCount,savedAt,snapshotAt,uses]=await Promise.all([
      countTickets(),
      getMeta('saved_at',null),
      getMeta('snapshot_at',null),
      getAllUses()
    ]);
    const pending=uses.filter(x=>x.sync_status==='pending').length;
    const conflicts=uses.filter(x=>x.sync_status==='conflict').length;
    const synced=uses.filter(x=>x.sync_status==='synced').length;
    return {ticketCount,savedAt,snapshotAt,pending,conflicts,synced,totalUses:uses.length};
  }

  window.SigmaOfflineStore={
    normalizeTicketCode,
    getDeviceId,
    saveSnapshot,
    getTicket,
    markUsed,
    stats,
    listUsesByStatus,
    updateUse,
    getMeta,
    setMeta
  };
})();
