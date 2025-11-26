# Cloudflare-chat
* fork该项目
* 获取`CLOUDFLARE_API_TOKEN`并添加到项目机密`CLOUDFLARE_API_TOKEN`，注意权限
* 通过Actions手动部署
* 在Cloudflare中的Workers&Pages中新出现的的Cloudflare-chat中添加`CHAT_USERS`环境机密，也就是多个用户名和密码，以如下JSON格式
```
[
  {"user":"tom","pass":"123"},
  {"user":"bob","pass":"456"}
]
```
* 添加自定义域，禁用预览，访问并登录使用
