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
// UserIdentity – Namenskürzel, lokal auf dem Gerät gespeichert
// (kein Login, jede Person wählt einmalig ihren Namen)
// ------------------------------------------------------------
const UserIdentity = (function () {
    const STORAGE_KEY = 'kasse_username';

    function get() {
        return localStorage.getItem(STORAGE_KEY) || '';
    }

    function set(name) {
        const trimmed = name.trim();
        if (trimmed) localStorage.setItem(STORAGE_KEY, trimmed);
    }

    function ensureOnboarding() {
        if (!get()) {
            DOM.onboardingOverlay.classList.remove('hidden');
        }
    }

    function initOnboarding() {
        function confirmName() {
            const name = DOM.onboardingNameInput.value.trim();
            if (!name) {
                DOM.onboardingNameInput.focus();
                return;
            }
            set(name);
            DOM.onboardingOverlay.classList.add('hidden');
        }

        DOM.onboardingSaveBtn.addEventListener('click', confirmName);
        DOM.onboardingNameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') confirmName();
        });
    }

    return { get, set, ensureOnboarding, initOnboarding };
})();

// ------------------------------------------------------------
// State
// ------------------------------------------------------------
const State = {
    monthlyBudget: 200,
    receipts: [], // [{ id, total, created_at, added_by, receipt_items: [{id, name, price}] }]
    editingReceiptId: null
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
    productSection: document.getElementById('product-section'),
    storeInput: document.getElementById('store-input'),
    amountInput: document.getElementById('amount-input'),
    addProductBtn: document.getElementById('add-product-btn'),
    runningTotal: document.getElementById('running-total'),
    submitReceiptBtn: document.getElementById('submit-receipt-btn'),

    photoInput: document.getElementById('photo-input'),
    photoPreviewWrap: document.getElementById('photo-preview-wrap'),
    photoPreview: document.getElementById('photo-preview'),
    removePhotoBtn: document.getElementById('remove-photo-btn'),
    photoBtn: document.getElementById('photo-btn'),
    photoBtnLabel: document.getElementById('photo-btn-label'),

    historyList: document.getElementById('history-list'),
    historyEmpty: document.getElementById('history-empty'),

    settingsBtn: document.getElementById('settings-btn'),
    settingsOverlay: document.getElementById('settings-overlay'),
    settingsSheet: document.getElementById('settings-sheet'),
    closeSettingsBtn: document.getElementById('close-settings-btn'),
    saveBudgetBtn: document.getElementById('save-budget-btn'),
    budgetInput: document.getElementById('budget-input'),
    settingsNameInput: document.getElementById('settings-name-input'),

    onboardingOverlay: document.getElementById('onboarding-overlay'),
    onboardingNameInput: document.getElementById('onboarding-name-input'),
    onboardingSaveBtn: document.getElementById('onboarding-save-btn'),

    editingBanner: document.getElementById('editing-banner'),
    cancelEditBtn: document.getElementById('cancel-edit-btn'),

    productRowTemplate: document.getElementById('product-row-template'),
    historyItemTemplate: document.getElementById('history-item-template')
};

