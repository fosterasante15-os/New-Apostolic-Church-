(() => {
      const reportRenderers = [];
      document.querySelectorAll('.report-screen').forEach(screen => {
        const form = screen.querySelector('[data-report-filters]');
        let rows = [...screen.querySelectorAll('tbody tr')];
        const count = screen.querySelector('[data-report-count]');
        const memberReportBody = screen.id === 'report-members' ? screen.querySelector('#member-report-rows') : null;
        function readMembers() {
          if (Array.isArray(window.churchMembers)) return window.churchMembers;
          try { const value = JSON.parse(localStorage.getItem('church-members-v1') || '[]'); return Array.isArray(value) ? value : []; } catch (_) { return []; }
        }
        function readDepartments() {
          if (Array.isArray(window.churchDepartments)) return window.churchDepartments.map(department => department.name).filter(Boolean);
          try { const value = JSON.parse(localStorage.getItem('church-departments-v1') || '[]'); if (Array.isArray(value) && value.length) return value.map(department => department.name).filter(Boolean); } catch (_) {}
          return ['Choir', 'Lactating Mothers', 'Left Back Seat', "Men's Fellowship", 'Middle Seat', 'Right Back Seat', 'Sunday School', "The Minister's Wife", "Women's Fellowship", "Children's Fellowship", 'Youth Fellowship'];
        }
        function renderMemberReport() {
          if (!memberReportBody) return;
          const members = readMembers();
          const departmentFilter = screen.querySelector('#member-report-department');
          const selectedDepartment = departmentFilter?.value || 'all';
          if (departmentFilter) {
            const departments = [...new Set([...readDepartments(), ...members.flatMap(member => window.memberDepartments(member))])].sort((a, b) => a.localeCompare(b));
            departmentFilter.replaceChildren(new Option('All departments', 'all'), ...departments.map(department => new Option(department, department)));
            departmentFilter.value = departments.includes(selectedDepartment) ? selectedDepartment : 'all';
          }
          memberReportBody.replaceChildren();
          members.forEach(member => {
            const tr = document.createElement('tr');
            tr.dataset.department = window.memberDepartments(member).join('|').toLowerCase();
            tr.dataset.status = String(member.status || '').toLowerCase();
            tr.dataset.date = member.joined || '';
            const cell = value => { const td = document.createElement('td'); td.textContent = value || '—'; return td; };
            const contact = [member.email, member.phone].filter(Boolean).join(' · ') || 'No contact details';
            tr.append(cell(member.id), cell(member.name), cell(contact), cell(member.department), cell(member.joined), cell(member.status));
            memberReportBody.append(tr);
          });
          rows = [...memberReportBody.querySelectorAll('tr')];
          applyFilters();
        }
        const readStore = key => { try { const value = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value : value && typeof value === 'object' ? value : []; } catch (_) { return []; } };
        const reportCell = value => { const td = document.createElement('td'); td.textContent = value === undefined || value === null || value === '' ? '—' : String(value); return td; };
        function replaceOptions(select, values, allLabel) {
          if (!select) return;
          const keep = select.value;
          select.replaceChildren(new Option(allLabel, 'all'), ...[...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b)).map(value => new Option(value, value)));
          select.value = [...select.options].some(option => option.value === keep) ? keep : 'all';
        }
        function renderAttendanceReport() {
          const body = screen.querySelector('#attendance-report-rows'); if (!body) return;
          const members = readMembers(), memberById = new Map(members.map(member => [member.id, member]));
          const services = readStore('church-services-v1'), saved = readStore('church-attendance-v1');
          const records = [];
          Object.entries(saved).forEach(([key, statuses]) => {
            const date = key.split(' · ')[0] || '';
            const serviceName = key.split(' · ').slice(1).join(' · ') || 'Sunday Service';
            Object.entries(statuses || {}).forEach(([memberId, status]) => {
              const member = memberById.get(memberId); if (!member) return;
              records.push({ date, serviceName, member, status });
            });
          });
          const serviceFilter = screen.querySelector('[data-filter="service"]');
          const departmentFilter = screen.querySelector('[data-filter="department"]');
          const personFilter = screen.querySelector('[data-filter="person"]');
          replaceOptions(serviceFilter, records.map(record => record.serviceName), 'All services');
          replaceOptions(departmentFilter, [...readDepartments(), ...members.flatMap(member => window.memberDepartments(member))], 'All departments');
          replaceOptions(personFilter, members.map(member => member.name), 'All members');
          body.replaceChildren();
          records.sort((a, b) => `${b.date}${b.member.name}`.localeCompare(`${a.date}${a.member.name}`)).forEach(record => {
            const tr = document.createElement('tr');
            tr.dataset.date = record.date; tr.dataset.service = record.serviceName.toLowerCase(); tr.dataset.department = window.memberDepartments(record.member).join('|').toLowerCase(); tr.dataset.person = String(record.member.name || '').toLowerCase();
            tr.append(reportCell(record.date), reportCell(record.serviceName), reportCell(record.member.name), reportCell(record.member.department), reportCell(String(record.status).replace(/^./, value => value.toUpperCase())));
            body.append(tr);
          });
          rows = [...body.querySelectorAll('tr')]; applyFilters();
        }
        function renderServiceReport() {
          const body = screen.querySelector('#service-report-rows'); if (!body) return;
          const services = Array.isArray(window.churchServices) ? window.churchServices : readStore('church-services-v1'), saved = readStore('church-attendance-v1');
          const venues = services.map(service => service.venue), venueFilter = screen.querySelector('[data-filter="venue"]');
          replaceOptions(venueFilter, venues, 'All venues'); body.replaceChildren();
          services.slice().sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`)).forEach(service => {
            const key = `${service.date} · Sunday Service`, statuses = Object.values(saved[key] || {}), counts = { present: 0, late: 0, absent: 0, excused: 0 };
            statuses.forEach(status => { if (counts[status] !== undefined) counts[status]++; });
            const tr = document.createElement('tr'); tr.dataset.date = service.date; tr.dataset.venue = String(service.venue || '').toLowerCase();
            tr.append(reportCell(service.date), reportCell('Sunday Service'), reportCell(service.venue), reportCell(counts.present), reportCell(counts.late), reportCell(counts.absent), reportCell(counts.excused)); body.append(tr);
          });
          rows = [...body.querySelectorAll('tr')]; applyFilters();
        }
        function renderDuesReport() {
          const body = screen.querySelector('#dues-report-rows'); if (!body) return;
          const church = readStore('church-general-dues-v1'), ministry = readStore('church-ministry-dues-v1'), groups = new Map();
          [...church.map(record => ({ ...record, type: 'church general', label: 'Church general dues' })), ...ministry.map(record => ({ ...record, type: 'ministry', label: 'Ministry dues' }))].forEach(record => {
            const month = record.month || String(record.paidOn || '').slice(0, 7) || 'Unknown';
            const key = `${month}|${record.type}`, group = groups.get(key) || { month, type: record.type, label: record.label, payments: 0, amount: 0 };
            group.payments++; group.amount += Number(record.amount || 0); groups.set(key, group);
          });
          const monthFilter = screen.querySelector('[data-filter="month"]'); replaceOptions(monthFilter, [...groups.values()].map(group => group.month), 'All months');
          body.replaceChildren();
          [...groups.values()].sort((a, b) => `${b.month}${b.type}`.localeCompare(`${a.month}${a.type}`)).forEach(group => {
            const tr = document.createElement('tr'); tr.dataset.month = group.month; tr.dataset.type = group.type;
            const label = group.month === 'Unknown' ? group.month : new Date(`${group.month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            tr.append(reportCell(label), reportCell(group.label), reportCell(group.payments), reportCell(`GH₵${group.amount.toFixed(2)}`)); body.append(tr);
          });
          rows = [...body.querySelectorAll('tr')]; applyFilters();
        }
        function renderLiveReport() {
          if (memberReportBody) renderMemberReport();
          if (screen.id === 'report-attendance') renderAttendanceReport();
          if (screen.id === 'report-services') renderServiceReport();
          if (screen.id === 'report-dues') renderDuesReport();
        }
        function applyFilters() {
          const controls = [...form.querySelectorAll('[data-filter]')];
          const from = form.querySelector('[data-date-from]')?.value || '';
          const to = form.querySelector('[data-date-to]')?.value || '';
          rows.forEach(row => {
            let show = true;
            for (const control of controls) {
              const selected = control.value.trim().toLowerCase();
              if (selected && selected !== 'all') { const have = (row.dataset[control.dataset.filter] || '').toLowerCase(); if (control.dataset.filter === 'department' ? !have.split('|').includes(selected) : have !== selected) show = false; }
            }
            const date = row.dataset.date || '';
            if (from && date && date < from) show = false;
            if (to && date && date > to) show = false;
            row.hidden = !show;
          });
          const visibleRows = rows.filter(row => !row.hidden);
          const visible = visibleRows.length;
          if (count) count.textContent = `${visible} ${visible === 1 ? 'record' : 'records'}`;
          if (screen.id === 'report-attendance') {
            const status = visibleRows.map(row => row.cells[4].innerText.trim().toLowerCase());
            const attended = status.filter(value => value === 'present' || value === 'late').length;
            const rate = visible ? Math.round(attended * 100 / visible) : 0;
            screen.querySelector('[data-report-stat="attendance-rate"]').textContent = `${rate}%`;
            screen.querySelector('[data-report-stat="present-count"]').textContent = status.filter(value => value === 'present').length;
            screen.querySelector('[data-report-stat="service-count"]').textContent = new Set(visibleRows.map(row => row.dataset.date)).size;
            screen.querySelectorAll('[data-trend-date]').forEach(bar => {
              const selected = visibleRows.filter(row => row.dataset.date === bar.dataset.trendDate);
              const selectedStatuses = selected.map(row => row.cells[4].innerText.trim().toLowerCase());
              const selectedRate = selected.length ? Math.round(selectedStatuses.filter(value => value === 'present' || value === 'late').length * 100 / selected.length) : 0;
              bar.hidden = selected.length === 0;
              bar.querySelector('[data-trend-fill]').style.width = `${selectedRate}%`;
              bar.querySelector('[data-trend-value]').textContent = `${selectedRate}%`;
            });
          }
          if (screen.id === 'report-dues') {
            const totals = { 'church general': { amount: 0, payments: 0 }, ministry: { amount: 0, payments: 0 } };
            visibleRows.forEach(row => {
              const type = row.dataset.type;
              if (!totals[type]) return;
              totals[type].payments += Number(row.cells[2].innerText.replace(/[^0-9.-]/g,'')) || 0;
              totals[type].amount += Number(row.cells[3].innerText.replace(/[^0-9.-]/g,'')) || 0;
            });
            const money = value => `GH₵${value.toFixed(2)}`;
            screen.querySelector('[data-report-stat="church-total"]').textContent = money(totals['church general'].amount);
            screen.querySelector('[data-report-stat="church-payments"]').textContent = totals['church general'].payments;
            screen.querySelector('[data-report-stat="ministry-total"]').textContent = money(totals.ministry.amount);
            screen.querySelector('[data-report-stat="ministry-payments"]').textContent = totals.ministry.payments;
            const periods = [...new Set(visibleRows.map(row => row.cells[0].innerText.trim()))];
            screen.querySelector('[data-report-stat="dues-period"]').textContent = periods.length === 0 ? 'No records' : periods.length === 1 ? periods[0] : 'Multiple months';
          }
        }
        form.addEventListener('submit', event => { event.preventDefault(); applyFilters(); });
        form.addEventListener('change', applyFilters);
        form.addEventListener('input', applyFilters);
        screen.querySelector('.report-reset')?.addEventListener('click', () => { form.reset(); applyFilters(); });
        screen.querySelector('[data-report-action="csv"]')?.addEventListener('click', () => {
          const table = screen.querySelector('table');
          const header = [...table.querySelectorAll('thead th')].map(cell => cell.innerText.trim());
          const visibleRows = rows.filter(row => !row.hidden).map(row => [...row.querySelectorAll('td')].map(cell => cell.innerText.trim()));
          const csvCell = value => `"${String(value).replaceAll('"','""')}"`;
          const csv = [header,...visibleRows].map(row => row.map(csvCell).join(',')).join('\r\n');
          const url = URL.createObjectURL(new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'}));
          const link = document.createElement('a');
          link.href = url; link.download = `church-${(screen.dataset.reportTitle || 'report').toLowerCase().replace(/[^a-z0-9]+/g,'-')}.csv`;
          document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
        });
        screen.querySelector('[data-report-action="print"]')?.addEventListener('click', () => window.print());
        window.addEventListener('members-change', renderLiveReport);
        window.addEventListener('services-change', renderLiveReport);
        window.addEventListener('attendance-change', renderLiveReport);
        window.addEventListener('dues-change', renderLiveReport);
        window.addEventListener('hashchange', renderLiveReport);
        reportRenderers.push(renderLiveReport);
        renderLiveReport();
        setTimeout(renderLiveReport, 0);
      });
      window.ChurchDB?.onStoresChanged?.([
        'church-members-v1',
        'church-departments-v1',
        'church-services-v1',
        'church-attendance-v1',
        'church-general-dues-v1',
        'church-ministry-dues-v1'
      ], () => {
        const readArrayStore = key => {
          try {
            const value = JSON.parse(localStorage.getItem(key) || '[]');
            return Array.isArray(value) ? value : [];
          } catch (_) {
            return [];
          }
        };
        window.churchMembers = readArrayStore('church-members-v1');
        window.churchDepartments = readArrayStore('church-departments-v1');
        window.churchServices = readArrayStore('church-services-v1');
        reportRenderers.forEach(render => render());
      });
    })();
