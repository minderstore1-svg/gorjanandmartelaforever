/**
 * GORJAN & MARTELA FOREVER — Controller Server
 * Works locally (node server.js) AND on Glitch/Render/Railway
 */
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;

function getLocalIP(){
  for(const ifaces of Object.values(os.networkInterfaces()))
    for(const i of ifaces)
      if(i.family==='IPv4' && !i.internal) return i.address;
  return '127.0.0.1';
}

// WS frame encode / decode (no npm, pure Node)
function encodeWS(data){
  const buf=Buffer.from(typeof data==='string'?data:JSON.stringify(data),'utf8');
  const len=buf.length;
  const frame=Buffer.alloc(len<126?2+len:4+len);
  frame[0]=0x81;
  if(len<126){frame[1]=len;buf.copy(frame,2);}
  else{frame[1]=126;frame.writeUInt16BE(len,2);buf.copy(frame,4);}
  return frame;
}
function decodeWS(buf){
  if(buf.length<2)return null;
  const masked=(buf[1]&0x80)!==0;
  let len=buf[1]&0x7f, offset=2;
  if(len===126){len=buf.readUInt16BE(2);offset=4;}
  if(buf.length<offset+(masked?4:0)+len)return null;
  if(!masked)return buf.slice(offset,offset+len).toString('utf8');
  const mask=buf.slice(offset,offset+4);offset+=4;
  const payload=Buffer.allocUnsafe(len);
  for(let i=0;i<len;i++)payload[i]=buf[offset+i]^mask[i%4];
  return payload.toString('utf8');
}
function wsHandshake(req,socket){
  const accept=crypto.createHash('sha1')
    .update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
}

// Clients
let gameSock=null;
const players={};

