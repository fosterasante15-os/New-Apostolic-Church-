/* Mobile money authorization for church dues and ministry dues.
       When "Mobile money" is chosen, an approval request is sent to the member's own phone; the due is saved only after approval.

       MODES  (set window.CHURCH_MOMO_API before this script, or edit MOMO_API below):
         ''      → no payment service connected: the admin enters the Transaction ID from the member's MoMo confirmation SMS.
         'demo'  → simulated approval for testing the screens. No real money moves; records are tagged "demo".
         'https://your-server.example/momo' → live. Your server (which holds the provider's secret keys) must offer:
              POST {API}/charge          body: { reference, phone, network, amount, currency:'GHS', description, memberId }
                                         reply: { status:'pending'|'success'|'failed', transactionId?, message? }
              GET  {API}/status?reference=…   reply: { status:'pending'|'success'|'failed', transactionId?, message? }
         The member then gets the prompt on their phone and approves it with their MoMo PIN. */
    (() => {
      const MOMO_API = (window.CHURCH_MOMO_API || '').replace(/\/$/, '');
      const MODE = !MOMO_API ? 'manual' : MOMO_API === 'demo' ? 'demo' : 'live';
      const NETWORKS = { mtn: 'MTN MoMo', telecel: 'Telecel Cash', airteltigo: 'AirtelTigo Money' };
      const PREFIX_NETWORK = { '024': 'mtn', '025': 'mtn', '053': 'mtn', '054': 'mtn', '055': 'mtn', '059': 'mtn', '020': 'telecel', '050': 'telecel', '026': 'airteltigo', '027': 'airteltigo', '056': 'airteltigo', '057': 'airteltigo' };
      const STORES = { church: 'church-general-dues-v1', ministry: 'church-ministry-dues-v1' };
      const isAdmin = () => window.ChurchAccess?.isAdmin ? window.ChurchAccess.isAdmin() : true;
      const readList = key => { try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } };
      const normalizePhone = raw => { let d = String(raw || '').replace(/[^\d]/g, ''); if (d.startsWith('233') && d.length === 12) d = '0' + d.slice(3); return /^0\d{9}$/.test(d) ? d : ''; };
      const money = v => `GH₵${Number(v || 0).toFixed(2)}`;
      const api = {};

      function init(prefix) {
        const $ = id => document.getElementById(`${prefix}-due-${id}`);
        const form = $('form'), method = $('method'), memberSel = $('member'), amountEl = $('amount'), errorEl = $('error');
        if (!form || !method || !errorEl) return;
        const panel = document.createElement('div'); panel.className = 'momo-panel member-form-wide'; panel.hidden = true;
        panel.innerHTML = `<div class="momo-title">Mobile money authorization</div>
          <p class="momo-help" data-r="help"></p>
          <div class="momo-grid">
            <label>Network<select data-r="network"><option value="mtn">MTN MoMo</option><option value="telecel">Telecel Cash</option><option value="airteltigo">AirtelTigo Money</option></select></label>
            <label>Member's MoMo number<input data-r="phone" type="tel" inputmode="tel" autocomplete="off" placeholder="024 000 0000"></label>
          </div>
          <div class="momo-actions"><button class="primary-button" type="button" data-r="send">Send approval request</button><button class="plain-button" type="button" data-r="cancel" hidden>Cancel request</button></div>
          <label data-r="txnLabel" hidden>Transaction ID<input data-r="txn" type="text" autocomplete="off" maxlength="40" placeholder="From the MoMo confirmation SMS"></label>
          <p class="momo-status" role="status" aria-live="polite" data-r="status"></p>`;
        errorEl.parentNode.insertBefore(panel, errorEl);
        const r = {}; panel.querySelectorAll('[data-r]').forEach(el => { r[el.dataset.r] = el; });
        let st = { status: 'idle' }, timer = null, seq = 0, carried = null;

        const isMomo = () => method.value === 'Mobile money';
        const stop = () => { clearTimeout(timer); timer = null; seq++; };
        function status(text, kind) { r.status.textContent = text || ''; r.status.className = `momo-status ${kind || ''}`; }
        function lock(on) { r.network.disabled = on; r.phone.disabled = on; r.send.disabled = on; r.cancel.hidden = !on; }
        function member() { const id = memberSel && memberSel.value; return id ? readList('church-members-v1').find(m => m.id === id) : null; }
        function detect() { const p = normalizePhone(r.phone.value); if (p && PREFIX_NETWORK[p.slice(0, 3)]) r.network.value = PREFIX_NETWORK[p.slice(0, 3)]; }
        function reset(message, kind) {
          stop(); carried = null; st = { status: 'idle' }; lock(false); r.txn.value = ''; status(message, kind);
        }
        function refresh() {
          panel.hidden = !isMomo(); if (panel.hidden) return;
          r.help.textContent = MODE === 'manual'
            ? 'Live approval requests are not connected yet. Have the member pay by MoMo, then enter the Transaction ID from their confirmation SMS to record the payment.'
            : MODE === 'demo'
              ? 'Demo mode: the approval is simulated and no real money moves. Payments are tagged "demo".'
              : "An approval request is sent to the member's phone. They enter their MoMo PIN there to approve, and the payment is saved only after they do.";
          r.send.hidden = MODE === 'manual'; r.txnLabel.hidden = MODE !== 'manual';
          r.send.textContent = MODE === 'demo' ? 'Send demo approval request' : 'Send approval request';
          if (!r.phone.value) { const m = member(); if (m && m.phone) { r.phone.value = m.phone; detect(); } }
        }
        function approved() {
          if (carried) return true;
          if (MODE === 'manual') return r.txn.value.trim().length >= 6;
          return st.status === 'success';
        }
        function succeed(txn, token) {
          if (token !== seq) return;
          clearTimeout(timer); st = { ...st, status: 'success', txn }; lock(false); r.send.disabled = true; r.phone.disabled = true; r.network.disabled = true;
          status(`Approved by the member. Transaction ${txn}. You can now save the payment.`, 'ok');
        }
        function fail(message, token) { if (token !== seq) return; clearTimeout(timer); st = { status: 'failed' }; lock(false); status(message, 'err'); }
        function poll(ref, token) {
          const started = Date.now();
          const tick = async () => {
            if (token !== seq) return;
            if (Date.now() - started > 120000) return fail('No approval received in time. Ask the member to try again.', token);
            try { const res = await fetch(`${MOMO_API}/status?reference=${encodeURIComponent(ref)}`); const data = await res.json(); if (token !== seq) return; if (data.status === 'success') return succeed(data.transactionId || ref, token); if (data.status === 'failed') return fail(data.message || 'The member declined or the payment failed.', token); } catch (_) { /* keep waiting */ }
            timer = setTimeout(tick, 3000);
          };
          timer = setTimeout(tick, 3000);
        }
        async function send() {
          errorEl.textContent = '';
          if (!isAdmin()) { status('Only an admin can send payment requests.', 'err'); return; }
          const m = member(), phone = normalizePhone(r.phone.value), amount = Number(amountEl.value);
          if (!m) { status('Choose the registered member first.', 'err'); return; }
          if (!(amount > 0)) { status('Enter the amount before sending the request.', 'err'); return; }
          if (!phone) { status("Enter a valid 10-digit MoMo number, such as 024 000 0000.", 'err'); return; }
          stop(); const token = seq; carried = null;
          const ref = `${prefix === 'church' ? 'CD' : 'MD'}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
          st = { status: 'pending', ref, phone, network: r.network.value, amount, memberId: m.id }; lock(true);
          status(`Request sent to ${phone}. Ask ${m.name || 'the member'} to approve it on their phone…`, 'pending');
          if (MODE === 'demo') { timer = setTimeout(() => succeed(`DEMO-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, token), 3500); return; }
          try {
            const res = await fetch(`${MOMO_API}/charge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reference: ref, phone, network: r.network.value, amount: Number(amount.toFixed(2)), currency: 'GHS', description: `${prefix === 'church' ? 'Church' : 'Ministry'} due`, memberId: m.id }) });
            const data = await res.json().catch(() => ({}));
            if (token !== seq) return;
            if (!res.ok || data.status === 'failed') throw new Error(data.message || 'The request could not be sent.');
            if (data.status === 'success') return succeed(data.transactionId || ref, token);
            poll(ref, token);
          } catch (e) { fail(e.message || 'The request could not be sent. Check the connection and try again.', token); }
        }
        function invalidate() {
          if (!isMomo() || MODE === 'manual') return;
          if (st.status === 'pending' || st.status === 'success' || carried) reset('Details changed. Send a new approval request.', 'note');
        }

        r.send.addEventListener('click', send);
        r.cancel.addEventListener('click', () => reset('Request cancelled.', 'note'));
        r.phone.addEventListener('input', () => { detect(); if (st.status === 'success') invalidate(); });
        if (amountEl) amountEl.addEventListener('input', invalidate);
        if (memberSel) memberSel.addEventListener('change', () => { r.phone.value = ''; invalidate(); refresh(); });
        method.addEventListener('change', () => { refresh(); if (!isMomo()) { stop(); } });
        form.addEventListener('reset', () => setTimeout(() => { stop(); carried = null; st = { status: 'idle' }; lock(false); r.txn.value = ''; r.phone.value = ''; status(''); refresh(); }, 0));
        /* Capture phase so this runs before the page's own save handler and can stop an unapproved mobile money payment. */
        form.addEventListener('submit', event => {
          if (!isMomo() || approved()) return;
          event.preventDefault(); event.stopImmediatePropagation();
          errorEl.textContent = MODE === 'manual' ? 'Enter the MoMo Transaction ID to record this payment.' : st.status === 'pending' ? 'Waiting for the member to approve the request on their phone.' : 'Send the approval request and wait for the member to approve it before saving.';
        }, true);
        /* Editing an existing mobile money record keeps its approval (until the amount, member or number changes). */
        const rows = $('rows');
        if (rows) rows.addEventListener('click', event => {
          if (!event.target.closest('button[data-action="edit"]')) return;
          const id = event.target.closest('tr')?.dataset.dueId;
          setTimeout(() => {
            const rec = readList(STORES[prefix]).find(d => d.id === id); stop(); st = { status: 'idle' }; lock(false); carried = null; r.txn.value = ''; r.phone.value = ''; status('');
            if (rec && rec.method === 'Mobile money') { r.phone.value = rec.momoPhone || ''; if (rec.momoNetwork) r.network.value = rec.momoNetwork; r.txn.value = rec.momoTxn || ''; carried = { ...rec }; status(rec.momoTxn ? `Already paid by mobile money. Transaction ${rec.momoTxn}.` : 'Previously recorded as mobile money.', 'ok'); }
            refresh();
          }, 0);
        });
        api[prefix] = { collect() {
          const blank = { momoPhone: '', momoNetwork: '', momoTxn: '', momoRef: '', momoStatus: '' };
          if (!isMomo() || !approved()) return blank;
          if (carried && st.status !== 'success') return { momoPhone: carried.momoPhone || '', momoNetwork: carried.momoNetwork || '', momoTxn: carried.momoTxn || '', momoRef: carried.momoRef || '', momoStatus: carried.momoStatus || '' };
          if (MODE === 'manual') return { momoPhone: normalizePhone(r.phone.value), momoNetwork: r.network.value, momoTxn: r.txn.value.trim(), momoRef: '', momoStatus: 'manual' };
          return { momoPhone: st.phone, momoNetwork: st.network, momoTxn: st.txn, momoRef: st.ref, momoStatus: MODE === 'demo' ? 'demo' : 'approved' };
        } };
        refresh();
      }
      window.MomoPay = { collect: prefix => (api[prefix] ? api[prefix].collect() : {}), networks: NETWORKS };
      ['church', 'ministry'].forEach(init);
    })();
