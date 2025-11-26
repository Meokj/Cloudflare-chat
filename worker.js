export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.clients = [];
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket only", { status: 400 });
    }

    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    this.clients.push(server);

    server.addEventListener("message", (e) => {
      try {
        const data = JSON.parse(e.data);
        const payload = JSON.stringify({
          nick: data.nick,
          text: data.text,
          time: new Date().toLocaleTimeString(),
          sender: data.nick
        });
        this.clients.forEach(c => { try { c.send(payload); } catch(e){} });
      } catch {}
    });

    server.addEventListener("close", () => {
      this.clients = this.clients.filter(c => c !== server);
    });

    return new Response(null, { status: 101, webSocket: client });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      const id = env.CHAT_ROOM.idFromName("default");
      const obj = env.CHAT_ROOM.get(id);
      return obj.fetch(request);
    }

    const html = `
<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<title>多人聊天室</title>
<style>
:root {--bg:#121212; --bubble-left:#1f1f1f; --bubble-right:#4caf50; --text:#eee;}
body {margin:0;padding:0;font-family:sans-serif;display:flex;flex-direction:column;height:100vh;background:var(--bg);}
#chat {flex:1;overflow-y:auto;padding:15px;}
.msg {margin-bottom:10px;padding:10px 14px;border-radius:15px;max-width:70%;word-wrap:break-word;}
.msg .meta {font-size:12px;opacity:0.7;margin-bottom:4px;}
.msg.left {background:var(--bubble-left);color:var(--text);align-self:flex-start;}
.msg.right {background:var(--bubble-right);color:#fff;align-self:flex-end;}
#input-area {display:flex;padding:10px;background:#1a1a1a;border-top:1px solid #333;}
#nick,#msg {padding:10px;border-radius:8px;border:1px solid #333;background:#222;color:#eee;}
#nick{width:100px;margin-right:8px;}
#msg{flex:1;margin-right:8px;}
#send{background:#4caf50;color:white;border:none;padding:0 20px;border-radius:8px;cursor:pointer;}
@media (max-width:600px){#nick{width:70px;padding:8px;}#msg{padding:8px;}#send{padding:0 12px;}}
</style>
</head>
<body>
<div id="chat"></div>
<div id="input-area">
<input id="nick" placeholder="昵称">
<input id="msg" placeholder="输入消息...">
<button id="send">发送</button>
</div>
<script>
const chat=document.getElementById("chat");
const nick=document.getElementById("nick");
const msg=document.getElementById("msg");
const send=document.getElementById("send");
const ws=new WebSocket("wss://"+location.host+"/ws");

ws.onmessage=(e)=>{
  const d=JSON.parse(e.data);
  const el=document.createElement("div");
  el.className="msg "+(d.sender===nick.value?"right":"left");
  el.innerHTML=\`<div class="meta">\${d.nick} · \${d.time}</div><div>\${d.text}</div>\`;
  chat.appendChild(el);
  chat.scrollTop=chat.scrollHeight;
};

const sendMsg=()=>{
  if(!nick.value.trim()||!msg.value.trim())return;
  ws.send(JSON.stringify({nick:nick.value.trim(),text:msg.value.trim()}));
  msg.value="";
};

send.onclick=sendMsg;
msg.addEventListener("keydown",e=>{if(e.key==="Enter")sendMsg();});
</script>
</body>
</html>
`;
    return new Response(html, { headers: { "content-type":"text/html; charset=utf-8" } });
  }
};
