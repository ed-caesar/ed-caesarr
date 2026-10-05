import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const dataDir = path.join(__dirname, 'data');
const ordersFile = path.join(dataDir, 'orders.json');
const productsFile = path.join(dataDir, 'products.json');

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(rateLimit({ windowMs: 60_000, limit: 120 }));
app.use(express.static(path.join(__dirname, 'public')));

const defaultProducts = [
  {id:'kolye-1',name:'Kalp Işıltısı Kolye',price:2890,category:'Kolye',stock:10,active:true},
  {id:'kupe-1',name:'Zarif Halka Küpe',price:2450,category:'Küpe',stock:10,active:true},
  {id:'yuzuk-1',name:'Lüks Tektaş Yüzük',price:3990,category:'Yüzük',stock:10,active:true},
  {id:'bileklik-1',name:'Işıltı Bileklik',price:3250,category:'Bileklik',stock:10,active:true},
  {id:'kolye-2',name:'Şans Kolyesi',price:2490,category:'Kolye',stock:10,active:true}
];
const sessions = new Map();

async function readJson(file, fallback){ try { return JSON.parse(await fs.readFile(file,'utf8')); } catch { return fallback; } }
async function writeJson(file, value){ await fs.mkdir(dataDir,{recursive:true}); await fs.writeFile(file, JSON.stringify(value,null,2)); }
async function readOrders(){ return readJson(ordersFile, []); }
async function readProducts(){
  const p = await readJson(productsFile, null);
  if (Array.isArray(p)) return p;
  await writeJson(productsFile, defaultProducts);
  return defaultProducts;
}
async function writeProducts(products){ await writeJson(productsFile, products); }
function makeOrderId(){ return 'EC-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase(); }
function safeEqual(a,b){ const x=Buffer.from(String(a||'')); const y=Buffer.from(String(b||'')); return x.length===y.length && crypto.timingSafeEqual(x,y); }
function requireAdmin(req,res,next){
  const token = req.headers.cookie?.match(/(?:^|; )ec_admin=([^;]+)/)?.[1];
  if (!token || !sessions.has(token)) return res.status(401).json({error:'Yetkisiz.'});
  next();
}

app.get('/api/products', async (_req,res)=>res.json((await readProducts()).filter(p=>p.active)));

app.post('/api/orders', async (req,res)=>{
  const {customer, items} = req.body || {};
  if(!customer?.name || !customer?.email || !customer?.phone || !customer?.address) return res.status(400).json({error:'Müşteri bilgileri eksik.'});
  if(!Array.isArray(items) || !items.length) return res.status(400).json({error:'Sepet boş.'});
  const products = await readProducts(); const normalized=[]; let total=0;
  for(const item of items){
    const p=products.find(x=>x.id===item.id && x.active); const qty=Math.max(1,Math.min(20,Number(item.qty)||1));
    if(!p) return res.status(400).json({error:'Geçersiz ürün.'});
    if(Number(p.stock) < qty) return res.status(400).json({error:`${p.name} için yeterli stok yok.`});
    normalized.push({id:p.id,name:p.name,price:p.price,qty}); total += p.price*qty;
  }
  const order={id:makeOrderId(),createdAt:new Date().toISOString(),status:'payment_pending',customer:{name:customer.name,email:customer.email,phone:customer.phone,address:customer.address},items:normalized,total,currency:'TRY'};
  const orders=await readOrders(); orders.push(order); await writeJson(ordersFile, orders);
  for(const item of normalized){ const p=products.find(x=>x.id===item.id); p.stock=Math.max(0,Number(p.stock)-item.qty); }
  await writeProducts(products);
  res.status(201).json({orderId:order.id,total:order.total,status:order.status,payment:{provider:'paytr',ready:false,message:'PayTR mağaza bilgileri eklendiğinde ödeme adımı aktif edilecek.'}});
});

app.get('/api/orders/:id', async (req,res)=>{
  const orders=await readOrders(); const order=orders.find(o=>o.id===req.params.id);
  if(!order) return res.status(404).json({error:'Sipariş bulunamadı.'});
  res.json(order);
});

app.post('/api/admin/login', (req,res)=>{
  if(!process.env.ADMIN_KEY || !safeEqual(req.body?.key, process.env.ADMIN_KEY)) return res.status(401).json({error:'Hatalı yönetici anahtarı.'});
  const token=crypto.randomBytes(32).toString('hex'); sessions.set(token, Date.now()+8*60*60*1000);
  res.setHeader('Set-Cookie',`ec_admin=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`);
  res.json({ok:true});
});
app.post('/api/admin/logout', (req,res)=>{ const token=req.headers.cookie?.match(/(?:^|; )ec_admin=([^;]+)/)?.[1]; if(token) sessions.delete(token); res.setHeader('Set-Cookie','ec_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'); res.json({ok:true}); });
app.get('/api/admin/me', requireAdmin, (_req,res)=>res.json({ok:true}));
app.get('/api/admin/orders', requireAdmin, async (_req,res)=>res.json(await readOrders()));
app.patch('/api/admin/orders/:id', requireAdmin, async (req,res)=>{
  const allowed=['payment_pending','paid','preparing','shipped','completed','cancelled'];
  if(!allowed.includes(req.body?.status)) return res.status(400).json({error:'Geçersiz sipariş durumu.'});
  const orders=await readOrders(); const order=orders.find(o=>o.id===req.params.id); if(!order) return res.status(404).json({error:'Sipariş bulunamadı.'});
  order.status=req.body.status; await writeJson(ordersFile,orders); res.json(order);
});
app.get('/api/admin/products', requireAdmin, async (_req,res)=>res.json(await readProducts()));
app.post('/api/admin/products', requireAdmin, async (req,res)=>{
  const {name,price,category='Takı',stock=0,active=true}=req.body||{};
  if(!name || !Number.isFinite(Number(price))) return res.status(400).json({error:'Ürün adı ve fiyat zorunlu.'});
  const products=await readProducts(); const product={id:'p-'+crypto.randomBytes(6).toString('hex'),name:String(name).trim(),price:Number(price),category:String(category),stock:Math.max(0,Number(stock)||0),active:Boolean(active)}; products.push(product); await writeProducts(products); res.status(201).json(product);
});
app.patch('/api/admin/products/:id', requireAdmin, async (req,res)=>{
  const products=await readProducts(); const p=products.find(x=>x.id===req.params.id); if(!p) return res.status(404).json({error:'Ürün bulunamadı.'});
  for(const key of ['name','category']) if(req.body[key]!==undefined) p[key]=String(req.body[key]).trim();
  for(const key of ['price','stock']) if(req.body[key]!==undefined) p[key]=Math.max(0,Number(req.body[key])||0);
  if(req.body.active!==undefined) p.active=Boolean(req.body.active);
  await writeProducts(products); res.json(p);
});
app.delete('/api/admin/products/:id', requireAdmin, async (req,res)=>{
  const products=await readProducts(); const next=products.filter(x=>x.id!==req.params.id); if(next.length===products.length) return res.status(404).json({error:'Ürün bulunamadı.'}); await writeProducts(next); res.json({ok:true});
});

app.post('/api/paytr/callback', async (req,res)=>{
  console.log('PayTR callback received:', req.body?.merchant_oid, req.body?.status);
  // Production: verify PayTR hash/signature, then atomically update the matching order.
  res.send('OK');
});

app.get('/admin', (_req,res)=>res.sendFile(path.join(__dirname,'public','admin.html')));
app.get('*', (_req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`ED CAESAR running on http://localhost:${PORT}`));
