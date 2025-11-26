export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.clients = [];
    this.onlineUsers = new Set();
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket only", { status: 400 });
    }

    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    this.clients.push(server);

    // 从请求 header 获取用户名
    const url = new URL(request.url);
    const username = url.searchParams.get("user") || "unknown";

    // 加入在线用户
    this.onlineUsers.add(username);
    this.broadcastOnlineUsers();

    // 发送历史消息
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

        // 保存最新100条
        let all = (await this.state.storage.get("messages")) || [];
        all.push(msg);
        if (all.length > 100) all = all.slice(-100);
        await this.state.storage.put("messages", all);

        // 广播消息
        this.clients.forEach(c => { try { c.send(JSON.stringify(msg)); } catch(e){} });
      } catch {}
    });

    server.addEventListener("close", () => {
      this.clients = this.clients.filter(c => c !== server);
      this.onlineUsers.delete(username);
      this.broadcastOnlineUsers();
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  broadcastOnlineUsers() {
    const list = Array.from(this.onlineUsers);
    const payload = JSON.stringify({ type: 'online', users: list });
    this.clients.forEach(c => { try { c.send(payload); } catch(e){} });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // WebSocket 入口
    if (url.pathname === "/ws") {
      const username = url.searchParams.get("user");
      const id = env.CHAT_ROOM.idFromName("default");
      const obj = env.CHAT_ROOM.get(id);
      return obj.fetch(request);
    }

    // POST 登录请求
    if (request.method === "POST") {
      try {
        const { username, password } = await request.json();
        const users = JSON.parse(env.CHAT_USERS || "[]");
        const ok = users.some(u => u.user === username && u.pass === password);
        return new Response(JSON.stringify({ ok }), { headers: { "content-type": "application/json" } });
      } catch {
        return new Response(JSON.stringify({ ok:false }), { headers: { "content-type": "application/json" } });
      }
    }

    // HTML 页面
    const html = `
<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<title>聊天室</title>
<style>
:root {--bg:#121212; --bubble-left:#1f1f1f; --bubble-right:#4caf50; --text:#eee;}
body {margin:0;padding:0;font-family:sans-serif;display:flex;flex-direction:column;height:100vh;background:var(--bg);}
#login, #chat-area {flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;width:100%;}
#chat {flex:1;overflow-y:auto;padding:15px;width:100%;}
.msg {margin-bottom:10px;padding:10px 14px;border-radius:15px;max-width:70%;word-wrap:break-word;}
.msg .meta {font-size:12px;opacity:0.7;margin-bottom:4px;}
.msg.left {background:var(--bubble-left);color:var(--text);align-self:flex-start;}
.msg.right {background:var(--bubble-right);color:#fff;align-self:flex-end;}
#input-area {display:flex;padding:10px;background:#1a1a1a;border-top:1px solid #333;width:100%;}
#nick,#msg,#user,#pass {padding:10px;border-radius:8px;border:1px solid #333;background:#222;color:#eee;}
#user,#pass{margin:5px;}
#msg{flex:1;margin-right:8px;}
#send{background:#4caf50;color:white;border:none;padding:0 20px;border-radius:8px;cursor:pointer;}
#logout {position:absolute;top:10px;right:10px;color:#fff;cursor:pointer;font-size:18px;}
#onlineUsers {position:absolute;top:10px;width:100%;text-align:center;color:#fff;font-size:16px;}
@media (max-width:600px){#nick{width:70px;padding:8px;}#msg{padding:8px;}#send{padding:0 12px;}}
</style>
</head>
<body>

<div id="login">
  <input id="user" placeholder="用户名">
  <input id="pass" type="password" placeholder="密码">
  <div id="loginMsg" style="color:red;margin-top:5px;"></div>
</div>

<div id="chat-area" style="display:none;height:100%;width:100%;position:relative;">
  <div id="onlineUsers"></div>
  <div id="logout">退出</div>
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
const userInput = document.getElementById("user");
const passInput = document.getElementById("pass");
const loginMsg = document.getElementById("loginMsg");
const logoutBtn = document.getElementById("logout");
const onlineUsersDiv = document.getElementById("onlineUsers");

const chat = document.getElementById("chat");
const nickInput = document.getElementById("nick");
const msgInput = document.getElementById("msg");
const sendBtn = document.getElementById("send");

let ws;
let currentUser = null;

// 刷新保持登录
if(localStorage.getItem("chatUser")){
  currentUser = localStorage.getItem("chatUser");
  loginDiv.style.display="none";
  chatDiv.style.display="flex";
  nickInput.value = currentUser;
  initWebSocket();
}

// 初始化 WebSocket
function initWebSocket(){
  ws = new WebSocket("wss://"+location.host+"/ws?user="+encodeURIComponent(currentUser));
  ws.onmessage = (e)=>{
    const d = JSON.parse(e.data);
    if(d.type==='online'){
      onlineUsersDiv.textContent = d.users.join(' , ');
    } else {
      const el = document.createElement("div");
      el.className = "msg "+(d.sender===currentUser?"right":"left");
      el.innerHTML = \`<div class="meta">\${d.nick} · \${d.time}</div><div>\${d.text}</div>\`;
      const isAtBottom = chat.scrollHeight - chat.scrollTop <= chat.clientHeight + 5;
      chat.appendChild(el);
      if(isAtBottom) chat.scrollTop = chat.scrollHeight;
    }
  };
}

// 登录
function login(){
  const username = userInput.value.trim();
  const password = passInput.value.trim();
  if(!username||!password){ loginMsg.textContent="请输入用户名和密码"; return; }

  fetch("/",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({username,password})
  }).then(r=>r.json()).then(res=>{
    if(res.ok){
      currentUser=username;
      localStorage.setItem("chatUser",username);
      loginDiv.style.display="none";
      chatDiv.style.display="flex";
      nickInput.value=username;
      initWebSocket();
    } else {
      loginMsg.textContent="用户名或密码错误";
    }
  });
}

// 回车登录
userInput.addEventListener("keydown", e=>{if(e.key==="Enter") login();});
passInput.addEventListener("keydown", e=>{if(e.key==="Enter") login();});

// 发送消息
function sendMsg(){
  if(!msgInput.value.trim() || !currentUser) return;
  ws.send(JSON.stringify({nick:currentUser, text:msgInput.value.trim()}));
  msgInput.value="";
}
sendBtn.onclick = sendMsg;
msgInput.addEventListener("keydown", e=>{if(e.key==="Enter") sendMsg();});

// 退出
logoutBtn.onclick = ()=>{
  localStorage.removeItem("chatUser");
  currentUser=null;
  ws && ws.close();
  chat.innerHTML="";
  loginDiv.style.display="flex";
  chatDiv.style.display="none";
  onlineUsersDiv.textContent="";
};
</script>
</body>
</html>
`;

    return new Response(html, { headers: { "content-type":"text/html; charset=utf-8" } });
  }
};
