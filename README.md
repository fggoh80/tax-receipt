# 税务收据小助手 · 安装部署指南

手机拍照 → Gemini AI 读收据、按 LHDN 减免项目归类 → 自动存进你自己的 Google Drive（按年份/项目/家人分文件夹）+ Google Sheets 总账。

- 纯网页 App（PWA），可「加到主屏幕」像 App 一样用，Android / iPhone 都行
- 没有后端服务器：收据只进你的 Google Drive，API Key 只存在你手机浏览器里
- 本应用只用 `drive.file` 权限 —— 只能看到它自己建立的文件，碰不到你 Drive 里其他东西

## Drive 里的结构

```
LHDN 税务收据/
├── 收据总账 Ledger            ← Google Sheets，每个 YA 一个分页
├── YA2026/
│   ├── 02 运动 Sukan/
│   │   └── 本人/2026-10-28_Decathlon Johor Bahru_RM189.90.jpg
│   ├── 08 父母医疗与护理 Perubatan Ibu Bapa/
│   │   ├── 父亲/…
│   │   └── 母亲/…
│   └── 99 其他（非减免）Lain-lain/…
└── YA2027/…
```

---

## 一次性设置（约 20 分钟，在电脑上做比较方便）

### 第 1 步：放上网（GitHub Pages，免费）

PWA 必须用 https 网址才能在手机安装。

1. 到 https://github.com 注册/登录 → 右上角 **+ → New repository**
2. 名称例如 `tax-receipt`，选 **Public**（代码里没有任何密码或 Key，公开没关系）→ Create
3. 点 **uploading an existing file**，把这个文件夹里的所有文件拖进去 → Commit
4. 进 **Settings → Pages** → Source 选 **Deploy from a branch**，Branch 选 `main` / `(root)` → Save
5. 等 1–2 分钟，网址会是：`https://你的用户名.github.io/tax-receipt/`

> 也可以用 Netlify Drop（https://app.netlify.com/drop）直接拖文件夹上去，一样免费。

### 第 2 步：Google Cloud —— 开 Drive / Sheets 权限，拿 Client ID

1. 打开 https://console.cloud.google.com → 顶部 **选择项目 → 新建项目**，名称 `Tax Receipt`
2. 左边菜单 **API 和服务 → 库**，搜索并 **启用**：
   - **Google Drive API**
   - **Google Sheets API**
3. **API 和服务 → OAuth 同意屏幕**（或 Google Auth Platform → 品牌）：
   - 用户类型 **外部 (External)**，应用名 `税务收据小助手`，填你的邮箱
   - **数据访问 / 范围**：添加 `.../auth/drive.file`
   - **受众 / 测试用户**：加入你自己的 Gmail（和家人的，如果他们也要用）
   - 保持「测试中 (Testing)」状态即可，只给自己用不需要 Google 审核
4. **API 和服务 → 凭据 → 创建凭据 → OAuth 客户端 ID**
   - 应用类型：**Web 应用**
   - **已获授权的 JavaScript 来源**：填第 1 步的网址根部，例如 `https://你的用户名.github.io`（不要加路径、不要加结尾 /）
   - 创建 → 复制 **客户端 ID**（`xxxx.apps.googleusercontent.com`）

> ⚠ 「测试中」状态的 OAuth 应用，授权每 7 天会失效一次，到时 App 会再弹出 Google 登录，点一下就好。想要免这一步，可在 OAuth 同意屏幕点「发布应用」；drive.file 属于非敏感权限，通常不需要提交审核。

### 第 3 步：拿 Gemini API Key

1. 打开 https://aistudio.google.com/apikey → **Create API key** → 选第 2 步的项目
2. 复制 Key（`AIza…`）
3. 免费额度对个人每年几百张收据绰绰有余

建议：在 Google Cloud **凭据** 页面点开这把 Key → **API 限制** 只勾 *Generative Language API*，**应用限制** 选「网站」并填你的 GitHub Pages 网址，防止被盗用。

### 第 4 步：手机安装

1. 手机浏览器打开第 1 步网址（Android 用 Chrome，iPhone 用 Safari）
2. **设置** 页面填入 Client ID、Gemini Key、家人名单 → 保存 → **连接 Google Drive** → 登录授权
3. 安装到主屏幕：
   - Android Chrome：右上角 ⋮ → **添加到主屏幕 / 安装应用**
   - iPhone Safari：分享按钮 → **添加到主屏幕**

完成！之后每次拿到收据：打开 App → 📷 拍照 → 检查 AI 填好的资料 → **保存到 Drive**。

---

## 使用小贴士

- **AI 只是建议**：保存前一定看一眼分类、金额、日期。黄色框 = AI 把握不高，要特别检查。
- **YA 按收据日期**：2026 年的收据进 YA2026，2027 年 4–5 月报税时用。
- **总览** 页面显示每个项目已花多少、上限多少、还可以用多少，报税时照着填 e-Filing 就行。
- **重复上传** 会被检测出来并提醒。
- **改错了？** 打开总账改分类那一列（总览会跟着变），并在 Drive 把文件拖到正确文件夹。
- **保存期限**：所得税法第 82A 条要求保留 7 年。App 永远不会删除文件；建议 YA2026 的收据保留到 2034 年之后。
- **Drive 空间**：照片自动压缩到约 0.3–0.8 MB，一年几百张不到 0.5 GB，免费 15 GB 够用很多年。

## 每年要做的一件事

财政预算案每年都会改减免项目和上限。每年 1 月打开 `reliefs.js`，对照 LHDN 官网
（hasil.gov.my → Individu → Pelepasan Cukai）修改金额或新增项目，再上传到 GitHub 覆盖旧文件即可。
AI 的分类规则和总览上限会自动跟着更新。

## 文件说明

| 文件 | 作用 |
|---|---|
| `index.html` | 界面 |
| `app.js` | 主程序：Google 登录、Gemini 分析、Drive 上传、Sheets 总账、总览计算 |
| `reliefs.js` | **减免项目表**（每年更新这个） |
| `manifest.json`, `sw.js`, `icon*` | PWA 安装、离线外壳、图标 |

## 常见问题

- **点“连接”没反应 / 弹窗被挡**：允许该网站弹出窗口；确认 Client ID 的「JavaScript 来源」和网址完全一致（https、无结尾 /）。
- **Error 403 access_denied**：没把你的 Gmail 加进 OAuth「测试用户」。
- **Gemini 错误 404**：模型名称改了。设置里模型填 `gemini-flash-latest`（自动用最新 Flash）。
- **换手机**：在新手机填同样的 Client ID 和 Key、连接同一个 Google 账号即可，之前的收据和总账都在。

> 本工具协助整理收据，不构成税务意见。申报前请以 LHDN 最新公告为准，复杂情况请咨询持牌税务代理。
