export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.clients = [];
  }

  async getNextNick() {
    const online = (await this.state.storage.get("online")) || [];
    let num = 1;
    while (online.includes(String(num).padStart(3, "0"))) num++;
    const nick = String(num).padStart(3, "0");
    online.push(nick);
    await this.state.storage.put("online", online);
    return nick;
  }

  async removeNick(nick) {
    const online = (await this.state.storage.get("online")) || [];
    const idx = online.indexOf(nick);
    if (idx >= 0) online.splice(idx, 1);
    await this.state.storage.put("online", online);
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket only", { status: 400 });
    }

    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    this.clients.push(server);

    const nick = await this.getNextNick();
    server.send(JSON.stringify({ type: "nick", nick }));

    // 发送历史消息
    const history = await this.state.storage.list({ prefix: "msg:" });
    const sortedHistory = history.sort((a, b) => a.metadata.time - b.metadata.time);
    for (const { value } of sortedHistory) {
      server.send(JSON.stringify({
        type: "msg",
        nick: value.nick,
        sender: value.sender,
        text: value.text,
        time: value.time
      }));
    }

    server.addEventListener("message", async (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "msg") {
          const shTime = new Intl.DateTimeFormat("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
            timeZone: "Asia/Shanghai",
          }).format(new Date());

          const payload = {
            type: "msg",
            nick,
            sender: nick,
            text: data.text,
            time: shTime
          };

          const id = crypto.randomUUID();
          await this.state.storage.put("msg:" + id, payload, { metadata: { time: Date.now() } });

          // 保留最新 100 条消息
          const allMessages = await this.state.storage.list({ prefix: "msg:" });
          if (allMessages.length > 100) {
            const sorted = allMessages.sort((a, b) => a.metadata.time - b.metadata.time);
            const excess = sorted.length - 100;
            for (let i = 0; i < excess; i++) {
              await this.state.storage.delete(sorted[i].key);
            }
          }

          const str = JSON.stringify(payload);
          this.clients.forEach(c => { try { c.send(str); } catch {} });
        }
      } catch {}
    });

    server.addEventListener("close", async () => {
      this.clients = this.clients.filter(c => c !== server);
      await this.removeNick(nick);
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

    // 密码通过环境变量
    const PASSWORD = env.CHAT_PASSWORD || "1234";

    const html = `
<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<title>多人聊天室</title>
<style>
:root {--bg:#121212; --bubble-left:#1f1f1f; --bubble-right:#4caf50; --text:#eee;}
body {margin:0;padding:0;font-family:sans-serif;display:flex;flex-direction:column;height:100vh;background:var(--bg);}
#login,#chat-container {flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;}
#chat-container{display:none;flex:1;width:100%;}
#chat{flex:1;overflow-y:auto;padding:15px;width:100%;}
.msg{margin-bottom:10px;padding:10px 14px;border-radius:15px;max-width:70%;word-wrap:break-word;}
.msg .meta{font-size:12px;opacity:0.7;margin-bottom:4px;}
.msg.left{background:var(--bubble-left);color:var(--text);align-self:flex-start;}
.msg.right{background:var(--bubble-right);color:#fff;align-self:flex-end;}
#input-area{display:flex;padding:10px;background:#1a1a1a;border-top:1px solid #333;width:100%;box-sizing:border-box;}
#msg{flex:1;margin-right:8px;padding:10px;border-radius:8px;border:1px solid #333;background:#222;color:#eee;}
#send{background:#4caf50;color:white;border:none;padding:0 20px;border-radius:8px;cursor:pointer;}
#password{padding:10px;border-radius:8px;border:1px solid #333;background:#222;color:#eee;margin-bottom:10px;}
#login button{padding:10px 20px;border-radius:8px;border:none;background:#4caf50;color:#fff;cursor:pointer;}
</style>
</head>
<body>
<div id="login">
<input type="password" id="password" placeholder="请输入密码">
<button id="loginBtn">进入聊天室</button>
</div>
<div id="chat-container">
<div id="chat"></div>
<div id="input-area">
<input id="msg" placeholder="输入消息...">
<button id="send">发送</button>
</div>
</div>
<script>
let myNick = "";
const PASSWORD = "${PASSWORD}";

const loginDiv = document.getElementById("login");
const loginBtn = document.getElementById("loginBtn");
const passwordInput = document.getElementById("password");
const chatContainer = document.getElementById("chat-container");
const chat = document.getElementById("chat");
const msgInput = document.getElementById("msg");
const sendBtn = document.getElementById("send");

loginBtn.onclick = () => {
  if(passwordInput.value === PASSWORD){
    loginDiv.style.display = "none";
    chatContainer.style.display = "flex";
    initChat();
  }else{
    alert("密码错误");
  }
};

function initChat(){
  const ws = new WebSocket("wss://"+location.host+"/ws");

  ws.onmessage = (e)=>{
    const d = JSON.parse(e.data);
    if(d.type==="nick"){
      myNick = d.nick; // 先获取昵称
    }else if(d.type==="msg"){
      const el = document.createElement("div");
      el.className = "msg "+(d.sender===myNick?"right":"left");
      el.innerHTML = \`<div class="meta">\${d.nick} · \${d.time}</div><div>\${d.text}</div>\`;
      chat.appendChild(el);
      chat.scrollTop = chat.scrollHeight;
    }
  };

  const sendMsg = () => {
    if(!msgInput.value.trim()) return;
    ws.send(JSON.stringify({type:"msg", text: msgInput.value.trim()}));
    msgInput.value="";
  };
  sendBtn.onclick = sendMsg;
  msgInput.addEventListener("keydown", e => {if(e.key==="Enter") sendMsg();});
}
</script>
</body>
</html>
`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
};
