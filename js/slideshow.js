(() => {
      const notify = (message, type = 'info', title) => window.notify(message, type, title);
      /* Rotating images: the page background and the hero banner each run their own timer. */
      function slideshow(slides, { start = 0, firstChange = 10000, interval = 10000, onShow, onEmpty } = {}) {
        let index = start, kick, timer;
        const alive = () => slides.filter(slide => slide.isConnected);
        const show = i => {
          const list = alive();
          if (!list.length) { clearTimeout(kick); clearInterval(timer); onEmpty?.(); return; }
          index = ((i % list.length) + list.length) % list.length;
          list.forEach((slide, n) => slide.classList.toggle('is-visible', n === index));
          onShow?.(index, list.length);
        };
        const run = wait => {
          clearTimeout(kick); clearInterval(timer);
          kick = setTimeout(() => { show(index + 1); timer = setInterval(() => show(index + 1), interval); }, wait);
        };
        slides.forEach(slide => {
          const image = slide.matches('img') ? slide : slide.querySelector('img');
          if (!image) return;
          const removeIfBroken = () => { slide.remove(); show(index); };
          image.addEventListener('error', removeIfBroken, { once: true });
          /* A local asset may have failed while the parser was still loading the page. */
          if (image.complete && image.naturalWidth === 0) removeIfBroken();
        });
        show(index); run(firstChange);
        return { go: i => { show(i); run(interval); } };
      }
      const heroBanner = document.querySelector('.hero-banner');
      if (heroBanner) {
        const dotsBox = heroBanner.querySelector('.hero-dots');
        let hero;
        hero = slideshow([...heroBanner.querySelectorAll('.hero-slide')], {
          start: 0, firstChange: 10000,
          onShow: (index, total) => {
            if (dotsBox.children.length !== total) {
              dotsBox.replaceChildren(...Array.from({ length: total }, (_, n) => { const dot = document.createElement('button'); dot.type = 'button'; dot.setAttribute('aria-label', `Show photo ${n + 1}`); dot.addEventListener('click', () => hero.go(n)); return dot; }));
            }
            [...dotsBox.children].forEach((dot, n) => n === index ? dot.setAttribute('aria-current', 'true') : dot.removeAttribute('aria-current'));
          },
          onEmpty: () => { heroBanner.hidden = true; }
        });
      }
      /* Background starts on a different photo and changes 5 s after the banner, so the two never show the same picture. */
      slideshow([...document.querySelectorAll('[data-backdrop-image]')], { start: 1, firstChange: 5000 });
      const navToggle = document.getElementById('mobile-nav-toggle');
      navToggle?.addEventListener('click', () => { const open = document.body.classList.toggle('nav-open'); navToggle.setAttribute('aria-expanded', String(open)); });
      document.querySelectorAll('.nav a').forEach(link => link.addEventListener('click', () => { document.body.classList.remove('nav-open'); navToggle?.setAttribute('aria-expanded','false'); }));
      const logoutDialog = document.getElementById('logout-dialog');
      const closeLogoutDialog = () => { if (logoutDialog?.open) logoutDialog.close(); };
      document.getElementById('logout-button')?.addEventListener('click', () => { if (logoutDialog?.showModal) logoutDialog.showModal(); });
      document.getElementById('logout-stay')?.addEventListener('click', closeLogoutDialog);
      document.getElementById('logout-confirm')?.addEventListener('click', () => {
        try {
          const current = JSON.parse(sessionStorage.getItem('church-auth-v1') || 'null');
          const list = JSON.parse(localStorage.getItem('church-reconstruction-users-v1') || '[]');
          if (current && Array.isArray(list)) {
            const when = new Date().toISOString();
            localStorage.setItem('church-reconstruction-users-v1', JSON.stringify(list.map(user => user.id === current.id ? { ...user, current: false, lastLogout: when } : user)));
          }
          sessionStorage.removeItem('church-auth-v1');
        } catch (_) {}
        location.replace('login.html?loggedout=1&from=index.html');
      });
      document.querySelectorAll('.heading-row > .primary-button').forEach(button => { if (!button.id) button.addEventListener('click', () => notify(`${button.textContent.replace('＋','').trim()} is ready for a backend connection.`)); });
      /* Church map (Google Maps). The pin follows the address saved in Settings (default: DEFAULT_MAP_QUERY). */
      const DEFAULT_MAP_QUERY = 'M9PW+3FQ Kumasi, Ashanti, Ghana';
      const mapQuery = () => (window.churchProfile?.address || '').trim() || DEFAULT_MAP_QUERY;
      const mapFrame = document.getElementById('church-map'), mapPlaceholder = document.getElementById('map-placeholder');
      const mapShow = document.getElementById('map-show'), mapDirections = document.getElementById('map-directions'), mapStatus = document.getElementById('map-status');
      const destination = () => encodeURIComponent(mapQuery());
      const showFrame = src => { mapFrame.src = src; mapFrame.hidden = false; mapPlaceholder.hidden = true; mapShow.textContent = 'Hide map'; };
      const churchEmbed = () => `https://maps.google.com/maps?q=${destination()}&z=17&output=embed`;
      const setStatus = (text, linkText, href) => {
        mapStatus.textContent = text;
        if (href) { const a = document.createElement('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = linkText; mapStatus.append(' ', a); }
      };
      const refreshMapLinks = () => {
        const open = document.getElementById('map-open'); if (open) open.href = `https://www.google.com/maps/search/?api=1&query=${destination()}`;
        if (mapFrame && !mapFrame.hidden) { showFrame(churchEmbed()); setStatus(''); }
      };
      window.addEventListener('church-profile-change', refreshMapLinks);
      refreshMapLinks();
      mapShow?.addEventListener('click', () => {
        if (!mapFrame.hidden) { mapFrame.hidden = true; mapPlaceholder.hidden = false; mapShow.textContent = 'Show map'; mapStatus.textContent = ''; return; }
        showFrame(churchEmbed()); setStatus('');
      });
      mapDirections?.addEventListener('click', () => {
        const fallback = () => window.open(`https://www.google.com/maps/dir/?api=1&destination=${destination()}&travelmode=driving`, '_blank', 'noopener');
        if (!navigator.geolocation) { setStatus('Location is not available in this browser. Opening directions in Google Maps.'); fallback(); return; }
        setStatus('Finding your location…'); mapDirections.disabled = true;
        navigator.geolocation.getCurrentPosition(pos => {
          const origin = `${pos.coords.latitude},${pos.coords.longitude}`;
          showFrame(`https://maps.google.com/maps?saddr=${encodeURIComponent(origin)}&daddr=${destination()}&output=embed`);
          setStatus('Route from your location to the church.', 'Open turn-by-turn directions', `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${destination()}&travelmode=driving`);
          mapDirections.disabled = false;
        }, () => {
          setStatus('Could not get your location, so directions open in Google Maps instead.'); mapDirections.disabled = false; fallback();
        }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
      });
      document.querySelectorAll('#attendance button, #church-dues .filter-submit').forEach(button => { if (!button.id && button.type === 'button') button.addEventListener('click', () => notify(`${button.textContent.trim()} completed for this local demo.`)); });
    })();
