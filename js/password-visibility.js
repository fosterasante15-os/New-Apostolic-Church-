(() => {
  const buttons = root => root.querySelectorAll('[data-password-toggle]');
  function mask(root = document, clear = false) {
    buttons(root).forEach(button => {
      const input = document.getElementById(button.dataset.passwordToggle);
      if (!input) return;
      input.type = 'password';
      if (clear) input.value = '';
      button.textContent = 'Show';
      button.setAttribute('aria-label', 'Show password');
      button.setAttribute('aria-pressed', 'false');
    });
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-password-toggle]');
    if (!button) return;
    const input = document.getElementById(button.dataset.passwordToggle);
    if (!input || input.disabled) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.textContent = show ? 'Hide' : 'Show';
    button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    button.setAttribute('aria-pressed', String(show));
  });
  document.addEventListener('close', event => { if (event.target.tagName === 'DIALOG') mask(event.target, true); }, true);
  document.addEventListener('reset', event => setTimeout(() => mask(event.target), 0), true);
  window.addEventListener('pagehide', () => mask(document, true));
  window.ChurchPasswordVisibility = { mask };
  mask();
})();
