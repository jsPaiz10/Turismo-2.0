import {readPlan,writePlan} from './src/plans.mjs';
import {controlSnapshot} from './src/control.mjs';
import {startExcelSync} from './src/excel-sync.mjs';
import {serveMedia} from './src/media.mjs';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {openDatabase} from './src/database.mjs';
import {destinations,categories,filterDestinations,buildPlan} from './src/catalog.mjs';
import {hashPassword,verifyPassword,randomToken,digest,securityHeaders,readJson,createLimiter,HttpError} from './src/security.mjs';
import {renderHome,renderDestination,renderInfo,renderTerrain,renderControl} from './src/views.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
export async function createApp(config={}) {
 const production=(config.mode??process.env.NODE_ENV)==='production';
 const origin=new URL(config.origin??process.env.PUBLIC_ORIGIN??process.env.RENDER_EXTERNAL_URL??'http://localhost:3000');
 if(origin.pathname!=='/'||origin.search||origin.hash||origin.username||origin.password)throw new Error('PUBLIC_ORIGIN debe contener únicamente el origen.');
 if(production&&origin.protocol!=='https:')throw new Error('Producción requiere PUBLIC_ORIGIN con HTTPS.');
 const dataDir=config.dataDir??process.env.DATA_DIR??resolve(root,'data');
 const db=openDatabase(dataDir);
 const excel=startExcelSync(db,resolve(dataDir,'control'),{enabled:config.excelEnabled??process.env.EXCEL_ENABLED!=='false',interval:config.excelInterval??1500,worker:config.excelWorker});
 const limiter=createLimiter();
 const dummyHash=await hashPassword(randomToken());
 const cookieName=production?'__Host-te_session':'te_session';
 let hashing=0;
 async function guardedHash(action){if(hashing>=4)throw new HttpError(503,'Estamos atendiendo otras solicitudes. Inténtalo de nuevo.');hashing++;try{return await action();}finally{hashing--;}}
 const purge=()=>db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());purge();
 const timer=setInterval(purge,60000);timer.unref();
 function session(req){const value=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);if(!value||!/^[a-f0-9]{64}$/.test(value))return null;return db.prepare('SELECT * FROM sessions WHERE token=? AND expires>?').get(digest(value),Date.now());}
 function newSession(res,userId=null,previous=null){const token=randomToken(),csrf=randomToken(),age=userId?7*86400:2*3600;if(previous)db.prepare('DELETE FROM sessions WHERE token=?').run(previous.token);db.prepare('INSERT INTO sessions(token,user_id,csrf,expires) VALUES(?,?,?,?)').run(digest(token),userId,csrf,Date.now()+age*1000);res.setHeader('Set-Cookie',`${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${production?'; Secure':''}`);return {user_id:userId,csrf};}
 function userState(s){return {csrfToken:s.csrf,user:s.user_id?db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(s.user_id):null};}
 const server=createServer({maxHeaderSize:16384},async(req,res)=>{
  for(const[k,v]of Object.entries(securityHeaders(production)))res.setHeader(k,v);
  const send=(code,value,type='application/json; charset=utf-8')=>{res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store'});res.end(req.method==='HEAD'?'':type.startsWith('application/json')?JSON.stringify(value):value);};
  try {
   if(req.headers.host!==origin.host)throw new HttpError(421,'El dominio de la solicitud no está permitido.');
   const url=new URL(req.url,origin),path=url.pathname;
   if(req.url.length>2048)throw new HttpError(414,'La dirección es demasiado larga.');
   const ip=req.socket.remoteAddress??'unknown';
   if(path.startsWith('/api/'))limiter.take('api:'+ip,180,60000);
   let s=session(req);
   if(!['GET','HEAD'].includes(req.method)){
    if(req.headers.origin!==origin.origin||req.headers['sec-fetch-site']==='cross-site')throw new HttpError(403,'Origen no permitido.');
    if(!s||req.headers['x-csrf-token']!==s.csrf)throw new HttpError(403,'La sesión caducó. Recarga la página.');
   }
   if(path==='/api/session'&&req.method==='GET'){if(!s)s=newSession(res);return send(200,userState(s));}
   if(path==='/api/itinerary'&&req.method==='GET'){const days=Number(url.searchParams.get('days')),interest=url.searchParams.get('interest'),stops=buildPlan(days,interest);if(!stops)throw new HttpError(400,'Elige de uno a tres días y un interés válido.');return send(200,{plan:{days,interest,stops}});}
   if(path==='/api/destinations'&&req.method==='GET'){
    const q=url.searchParams.get('q')??'',category=url.searchParams.get('category')??'todos',region=url.searchParams.get('region')??'todas';
    if(q.length>100||!Object.hasOwn(categories,category)||!['todas','occidente','centro','costa'].includes(region))throw new HttpError(400,'Los filtros no son válidos.');
    return send(200,{destinations:filterDestinations({q,category,region})});
   }
   if(['/api/auth/register','/api/auth/login'].includes(path)&&req.method==='POST'){
    limiter.take('auth-ip:'+ip,15,15*60000);
    const body=await readJson(req),email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
    if(email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email)||typeof body.password!=='string'||body.password.length<12||body.password.length>128)throw new HttpError(400,'Usa un correo válido y una contraseña de 12 a 128 caracteres.');
    limiter.take('auth-email:'+digest(email),10,15*60000);
    let user=db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if(path.endsWith('/register')){
     const name=typeof body.name==='string'?body.name.trim():'';
     if(name.length<2||name.length>80||/[\x00-\x1f<>]/.test(name)||body.acceptPrivacy!==true)throw new HttpError(400,'Revisa tu nombre y acepta el aviso de privacidad.');
     const password=await guardedHash(()=>hashPassword(body.password));
     if(user)throw new HttpError(409,'No se pudo crear la cuenta. Prueba iniciar sesión.');
     user={id:randomUUID(),name,email};
     try{db.prepare('INSERT INTO users(id,name,email,password,created) VALUES(?,?,?,?,?)').run(user.id,name,email,password,Date.now());}catch(error){if(error.code?.startsWith('ERR_SQLITE'))throw new HttpError(409,'No se pudo crear la cuenta. Prueba iniciar sesión.');throw error;}
    }else{
     const valid=await guardedHash(()=>verifyPassword(body.password,user?.password??dummyHash));
     if(!valid||!user)throw new HttpError(401,'Correo o contraseña incorrectos.');
    }
    db.prepare('UPDATE users SET last_login=?,login_count=login_count+1 WHERE id=?').run(Date.now(),user.id);
    s=newSession(res,user.id,s);return send(path.endsWith('/register')?201:200,userState(s));
   }
   if(path==='/api/auth/logout'&&req.method==='POST'){s=newSession(res,null,s);return send(200,userState(s));}
   if(path==='/api/account'&&req.method==='DELETE'){
    if(!s?.user_id)throw new HttpError(401,'Inicia sesión para continuar.');
    limiter.take('delete:'+ip,5,15*60000);const body=await readJson(req);
    if(typeof body.password!=='string'||body.password.length>128)throw new HttpError(400,'Escribe tu contraseña.');
    const user=db.prepare('SELECT password FROM users WHERE id=?').get(s.user_id);
    if(!await guardedHash(()=>verifyPassword(body.password,user.password)))throw new HttpError(401,'La contraseña no es correcta.');
    db.prepare('DELETE FROM users WHERE id=?').run(s.user_id);s=newSession(res);return send(200,userState(s));
   }
   if(path==='/api/favorites'){
    if(!s?.user_id)throw new HttpError(401,'Inicia sesión para guardar en tu cuenta.');
    if(req.method==='PUT'){const body=await readJson(req);if(!Array.isArray(body.ids)||body.ids.length>destinations.length||body.ids.some(id=>!destinations.some(d=>d.id===id)))throw new HttpError(400,'La lista de favoritos no es válida.');db.exec('BEGIN');try{db.prepare('DELETE FROM favorites WHERE user_id=?').run(s.user_id);const insert=db.prepare('INSERT INTO favorites VALUES(?,?)');for(const id of new Set(body.ids))insert.run(s.user_id,id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
    else if(req.method!=='GET')throw new HttpError(405,'Método no permitido.');
    return send(200,{ids:db.prepare('SELECT destination_id FROM favorites WHERE user_id=?').all(s.user_id).map(row=>row.destination_id)});
   }
   if(path==='/api/plan'){
    if(!s?.user_id)throw new HttpError(401,'Inicia sesión para guardar en tu cuenta.');
    if(req.method==='PUT')writePlan(db,s.user_id,await readJson(req));
    else if(req.method==='DELETE')db.prepare('DELETE FROM plans WHERE user_id=?').run(s.user_id);
    else if(req.method!=='GET')throw new HttpError(405,'Método no permitido.');
    return send(200,{plan:readPlan(db,s.user_id)});
   }
   if(path==='/api/control'||path==='/api/control/excel'){
    if(!s?.user_id)throw new HttpError(401,'Inicia sesión con tu cuenta administradora.');
    const admin=db.prepare('SELECT role FROM users WHERE id=?').get(s.user_id);
    if(admin?.role!=='admin')throw new HttpError(403,'Esta sección es solo para administradores.');
    if(req.method!=='GET')throw new HttpError(405,'Método no permitido.');
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Robots-Tag','noindex, nofollow');
    if(path.endsWith('/excel')){
     const status=excel.state();if(!status.enabled||status.pending||status.error)throw new HttpError(503,status.error??'El Excel se está actualizando. Intenta nuevamente en unos segundos.');
     let file;try{file=await readFile(excel.target);}catch{throw new HttpError(503,'El Excel todavía no está disponible.');}
     if(excel.state().revision!==status.revision)throw new HttpError(503,'Hay cambios recientes. Espera la actualización del Excel.');
     res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="control-turismo.xlsx"','Content-Length':file.length});return res.end(file);
    }
    const page=Number(url.searchParams.get('page')??1);if(!Number.isInteger(page)||page<1||page>100000)throw new HttpError(400,'Página no válida.');
    const snapshot=controlSnapshot(db),offset=(page-1)*50;return send(200,{totals:{users:snapshot.users.length,plans:snapshot.plans.length,favorites:snapshot.favorites.length},users:snapshot.users.slice(offset,offset+50),plans:snapshot.plans.slice(offset,offset+50),page,pages:Math.max(1,Math.ceil(Math.max(snapshot.users.length,snapshot.plans.length)/50)),excel:excel.state()});
   }
   if(path.startsWith('/api/'))throw new HttpError(404,'No existe esta ruta.');
   if(!['GET','HEAD'].includes(req.method))throw new HttpError(405,'Método no permitido.');
   if(await serveMedia(req,res,root,path))return;
   if(path==='/el-salvador-3d')return send(200,renderTerrain(origin.origin),'text/html; charset=utf-8');
   if(path==='/control'){res.setHeader('X-Robots-Tag','noindex, nofollow');return send(200,renderControl(origin.origin),'text/html; charset=utf-8');}
   if(path==='/')return send(200,renderHome(origin.origin),'text/html; charset=utf-8');
   if(path.startsWith('/destinos/')){const d=destinations.find(x=>path==='/destinos/'+x.id);if(d)return send(200,renderDestination(d,origin.origin),'text/html; charset=utf-8');}
   if(['/privacidad','/creditos','/guia'].includes(path))return send(200,renderInfo(path,origin.origin),'text/html; charset=utf-8');
   if(path==='/robots.txt')return send(200,`User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${origin.origin}/sitemap.xml\n`,'text/plain; charset=utf-8');
   if(path==='/sitemap.xml')return send(200,`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/','/guia',...destinations.map(d=>'/destinos/'+d.id)].map(p=>`<url><loc>${origin.origin}${p}</loc></url>`).join('')}</urlset>`,'application/xml; charset=utf-8');
   // Only explicitly public files are served. Never expose source, secrets or database.
   if(['/control.js','/control.css','/app.js','/journey.js','/experience.js','/experience.css','/terrain.js','/terrain.css','/brand.js','/brand.css','/culture.js','/culture.css','/botanical.js','/botanical.css','/photo-scene.js','/patio-cinema.js','/patio.js','/patio.css','/patio-models.js','/styles.css','/favicon.svg'].includes(path)||/^\/assets\/[a-z0-9-]+\.(webp|woff2|glb|json|svg)$/.test(path)||['/vendor/three.module.js','/vendor/three.core.js','/vendor/GLTFLoader.js','/vendor/BufferGeometryUtils.js','/vendor/SkeletonUtils.js'].includes(path)){
    try{const file=await readFile(resolve(root,'public','.'+path));const types={'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp','.woff2':'font/woff2','.glb':'model/gltf-binary','.json':'application/json; charset=utf-8'};res.writeHead(200,{'Content-Type':types[extname(path)],'Cache-Control':'public, max-age=3600'});return res.end(req.method==='HEAD'?'':file);}catch(error){if(error.code!=='ENOENT')throw error;}
   }
   return send(404,renderInfo('/404',origin.origin),'text/html; charset=utf-8');
  }catch(error){if(res.headersSent){res.destroy();return;}if(error.status===429)res.setHeader('Retry-After','900');if(!error.status)console.error('Request failed:',error.code??error.name);send(error.status??500,{error:error.status?error.message:'No pudimos completar la solicitud. Inténtalo de nuevo.'});}
 });
 server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
 server.on('close',()=>{excel.close();clearInterval(timer);limiter.close();db.close();});
 return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const server=await createApp();const port=Number(process.env.PORT??3000);server.listen(port,process.env.HOST??'127.0.0.1',()=>console.log(`Turismo Escondido: ${process.env.PUBLIC_ORIGIN??'http://localhost:'+port}`));
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
}
