// ============================================================
// Haushaltskasse – app.js
// Vanilla JS, IIFE-Module, keine Build-Tools.
// ============================================================

// ------------------------------------------------------------
// Config
// ------------------------------------------------------------
const SUPABASE_URL = 'https://adlktjfdpuqunckqveot.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkbGt0amZkcHVxdW5ja3F2ZW90Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5Mjc1MjYsImV4cCI6MjA5ODUwMzUyNn0.9OtoQ_gtd0wTRVXccuM_watd6badod3_CTT4T4fQo0Q';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ------------------------------------------------------------
// Utils
// ------------------------------------------------------------
const Utils = (function () {
    function parsePrice(raw) {
        if (typeof raw !== 'string') raw = String(raw ?? '');
        const normalized = raw.trim().replace(',', '.');
        const value = parseFloat(normalized);
        return Number.isFinite(value) ? value : 0;
    }

    function formatMoney(value) {
        return Number(value).toLocaleString('de-DE', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function isSameMonth(dateStr, ref) {
        const d = new Date(dateStr);
        return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
    }

    function daysRemainingInMonth(ref) {
        const lastDay = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate();
        return lastDay - ref.getDate() + 1;
    }

    function monthLabel(ref) {
        const label = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(ref);
        return label.charAt(0).toUpperCase() + label.slice(1);
    }

    function formatDate(dateStr) {
        return new Date(dateStr).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    function formatTime(dateStr) {
        return new Date(dateStr).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    }

    return { parsePrice, formatMoney, isSameMonth, daysRemainingInMonth, monthLabel, formatDate, formatTime };
})();

// ------------------------------------------------------------
// State
// ------------------------------------------------------------
const State = {
    monthlyBudget: 200,
    receipts: [] // [{ id, total, created_at, receipt_items: [{id, name, price}] }]
};

// ------------------------------------------------------------
// DOM refs
// ------------------------------------------------------------
const DOM = {
    monthLabel: document.getElementById('month-label'),
    remainingBudget: document.getElementById('remaining-budget'),
    daysLeft: document.getElementById('days-left'),
    dailyBudget: document.getElementById('daily-budget'),

    productRows: document.getElementById('product-rows'),
    addProductBtn: document.getElementById('add-product-btn'),
    runningTotal: document.getElementById('running-total'),
    submitReceiptBtn: document.getElementById('submit-receipt-btn'),

    historyList: document.getElementById('history-list'),
    historyEmpty: document.getElementById('history-empty'),

    settingsBtn: document.getElementById('settings-btn'),
    settingsOverlay: document.getElementById('settings-overlay'),
    settingsSheet: document.getElementById('settings-sheet'),
    closeSettingsBtn: document.getElementById('close-settings-btn'),
    saveBudgetBtn: document.getElementById('save-budget-btn'),
    budgetInput: document.getElementById('budget-input'),

    productRowTemplate: document.getElementById('product-row-template'),
    historyItemTemplate: document.getElementById('history-item-template')
};

// ------------------------------------------------------------
// Budget – Anzeige oben
// ------------------------------------------------------------
const Budget = (function () {
    function spentThisMonth() {
        const now = new Date();
        return State.receipts
            .filter((r) => Utils.isSameMonth(r.created_at, now))
            .reduce((sum, r) => sum + Number(r.total), 0);
    }

    function render() {
        const now = new Date();
        const remaining = State.monthlyBudget - spentThisMonth();
        const daysLeft = Utils.daysRemainingInMonth(now);
        const daily = daysLeft > 0 ? remaining / daysLeft : remaining;

        DOM.monthLabel.textContent = Utils.monthLabel(now);
        DOM.remainingBudget.textContent = Utils.formatMoney(remaining);
        DOM.daysLeft.textContent = daysLeft;
        DOM.dailyBudget.textContent = `${Utils.formatMoney(daily)} €`;

        const negative = remaining < 0;
        DOM.remainingBudget.classList.toggle('text-red-400', negative);
        DOM.remainingBudget.classList.toggle('text-bone', !negative);
    }

    return { render };
})();

// ------------------------------------------------------------
// ProductForm – Produktzeilen & Live-Summe
// ------------------------------------------------------------
const ProductForm = (function () {
    function addRow(focus) {
        const fragment = DOM.productRowTemplate.content.cloneNode(true);
        const row = fragment.querySelector('.product-row');
        const nameInput = row.querySelector('.product-name');
        const priceInput = row.querySelector('.product-price');
        const removeBtn = row.querySelector('.remove-row-btn');

        priceInput.addEventListener('input', recalcTotal);
        removeBtn.addEventListener('click', () => {
            row.remove();
            recalcTotal();
        });

        DOM.productRows.appendChild(row);
        if (focus) nameInput.focus();
        return row;
    }

    function getRows() {
        return Array.from(DOM.productRows.querySelectorAll('.product-row'));
    }

    function getValidItems() {
        return getRows()
            .map((row) => {
                const name = row.querySelector('.product-name').value.trim();
                const price = Utils.parsePrice(row.querySelector('.product-price').value);
                return { name: name || 'Artikel', price };
            })
            .filter((item) => item.price > 0);
    }

    function recalcTotal() {
        const total = getValidItems().reduce((sum, item) => sum + item.price, 0);
        DOM.runningTotal.textContent = `${Utils.formatMoney(total)} €`;
        DOM.submitReceiptBtn.disabled = total <= 0;
        return total;
    }

    function reset() {
        DOM.productRows.innerHTML = '';
        addRow(false);
        recalcTotal();
    }

    function init() {
        DOM.addProductBtn.addEventListener('click', () => addRow(true));
        reset();
    }

    return { init, reset, getValidItems, recalcTotal };
})();

// ------------------------------------------------------------
// ReceiptSubmit – Beleg abrechnen
// ------------------------------------------------------------
const ReceiptSubmit = (function () {
    async function submit() {
        const items = ProductForm.getValidItems();
        if (items.length === 0) return;

        const total = items.reduce((sum, item) => sum + item.price, 0);

        DOM.submitReceiptBtn.disabled = true;
        DOM.submitReceiptBtn.textContent = 'Speichern…';

        try {
            const { data: receipt, error: receiptError } = await sb
                .from('receipts')
                .insert({ total })
                .select()
                .single();

            if (receiptError) throw receiptError;

            const itemRows = items.map((item) => ({
                receipt_id: receipt.id,
                name: item.name,
                price: item.price
            }));

            const { error: itemsError } = await sb.from('receipt_items').insert(itemRows);
            if (itemsError) throw itemsError;

            ProductForm.reset();
            await DataSync.reload();
        } catch (err) {
            console.error('Fehler beim Speichern des Belegs:', err);
            alert('Beleg konnte nicht gespeichert werden. Bitte Internetverbindung prüfen und erneut versuchen.');
        } finally {
            DOM.submitReceiptBtn.textContent = 'Beleg abrechnen';
            ProductForm.recalcTotal();
        }
    }

    function init() {
        DOM.submitReceiptBtn.addEventListener('click', submit);
    }

    return { init };
})();

// ------------------------------------------------------------
// History – Verlaufsliste mit Ausklapp-Funktion
// ------------------------------------------------------------
const History = (function () {
    function render() {
        DOM.historyList.innerHTML = '';

        if (State.receipts.length === 0) {
            DOM.historyEmpty.classList.remove('hidden');
            return;
        }
        DOM.historyEmpty.classList.add('hidden');

        State.receipts.forEach((receipt) => {
            const fragment = DOM.historyItemTemplate.content.cloneNode(true);
            const item = fragment.querySelector('.history-item');
            const toggle = item.querySelector('.history-toggle');
            const dateEl = item.querySelector('.history-date');
            const timeEl = item.querySelector('.history-time');
            const totalEl = item.querySelector('.history-total');
            const itemsEl = item.querySelector('.history-items');

            dateEl.textContent = Utils.formatDate(receipt.created_at);
            timeEl.textContent = Utils.formatTime(receipt.created_at);
            totalEl.textContent = `${Utils.formatMoney(receipt.total)} €`;

            const products = receipt.receipt_items || [];
            itemsEl.innerHTML = products
                .map(
                    (p) => `
        <div class="flex items-center justify-between text-sm">
          <span class="text-bone/90">${escapeHtml(p.name)}</span>
          <span class="num text-muted">${Utils.formatMoney(p.price)} €</span>
        </div>`
                )
                .join('');

            toggle.addEventListener('click', () => {
                itemsEl.classList.toggle('hidden');
                item.classList.toggle('expanded');
            });

            DOM.historyList.appendChild(item);
        });
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    return { render };
})();

// ------------------------------------------------------------
// Settings – Bottom Sheet für Budget-Änderung
// ------------------------------------------------------------
const Settings = (function () {
    function open() {
        DOM.budgetInput.value = State.monthlyBudget;
        DOM.settingsOverlay.classList.remove('opacity-0', 'pointer-events-none');
        DOM.settingsSheet.classList.remove('translate-y-full');
        setTimeout(() => DOM.budgetInput.focus(), 200);
    }

    function close() {
        DOM.settingsOverlay.classList.add('opacity-0', 'pointer-events-none');
        DOM.settingsSheet.classList.add('translate-y-full');
    }

    async function save() {
        const value = Utils.parsePrice(DOM.budgetInput.value);
        if (value <= 0) {
            alert('Bitte einen gültigen Betrag eingeben.');
            return;
        }

        DOM.saveBudgetBtn.disabled = true;
        try {
            const { error } = await sb
                .from('settings')
                .update({ monthly_budget: value, updated_at: new Date().toISOString() })
                .eq('id', 1);
            if (error) throw error;

            close();
            await DataSync.reload();
        } catch (err) {
            console.error('Fehler beim Speichern des Budgets:', err);
            alert('Budget konnte nicht gespeichert werden.');
        } finally {
            DOM.saveBudgetBtn.disabled = false;
        }
    }

    function init() {
        DOM.settingsBtn.addEventListener('click', open);
        DOM.closeSettingsBtn.addEventListener('click', close);
        DOM.settingsOverlay.addEventListener('click', close);
        DOM.saveBudgetBtn.addEventListener('click', save);
    }

    return { init };
})();

// ------------------------------------------------------------
// DataSync – Laden & Realtime-Synchronisation
// ------------------------------------------------------------
const DataSync = (function () {
    async function reload() {
        const [settingsRes, receiptsRes] = await Promise.all([
            sb.from('settings').select('*').eq('id', 1).single(),
            sb
                .from('receipts')
                .select('*, receipt_items(*)')
                .order('created_at', { ascending: false })
        ]);

        if (settingsRes.error) console.error('Settings-Fehler:', settingsRes.error);
        if (receiptsRes.error) console.error('Receipts-Fehler:', receiptsRes.error);

        State.monthlyBudget = Number(settingsRes.data?.monthly_budget ?? 200);
        State.receipts = receiptsRes.data ?? [];

        Budget.render();
        History.render();
    }

    function initRealtime() {
        sb.channel('haushaltskasse-changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'receipts' }, reload)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'receipt_items' }, reload)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, reload)
            .subscribe();
    }

    return { reload, initRealtime };
})();

// ------------------------------------------------------------
// PWA – Service Worker Registrierung
// ------------------------------------------------------------
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js').catch((err) => {
                console.error('Service Worker Registrierung fehlgeschlagen:', err);
            });
        });
    }
}

// ------------------------------------------------------------
// App Init
// ------------------------------------------------------------
(async function initApp() {
    ProductForm.init();
    ReceiptSubmit.init();
    Settings.init();
    registerServiceWorker();

    await DataSync.reload();
    DataSync.initRealtime();

    // Tagesbudget/verbleibende Tage aktualisieren, falls die App über
    // Mitternacht hinweg geöffnet bleibt.
    setInterval(() => Budget.render(), 60 * 1000);
})();