(() => {
  const form = document.getElementById('login-form');
  const error = form.querySelector('.form-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email.value, password: form.password.value }),
      });
      if (res.ok) return window.location.reload();
      error.textContent = (await res.json().catch(() => ({}))).error || 'Sign in failed.';
    } catch {
      error.textContent = 'Could not reach the server. Check your connection.';
    } finally {
      btn.disabled = false;
    }
  });
})();
