(function(){
  const DB_NAME='sigma-offline-v1';
  const DB_VERSION=2;
  const STORE_TICKETS='tickets';
  const STORE_USES='uses';
  const STORE_META='meta';
  const STORE_DAY_RESERVES='day_reserves';
  const STORE_DAY_ISSUES='day_issues';

  function reqToPromise(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||new Error('IndexedDB error'));});}
  function txDone(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error||new Error('IndexedDB transaction error'));tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted'));});}

  async function db(){
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB_NAME,DB_VERSION);
      req.onupgradeneeded=()=>{
        const d=req.result;
        if(!d.objectStoreNames.contains(STORE_TICKETS)) d.createObjectStore(STORE_TICKETS,{keyPath:'ticket_code'});
        if(!d.objectStoreNames.contains(STORE_USES)){
          const s=d.createObjectStore(STORE_USES,{keyPath:'local_id'});
          s.createIndex('sync_status','sync_status',{unique:false});
          s.createIndex('ticket_code','ticket_code',{unique:false});
        }
        if(!d.objectStoreNames.contains(STORE_META)) d.createObjectStore(STORE_META,{keyPath:'key'});
        if(!d.objectStoreNames.contains(STORE_DAY_RESERVES)){
          const s=d.createObjectStore(STORE_DAY_RESERVES,{keyPath:'ticket_code'});
          s.createIndex('seller_user_id','seller_user_id',{unique:false});
        }
        if(!d.objectStoreNames.contains(STORE_DAY_ISSUES)){
          const s=d.createObjectStore(STORE_DAY_ISSUES,{keyPath:'local_id'});
          s.createIndex('sync_status','sync_status',{unique:false});
          s.createIndex('ticket_code','ticket_code',{unique:true});
          s.createIndex('seller_user_id','seller_user_id',{unique:false});
        }
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||new Error('IndexedDBを開けませんでした'));
    });
  }

  function normalizeTicketCode(value){
    const raw=String(value||'').trim();
    if(!raw)return '';
    try{const u=new URL(raw);const code=u.searchParams.get('code');return code?code.trim():raw;}catch(_){return raw;}
  }

  function randomId(){return globalThis.crypto?.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);}
  function getDeviceId(){const key='sigma_offline_device_id';let id=localStorage.getItem(key);if(!id){id=randomId();localStorage.setItem(key,id);}return id;}

  async function setMeta(key,value){const d=await db();const tx=d.transaction(STORE_META,'readwrite');tx.objectStore(STORE_META).put({key,value});await txDone(tx);}
  async function getMeta(key,defaultValue=null){const d=await db();const tx=d.transaction(STORE_META,'readonly');const row=await reqToPromise(tx.objectStore(STORE_META).get(key));return row?row.value:defaultValue;}
  async function getAllUses(){const d=await db();const tx=d.transaction(STORE_USES,'readonly');return await reqToPromise(tx.objectStore(STORE_USES).getAll());}
  async function getAllDayIssues(){const d=await db();const tx=d.transaction(STORE_DAY_ISSUES,'readonly');return await reqToPromise(tx.objectStore(STORE_DAY_ISSUES).getAll());}

  async function saveSnapshot(snapshot,operator){
    const tickets=Array.isArray(snapshot?.tickets)?snapshot.tickets:[];
    const reserves=Array.isArray(snapshot?.offline_day_reserves)?snapshot.offline_day_reserves:[];
    const staff=Array.isArray(snapshot?.staff)?snapshot.staff:[];
    const managerOrders=Array.isArray(snapshot?.manager_orders)?snapshot.manager_orders:[];
    const [uses,issues]=await Promise.all([getAllUses(),getAllDayIssues()]);
    const usedMap=new Map();
    for(const u of uses){if(u?.ticket_code&&u.sync_status!=='synced')usedMap.set(String(u.ticket_code),u);}
    const issueMap=new Map();
    for(const x of issues){if(x?.ticket_code&&x.sync_status!=='synced')issueMap.set(String(x.ticket_code),x);}

    const d=await db();
    const tx=d.transaction([STORE_TICKETS,STORE_DAY_RESERVES,STORE_META],'readwrite');
    const ts=tx.objectStore(STORE_TICKETS),rs=tx.objectStore(STORE_DAY_RESERVES),ms=tx.objectStore(STORE_META);
    ts.clear();rs.clear();

    for(const row of tickets){
      if(!row?.ticket_code)continue;
      const code=normalizeTicketCode(row.ticket_code),localUse=usedMap.get(code);
      ts.put({
        ticket_code:code,
        status:localUse?'used':String(row.status||''),
        product_name:row.product_name||'',
        presale_price:Number(row.presale_price||row.sale_price_snapshot||0),
        sales_channel_v2:row.sales_channel_v2||row.channel||'',
        redemption_item:localUse?.item||row.redemption_item||null,
        used_at:localUse?.used_at||row.used_at||null,
        snapshot_status:String(row.status||''),
        snapshot_at:snapshot?.snapshot_at||new Date().toISOString()
      });
    }

    for(const row of reserves){
      if(!row?.ticket_code)continue;
      const code=normalizeTicketCode(row.ticket_code),localUse=usedMap.get(code),localIssue=issueMap.get(code);
      rs.put({
        ticket_code:code,
        seller_user_id:row.seller_user_id,
        seller_name:row.seller_name||'',
        unit_price:Number(row.unit_price||0),
        server_issued_at:row.issued_at||null,
        local_issued_at:localIssue?.issued_at||null,
        snapshot_at:snapshot?.snapshot_at||new Date().toISOString()
      });
      ts.put({
        ticket_code:code,
        status:localUse?'used':'active',
        product_name:'非常用オフライン当日券（炒飯1個 / 胡麻団子2個）',
        presale_price:Number(row.unit_price||0),
        sales_channel_v2:'offline_day_reserved',
        redemption_item:localUse?.item||null,
        used_at:localUse?.used_at||null,
        snapshot_status:'reserved',
        snapshot_at:snapshot?.snapshot_at||new Date().toISOString()
      });
    }

    const savedAt=new Date().toISOString();
    ms.put({key:'snapshot_at',value:snapshot?.snapshot_at||savedAt});
    ms.put({key:'saved_at',value:savedAt});
    ms.put({key:'ticket_count',value:tickets.length+reserves.length});
    ms.put({key:'normal_ticket_count',value:tickets.length});
    ms.put({key:'offline_reserve_count',value:reserves.length});
    ms.put({key:'offline_staff',value:staff});
    ms.put({key:'offline_day_price',value:Number(snapshot?.day_price||0)});
    ms.put({key:'manager_order_snapshot',value:{saved_at:savedAt,source:'general_backup',orders:managerOrders}});
    if(operator)ms.put({key:'operator',value:operator});
    ms.put({key:'device_id',value:getDeviceId()});
    await txDone(tx);
    return {ticket_count:tickets.length+reserves.length,normal_ticket_count:tickets.length,offline_reserve_count:reserves.length,saved_at:savedAt,snapshot_at:snapshot?.snapshot_at||savedAt};
  }

  async function getTicket(value){const code=normalizeTicketCode(value);if(!code)return null;const d=await db();const tx=d.transaction(STORE_TICKETS,'readonly');return await reqToPromise(tx.objectStore(STORE_TICKETS).get(code));}

  async function markUsed(value,item){
    const code=normalizeTicketCode(value);
    if(!code)throw new Error('チケットコードがありません');
    if(!['fried_rice','sesame_pair'].includes(item))throw new Error('交換商品が不正です');
    const d=await db();
    const tx=d.transaction([STORE_TICKETS,STORE_USES,STORE_META],'readwrite');
    const ts=tx.objectStore(STORE_TICKETS),us=tx.objectStore(STORE_USES),ms=tx.objectStore(STORE_META);
    const ticket=await reqToPromise(ts.get(code));
    if(!ticket)throw new Error('この端末に保存されていないチケットです');
    if(ticket.status!=='active')throw new Error(ticket.status==='used'?'すでに使用済みです':'現在使用できないチケットです');
    const usedAt=new Date().toISOString(),localId=randomId();
    const operatorRow=await reqToPromise(ms.get('operator'));
    const registerRow=await reqToPromise(ms.get('offline_register_label'));
    const use={local_id:localId,ticket_code:code,item,used_at:usedAt,register_label:registerRow?.value||null,device_id:getDeviceId(),operator:operatorRow?.value||null,sync_status:'pending',sync_error:null,synced_at:null,server_result:null};
    ticket.status='used';ticket.redemption_item=item;ticket.used_at=usedAt;ticket.local_use_id=localId;
    ts.put(ticket);us.put(use);await txDone(tx);return use;
  }

  async function countTickets(){const d=await db();const tx=d.transaction(STORE_TICKETS,'readonly');return await reqToPromise(tx.objectStore(STORE_TICKETS).count());}
  async function listUsesByStatus(statuses){const wanted=new Set(Array.isArray(statuses)?statuses:[statuses]);const rows=await getAllUses();return rows.filter(x=>wanted.has(x.sync_status)).sort((a,b)=>String(a.used_at).localeCompare(String(b.used_at)));}
  async function updateUse(localId,patch){const d=await db();const tx=d.transaction(STORE_USES,'readwrite');const s=tx.objectStore(STORE_USES);const row=await reqToPromise(s.get(localId));if(!row)return null;Object.assign(row,patch||{});s.put(row);await txDone(tx);return row;}

  async function getStaffList(){return await getMeta('offline_staff',[]);}

  async function getDayReservesForSeller(sellerUserId){
    const d=await db();const tx=d.transaction(STORE_DAY_RESERVES,'readonly');const all=await reqToPromise(tx.objectStore(STORE_DAY_RESERVES).getAll());
    const issues=await getAllDayIssues(),used=new Set(issues.map(x=>x.ticket_code));
    return all.filter(x=>String(x.seller_user_id)===String(sellerUserId)).filter(x=>!x.server_issued_at&&!used.has(x.ticket_code)).sort((a,b)=>String(a.ticket_code).localeCompare(String(b.ticket_code)));
  }

  async function issueOfflineDayTicket(sellerUserId,sellerName){
    if(!sellerUserId)throw new Error('発行者を選択してください');
    const reserves=await getDayReservesForSeller(sellerUserId);
    if(!reserves.length)throw new Error('この発行者のオフライン当日券残数がありません');
    let idx=0;
    if(globalThis.crypto?.getRandomValues){const a=new Uint32Array(1);crypto.getRandomValues(a);idx=a[0]%reserves.length;}else idx=Math.floor(Math.random()*reserves.length);
    const r=reserves[idx],localId=randomId(),issuedAt=new Date().toISOString();
    const issue={local_id:localId,ticket_code:r.ticket_code,seller_user_id:sellerUserId,seller_name:sellerName||r.seller_name||'',unit_price:Number(r.unit_price||0),issued_at:issuedAt,device_id:getDeviceId(),sync_status:'pending',sync_error:null,synced_at:null,server_result:null};
    const d=await db();const tx=d.transaction([STORE_DAY_ISSUES,STORE_DAY_RESERVES],'readwrite');
    tx.objectStore(STORE_DAY_ISSUES).put(issue);
    const reserve=await reqToPromise(tx.objectStore(STORE_DAY_RESERVES).get(r.ticket_code));
    if(reserve){reserve.local_issued_at=issuedAt;tx.objectStore(STORE_DAY_RESERVES).put(reserve);}
    await txDone(tx);return issue;
  }

  async function listDayIssuesByStatus(statuses){const wanted=new Set(Array.isArray(statuses)?statuses:[statuses]);const rows=await getAllDayIssues();return rows.filter(x=>wanted.has(x.sync_status)).sort((a,b)=>String(a.issued_at).localeCompare(String(b.issued_at)));}
  async function updateDayIssue(localId,patch){const d=await db();const tx=d.transaction(STORE_DAY_ISSUES,'readwrite');const s=tx.objectStore(STORE_DAY_ISSUES);const row=await reqToPromise(s.get(localId));if(!row)return null;Object.assign(row,patch||{});s.put(row);await txDone(tx);return row;}

  async function setManagerOrders(orders,source='manager'){await setMeta('manager_order_snapshot',{saved_at:new Date().toISOString(),source,orders:Array.isArray(orders)?orders:[]});}
  async function getManagerOrders(){return await getMeta('manager_order_snapshot',{saved_at:null,source:null,orders:[]});}

  async function stats(){
    const [ticketCount,savedAt,snapshotAt,uses,issues,reserveCount]=await Promise.all([
      countTickets(),getMeta('saved_at',null),getMeta('snapshot_at',null),getAllUses(),getAllDayIssues(),
      (async()=>{const d=await db();const tx=d.transaction(STORE_DAY_RESERVES,'readonly');return await reqToPromise(tx.objectStore(STORE_DAY_RESERVES).count());})()
    ]);
    return {
      ticketCount,savedAt,snapshotAt,
      pending:uses.filter(x=>x.sync_status==='pending').length,
      conflicts:uses.filter(x=>x.sync_status==='conflict').length,
      synced:uses.filter(x=>x.sync_status==='synced').length,
      totalUses:uses.length,
      reserveCount,
      pendingIssues:issues.filter(x=>x.sync_status==='pending').length,
      syncedIssues:issues.filter(x=>x.sync_status==='synced').length,
      totalIssues:issues.length
    };
  }

  window.SigmaOfflineStore={normalizeTicketCode,getDeviceId,saveSnapshot,getTicket,markUsed,stats,listUsesByStatus,updateUse,getMeta,setMeta,getStaffList,getDayReservesForSeller,issueOfflineDayTicket,listDayIssuesByStatus,updateDayIssue,setManagerOrders,getManagerOrders};
})();