function wsURL(req){
  // Detect if behind HTTPS proxy (Glitch/Render/Railway all set this)
  const proto = req.headers['x-forwarded-proto']==='https' ? 'wss' : 'ws';
  const host  = req.headers['host'] || `localhost:${PORT}`;
  return `${proto}://${host}`;
}
function gameURL(req){
  const proto = req.headers['x-forwarded-proto']==='https' ? 'https' : 'http';
  const host  = req.headers['host'] || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

// HTTP server
const server=http.createServer((req,res)=>{
  const url=req.url.split('?')[0];

  if(url==='/'||url==='/game'){
    let html=fs.readFileSync(path.join(__dirname,'wedding-game-v9.html'),'utf8');
    const WS=wsURL(req);
    const GAME=gameURL(req);
    // Replace hardcoded localhost URL with the real server URL
    html=html.replace(/ws:\/\/localhost:3000/g, WS);
    html=html.replace(/http:\/\/localhost:3000/g, GAME);
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
    res.end(html);

  } else if(url==='/controller'){
    let html=fs.readFileSync(path.join(__dirname,'controller.html'),'utf8');
    html=html.replace(/__WS_URL__/g, wsURL(req));
    html=html.replace(/__GAME_URL__/g, gameURL(req));
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
    res.end(html);

  } else if(url.startsWith('/music/') && url.endsWith('.mp3')){
    // Map clean names → actual filenames in repo root
    const nameMap = {
      'floating-also.mp3':       'William Rosati - Floating Also.mp3',
      'powerup.mp3':             'Jeremy Blake - Powerup!.mp3',
      'maze.mp3':                'Density & Time - MAZE.mp3',
      'night-shade.mp3':         'AdhesiveWombat - Night Shade.mp3',
      'sour-rock.mp3':           'Jeremy Korpas - Sour Rock.mp3',
      'coupe.mp3':               'The Grand Affair - Coupe.mp3',
      '8bit-dungeon.mp3':        'Kevin MacLeod - 8bit Dungeon Level.mp3',
      'underclocked.mp3':        'Eric Skiff - Underclocked (underunderclocked mix).mp3',
      '8bit-love.mp3':           'HeatleyBros - HeatleyBros I - 06 8 Bit Love.mp3',
      '8bit-space-groove.mp3':   'HeatleyBros - HeatleyBros I - 08 8 Bit Space Groove.mp3',
      'fun-puzzle-quest.mp3':    'HeatleyBros - HeatleyBros I - 05 Fun Puzzle Quest.mp3',
      'back-to-business.mp3':    'HeatleyBros - HeatleyBros I - 07 Back To Business.mp3',
      'wedding-march.mp3':     "Mendelssohn's Wedding March.mp3",
      'dreams-of-childhood.mp3': 'dreams-of-childhood.mp3',
    };
    const clean = decodeURIComponent(path.basename(url));
    const actual = nameMap[clean];
    const fpath = actual ? path.join(__dirname, actual) : null;
    if(fpath && fs.existsSync(fpath)){
      const stat = fs.statSync(fpath);
      res.writeHead(200,{
        'Content-Type':'audio/mpeg',
        'Content-Length':stat.size,
        'Accept-Ranges':'bytes',
        'Cache-Control':'public, max-age=86400',
      });
      fs.createReadStream(fpath).pipe(res);
    } else {
      res.writeHead(404); res.end('Music not found: '+clean);
    }

  } else {
    res.writeHead(404);res.end('Not found');
  }
});

// WebSocket upgrade
server.on('upgrade',(req,socket)=>{
  if(req.headers['upgrade']!=='websocket'){socket.destroy();return;}
  wsHandshake(req,socket);
  let buf=Buffer.alloc(0);
  socket.on('data',chunk=>{
    buf=Buffer.concat([buf,chunk]);
    let txt;
    while((txt=decodeWS(buf))!==null){
      buf=Buffer.alloc(0);
      // Compact key message — passthrough raw
      if(txt.length > 1 && txt[1]===':' && (txt[0]==='d'||txt[0]==='u')){
        if(gameSock&&!gameSock.destroyed) gameSock.write(encodeWS(txt));
        continue;
      }
      // God mode secret
      if(txt==='GODMODE'){
        if(gameSock&&!gameSock.destroyed) gameSock.write(encodeWS('GODMODE'));
        continue;
      }
      // SFX mute toggle
      if(txt==='SFXMUTE'){
        if(gameSock&&!gameSock.destroyed) gameSock.write(encodeWS('SFXMUTE'));
        continue;
      }
      // Plain string OR JSON game_register
      if(txt==='game_register'){
        gameSock=socket;
        const proto=req.headers['x-forwarded-proto']==='https'?'https':'http';
        const host=req.headers['host']||`localhost:${PORT}`;
        socket.write(encodeWS({type:'server_info',url:`${proto}://${host}`}));
        Object.keys(players).forEach(p=>socket.write(encodeWS({type:'player_connected',player:p})));
        continue;
      }
      try{
        const msg=JSON.parse(txt);
        if(msg.type==='game_register'){
          gameSock=socket;
          const proto=req.headers['x-forwarded-proto']==='https'?'https':'http';
          const host=req.headers['host']||`localhost:${PORT}`;
          socket.write(encodeWS({type:'server_info',url:`${proto}://${host}`}));
          Object.keys(players).forEach(p=>socket.write(encodeWS({type:'player_connected',player:p})));
        } else if(msg.type==='player_register'){
          players[msg.player]=socket;
          socket._role=msg.player;
          if(gameSock&&!gameSock.destroyed)gameSock.write(encodeWS({type:'player_connected',player:msg.player}));
          socket.write(encodeWS({type:'registered',player:msg.player}));
          console.log('✅',msg.player,'connected');
        } else if(msg.type==='ping'){
          socket.write(encodeWS({type:'pong'}));
        }
      }catch(e){}
    }
  });
  socket.on('close',()=>{
    if(socket===gameSock){gameSock=null;console.log('⚠️  Game disconnected');}
    if(socket._role){delete players[socket._role];if(gameSock&&!gameSock.destroyed)gameSock.write(encodeWS({type:'player_disconnected',player:socket._role}));console.log('❌',socket._role,'disconnected');}
  });
  socket.on('error',()=>{});
});

server.listen(PORT,()=>{
  const localIP=getLocalIP();
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║   GORJAN & MARTELA FOREVER — Game Server     ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  📺  http://localhost:${PORT}  (open on this PC)  ║`);
  console.log(`║  📱  http://${localIP}:${PORT}/controller           ║`);
  console.log('╚══════════════════════════════════════════════╝\n');
});