// ------------------------------------------------------------
// PhotoUpload – Beleg-Foto auswählen, anzeigen, zu Supabase
// Storage hochladen
// ------------------------------------------------------------
const PhotoUpload = (function () {
    const BUCKET = 'receipt-photos';

    let selectedFile = null; // neu ausgewähltes, noch nicht hochgeladenes Foto
    let existingUrl = null; // bereits gespeicherte URL (beim Bearbeiten geladen)

    function showPreview(src) {
        DOM.photoPreview.src = src;
        DOM.photoPreviewWrap.classList.remove('hidden');
        DOM.photoBtnLabel.textContent = 'Foto ersetzen';
    }

    function hidePreview() {
        DOM.photoPreviewWrap.classList.add('hidden');
        DOM.photoPreview.src = '';
        DOM.photoBtnLabel.textContent = 'Foto vom Bon hinzufügen';
    }

    function onFileSelected(e) {
        const file = e.target.files[0];
        if (!file) return;

        selectedFile = file;
        existingUrl = null;

        const reader = new FileReader();
        reader.onload = (ev) => showPreview(ev.target.result);
        reader.readAsDataURL(file);
    }

    function remove() {
        selectedFile = null;
        existingUrl = null;
        DOM.photoInput.value = '';
        hidePreview();
    }

    function reset() {
        remove();
    }

    function loadExisting(url) {
        reset();
        if (url) {
            existingUrl = url;
            showPreview(url);
        }
    }

    // Lädt ein neu ausgewähltes Foto hoch (falls vorhanden) und gibt
    // die zu speichernde URL zurück. Wurde nichts geändert, bleibt die
    // bestehende URL erhalten. Wurde das Foto entfernt, wird null
    // zurückgegeben.
    async function uploadIfNeeded() {
        if (!selectedFile) return existingUrl;

        const ext = (selectedFile.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${crypto.randomUUID()}.${ext}`;

        const { error } = await sb.storage.from(BUCKET).upload(path, selectedFile);
        if (error) throw error;

        const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
        return data.publicUrl;
    }

    function init() {
        DOM.photoBtn.addEventListener('click', () => DOM.photoInput.click());
        DOM.photoInput.addEventListener('change', onFileSelected);
        DOM.removePhotoBtn.addEventListener('click', remove);
    }

    return { init, reset, loadExisting, uploadIfNeeded };
})();

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

        // Enter im Namensfeld -> springt ins Preisfeld derselben Zeile
        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                priceInput.focus();
            }
        });

        // Enter im Preisfeld -> springt zur nächsten Zeile, oder legt
        // eine neue an, wenn es die letzte Zeile ist. So kommt man an
        // der Kasse ohne den "Produkt hinzufügen"-Button durch.
        priceInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const nextRow = row.nextElementSibling;
                if (nextRow && nextRow.classList.contains('product-row')) {
                    nextRow.querySelector('.product-name').focus();
                } else {
                    addRow(true);
                }
            }
        });

        DOM.productRows.appendChild(row);
        if (focus) nameInput.focus();
        return row;
    }

    function loadItems(items) {
        DOM.productRows.innerHTML = '';
        if (!items || items.length === 0) {
            addRow(false);
        } else {
            items.forEach((item) => {
                const row = addRow(false);
                row.querySelector('.product-name').value = item.name;
                row.querySelector('.product-price').value = item.price;
            });
        }
        recalcTotal();
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
        // Solange Produkte erfasst sind, ist die Summe der Produkte die
        // Quelle der Wahrheit für den Betrag. Werden alle Zeilen wieder
        // gelöscht, bleibt der zuletzt gültige Betrag stehen und ist
        // manuell änderbar.
        if (total > 0) {
            DOM.amountInput.value = total.toFixed(2);
        }
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

    return { init, reset, loadItems, getValidItems, recalcTotal };
})();

// ------------------------------------------------------------
// ReceiptSubmit – Beleg abrechnen
// ------------------------------------------------------------
const ReceiptSubmit = (function () {
    async function submit() {
        const items = ProductForm.getValidItems();
        const itemsTotal = items.reduce((sum, item) => sum + item.price, 0);
        const manualTotal = Utils.parsePrice(DOM.amountInput.value);
        const total = items.length > 0 ? itemsTotal : manualTotal;

        if (total <= 0) {
            alert('Bitte einen Betrag eingeben oder Produkte hinzufügen.');
            return;
        }

        const editingId = State.editingReceiptId;
        const storeName = DOM.storeInput.value.trim() || null;

        DOM.submitReceiptBtn.disabled = true;
        DOM.submitReceiptBtn.textContent = 'Speichern…';

        try {
            const photoUrl = await PhotoUpload.uploadIfNeeded();

            if (editingId) {
                // Bestehenden Beleg aktualisieren: Summe/Laden/Foto updaten,
                // alte Produktzeilen ersetzen.
                const { error: updateError } = await sb
                    .from('receipts')
                    .update({ total, store_name: storeName, photo_url: photoUrl })
                    .eq('id', editingId);
                if (updateError) throw updateError;

                const { error: deleteItemsError } = await sb
                    .from('receipt_items')
                    .delete()
                    .eq('receipt_id', editingId);
                if (deleteItemsError) throw deleteItemsError;

                if (items.length > 0) {
                    const itemRows = items.map((item) => ({
                        receipt_id: editingId,
                        name: item.name,
                        price: item.price
                    }));
                    const { error: itemsError } = await sb.from('receipt_items').insert(itemRows);
                    if (itemsError) throw itemsError;
                }

                ReceiptActions.exitEditMode();
            } else {
                const { data: receipt, error: receiptError } = await sb
                    .from('receipts')
                    .insert({ total, added_by: UserIdentity.get() || null, store_name: storeName, photo_url: photoUrl })
                    .select()
                    .single();

                if (receiptError) throw receiptError;

                if (items.length > 0) {
                    const itemRows = items.map((item) => ({
                        receipt_id: receipt.id,
                        name: item.name,
                        price: item.price
                    }));

                    const { error: itemsError } = await sb.from('receipt_items').insert(itemRows);
                    if (itemsError) throw itemsError;
                }
            }

            resetForm();
            await DataSync.reload();
        } catch (err) {
            console.error('Fehler beim Speichern des Belegs:', err);
            alert('Beleg konnte nicht gespeichert werden:\n' + (err?.message || String(err)));
        } finally {
            DOM.submitReceiptBtn.disabled = false;
            DOM.submitReceiptBtn.textContent = State.editingReceiptId ? 'Änderungen speichern' : 'Beleg abrechnen';
        }
    }

    function resetForm() {
        DOM.storeInput.value = '';
        DOM.amountInput.value = '';
        DOM.productSection.classList.add('hidden');
        ProductForm.reset();
        PhotoUpload.reset();
    }

    function init() {
        DOM.submitReceiptBtn.addEventListener('click', submit);
    }

    return { init, resetForm };
})();

// ------------------------------------------------------------
// ReceiptActions – Bearbeiten & Löschen bestehender Belege
// ------------------------------------------------------------
const ReceiptActions = (function () {
    function enterEditMode(receipt) {
        State.editingReceiptId = receipt.id;
        const items = (receipt.receipt_items || []).map((i) => ({ name: i.name, price: i.price }));
        DOM.storeInput.value = receipt.store_name || '';
        DOM.amountInput.value = receipt.total;
        ProductForm.loadItems(items);
        PhotoUpload.loadExisting(receipt.photo_url);
        DOM.productSection.classList.remove('hidden');
        DOM.editingBanner.classList.remove('hidden');
        DOM.editingBanner.classList.add('flex');
        DOM.submitReceiptBtn.textContent = 'Änderungen speichern';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function exitEditMode() {
        State.editingReceiptId = null;
        DOM.editingBanner.classList.add('hidden');
        DOM.editingBanner.classList.remove('flex');
        DOM.productSection.classList.add('hidden');
        DOM.submitReceiptBtn.textContent = 'Beleg abrechnen';
    }

    async function deleteReceipt(id) {
        const confirmed = confirm('Diesen Beleg wirklich löschen? Das kann nicht rückgängig gemacht werden.');
        if (!confirmed) return;

        try {
            const { error } = await sb.from('receipts').delete().eq('id', id);
            if (error) throw error;

            if (State.editingReceiptId === id) {
                exitEditMode();
                ReceiptSubmit.resetForm();
            }
            await DataSync.reload();
        } catch (err) {
            console.error('Fehler beim Löschen:', err);
            alert('Beleg konnte nicht gelöscht werden.');
        }
    }

    function init() {
        DOM.cancelEditBtn.addEventListener('click', () => {
            exitEditMode();
            ReceiptSubmit.resetForm();
        });
    }

    return { init, enterEditMode, exitEditMode, deleteReceipt };
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
            const storeEl = item.querySelector('.history-store');
            const dateEl = item.querySelector('.history-date');
            const timeEl = item.querySelector('.history-time');
            const authorEl = item.querySelector('.history-author');
            const totalEl = item.querySelector('.history-total');
            const itemsEl = item.querySelector('.history-items');
            const photoEl = item.querySelector('.history-photo');
            const noDetailsEl = item.querySelector('.history-no-details');
            const productsEl = item.querySelector('.history-products');
            const editBtn = item.querySelector('.history-edit-btn');
            const deleteBtn = item.querySelector('.history-delete-btn');

            if (receipt.store_name) {
                storeEl.textContent = receipt.store_name;
                storeEl.classList.remove('hidden');
            }
            dateEl.textContent = Utils.formatDate(receipt.created_at);
            timeEl.textContent = Utils.formatTime(receipt.created_at);
            authorEl.textContent = receipt.added_by ? ` · von ${receipt.added_by}` : '';
            totalEl.textContent = `${Utils.formatMoney(receipt.total)} €`;

            if (receipt.photo_url) {
                photoEl.src = receipt.photo_url;
                photoEl.classList.remove('hidden');
                photoEl.classList.add('cursor-zoom-in');
                photoEl.addEventListener('click', () => window.open(receipt.photo_url, '_blank'));
            }

            const products = receipt.receipt_items || [];
            if (products.length === 0) {
                noDetailsEl.classList.remove('hidden');
            }
            productsEl.innerHTML = products
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

            editBtn.addEventListener('click', () => ReceiptActions.enterEditMode(receipt));
            deleteBtn.addEventListener('click', () => ReceiptActions.deleteReceipt(receipt.id));

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
        DOM.settingsNameInput.value = UserIdentity.get();
        DOM.settingsOverlay.classList.remove('opacity-0', 'pointer-events-none');
        DOM.settingsSheet.classList.remove('translate-y-full');
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

        UserIdentity.set(DOM.settingsNameInput.value);

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
    if (!('serviceWorker' in navigator)) return;

    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch((err) => {
            console.error('Service Worker Registrierung fehlgeschlagen:', err);
        });
    });

    // Sobald ein neuer Service Worker aktiv wird (neues Deploy erkannt),
    // laden wir die Seite einmal automatisch neu, damit man nie mit
    // veraltetem Code hängen bleibt.
    let hasReloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hasReloaded) return;
        hasReloaded = true;
        window.location.reload();
    });
}

// ------------------------------------------------------------
// App Init
// ------------------------------------------------------------
(async function initApp() {
    UserIdentity.initOnboarding();
    UserIdentity.ensureOnboarding();

    ProductForm.init();
    PhotoUpload.init();
    ReceiptSubmit.init();
    ReceiptActions.init();
    Settings.init();
    registerServiceWorker();

    await DataSync.reload();
    DataSync.initRealtime();

    // Tagesbudget/verbleibende Tage aktualisieren, falls die App über
    // Mitternacht hinweg geöffnet bleibt.
    setInterval(() => Budget.render(), 60 * 1000);
})();