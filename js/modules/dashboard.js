/* Dashboard: keep the overview cards tied to the same browser-local records as each management page. */
    (() => {
      const read = (key, fallback = []) => { try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return value ?? fallback; } catch (_) { return fallback; } };
      const money = value => `GH₵${Number(value || 0).toFixed(2)}`;
      const monthKey = date => String(date || '').slice(0, 7);
      const today = () => new Date().toISOString().slice(0, 10);
      const currentMonth = () => today().slice(0, 7);
      const months = count => {
        const now = new Date(), result = [];
        for (let i = count - 1; i >= 0; i--) {
          const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
          result.push({ key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`, label: date.toLocaleDateString('en-US', { month: 'short' }) });
        }
        return result;
      };
      const defaultMembers = [
        { id: 'NAC-0001', name: 'Member 001', department: 'Choir', joined: '2024-01-15', status: 'Active' },
        { id: 'NAC-0002', name: 'Member 002', department: 'Sunday School', joined: '2023-08-04', status: 'Active' },
        { id: 'NAC-0003', name: 'Member 003', department: "Men's Fellowship", joined: '2022-11-21', status: 'Active' }
      ];
      function render() {
        const rawMembers = Array.isArray(window.churchMembers) && window.churchMembers.length ? window.churchMembers : read('church-members-v1', null);
        const members = Array.isArray(rawMembers) && rawMembers.length ? rawMembers : defaultMembers;
        const services = Array.isArray(window.churchServices) && window.churchServices.length ? window.churchServices : read('church-services-v1', []);
        const ministers = Array.isArray(window.churchMinisters) && window.churchMinisters.length ? window.churchMinisters : read('church-reconstruction-ministers-v1', []);
        const current = currentMonth(), active = members.filter(member => !member.status || member.status === 'Active').length;
        const newThisMonth = members.filter(member => monthKey(member.joined) === current).length;
        const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
        set('dash-total-members', members.length); set('dash-members-note', `${active} active · ${newThisMonth} new this month`);

        const upcoming = services.filter(service => service.date >= today()).sort((a, b) => `${a.date}${a.time || ''}`.localeCompare(`${b.date}${b.time || ''}`));
        set('dash-upcoming-services', upcoming.length);
        set('dash-services-note', upcoming.length ? `Next: ${upcoming[0].date}${upcoming[0].time ? ` · ${upcoming[0].time}` : ''}` : 'No upcoming Sunday services');

        const church = read('church-general-dues-v1'), ministry = read('church-ministry-dues-v1');
        const duesTotal = records => records.filter(record => (record.month || monthKey(record.paidOn)) === current).reduce((sum, record) => sum + Number(record.amount || 0), 0);
        const duesCount = records => records.filter(record => (record.month || monthKey(record.paidOn)) === current).length;
        set('dash-church-dues', money(duesTotal(church))); set('dash-church-dues-note', `${duesCount(church)} ${duesCount(church) === 1 ? 'payment' : 'payments'}`);
        set('dash-ministry-dues', money(duesTotal(ministry))); set('dash-ministry-dues-note', `${duesCount(ministry)} ${duesCount(ministry) === 1 ? 'payment' : 'payments'}`);

        const chart = document.getElementById('dash-growth-chart');
        if (chart) {
          const series = months(8), counts = series.map(item => members.filter(member => monthKey(member.joined) === item.key).length), max = Math.max(...counts, 1);
          chart.querySelectorAll('.month').forEach((item, index) => {
            const label = item.querySelector(':scope > span:last-child'), space = item.querySelector('.bar-space'), count = counts[index] || 0;
            if (label) label.textContent = series[index].label;
            if (space) { space.replaceChildren(); const value = document.createElement('span'); value.className = 'bar-value'; value.textContent = String(count); const bar = document.createElement('span'); bar.className = 'bar'; bar.style.height = `${Math.max(3, Math.round(count / max * 135))}px`; bar.title = `${count} member${count === 1 ? '' : 's'} joined in ${series[index].label}`; space.append(value, bar); }
          });
          chart.setAttribute('aria-label', `New member registrations for the last ${series.length} months: ${counts.join(', ')}`);
        }

        const ministerCards = document.getElementById('dash-minister-cards');
        if (ministerCards && ministers.length) {
          ministerCards.replaceChildren();
          ministers.slice().sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0)).forEach(minister => {
            const card = document.createElement('article'); card.className = 'minister-card';
            const avatar = document.createElement('div'); avatar.className = 'minister-avatar'; avatar.textContent = String(minister.name || 'M').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
            const name = document.createElement('h3'); name.textContent = minister.name || 'Minister';
            const role = document.createElement('div'); role.className = 'minister-role'; role.textContent = minister.role || 'Minister';
            const note = document.createElement('p'); note.textContent = minister.note || '';
            card.append(avatar, name, role, note); ministerCards.append(card);
          });
        }
      }
      ['members-change', 'services-change', 'dues-change', 'ministers-change', 'church-profile-change', 'attendance-change', 'offerings-change'].forEach(event => window.addEventListener(event, render));
      render(); setTimeout(render, 0);
    })();
