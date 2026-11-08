/* Global notifications: notify(message, type = 'info', title?) -- types: success | error | info */
    (() => {
      const ICONS = { success: '\u2713', error: '!', info: 'i' };
      const TITLES = { success: 'Success', error: 'Something went wrong', info: 'Notice' };
      window.notify = function notify(message, type = 'info', title) {
        const stack = document.getElementById('toast-stack');
        if (!stack) return;
        if (!ICONS[type]) type = 'info';
        const time = type === 'error' ? 7000 : 4500;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
        toast.style.setProperty('--toast-time', `${time}ms`);
        const icon = document.createElement('span'); icon.className = 'toast-icon'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = ICONS[type];
        const body = document.createElement('div'); body.className = 'toast-body';
        const heading = document.createElement('strong'); heading.className = 'toast-title'; heading.textContent = title || TITLES[type];
        const text = document.createElement('span'); text.className = 'toast-message'; text.textContent = message;
        body.append(heading, text);
        const close = document.createElement('button'); close.type = 'button'; close.className = 'toast-close'; close.setAttribute('aria-label', 'Dismiss notification'); close.textContent = '\u00d7';
        const bar = document.createElement('span'); bar.className = 'toast-progress';
        toast.append(icon, body, close, bar);
        stack.append(toast);
        while (stack.children.length > 4) stack.firstElementChild.remove();
        requestAnimationFrame(() => toast.classList.add('is-visible'));
        let timer, done = false;
        const dismiss = () => { if (done) return; done = true; clearTimeout(timer); toast.classList.remove('is-visible'); toast.classList.add('is-leaving'); setTimeout(() => toast.remove(), 300); };
        const arm = () => { clearTimeout(timer); timer = setTimeout(dismiss, time); };
        close.addEventListener('click', dismiss);
        toast.addEventListener('mouseenter', () => clearTimeout(timer));
        toast.addEventListener('mouseleave', arm);
        arm();
      };
    })();
