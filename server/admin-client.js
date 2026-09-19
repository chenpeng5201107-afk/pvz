const feedback = document.querySelector('#feedback');
const dialog = document.querySelector('#confirmation');
const confirmation = document.querySelector('#confirm-username');
const token = document.querySelector('meta[name="admin-token"]').content;
let pending = false;

function confirmDestructiveAction(action, username) {
  document.querySelector('#confirm-title').textContent =
    action === 'delete' ? '删除账号' : '清空通关进度';
  document.querySelector('#confirm-description').textContent =
    action === 'delete'
      ? `将永久删除“${username}”及其全部成绩和登录记录，无法在页面内撤销。`
      : `将清空“${username}”的全部成绩并退出所有登录，恢复到第 1 关。账号和密码保留。`;
  confirmation.value = '';
  confirmation.setCustomValidity('');
  confirmation.oninput = () =>
    confirmation.setCustomValidity(
      confirmation.value === username ? '' : '请输入完整且一致的用户名',
    );
  dialog.returnValue = '';
  dialog.showModal();
  confirmation.focus();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), {
      once: true,
    });
  });
}

document
  .querySelector('[data-action="progress"] select[name="level"]')
  ?.addEventListener('change', (event) => {
    const option = event.target.selectedOptions[0];
    const form = event.target.form;
    form.elements.namedItem('stars').value = option.dataset.stars;
    form.elements.namedItem('seconds').value = option.dataset.seconds;
  });

document.addEventListener('submit', async (event) => {
  const form = event.target;
  const action = form.dataset.action;
  if (!action) return;
  event.preventDefault();
  if (pending) return;
  const data = Object.fromEntries(new FormData(form));
  if (action === 'password') {
    if (data.password !== data.confirmPassword) {
      feedback.textContent = '两次输入的密码不一致，请重新输入。';
      feedback.classList.add('error');
      feedback.scrollIntoView({ block: 'nearest' });
      return;
    }
    delete data.confirmPassword;
  }
  pending = true;
  try {
    if (action === 'delete' || action === 'reset-progress') {
      if (!(await confirmDestructiveAction(action, form.dataset.username))) return;
      data.confirmUsername = confirmation.value;
    }
    if (action === 'progress') {
      data.level = Number(data.level);
      data.stars = Number(data.stars);
      data.seconds = Number(data.seconds);
    }
    document.querySelectorAll('form[data-action] button').forEach((button) => {
      button.disabled = true;
    });
    feedback.classList.remove('error');
    feedback.textContent = '正在保存…';
    const response = await fetch(`/api/admin/users/${form.dataset.userId}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
      body: JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? '操作未完成，请稍后重试');
    const url = new URL(location.href);
    url.searchParams.set('notice', action);
    if (action === 'delete') url.searchParams.delete('user');
    else url.searchParams.set('user', form.dataset.userId);
    if (action === 'rename') url.searchParams.delete('q');
    location.assign(url);
  } catch (error) {
    feedback.textContent =
      error instanceof TypeError ? '无法连接服务器，请确认服务仍在运行。' : error.message;
    feedback.classList.add('error');
    feedback.scrollIntoView({ block: 'nearest' });
  } finally {
    pending = false;
    document.querySelectorAll('form[data-action] button').forEach((button) => {
      button.disabled = false;
    });
  }
});
