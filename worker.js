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

    // 新用户接入，发送历史消息
    const messages = (await this.state.storage.get("messages")) || [];
    messages.forEach(m => { try { server.send(JSON.stringify(m)); } catch(e){} });

    server.addEventListener("message", async (e) => {
      try {
        const data = JSON.parse(e.data);
        const msg = {
          nick: data.nick,
          text: data.text,
          time: new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }),
          sender: data.nick
        };

        // 保存最新 100 条消息
        let all = (await this.state.storage.get("messages")) || [];
        all.push(msg);
        if (all.length > 100) all = all.slice(all.length - 100);
        await this.state.storage.put("messages", all);

        // 广播消息
        this.clients.forEach(c => { try { c.send(JSON.stringify(msg)); } catch(e){} });
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

    if (request.method === "POST") {
      try {
        const { username, password } = await request.json();
        const users = JSON.parse(env.CHAT_USERS || "[]");
        const ok = users.some(u => u.user === username && u.pass === password);
        return new Response(JSON.stringify({ ok }), { headers: { "content-type": "application/json" } });
      } catch {
        return new Response(JSON.stringify({ ok: false }), { headers: { "content-type": "application/json" } });
      }
    }

    // HTML 页面
    const html = `
<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<title>多人聊天室</title>
<style>
:root {--bg:#121212; --bubble-left:#1f1f1f; --bubble-right:#4caf50; --text:#eee;}
body {margin:0;padding:0;font-family:sans-serif;display:flex;flex-direction:column;height:100vh;background:var(--bg);}
#login, #chat-area {flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;}
#chat {flex:1;overflow-y:auto;padding:15px;width:100%;}
.msg {margin-bottom:10px;padding:10px 14px;border-radius:15px;max-width:70%;word-wrap:break-word;}
.msg .meta {font-size:12px;opacity:0.7;margin-bottom:4px;}
.msg.left {background:var(--bubble-left);color:var(--text);align-self:flex-start;}
.msg.right {background:var(--bubble-right);color:#fff;align-self:flex-end;}
#input-area {display:flex;padding:10px;background:#1a1a1a;border-top:1px solid #333;width:100%;}
#nick,#msg,#user,#pass {padding:10px;border-radius:8px;border:1px solid #333;background:#222;color:#eee;}
#user,#pass{margin:5px;}
#msg{flex:1;margin-right:8px;}
#send,#loginBtn{background:#4caf50;color:white;border:none;padding:0 20px;border-radius:8px;cursor:pointer;}
</style>
</head>
<body>

<div id="login">
  <input id="user" placeholder="用户名">
  <input id="pass" type="password" placeholder="密码">
  <button id="loginBtn">登录</button>
  <div id="loginMsg" style="color:red;margin-top:5px;"></div>
</div>

<div id="chat-area" style="display:none;width:100%;height:100%;">
  <div id="chat"></div>
  <div id="input-area">
    <input id="nick" disabled>
    <input id="msg" placeholder="输入消息...">
    <button id="send">发送</button>
  </div>
</div>

<script>
const loginDiv = document.getElementById("login");
const chatDiv = document.getElementById("chat-area");
const loginBtn = document.getElementById("loginBtn");
const userInput = document.getElementById("user");
const passInput = document.getElementById("pass");
const loginMsg = document.getElementById("loginMsg");

const chat = document.getElementById("chat");
const nickInput = document.getElementById("nick");
const msgInput = document.getElementById("msg");
const sendBtn = document.getElementById("send");

let ws;
let currentUser;

loginBtn.onclick = async () => {
  const username = userInput.value.trim();
  const password = passInput.value.trim();
  if(!username || !password){ loginMsg.textContent="请输入用户名和密码"; return; }

  try {
    const res = await fetch("/", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({username,password})
    });
    const data = await res.json();
    if(data.ok){
      loginDiv.style.display="none";
      chatDiv.style.display="flex";
      nickInput.value = username;
      currentUser = username;

      ws = new WebSocket("wss://"+location.host+"/ws");
      ws.onmessage = (e) => {
        const d = JSON.parse(e.data);
        const el = document.createElement("div");
        el.className = "msg "+(d.sender===currentUser?"right":"left");
        el.innerHTML = \`<div class="meta">\${d.nick} · \${d.time}</div><div>\${d.text}</div>\`;
        chat.appendChild(el);
        chat.scrollTop = chat.scrollHeight;
      };
    } else {
      loginMsg.textContent = "用户名或密码错误";
    }
  } catch(err) {
    loginMsg.textContent = "登录失败";
  }
};

const sendMsg = () => {
  if(!msgInput.value.trim() || !ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({nick:nickInput.value, text:msgInput.value.trim()}));
  msgInput.value="";
};

sendBtn.onclick = sendMsg;
msgInput.addEventListener("keydown", e=>{if(e.key==="Enter") sendMsg();});
</script>
</body>
</html>
`;

    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
};
