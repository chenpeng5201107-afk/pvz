import type { Store } from './store.ts';
import { LEVELS } from '../src/core/content.ts';

export const isLoopbackAddress = (address?: string): boolean =>
  address === '::1' ||
  /^127\.\d+\.\d+\.\d+$/.test(address ?? '') ||
  /^::ffff:127\.\d+\.\d+\.\d+$/.test(address ?? '');

const escapeHtml = (value: unknown): string =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!,
  );

const notices: Record<string, string> = {
  rename: '用户名已修改，该用户需要重新登录。',
  password: '密码已重置，所有旧登录已退出。',
  logout: '该用户的所有登录已退出。',
  progress: '关卡成绩已保存，该用户重新登录后即可看到。',
  'reset-progress': '通关进度已清空，该用户将从第 1 关重新开始。',
  delete: '账号及其通关进度、登录记录已删除。',
};

export function databasePage(store: Store, params: URLSearchParams, token: string): string {
  const view = store.databaseView(),
    query = (params.get('q') ?? '').trim(),
    users = view.users.filter(
      (user) =>
        user.username.toLocaleLowerCase('en-US').includes(query.toLocaleLowerCase('en-US')) ||
        String(user.id) === query,
    ),
    selected = users.find((user) => user.id === Number(params.get('user'))) ?? users[0],
    progress = view.progress.filter((row) => row.userId === selected?.id),
    selectedName = escapeHtml(selected?.username ?? ''),
    formAttributes = `data-user-id="${selected?.id}" data-username="${selectedName}"`,
    firstResult = progress.find((row) => row.level === 1),
    userRows = users
      .map((user) => {
        const records = view.progress.filter((row) => row.userId === user.id);
        return `<tr${user.id === selected?.id ? ' class="selected"' : ''}><td class="user-cell"><strong>${escapeHtml(user.username)}</strong><small>ID ${user.id} · ${escapeHtml(new Date(user.createdAt).toLocaleDateString('zh-CN'))} 注册</small></td><td>${records.length} 关 / ${records.reduce((sum, row) => sum + row.stars, 0)} 星</td><td>${user.activeSessions}</td><td><a class="button small" href="/database?${escapeHtml(new URLSearchParams({ q: query, user: String(user.id) }).toString())}"${user.id === selected?.id ? ' aria-current="true"' : ''}>管理<span class="sr-only"> ${escapeHtml(user.username)}</span></a></td></tr>`;
      })
      .join(''),
    progressRows = progress
      .map(
        (row) =>
          `<tr><td>第 ${row.level} 关</td><td>${row.stars} 星</td><td>${Number(row.bestSeconds.toFixed(1))} 秒</td></tr>`,
      )
      .join(''),
    notice = notices[params.get('notice') ?? ''] ?? '';

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="admin-token" content="${token}"><title>用户管理 · 植物大战僵尸-函数版</title>
<style>
:root{color-scheme:light;font-family:system-ui,"Microsoft YaHei",sans-serif;color:#26342b;background:#f4f1e8}*{box-sizing:border-box}body{margin:0}header{background:#304f3b;color:#fff;padding:28px max(24px,calc((100vw - 1280px)/2))}header h1{margin:0 0 8px;font-size:26px}header p{margin:0;color:#d9e5dc}nav{margin-top:18px;display:flex;gap:20px}a{color:inherit}main{max-width:1280px;margin:auto;padding:26px 24px 44px}.summary{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid #cccfc3;background:#fff}.summary div{padding:16px 20px}.summary small{color:#637267}.summary strong{display:block;font-size:25px;margin-top:4px}.workspace{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:24px;margin-top:28px}h2{font-size:20px;margin:0 0 14px}h3{font-size:16px;margin:0 0 12px}.table-wrap{overflow:auto;border:1px solid #cccfc3;background:#fff}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:12px;border-bottom:1px solid #e4e2da}th{background:#e9eee8;color:#526057;font-size:12px;white-space:nowrap}tbody tr:last-child td{border-bottom:0}.selected td{background:#edf3e9}.user-cell{overflow-wrap:anywhere}.user-cell strong{display:block}.user-cell small{display:block;color:#657467;font-size:11px;margin-top:5px}.empty{padding:28px;text-align:center;color:#667467}.muted{color:#637267;font-size:13px;line-height:1.6;margin:8px 0 16px}.panel{background:#fff;border:1px solid #cccfc3;padding:20px;margin-bottom:16px}.search{display:flex;gap:8px;margin-bottom:14px}.search input{flex:1;min-width:0}.button,button{font:inherit;font-size:14px;display:inline-block;border:1px solid #bac6b9;background:#edf2e9;color:#304f3b;border-radius:5px;padding:9px 14px;text-decoration:none;cursor:pointer;white-space:nowrap}button:hover,.button:hover{background:#dce8d6}button:disabled{opacity:.55;cursor:wait}.small{padding:6px 9px;font-size:12px}.primary{background:#36583f;color:#fff;border-color:#36583f}.primary:hover{background:#28452f}input,select{font:inherit;border:1px solid #b9c4b8;border-radius:4px;padding:10px;max-width:100%;background:#fff;color:#26342b}label{display:grid;gap:7px;font-size:13px;margin:12px 0}input:focus,select:focus,button:focus-visible,a:focus-visible{outline:2px solid #527d47;outline-offset:2px}.fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}.fields label{min-width:0}.row{display:flex;gap:10px;align-items:end}.row label{flex:1;min-width:0}.row button{margin-bottom:12px}.danger-zone{border-color:#d7b0a7}.danger{background:#fff3ef;color:#913e32;border-color:#c68b7d}.danger:hover{background:#f4dfd8}.danger-actions{display:flex;gap:10px;flex-wrap:wrap}.message{padding:12px 16px;background:#e7eee0;border-left:3px solid #5f8051;margin:16px 0;scroll-margin-top:16px}.message:empty{display:none}.message.error{background:#fae9e2;border-color:#a14432;color:#803126}footer{color:#657467;font-size:12px;margin-top:24px;line-height:1.6}dialog{width:min(460px,calc(100vw - 32px));border:1px solid #c8cdbf;border-radius:8px;padding:24px;color:#26342b}dialog::backdrop{background:#192a2099}dialog p{line-height:1.6;font-size:14px}.dialog-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:22px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}@media(max-width:900px){.workspace{grid-template-columns:1fr}}@media(max-width:500px){header,main{padding-left:16px;padding-right:16px}.summary div{padding:14px 10px}.fields{grid-template-columns:1fr}.search{flex-wrap:wrap}.panel{padding:16px}.row{display:block}}
</style><script src="/database.js" defer></script></head>
<body><header><h1>用户管理</h1><p>植物大战僵尸-函数版 · 本机开发者管理</p><nav><a href="/">返回游戏</a><a href="/database">刷新列表</a></nav></header>
<main><div class="summary"><div><small>玩家数量</small><strong>${view.users.length}</strong></div><div><small>通关记录</small><strong>${view.progress.length}</strong></div><div><small>有效登录</small><strong>${view.users.reduce((sum, user) => sum + user.activeSessions, 0)}</strong></div></div>
<p id="feedback" class="message" role="status" aria-live="polite">${notice}</p>
<noscript><p class="message error">请启用浏览器 JavaScript 后使用管理操作。</p></noscript>
<div class="workspace"><section aria-labelledby="players-heading"><h2 id="players-heading">玩家列表 <small>(${users.length})</small></h2>
<form class="search" method="get" action="/database"><label class="sr-only" for="query">搜索用户名或 ID</label><input id="query" name="q" value="${escapeHtml(query)}" placeholder="搜索用户名或 ID" type="search"><button type="submit">搜索</button>${query ? '<a class="button" href="/database">清除</a>' : ''}</form>
<div class="table-wrap"><table><thead><tr><th>玩家 / 注册日期</th><th>进度</th><th>有效登录</th><th>操作</th></tr></thead><tbody>${userRows || '<tr><td colspan="4" class="empty">没有匹配的玩家</td></tr>'}</tbody></table></div><p class="muted">有效登录数表示尚未过期的登录凭据，不代表实时在线人数。</p></section>
<section aria-labelledby="details-heading"><h2 id="details-heading">${selected ? `管理：${selectedName}` : '用户详情'}</h2>
${
  selected
    ? `<p class="muted">ID ${selected.id} · 管理操作后，该用户需重新登录游戏。其他玩家不受影响。</p>
<div class="panel"><h3>账号资料</h3><form data-action="rename" ${formAttributes}><div class="row"><label>用户名<input name="username" value="${selectedName}" minlength="2" maxlength="20" required autocomplete="off"></label><button type="submit">保存用户名</button></div></form>
<form data-action="password" ${formAttributes}><div class="fields"><label>新密码<input name="password" type="password" minlength="8" maxlength="128" required autocomplete="new-password"></label><label>再次输入新密码<input name="confirmPassword" type="password" minlength="8" maxlength="128" required autocomplete="new-password"></label></div><button type="submit">重置密码并退出旧登录</button></form></div>
<div class="panel"><h3>通关进度</h3><div class="table-wrap"><table><thead><tr><th>关卡</th><th>最高星数</th><th>最快时间</th></tr></thead><tbody>${progressRows || '<tr><td colspan="3" class="empty">暂无通关记录</td></tr>'}</tbody></table></div>
<form data-action="progress" ${formAttributes}><label>补录或修改关卡<select name="level">${LEVELS.map(
        (level) => {
          const result = progress.find((row) => row.level === level.id);
          return `<option value="${level.id}" data-stars="${result?.stars ?? 1}" data-seconds="${result?.bestSeconds ?? 60}">第 ${level.id} 关 · ${escapeHtml(level.title)} · ${result ? '已通关' : '未通关'}</option>`;
        },
      ).join(
        '',
      )}</select></label><div class="fields"><label>星数<select name="stars">${[1, 2, 3].map((stars) => `<option value="${stars}"${stars === (firstResult?.stars ?? 1) ? ' selected' : ''}>${stars} 星</option>`).join('')}</select></label><label>通关时间（秒）<input name="seconds" type="number" min="1" max="86400" step="any" value="${firstResult?.bestSeconds ?? 60}" required></label></div><p class="muted">保存将覆盖该关成绩，可调低星数或增加时间。补录高关卡成绩会解锁它之前的关卡及下一关。</p><button class="primary" type="submit">保存关卡成绩</button></form></div>
<div class="panel"><h3>登录管理</h3><p class="muted">退出该账号的所有登录；账号与成绩保留。</p><form data-action="logout" ${formAttributes}><button type="submit">强制退出所有登录</button></form></div>
<div class="panel danger-zone"><h3>重置与删除</h3><p class="muted">清空进度会恢复到第 1 关；删除账号会同时移除全部成绩和登录记录。这两项操作无法在页面内撤销，请先备份需要保留的数据。</p><div class="danger-actions"><form data-action="reset-progress" ${formAttributes}><button class="danger" type="submit">清空通关进度</button></form><form data-action="delete" ${formAttributes}><button class="danger" type="submit">删除账号</button></form></div></div>`
    : '<div class="panel empty">在左侧选择一个玩家，即可管理账号与进度。</div>'
}
</section></div><footer>仅限服务器以本机地址启动时访问。密码不提供查看；需要时可重置。服务器重启后，请刷新本页面。</footer></main>
<dialog id="confirmation" aria-labelledby="confirm-title"><form method="dialog"><h2 id="confirm-title"></h2><p id="confirm-description"></p><label>输入该用户的完整用户名确认<input id="confirm-username" required autocomplete="off"></label><div class="dialog-actions"><button value="cancel" formnovalidate>取消</button><button class="danger" value="confirm">确认操作</button></div></form></dialog>
</body></html>`;
}
