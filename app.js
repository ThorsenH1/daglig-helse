/* =========================================
   DAGLIG HELSE – App Logic
   Versjon 1.0.0
   For besteforeldre / eldre brukere
   ========================================= */

const APP_VERSION = '1.1.0';

// ==========================================
// STATE
// ==========================================
let currentUser = null;
let db = null;
let currentView = 'home';
let selectedMovementType = null;
let selectedSleepQuality = null;
let historyDateOffset = 0;
let editingMedicineId = null;

// Dagens data
let todayData = {
    water: { count: 0, logs: [] },
    bathroom: { logs: [] },
    medicineTaken: [],
    health: null,
    sleep: null,
    movement: { activities: [] },
    diary: '',
    checkedIn: false
};

// Innstillinger
let settings = {
    name: '',
    waterGoal: 8,
    waterReminder: false,
    waterInterval: 60,
    medicineReminder: false,
    movementReminder: false,
    movementInterval: 120,
    checkinReminder: false,
    checkinTime: '09:00',
    soundEnabled: true,
    fontSize: 'normal'
};

// Medisiner
let medicines = [];

// Nødkontakter
let emergencyContacts = [];

// Handleliste
let shoppingList = [];

// Påminnelser
let reminderTimers = {};
let lastWaterReminder = 0;
let lastMovementReminder = 0;

// Firebase Cloud Messaging
let messaging = null;
let fcmToken = null;

// ==========================================
// INITIALISERING
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

function initApp() {
    // Initialiser Firebase
    if (typeof firebase !== 'undefined' && typeof firebaseConfig !== 'undefined') {
        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
        
        // Aktiver offline-persistens for bedre ytelse uten nett
        db.enablePersistence({ synchronizeTabs: true }).catch(err => {
            if (err.code === 'failed-precondition') {
                console.warn('Offline-persistens: Flere faner åpne, kun én kan ha persistens.');
            } else if (err.code === 'unimplemented') {
                console.warn('Offline-persistens: Ikke støttet i denne nettleseren.');
            }
        });
        
        // Initialiser Cloud Messaging (for push-varsler når appen er lukket)
        initializeMessaging();
        
        // Lytt på auth-endringer
        firebase.auth().onAuthStateChanged(handleAuthStateChanged);
    } else {
        console.error('Firebase ikke lastet. Sjekk firebase-config.js');
        hideLoading();
        showView('login');
    }
    
    // Start klokke
    updateClock();
    setInterval(updateClock, 1000);
    
    // Registrer service workers
    registerServiceWorker();
}

function hideLoading() {
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
        loadingScreen.style.opacity = '0';
        loadingScreen.style.transition = 'opacity 0.5s';
        setTimeout(() => loadingScreen.style.display = 'none', 500);
    }
}

// ==========================================
// AUTH
// ==========================================
function handleAuthStateChanged(user) {
    hideLoading();
    if (user) {
        currentUser = user;
        document.getElementById('login-view').style.display = 'none';
        document.getElementById('app-container').style.display = 'block';
        
        // Last brukerdata
        loadAllData();
        
        // Start påminnelser
        setupReminders();
        
        // Be om varslingstillatelse
        requestNotificationPermission();
        
        // Oppdater header
        updateGreeting();
        
        showView('home');
    } else {
        currentUser = null;
        document.getElementById('login-view').style.display = 'block';
        document.getElementById('app-container').style.display = 'none';
        stopAllReminders();
    }
}

function signInWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    
    // Bruk popup for alle enheter (redirect kan gi problemer med GitHub Pages)
    firebase.auth().signInWithPopup(provider).catch(err => {
        console.error('Innlogging feilet:', err);
        if (err.code === 'auth/popup-blocked') {
            // Fallback til redirect hvis popup blokkeres
            firebase.auth().signInWithRedirect(provider);
        } else if (err.code === 'auth/unauthorized-domain') {
            showConfirm('❌ Domenet er ikke autorisert i Firebase. Legg til dette domenet i Firebase Console → Authentication → Settings → Authorized domains.');
        } else {
            showConfirm('❌ Innlogging feilet. Prøv igjen.');
        }
    });
}

function handleSignOut() {
    if (confirm('Er du sikker på at du vil logge ut?')) {
        stopAllReminders();
        firebase.auth().signOut();
    }
}

// ==========================================
// NAVIGASJON
// ==========================================
function showView(viewName) {
    // Skjul alle views
    document.querySelectorAll('.view.app-view').forEach(v => v.style.display = 'none');
    
    // Vis valgt view
    const view = document.getElementById(viewName + '-view');
    if (view) {
        view.style.display = 'block';
        currentView = viewName;
    }
    
    // Oppdater nav
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === viewName);
    });
    
    // Spesifikk view-logikk
    switch(viewName) {
        case 'home':
            updateDashboard();
            break;
        case 'water':
            updateWaterView();
            break;
        case 'bathroom':
            updateBathroomView();
            break;
        case 'medicine':
            updateMedicineView();
            break;
        case 'health':
            updateHealthView();
            break;
        case 'sleep':
            updateSleepView();
            break;
        case 'movement':
            updateMovementView();
            break;
        case 'diary':
            updateDiaryView();
            break;
        case 'shopping':
            updateShoppingView();
            break;
        case 'emergency':
            updateEmergencyView();
            break;
        case 'history':
            historyDateOffset = 0;
            updateHistoryView();
            break;
        case 'settings':
            updateSettingsView();
            break;
    }
    
    // Scroll til toppen
    window.scrollTo(0, 0);
}

// ==========================================
// KLOKKE & DATO
// ==========================================
function updateClock() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' });
    const dateStr = formatFullDate(now);
    
    const clockTime = document.getElementById('clock-time');
    const clockDate = document.getElementById('clock-date');
    const headerDate = document.getElementById('header-date');
    
    if (clockTime) clockTime.textContent = timeStr;
    if (clockDate) clockDate.textContent = dateStr;
    if (headerDate) headerDate.textContent = dateStr;
}

function updateGreeting() {
    const hour = new Date().getHours();
    let greeting = 'God dag';
    if (hour < 6) greeting = 'God natt';
    else if (hour < 10) greeting = 'God morgen';
    else if (hour < 12) greeting = 'God formiddag';
    else if (hour < 17) greeting = 'God ettermiddag';
    else if (hour < 22) greeting = 'God kveld';
    else greeting = 'God natt';
    
    const name = settings.name || (currentUser ? currentUser.displayName?.split(' ')[0] : '');
    const fullGreeting = name ? `${greeting}, ${name}!` : `${greeting}!`;
    
    document.getElementById('header-greeting').textContent = fullGreeting;
}

function formatFullDate(date) {
    const dager = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];
    const maneder = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'];
    return `${dager[date.getDay()]} ${date.getDate()}. ${maneder[date.getMonth()]} ${date.getFullYear()}`;
}

function getTodayString() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}

function getDateString(date) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function getTimeString() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
}

// ==========================================
// FIREBASE DATA – LASTE OG LAGRE
// ==========================================
function getUserRef() {
    if (!db || !currentUser) return null;
    return db.collection('users').doc(currentUser.uid);
}

async function loadAllData() {
    if (!currentUser || !db) return;
    
    try {
        await Promise.all([
            loadSettings(),
            loadMedicines(),
            loadEmergencyContacts(),
            loadShoppingList(),
            loadTodayData()
        ]);
        
        updateDashboard();
        localStorage.setItem('dagligHelse_lastDate', getTodayString());
        
        // Synkroniser påminnelsesinnstillinger til skyen
        await syncReminderSettingsToCloud();
        
        console.log('Alle data lastet');
    } catch (err) {
        console.error('Feil ved lasting av data:', err);
        showConfirm('⚠️ Kunne ikke laste alle data. Sjekk nettilkoblingen.');
    }
}

async function loadSettings() {
    const ref = getUserRef();
    if (!ref) return;
    
    const doc = await ref.get();
    if (doc.exists && doc.data().settings) {
        settings = { ...settings, ...doc.data().settings };
        applyFontSize(settings.fontSize);
    }
}

async function saveSettingsToFirebase() {
    const ref = getUserRef();
    if (!ref) return;
    
    await ref.set({ settings: settings }, { merge: true });
}

async function loadMedicines() {
    const ref = getUserRef();
    if (!ref) return;
    
    const snapshot = await ref.collection('medicines').get();
    medicines = [];
    snapshot.forEach(doc => {
        medicines.push({ id: doc.id, ...doc.data() });
    });
}

async function loadEmergencyContacts() {
    const ref = getUserRef();
    if (!ref) return;
    
    const snapshot = await ref.collection('emergencyContacts').orderBy('name').get();
    emergencyContacts = [];
    snapshot.forEach(doc => {
        emergencyContacts.push({ id: doc.id, ...doc.data() });
    });
}

async function loadShoppingList() {
    const ref = getUserRef();
    if (!ref) return;
    
    const doc = await ref.collection('lists').doc('shopping').get();
    if (doc.exists) {
        shoppingList = doc.data().items || [];
    }
}

async function saveShoppingList() {
    const ref = getUserRef();
    if (!ref) return;
    
    await ref.collection('lists').doc('shopping').set({ 
        items: shoppingList,
        updated: firebase.firestore.FieldValue.serverTimestamp()
    });
}

async function loadTodayData() {
    const ref = getUserRef();
    if (!ref) return;
    const today = getTodayString();
    
    // Last vannlogg
    const waterDoc = await ref.collection('waterLogs').doc(today).get();
    if (waterDoc.exists) {
        todayData.water = waterDoc.data();
    } else {
        todayData.water = { count: 0, logs: [] };
    }
    
    // Last toalettlogg
    const bathroomDoc = await ref.collection('bathroomLogs').doc(today).get();
    if (bathroomDoc.exists) {
        todayData.bathroom = bathroomDoc.data();
    } else {
        todayData.bathroom = { logs: [] };
    }
    
    // Last medisintatt
    const medicineDoc = await ref.collection('medicineLogs').doc(today).get();
    if (medicineDoc.exists) {
        todayData.medicineTaken = medicineDoc.data().taken || [];
    } else {
        todayData.medicineTaken = [];
    }
    
    // Last helselogg
    const healthDoc = await ref.collection('healthLogs').doc(today).get();
    if (healthDoc.exists) {
        todayData.health = healthDoc.data();
    } else {
        todayData.health = null;
    }
    
    // Last søvnlogg
    const sleepDoc = await ref.collection('sleepLogs').doc(today).get();
    if (sleepDoc.exists) {
        todayData.sleep = sleepDoc.data();
    } else {
        todayData.sleep = null;
    }
    
    // Last bevegelseslogg
    const movementDoc = await ref.collection('movementLogs').doc(today).get();
    if (movementDoc.exists) {
        todayData.movement = movementDoc.data();
    } else {
        todayData.movement = { activities: [] };
    }
    
    // Last dagbok
    const diaryDoc = await ref.collection('diaryLogs').doc(today).get();
    if (diaryDoc.exists) {
        todayData.diary = diaryDoc.data().text || '';
    } else {
        todayData.diary = '';
    }
    
    // Last innsjekk
    const checkinDoc = await ref.collection('checkins').doc(today).get();
    if (checkinDoc.exists) {
        todayData.checkedIn = true;
    } else {
        todayData.checkedIn = false;
    }
}

// ==========================================
// DASHBOARD
// ==========================================
function updateDashboard() {
    // Vann
    const waterCount = todayData.water.count || 0;
    const waterGoal = settings.waterGoal || 8;
    document.getElementById('home-water-count').textContent = `${waterCount} glass`;
    document.getElementById('home-water-goal').textContent = `Mål: ${waterGoal} glass`;
    const waterPct = Math.min(100, Math.round((waterCount / waterGoal) * 100));
    document.getElementById('home-water-progress').style.width = waterPct + '%';
    
    // Toalett
    const bathroomLogs = todayData.bathroom.logs || [];
    if (bathroomLogs.length > 0) {
        const lastVisit = bathroomLogs[bathroomLogs.length - 1];
        document.getElementById('home-bathroom-last').textContent = lastVisit.time;
        document.getElementById('home-bathroom-count').textContent = `${bathroomLogs.length} besøk i dag`;
    } else {
        document.getElementById('home-bathroom-last').textContent = 'Ingen i dag';
        document.getElementById('home-bathroom-count').textContent = '0 besøk i dag';
    }
    
    // Medisin
    const totalMedicineDoses = getMedicineDosesForToday();
    const takenCount = todayData.medicineTaken.length;
    if (totalMedicineDoses > 0) {
        document.getElementById('home-medicine-status').textContent = `${takenCount}/${totalMedicineDoses}`;
        document.getElementById('home-medicine-detail').textContent = 
            takenCount >= totalMedicineDoses ? '✅ Alle tatt!' : `${totalMedicineDoses - takenCount} gjenstår`;
        const medPct = Math.min(100, Math.round((takenCount / totalMedicineDoses) * 100));
        document.getElementById('home-medicine-progress').style.width = medPct + '%';
    } else {
        document.getElementById('home-medicine-status').textContent = 'Ingen';
        document.getElementById('home-medicine-detail').textContent = 'Legg til medisiner i innstillinger';
        document.getElementById('home-medicine-progress').style.width = '0%';
    }
    
    // Helse
    if (todayData.health) {
        const moodEmojis = {
            'veldig_bra': '😄', 'bra': '🙂', 'ok': '😐', 'darlig': '😟', 'veldig_darlig': '😢'
        };
        document.getElementById('home-health-mood').textContent = 
            moodEmojis[todayData.health.mood] || 'Registrert';
        document.getElementById('home-health-detail').textContent = 
            todayData.health.bpSys ? `BP: ${todayData.health.bpSys}/${todayData.health.bpDia}` : '';
    } else {
        document.getElementById('home-health-mood').textContent = 'Ikke registrert';
        document.getElementById('home-health-detail').textContent = 'Trykk for å registrere';
    }
    
    // Innsjekk
    const checkinCard = document.getElementById('checkin-card');
    if (!todayData.checkedIn) {
        checkinCard.style.display = 'block';
    } else {
        checkinCard.style.display = 'none';
    }
    
    // Påminnelser
    updateRemindersDisplay();
}

function getMedicineDosesForToday() {
    let total = 0;
    medicines.forEach(med => {
        if (med.active !== false) {
            total += (med.times || []).length;
        }
    });
    return total;
}

function updateRemindersDisplay() {
    const container = document.getElementById('home-reminders');
    const now = new Date();
    const currentTime = getTimeString();
    let reminders = [];
    
    // Medisinpåminnelser
    medicines.forEach(med => {
        if (med.active !== false) {
            (med.times || []).forEach(time => {
                const alreadyTaken = todayData.medicineTaken.some(
                    t => t.medicineId === med.id && t.scheduledTime === time
                );
                if (!alreadyTaken && time >= currentTime) {
                    reminders.push({
                        time: time,
                        icon: '💊',
                        text: `${med.name} (${med.dosage || ''})`,
                        type: 'medicine'
                    });
                }
            });
        }
    });
    
    // Vannpåminnelse
    if (settings.waterReminder && todayData.water.count < settings.waterGoal) {
        const nextWaterTime = new Date(lastWaterReminder + settings.waterInterval * 60000);
        if (nextWaterTime > now) {
            reminders.push({
                time: nextWaterTime.toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' }),
                icon: '💧',
                text: 'Drikk et glass vann',
                type: 'water'
            });
        }
    }
    
    reminders.sort((a, b) => a.time.localeCompare(b.time));
    
    if (reminders.length === 0) {
        container.innerHTML = '<p class="empty-state">Ingen kommende påminnelser</p>';
    } else {
        container.innerHTML = reminders.map(r => `
            <div class="reminder-item">
                <span class="reminder-time">${r.time}</span>
                <span>${r.icon} ${r.text}</span>
            </div>
        `).join('');
    }
}

// ==========================================
// VANNINNTAK
// ==========================================
function addWater() {
    todayData.water.count = (todayData.water.count || 0) + 1;
    todayData.water.logs.push({ time: getTimeString() });
    saveWaterLog();
    updateWaterView();
    updateDashboard();
    showConfirm('💧 Glass registrert!');
    lastWaterReminder = Date.now();
}

function removeWater() {
    if (todayData.water.count > 0) {
        todayData.water.count--;
        todayData.water.logs.pop();
        saveWaterLog();
        updateWaterView();
        updateDashboard();
        showConfirm('➖ Glass fjernet');
    }
}

function quickAddWater() {
    addWater();
    if (currentView === 'home') updateDashboard();
}

async function saveWaterLog() {
    const ref = getUserRef();
    if (!ref) return;
    
    await ref.collection('waterLogs').doc(getTodayString()).set({
        count: todayData.water.count,
        logs: todayData.water.logs,
        updated: firebase.firestore.FieldValue.serverTimestamp()
    });
}

function updateWaterView() {
    const count = todayData.water.count || 0;
    const goal = settings.waterGoal || 8;
    
    document.getElementById('water-count-display').textContent = count;
    document.getElementById('water-goal-text').textContent = `Mål: ${goal} glass`;
    
    const pct = Math.min(100, Math.round((count / goal) * 100));
    document.getElementById('water-progress-fill').style.width = pct + '%';
    
    // Visuelle glass
    const glassesContainer = document.getElementById('water-glasses-visual');
    let html = '';
    for (let i = 0; i < goal; i++) {
        html += `<span class="water-glass ${i < count ? '' : 'empty'}">🥛</span>`;
    }
    glassesContainer.innerHTML = html;
    
    // Logg
    const logList = document.getElementById('water-log-list');
    if (todayData.water.logs.length === 0) {
        logList.innerHTML = '<p class="empty-state">Ingen glass registrert ennå</p>';
    } else {
        logList.innerHTML = todayData.water.logs.map((log, i) => `
            <div class="log-item">
                <span class="log-time">${log.time}</span>
                <span class="log-text">Glass #${i + 1}</span>
            </div>
        `).join('');
    }
}

// ==========================================
// TOALETTLOGG
// ==========================================
function logBathroom() {
    quickLogBathroom();
}

function quickLogBathroom() {
    const noteEl = document.getElementById('bathroom-note');
    const note = noteEl ? noteEl.value.trim() : '';
    
    const entry = {
        time: getTimeString(),
        note: note
    };
    
    todayData.bathroom.logs.push(entry);
    saveBathroomLog();
    updateBathroomView();
    updateDashboard();
    showConfirm('🚽 Besøk registrert!');
    
    if (noteEl) noteEl.value = '';
}

async function saveBathroomLog() {
    const ref = getUserRef();
    if (!ref) return;
    
    await ref.collection('bathroomLogs').doc(getTodayString()).set({
        logs: todayData.bathroom.logs,
        updated: firebase.firestore.FieldValue.serverTimestamp()
    });
}

function updateBathroomView() {
    const logs = todayData.bathroom.logs || [];
    
    if (logs.length > 0) {
        const last = logs[logs.length - 1];
        document.getElementById('bathroom-last-time').textContent = last.time;
    } else {
        document.getElementById('bathroom-last-time').textContent = 'Ingen registrert i dag';
    }
    
    document.getElementById('bathroom-count-text').textContent = `${logs.length} besøk i dag`;
    
    const logList = document.getElementById('bathroom-log-list');
    if (logs.length === 0) {
        logList.innerHTML = '<p class="empty-state">Ingen besøk registrert i dag</p>';
    } else {
        logList.innerHTML = logs.map((log, i) => `
            <div class="log-item">
                <span class="log-time">${log.time}</span>
                <span class="log-text">Besøk #${i + 1}${log.note ? ' – ' + escapeHtml(log.note) : ''}</span>
                <button class="log-delete" onclick="deleteBathroomLog(${i})">🗑️</button>
            </div>
        `).join('');
    }
}

function deleteBathroomLog(index) {
    todayData.bathroom.logs.splice(index, 1);
    saveBathroomLog();
    updateBathroomView();
    updateDashboard();
}

// ==========================================
// MEDISINER
// ==========================================
function showAddMedicineModal() {
    editingMedicineId = null;
    document.getElementById('medicine-name').value = '';
    document.getElementById('medicine-dosage').value = '';
    document.getElementById('medicine-times-list').innerHTML = `
        <div class="medicine-time-row">
            <input type="time" class="input-large medicine-time-input" value="08:00">
        </div>
    `;
    document.getElementById('modal-add-medicine').style.display = 'flex';
}

function addMedicineTimeRow() {
    const container = document.getElementById('medicine-times-list');
    const row = document.createElement('div');
    row.className = 'medicine-time-row';
    row.innerHTML = `<input type="time" class="input-large medicine-time-input" value="12:00">`;
    container.appendChild(row);
}

async function saveMedicine() {
    const name = document.getElementById('medicine-name').value.trim();
    const dosage = document.getElementById('medicine-dosage').value.trim();
    const timeInputs = document.querySelectorAll('.medicine-time-input');
    const times = Array.from(timeInputs).map(input => input.value).filter(t => t);
    
    if (!name) {
        showConfirm('❌ Skriv inn medisinnavnet');
        return;
    }
    
    const ref = getUserRef();
    if (!ref) return;
    
    const medicineData = {
        name: name,
        dosage: dosage,
        times: times,
        active: true,
        created: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    if (editingMedicineId) {
        await ref.collection('medicines').doc(editingMedicineId).update(medicineData);
    } else {
        await ref.collection('medicines').add(medicineData);
    }
    
    await loadMedicines();
    closeModal('modal-add-medicine');
    updateMedicineView();
    updateSettingsView();
    updateDashboard();
    await syncReminderSettingsToCloud();
    showConfirm('💊 Medisin lagret!');
}

async function deleteMedicine(medicineId) {
    if (!confirm('Er du sikker på at du vil slette denne medisinen?')) return;
    
    const ref = getUserRef();
    if (!ref) return;
    
    await ref.collection('medicines').doc(medicineId).delete();
    await loadMedicines();
    updateMedicineView();
    updateSettingsView();
    updateDashboard();
    await syncReminderSettingsToCloud();
    showConfirm('🗑️ Medisin slettet');
}

async function takeMedicine(medicineId, scheduledTime) {
    const medicine = medicines.find(m => m.id === medicineId);
    if (!medicine) return;
    
    // Sjekk om allerede tatt
    const alreadyTaken = todayData.medicineTaken.some(
        t => t.medicineId === medicineId && t.scheduledTime === scheduledTime
    );
    if (alreadyTaken) {
        showConfirm('⚠️ Denne dosen er allerede registrert');
        return;
    }
    
    todayData.medicineTaken.push({
        medicineId: medicineId,
        name: medicine.name,
        dosage: medicine.dosage,
        scheduledTime: scheduledTime,
        takenTime: getTimeString()
    });
    
    const ref = getUserRef();
    if (!ref) return;
    
    await ref.collection('medicineLogs').doc(getTodayString()).set({
        taken: todayData.medicineTaken,
        updated: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    updateMedicineView();
    updateDashboard();
    showConfirm(`✅ ${medicine.name} registrert som tatt!`);
}

function updateMedicineView() {
    const todayList = document.getElementById('medicine-today-list');
    const takenList = document.getElementById('medicine-taken-list');
    
    if (medicines.length === 0) {
        todayList.innerHTML = '<p class="empty-state">Ingen medisiner lagt til ennå. Trykk "Legg til ny medisin" under.</p>';
    } else {
        let html = '';
        medicines.forEach(med => {
            if (med.active === false) return;
            (med.times || []).forEach(time => {
                const taken = todayData.medicineTaken.some(
                    t => t.medicineId === med.id && t.scheduledTime === time
                );
                html += `
                    <div class="medicine-item ${taken ? 'taken' : ''}">
                        <div class="medicine-item-info">
                            <div class="medicine-item-name">${escapeHtml(med.name)}</div>
                            <div class="medicine-item-dosage">${escapeHtml(med.dosage || '')}</div>
                            <div class="medicine-item-time">⏰ ${time}</div>
                        </div>
                        <button class="btn btn-take-medicine ${taken ? 'taken' : ''}" 
                                onclick="takeMedicine('${med.id}', '${time}')"
                                ${taken ? 'disabled' : ''}>
                            ${taken ? '✅ Tatt' : '💊 Ta nå'}
                        </button>
                    </div>
                `;
            });
        });
        todayList.innerHTML = html || '<p class="empty-state">Ingen doser planlagt</p>';
    }
    
    // Tatt i dag
    if (todayData.medicineTaken.length === 0) {
        takenList.innerHTML = '<p class="empty-state">Ingen medisiner tatt ennå i dag</p>';
    } else {
        takenList.innerHTML = todayData.medicineTaken.map(t => `
            <div class="log-item">
                <span class="log-time">${t.takenTime}</span>
                <span class="log-text">${escapeHtml(t.name)} ${t.dosage ? '(' + escapeHtml(t.dosage) + ')' : ''}</span>
            </div>
        `).join('');
    }
}

// ==========================================
// HELSE
// ==========================================
function setMood(mood) {
    document.querySelectorAll('.mood-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.mood === mood);
    });
    if (!todayData.health) todayData.health = {};
    todayData.health.mood = mood;
}

function updatePainDisplay() {
    const value = document.getElementById('pain-level').value;
    document.getElementById('pain-value-display').textContent = value;
}

async function saveHealthLog() {
    const mood = todayData.health?.mood || null;
    const pain = parseInt(document.getElementById('pain-level').value) || 0;
    const bpSys = document.getElementById('bp-systolic').value;
    const bpDia = document.getElementById('bp-diastolic').value;
    const pulse = document.getElementById('bp-pulse').value;
    const weight = document.getElementById('health-weight').value;
    const notes = document.getElementById('health-notes').value.trim();
    
    todayData.health = {
        mood: mood,
        pain: pain,
        bpSys: bpSys ? parseInt(bpSys) : null,
        bpDia: bpDia ? parseInt(bpDia) : null,
        pulse: pulse ? parseInt(pulse) : null,
        weight: weight ? parseFloat(weight) : null,
        notes: notes,
        time: getTimeString()
    };
    
    const ref = getUserRef();
    if (!ref) return;
    
    await ref.collection('healthLogs').doc(getTodayString()).set({
        ...todayData.health,
        updated: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    updateDashboard();
    showConfirm('❤️ Helsedata lagret!');
}

function updateHealthView() {
    if (todayData.health) {
        // Sett mood
        if (todayData.health.mood) {
            document.querySelectorAll('.mood-btn').forEach(btn => {
                btn.classList.toggle('selected', btn.dataset.mood === todayData.health.mood);
            });
        }
        
        // Sett smerte
        if (todayData.health.pain !== undefined) {
            document.getElementById('pain-level').value = todayData.health.pain;
            document.getElementById('pain-value-display').textContent = todayData.health.pain;
        }
        
        // Sett blodtrykk
        if (todayData.health.bpSys) document.getElementById('bp-systolic').value = todayData.health.bpSys;
        if (todayData.health.bpDia) document.getElementById('bp-diastolic').value = todayData.health.bpDia;
        if (todayData.health.pulse) document.getElementById('bp-pulse').value = todayData.health.pulse;
        
        // Sett vekt
        if (todayData.health.weight) document.getElementById('health-weight').value = todayData.health.weight;
        
        // Sett notater
        if (todayData.health.notes) document.getElementById('health-notes').value = todayData.health.notes;
    }
}

// ==========================================
// SØVN
// ==========================================
function setSleepQuality(quality) {
    selectedSleepQuality = quality;
    document.querySelectorAll('.quality-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.quality === quality);
    });
    updateSleepDuration();
}

function updateSleepDuration() {
    const bedtime = document.getElementById('sleep-bedtime').value;
    const waketime = document.getElementById('sleep-waketime').value;
    
    if (bedtime && waketime) {
        let bedMinutes = timeToMinutes(bedtime);
        let wakeMinutes = timeToMinutes(waketime);
        
        if (wakeMinutes <= bedMinutes) {
            wakeMinutes += 24 * 60; // Neste dag
        }
        
        const diffMinutes = wakeMinutes - bedMinutes;
        const hours = Math.floor(diffMinutes / 60);
        const mins = diffMinutes % 60;
        
        document.getElementById('sleep-duration-text').textContent = 
            `${hours} timer${mins > 0 ? ` ${mins} min` : ''}`;
    }
}

function timeToMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}

async function saveSleepLog() {
    const bedtime = document.getElementById('sleep-bedtime').value;
    const waketime = document.getElementById('sleep-waketime').value;
    
    todayData.sleep = {
        bedtime: bedtime,
        waketime: waketime,
        quality: selectedSleepQuality,
        time: getTimeString()
    };
    
    const ref = getUserRef();
    if (!ref) return;
    
    await ref.collection('sleepLogs').doc(getTodayString()).set({
        ...todayData.sleep,
        updated: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    showConfirm('😴 Søvndata lagret!');
    loadSleepHistory();
}

function updateSleepView() {
    if (todayData.sleep) {
        document.getElementById('sleep-bedtime').value = todayData.sleep.bedtime || '22:00';
        document.getElementById('sleep-waketime').value = todayData.sleep.waketime || '07:00';
        if (todayData.sleep.quality) {
            setSleepQuality(todayData.sleep.quality);
        }
    }
    updateSleepDuration();
    loadSleepHistory();
}

async function loadSleepHistory() {
    const ref = getUserRef();
    if (!ref) return;
    
    const container = document.getElementById('sleep-history-list');
    const dates = [];
    const now = new Date();
    
    for (let i = 1; i <= 7; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        dates.push(getDateString(d));
    }
    
    let html = '';
    for (const dateStr of dates) {
        const doc = await ref.collection('sleepLogs').doc(dateStr).get();
        if (doc.exists) {
            const data = doc.data();
            const qualityEmojis = {
                'veldig_bra': '😴💤', 'bra': '😊', 'ok': '😐', 'darlig': '😫'
            };
            html += `
                <div class="log-item">
                    <span class="log-time">${dateStr.split('-').reverse().join('.')}</span>
                    <span class="log-text">${data.bedtime || '?'} → ${data.waketime || '?'} ${qualityEmojis[data.quality] || ''}</span>
                </div>
            `;
        }
    }
    
    container.innerHTML = html || '<p class="empty-state">Ingen søvndata de siste 7 dagene</p>';
}

// ==========================================
// BEVEGELSE
// ==========================================
function logMovement(type) {
    selectedMovementType = type;
    
    document.querySelectorAll('.btn-movement').forEach(btn => {
        btn.classList.remove('selected');
    });
    event.target.closest('.btn-movement')?.classList.add('selected');
    
    document.getElementById('movement-duration-section').style.display = 'block';
    document.getElementById('movement-duration').value = '30';
    document.getElementById('movement-duration').focus();
}

async function saveMovement() {
    if (!selectedMovementType) return;
    
    const duration = parseInt(document.getElementById('movement-duration').value) || 30;
    const typeNames = {
        'gåtur': '🚶 Gåtur',
        'hagearbeid': '🌱 Hagearbeid',
        'gymnastikk': '🤸 Gymnastikk',
        'sykling': '🚴 Sykling',
        'svømming': '🏊 Svømming',
        'annet': '✨ Annet'
    };
    
    todayData.movement.activities.push({
        type: selectedMovementType,
        name: typeNames[selectedMovementType] || selectedMovementType,
        duration: duration,
        time: getTimeString()
    });
    
    const ref = getUserRef();
    if (!ref) return;
    
    await ref.collection('movementLogs').doc(getTodayString()).set({
        activities: todayData.movement.activities,
        updated: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    selectedMovementType = null;
    document.getElementById('movement-duration-section').style.display = 'none';
    document.querySelectorAll('.btn-movement').forEach(btn => btn.classList.remove('selected'));
    
    lastMovementReminder = Date.now();
    updateMovementView();
    showConfirm('🚶 Aktivitet registrert!');
}

function updateMovementView() {
    const activities = todayData.movement.activities || [];
    document.getElementById('movement-count').textContent = activities.length;
    
    const logList = document.getElementById('movement-log-list');
    if (activities.length === 0) {
        logList.innerHTML = '<p class="empty-state">Ingen aktivitet registrert i dag</p>';
    } else {
        logList.innerHTML = activities.map((a, i) => `
            <div class="log-item">
                <span class="log-time">${a.time}</span>
                <span class="log-text">${escapeHtml(a.name)} – ${a.duration} min</span>
            </div>
        `).join('');
    }
}

// ==========================================
// DAGBOK
// ==========================================
async function saveDiary() {
    const text = document.getElementById('diary-text').value.trim();
    todayData.diary = text;
    
    const ref = getUserRef();
    if (!ref) return;
    
    await ref.collection('diaryLogs').doc(getTodayString()).set({
        text: text,
        updated: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    showConfirm('📝 Dagbok lagret!');
    loadDiaryHistory();
}

function updateDiaryView() {
    document.getElementById('diary-text').value = todayData.diary || '';
    loadDiaryHistory();
}

async function loadDiaryHistory() {
    const ref = getUserRef();
    if (!ref) return;
    
    const container = document.getElementById('diary-history-list');
    const dates = [];
    const now = new Date();
    
    for (let i = 1; i <= 14; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        dates.push(getDateString(d));
    }
    
    let html = '';
    for (const dateStr of dates) {
        const doc = await ref.collection('diaryLogs').doc(dateStr).get();
        if (doc.exists && doc.data().text) {
            const d = new Date(dateStr + 'T00:00:00');
            html += `
                <div class="diary-entry">
                    <div class="diary-entry-date">${formatFullDate(d)}</div>
                    <div class="diary-entry-text">${escapeHtml(doc.data().text)}</div>
                </div>
            `;
        }
    }
    
    container.innerHTML = html || '<p class="empty-state">Ingen dagbokinnlegg de siste 14 dagene</p>';
}

// ==========================================
// HANDLELISTE
// ==========================================
function addShoppingItem() {
    const input = document.getElementById('shopping-input');
    const text = input.value.trim();
    if (!text) return;
    
    shoppingList.push({
        text: text,
        checked: false,
        added: getTimeString()
    });
    
    input.value = '';
    saveShoppingList();
    updateShoppingView();
}

function toggleShoppingItem(index) {
    shoppingList[index].checked = !shoppingList[index].checked;
    saveShoppingList();
    updateShoppingView();
}

function deleteShoppingItem(index) {
    shoppingList.splice(index, 1);
    saveShoppingList();
    updateShoppingView();
}

function clearCompletedShopping() {
    shoppingList = shoppingList.filter(item => !item.checked);
    saveShoppingList();
    updateShoppingView();
}

function updateShoppingView() {
    const container = document.getElementById('shopping-list');
    const clearBtn = document.getElementById('btn-clear-shopping');
    
    if (shoppingList.length === 0) {
        container.innerHTML = '<p class="empty-state">Handlelisten er tom</p>';
        clearBtn.style.display = 'none';
    } else {
        // Vis uavkryssede først, så avkryssede
        const sorted = [...shoppingList].map((item, i) => ({ ...item, originalIndex: i }));
        sorted.sort((a, b) => a.checked - b.checked);
        
        container.innerHTML = sorted.map(item => `
            <div class="shopping-item ${item.checked ? 'checked' : ''}" onclick="toggleShoppingItem(${item.originalIndex})">
                <div class="shopping-checkbox">${item.checked ? '✓' : ''}</div>
                <span class="shopping-item-text">${escapeHtml(item.text)}</span>
                <button class="shopping-item-delete" onclick="event.stopPropagation(); deleteShoppingItem(${item.originalIndex})">🗑️</button>
            </div>
        `).join('');
        
        const hasChecked = shoppingList.some(i => i.checked);
        clearBtn.style.display = hasChecked ? 'block' : 'none';
    }
}

// ==========================================
// NØDKONTAKTER
// ==========================================
function showAddContactModal() {
    document.getElementById('contact-name').value = '';
    document.getElementById('contact-phone').value = '';
    document.getElementById('contact-relation').value = 'barnebarn';
    document.getElementById('modal-add-contact').style.display = 'flex';
}

async function saveContact() {
    const name = document.getElementById('contact-name').value.trim();
    const phone = document.getElementById('contact-phone').value.trim();
    const relation = document.getElementById('contact-relation').value;
    
    if (!name || !phone) {
        showConfirm('❌ Fyll inn navn og telefonnummer');
        return;
    }
    
    const ref = getUserRef();
    if (!ref) return;
    
    await ref.collection('emergencyContacts').add({
        name: name,
        phone: phone,
        relation: relation,
        created: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    await loadEmergencyContacts();
    closeModal('modal-add-contact');
    updateEmergencyView();
    showConfirm('👤 Kontakt lagret!');
}

async function deleteContact(contactId) {
    if (!confirm('Er du sikker på at du vil slette denne kontakten?')) return;
    
    const ref = getUserRef();
    if (!ref) return;
    
    await ref.collection('emergencyContacts').doc(contactId).delete();
    await loadEmergencyContacts();
    updateEmergencyView();
    showConfirm('🗑️ Kontakt slettet');
}

function updateEmergencyView() {
    const container = document.getElementById('emergency-contacts-list');
    
    if (emergencyContacts.length === 0) {
        container.innerHTML = '<p class="empty-state">Ingen kontakter lagt til ennå</p>';
    } else {
        const relationLabels = {
            'barnebarn': '👶 Barnebarn',
            'barn': '👨‍👧 Barn',
            'ektefelle': '💑 Ektefelle',
            'nabo': '🏠 Nabo',
            'venn': '👫 Venn',
            'lege': '👨‍⚕️ Lege',
            'hjemmesykepleier': '👩‍⚕️ Hjemmesykepleier',
            'annet': '👤 Annet'
        };
        
        container.innerHTML = emergencyContacts.map(c => `
            <div class="contact-card">
                <div class="contact-info">
                    <div class="contact-name">${escapeHtml(c.name)}</div>
                    <div class="contact-relation">${relationLabels[c.relation] || c.relation}</div>
                    <div class="contact-phone">📞 ${escapeHtml(c.phone)}</div>
                </div>
                <a href="tel:${c.phone}" class="btn btn-call-contact">📞</a>
                <button class="btn-delete-contact" onclick="deleteContact('${c.id}')">🗑️</button>
            </div>
        `).join('');
    }
}

// ==========================================
// DAGLIG INNSJEKK
// ==========================================
async function dailyCheckIn() {
    todayData.checkedIn = true;
    
    const ref = getUserRef();
    if (!ref) return;
    
    await ref.collection('checkins').doc(getTodayString()).set({
        time: getTimeString(),
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    document.getElementById('checkin-card').style.display = 'none';
    showConfirm('✅ Innsjekk registrert! Ha en fin dag!');
}

// ==========================================
// HISTORIKK
// ==========================================
function changeHistoryDate(offset) {
    historyDateOffset += offset;
    if (historyDateOffset > 0) historyDateOffset = 0;
    updateHistoryView();
}

async function updateHistoryView() {
    const date = new Date();
    date.setDate(date.getDate() + historyDateOffset);
    const dateStr = getDateString(date);
    
    // Oppdater datovisning
    let displayText;
    if (historyDateOffset === 0) displayText = 'I dag';
    else if (historyDateOffset === -1) displayText = 'I går';
    else displayText = formatFullDate(date);
    
    document.getElementById('history-date-display').textContent = displayText;
    
    const ref = getUserRef();
    if (!ref) {
        document.getElementById('history-content').innerHTML = '<p class="empty-state">Ikke tilkoblet</p>';
        return;
    }
    
    let html = '';
    
    // Vann
    const waterDoc = await ref.collection('waterLogs').doc(dateStr).get();
    if (waterDoc.exists) {
        const d = waterDoc.data();
        html += `
            <div class="history-card">
                <h3>💧 Vanninntak</h3>
                <div class="history-detail"><span>Antall glass:</span><strong>${d.count || 0}</strong></div>
                ${(d.logs || []).map((l, i) => `<div class="history-detail"><span>Glass #${i+1}:</span><span>${l.time}</span></div>`).join('')}
            </div>
        `;
    }
    
    // Toalett
    const bathroomDoc = await ref.collection('bathroomLogs').doc(dateStr).get();
    if (bathroomDoc.exists) {
        const d = bathroomDoc.data();
        html += `
            <div class="history-card">
                <h3>🚽 Toalettbesøk</h3>
                <div class="history-detail"><span>Antall besøk:</span><strong>${(d.logs || []).length}</strong></div>
                ${(d.logs || []).map((l, i) => `<div class="history-detail"><span>Besøk #${i+1}:</span><span>${l.time}${l.note ? ' – ' + escapeHtml(l.note) : ''}</span></div>`).join('')}
            </div>
        `;
    }
    
    // Medisin
    const medicineDoc = await ref.collection('medicineLogs').doc(dateStr).get();
    if (medicineDoc.exists) {
        const d = medicineDoc.data();
        html += `
            <div class="history-card">
                <h3>💊 Medisiner</h3>
                ${(d.taken || []).map(t => `<div class="history-detail"><span>${escapeHtml(t.name)}:</span><span>Tatt kl. ${t.takenTime}</span></div>`).join('')}
            </div>
        `;
    }
    
    // Helse
    const healthDoc = await ref.collection('healthLogs').doc(dateStr).get();
    if (healthDoc.exists) {
        const d = healthDoc.data();
        const moodLabels = {
            'veldig_bra': '😄 Veldig bra', 'bra': '🙂 Bra', 'ok': '😐 OK', 
            'darlig': '😟 Dårlig', 'veldig_darlig': '😢 Veldig dårlig'
        };
        html += `
            <div class="history-card">
                <h3>❤️ Helse</h3>
                ${d.mood ? `<div class="history-detail"><span>Humør:</span><span>${moodLabels[d.mood] || d.mood}</span></div>` : ''}
                ${d.pain !== null && d.pain !== undefined ? `<div class="history-detail"><span>Smerte:</span><span>${d.pain}/10</span></div>` : ''}
                ${d.bpSys ? `<div class="history-detail"><span>Blodtrykk:</span><span>${d.bpSys}/${d.bpDia}</span></div>` : ''}
                ${d.pulse ? `<div class="history-detail"><span>Puls:</span><span>${d.pulse} bpm</span></div>` : ''}
                ${d.weight ? `<div class="history-detail"><span>Vekt:</span><span>${d.weight} kg</span></div>` : ''}
                ${d.notes ? `<div class="history-detail"><span>Merknad:</span><span>${escapeHtml(d.notes)}</span></div>` : ''}
            </div>
        `;
    }
    
    // Søvn
    const sleepDoc = await ref.collection('sleepLogs').doc(dateStr).get();
    if (sleepDoc.exists) {
        const d = sleepDoc.data();
        const qualityLabels = {
            'veldig_bra': '😴💤 Veldig bra', 'bra': '😊 Bra', 'ok': '😐 OK', 'darlig': '😫 Dårlig'
        };
        html += `
            <div class="history-card">
                <h3>😴 Søvn</h3>
                <div class="history-detail"><span>Leggetid:</span><span>${d.bedtime || '?'}</span></div>
                <div class="history-detail"><span>Våknetid:</span><span>${d.waketime || '?'}</span></div>
                ${d.quality ? `<div class="history-detail"><span>Kvalitet:</span><span>${qualityLabels[d.quality] || d.quality}</span></div>` : ''}
            </div>
        `;
    }
    
    // Bevegelse
    const movementDoc = await ref.collection('movementLogs').doc(dateStr).get();
    if (movementDoc.exists) {
        const d = movementDoc.data();
        html += `
            <div class="history-card">
                <h3>🚶 Bevegelse</h3>
                ${(d.activities || []).map(a => `<div class="history-detail"><span>${escapeHtml(a.name)}:</span><span>${a.duration} min (kl. ${a.time})</span></div>`).join('')}
            </div>
        `;
    }
    
    // Dagbok
    const diaryDoc = await ref.collection('diaryLogs').doc(dateStr).get();
    if (diaryDoc.exists && diaryDoc.data().text) {
        html += `
            <div class="history-card">
                <h3>📝 Dagbok</h3>
                <div style="white-space:pre-wrap; padding:8px 0;">${escapeHtml(diaryDoc.data().text)}</div>
            </div>
        `;
    }
    
    // Innsjekk
    const checkinDoc = await ref.collection('checkins').doc(dateStr).get();
    if (checkinDoc.exists) {
        html += `
            <div class="history-card">
                <h3>✅ Daglig innsjekk</h3>
                <div class="history-detail"><span>Sjekket inn kl.:</span><span>${checkinDoc.data().time}</span></div>
            </div>
        `;
    }
    
    document.getElementById('history-content').innerHTML = 
        html || '<p class="empty-state">Ingen data registrert for denne dagen</p>';
}

// ==========================================
// INNSTILLINGER
// ==========================================
function updateSettingsView() {
    document.getElementById('settings-name').value = settings.name || '';
    document.getElementById('settings-water-goal').value = settings.waterGoal || 8;
    document.getElementById('settings-water-reminder').checked = settings.waterReminder;
    document.getElementById('settings-water-interval').value = settings.waterInterval || 60;
    document.getElementById('settings-medicine-reminder').checked = settings.medicineReminder;
    document.getElementById('settings-movement-reminder').checked = settings.movementReminder;
    document.getElementById('settings-movement-interval').value = settings.movementInterval || 120;
    document.getElementById('settings-checkin-reminder').checked = settings.checkinReminder;
    document.getElementById('settings-checkin-time').value = settings.checkinTime || '09:00';
    document.getElementById('settings-sound').checked = settings.soundEnabled !== false;
    document.getElementById('app-version').textContent = APP_VERSION;
    document.getElementById('settings-email').textContent = currentUser?.email || '';
    
    // Font size buttons
    document.querySelectorAll('.btn-font-size').forEach(btn => btn.classList.remove('active'));
    
    // Medisiner
    const medList = document.getElementById('settings-medicine-list');
    if (medicines.length === 0) {
        medList.innerHTML = '<p class="empty-state">Ingen medisiner lagt til</p>';
    } else {
        medList.innerHTML = medicines.map(med => `
            <div class="medicine-setting-item">
                <div class="medicine-setting-info">
                    <div class="medicine-setting-name">${escapeHtml(med.name)}</div>
                    <div class="medicine-setting-detail">${escapeHtml(med.dosage || '')} – ${(med.times || []).join(', ')}</div>
                </div>
                <button class="btn-delete-medicine" onclick="deleteMedicine('${med.id}')">🗑️</button>
            </div>
        `).join('');
    }
    
    // Oppdater push-varsler status
    updatePushStatus();
}

function updatePushStatus() {
    const container = document.getElementById('push-status');
    if (!container) return;
    
    let html = '';
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const isPWA = window.matchMedia('(display-mode: standalone)').matches || 
                  window.navigator.standalone === true;
    
    // Sjekk 1: Nettleser-støtte
    const hasNotificationAPI = 'Notification' in window;
    const hasServiceWorker = 'serviceWorker' in navigator;
    
    if (!hasNotificationAPI || !hasServiceWorker) {
        html += '<div class="push-status-item push-status-error">❌ Nettleseren din støtter ikke push-varsler</div>';
    } else {
        html += '<div class="push-status-item push-status-ok">✅ Nettleseren støtter varsler</div>';
    }
    
    // Sjekk 2: iOS-spesifikt
    if (isIOS) {
        if (isPWA) {
            html += '<div class="push-status-item push-status-ok">✅ Appen er installert på hjemskjermen</div>';
        } else {
            html += '<div class="push-status-item push-status-warning">⚠️ <strong>iPhone:</strong> For å motta varsler MÅ du legge appen til hjemskjermen. Trykk på <strong>Del-ikonet</strong> (firkant med pil opp) → <strong>"Legg til på Hjem-skjerm"</strong></div>';
        }
    }
    
    // Sjekk 3: Varslingstillatelse
    if (hasNotificationAPI) {
        if (Notification.permission === 'granted') {
            html += '<div class="push-status-item push-status-ok">✅ Varslinger er tillatt</div>';
        } else if (Notification.permission === 'denied') {
            html += '<div class="push-status-item push-status-error">❌ Varslinger er blokkert. Gå til telefonens innstillinger for å tillate varsler for denne appen.</div>';
        } else {
            html += '<div class="push-status-item push-status-warning">⚠️ Du har ikke gitt tillatelse til varsler ennå. Trykk "Test varslinger" under.</div>';
        }
    }
    
    // Sjekk 4: FCM Token
    if (fcmToken) {
        html += '<div class="push-status-item push-status-ok">✅ Push-varsler er aktivert og klar!</div>';
    } else if (VAPID_KEY === '__VAPID_KEY_HER__') {
        html += '<div class="push-status-item push-status-warning">⚠️ VAPID-nøkkel mangler (utvikler må konfigurere denne)</div>';
    } else {
        html += '<div class="push-status-item push-status-warning">⏳ Push-varsler er ikke koblet opp ennå</div>';
    }
    
    container.innerHTML = html;
}

async function testPushSetup() {
    // Be om tillatelse
    if ('Notification' in window && Notification.permission === 'default') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            showConfirm('❌ Du må tillate varsler for at påminnelser skal fungere');
            updatePushStatus();
            return;
        }
    }
    
    if ('Notification' in window && Notification.permission === 'granted') {
        // Prøv å registrere FCM
        await registerFCMToken();
        
        // Vis testnotifikasjon
        if (navigator.serviceWorker) {
            const reg = await navigator.serviceWorker.ready;
            await reg.showNotification('🔔 Test fra Daglig Helse', {
                body: 'Flott! Varslinger fungerer! Du vil nå motta påminnelser selv når appen er lukket.',
                icon: 'icons/icon-192.png',
                badge: 'icons/icon-192.png',
                vibrate: [200, 100, 200],
                tag: 'daglig-helse-test',
                requireInteraction: true
            });
            showConfirm('✅ Testvarsling sendt!');
        } else {
            new Notification('🔔 Test', { body: 'Varsler fungerer!' });
        }
    } else {
        showConfirm('❌ Varsler er blokkert av nettleseren');
    }
    
    updatePushStatus();
}

async function saveSettings() {
    settings.name = document.getElementById('settings-name').value.trim();
    settings.waterGoal = parseInt(document.getElementById('settings-water-goal').value) || 8;
    settings.waterReminder = document.getElementById('settings-water-reminder').checked;
    settings.waterInterval = parseInt(document.getElementById('settings-water-interval').value) || 60;
    settings.medicineReminder = document.getElementById('settings-medicine-reminder').checked;
    settings.movementReminder = document.getElementById('settings-movement-reminder').checked;
    settings.movementInterval = parseInt(document.getElementById('settings-movement-interval').value) || 120;
    settings.checkinReminder = document.getElementById('settings-checkin-reminder').checked;
    settings.checkinTime = document.getElementById('settings-checkin-time').value || '09:00';
    settings.soundEnabled = document.getElementById('settings-sound').checked;
    
    await saveSettingsToFirebase();
    
    // Synkroniser påminnelser til skyen (for push-varsler)
    await syncReminderSettingsToCloud();
    
    // Oppdater lokale påminnelser (backup)
    setupReminders();
    
    // Hvis påminnelser er aktivert, sørg for at vi har FCM-token
    if (settings.waterReminder || settings.medicineReminder || 
        settings.movementReminder || settings.checkinReminder) {
        await registerFCMToken();
    }
    
    // Oppdater greeting
    updateGreeting();
    
    showConfirm('⚙️ Innstillinger lagret!');
}

function setFontSize(size) {
    settings.fontSize = size;
    applyFontSize(size);
    
    // Oppdater knapper
    document.querySelectorAll('.btn-font-size').forEach(btn => btn.classList.remove('active'));
}

function applyFontSize(size) {
    document.body.classList.remove('font-large', 'font-xlarge');
    if (size === 'large') document.body.classList.add('font-large');
    else if (size === 'xlarge') document.body.classList.add('font-xlarge');
}

// ==========================================
// PUSH-VARSLER (FCM) – Fungerer selv når appen er lukket
// ==========================================

// VAPID-nøkkel fra Firebase Console → Prosjektinnstillinger → Cloud Messaging → Web Push-sertifikater
// Brukeren MÅ generere denne og erstatte verdien under.
// Se README for instruksjoner.
const VAPID_KEY = '__VAPID_KEY_HER__';

function initializeMessaging() {
    try {
        if (typeof firebase.messaging === 'function') {
            messaging = firebase.messaging();
            
            // Håndter varsler som mottas mens appen er ÅPEN (forgrunn)
            messaging.onMessage((payload) => {
                console.log('[FCM] Forgrunnmelding mottatt:', payload);
                const data = payload.data || {};
                const notification = payload.notification || {};
                const title = notification.title || data.title || 'Påminnelse';
                const body = notification.body || data.body || '';
                const type = data.type || 'general';
                
                // Vis in-app toast
                showReminderToast(
                    type === 'water' ? '💧' : type === 'medicine' ? '💊' : type === 'movement' ? '🚶' : '🔔',
                    body,
                    type
                );
                
                // Spill lyd
                if (settings.soundEnabled !== false) {
                    playReminderSound();
                }
            });
            
            console.log('[FCM] Messaging initialisert');
        } else {
            console.warn('[FCM] firebase.messaging() ikke tilgjengelig');
        }
    } catch (err) {
        console.warn('[FCM] Kunne ikke initialisere messaging:', err);
    }
}

async function requestNotificationPermission() {
    // Steg 1: Be om tillatelse
    if ('Notification' in window) {
        if (Notification.permission === 'default') {
            // Vent litt slik at bruker har sett appen først
            await new Promise(r => setTimeout(r, 2000));
            const permission = await Notification.requestPermission();
            console.log('[FCM] Varslingstillatelse:', permission);
            if (permission !== 'granted') {
                console.warn('[FCM] Bruker nektet varsler');
                return;
            }
        } else if (Notification.permission !== 'granted') {
            console.warn('[FCM] Varsler er blokkert av bruker');
            return;
        }
    }
    
    // Steg 2: Hent FCM-token
    await registerFCMToken();
}

async function registerFCMToken() {
    if (!messaging || !currentUser) return;
    
    // Sjekk at VAPID-nøkkel er satt
    if (!VAPID_KEY || VAPID_KEY === '__VAPID_KEY_HER__') {
        console.warn('[FCM] VAPID_KEY er ikke konfigurert! Push-varsler er deaktivert.');
        console.warn('[FCM] Gå til Firebase Console → Prosjektinnstillinger → Cloud Messaging → Web Push-sertifikater');
        return;
    }
    
    try {
        // Registrer FCM service worker
        const swRegistration = await navigator.serviceWorker.register('firebase-messaging-sw.js');
        
        // Hent token
        const token = await messaging.getToken({
            vapidKey: VAPID_KEY,
            serviceWorkerRegistration: swRegistration
        });
        
        if (token) {
            fcmToken = token;
            console.log('[FCM] Token hentet:', token.substring(0, 20) + '...');
            
            // Lagre token i Firestore slik at Cloud Functions kan sende varsler
            await saveFCMToken(token);
        } else {
            console.warn('[FCM] Ingen token mottatt. Sjekk varslingsinnstillinger.');
        }
    } catch (err) {
        console.error('[FCM] Feil ved henting av token:', err);
    }
}

async function saveFCMToken(token) {
    const ref = getUserRef();
    if (!ref) return;
    
    // Lagre token med enhetsinformasjon
    const deviceInfo = {
        token: token,
        platform: navigator.platform || 'unknown',
        userAgent: navigator.userAgent.substring(0, 100),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    await ref.collection('fcmTokens').doc(token.substring(0, 40)).set(deviceInfo);
    console.log('[FCM] Token lagret i Firestore');
}

// Synkroniser påminnelsesinnstillinger til Firestore
// slik at Cloud Functions vet NÅR det skal sendes varsler
async function syncReminderSettingsToCloud() {
    const ref = getUserRef();
    if (!ref) return;
    
    const now = new Date();
    const reminderConfig = {
        // Vannpåminnelser
        waterReminder: settings.waterReminder || false,
        waterInterval: settings.waterInterval || 60,
        waterGoal: settings.waterGoal || 8,
        
        // Medisinpåminnelser
        medicineReminder: settings.medicineReminder || false,
        medicines: medicines.filter(m => m.active !== false).map(m => ({
            id: m.id,
            name: m.name,
            dosage: m.dosage || '',
            times: m.times || []
        })),
        
        // Bevegelsespåminnelser
        movementReminder: settings.movementReminder || false,
        movementInterval: settings.movementInterval || 120,
        
        // Daglig innsjekk
        checkinReminder: settings.checkinReminder || false,
        checkinTime: settings.checkinTime || '09:00',
        
        // Status
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Oslo',
        activeHoursStart: 7,  // Ikke send varsler før kl. 07
        activeHoursEnd: 22,   // Ikke send varsler etter kl. 22
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    await ref.set({ reminderConfig: reminderConfig }, { merge: true });
    console.log('[FCM] Påminnelsesinnstillinger synkronisert til skyen');
}

// ==========================================
// LOKALE PÅMINNELSER (backup når appen er åpen)
// ==========================================
function requestNotificationPermissionLegacy() {
    // Kun brukt som fallback
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

function setupReminders() {
    stopAllReminders();
    
    // Vannpåminnelse
    if (settings.waterReminder) {
        const intervalMs = (settings.waterInterval || 60) * 60 * 1000;
        reminderTimers.water = setInterval(() => {
            checkWaterReminder();
        }, 60000); // Sjekk hvert minutt
        lastWaterReminder = Date.now();
    }
    
    // Medisinpåminnelse
    if (settings.medicineReminder) {
        reminderTimers.medicine = setInterval(() => {
            checkMedicineReminder();
        }, 60000);
    }
    
    // Bevegelsespåminnelse
    if (settings.movementReminder) {
        reminderTimers.movement = setInterval(() => {
            checkMovementReminder();
        }, 60000);
        lastMovementReminder = Date.now();
    }
    
    // Innsjekk-påminnelse
    if (settings.checkinReminder) {
        reminderTimers.checkin = setInterval(() => {
            checkCheckinReminder();
        }, 60000);
    }
}

function stopAllReminders() {
    Object.values(reminderTimers).forEach(timer => clearInterval(timer));
    reminderTimers = {};
}

function checkWaterReminder() {
    if (todayData.water.count >= settings.waterGoal) return;
    
    const now = Date.now();
    const intervalMs = (settings.waterInterval || 60) * 60 * 1000;
    
    if (now - lastWaterReminder >= intervalMs) {
        showReminderToast('💧', 'På tide å drikke et glass vann!', 'water');
        sendNotification('💧 Vannpåminnelse', 'Husk å drikke et glass vann!');
        lastWaterReminder = now;
    }
}

function checkMedicineReminder() {
    const currentTime = getTimeString();
    
    medicines.forEach(med => {
        if (med.active === false) return;
        (med.times || []).forEach(time => {
            // Sjekk om tiden er nå (innenfor 1 minutt)
            if (time === currentTime) {
                const alreadyTaken = todayData.medicineTaken.some(
                    t => t.medicineId === med.id && t.scheduledTime === time
                );
                if (!alreadyTaken) {
                    showReminderToast('💊', `Tid for ${med.name}! (${med.dosage || ''})`, 'medicine');
                    sendNotification('💊 Medisinpåminnelse', `Tid for ${med.name}!`);
                }
            }
        });
    });
}

function checkMovementReminder() {
    const now = Date.now();
    const intervalMs = (settings.movementInterval || 120) * 60 * 1000;
    
    if (now - lastMovementReminder >= intervalMs) {
        showReminderToast('🚶', 'Tid for litt bevegelse! Rør litt på deg.', 'movement');
        sendNotification('🚶 Bevegelsespåminnelse', 'Tid for å røre litt på deg!');
        lastMovementReminder = now;
    }
}

function checkCheckinReminder() {
    if (todayData.checkedIn) return;
    
    const currentTime = getTimeString();
    const checkinTime = settings.checkinTime || '09:00';
    
    if (currentTime === checkinTime) {
        showReminderToast('🌅', 'God morgen! Husk å sjekke inn.', 'checkin');
        sendNotification('🌅 God morgen!', 'Husk å gjøre din daglige innsjekk.');
    }
}

function showReminderToast(icon, text, type) {
    const toast = document.getElementById('reminder-toast');
    document.getElementById('toast-icon').textContent = icon;
    document.getElementById('toast-text').textContent = text;
    
    const actionBtn = document.getElementById('toast-action-btn');
    if (type === 'water') {
        actionBtn.style.display = 'inline-flex';
        actionBtn.textContent = '💧 Drikk nå';
        actionBtn.onclick = () => { quickAddWater(); dismissReminder(); };
    } else if (type === 'movement') {
        actionBtn.style.display = 'inline-flex';
        actionBtn.textContent = '🚶 Registrer';
        actionBtn.onclick = () => { showView('movement'); dismissReminder(); };
    } else {
        actionBtn.style.display = 'none';
    }
    
    toast.style.display = 'block';
    
    // Spill lyd
    if (settings.soundEnabled !== false) {
        playReminderSound();
    }
}

function dismissReminder() {
    document.getElementById('reminder-toast').style.display = 'none';
}

function handleReminderAction() {
    // Handled by dynamic onclick
}

function sendNotification(title, body) {
    // Lokalt varsel (vises kun når appen er åpen)
    if ('Notification' in window && Notification.permission === 'granted') {
        try {
            // Prøv service worker-basert notification (mer pålitelig)
            if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                navigator.serviceWorker.ready.then(reg => {
                    reg.showNotification(title, {
                        body: body,
                        icon: 'icons/icon-192.png',
                        badge: 'icons/icon-192.png',
                        tag: 'daglig-helse-local-' + Date.now(),
                        renotify: true,
                        vibrate: [200, 100, 200],
                        requireInteraction: true
                    });
                });
            } else {
                new Notification(title, {
                    body: body,
                    icon: 'icons/icon-192.png',
                    badge: 'icons/icon-192.png',
                    tag: 'daglig-helse-' + Date.now(),
                    renotify: true
                });
            }
        } catch (err) {
            console.log('Notification feilet:', err);
        }
    }
}

function playReminderSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        // Spill en vennlig "ping" lyd
        const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
        
        notes.forEach((freq, i) => {
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(freq, audioCtx.currentTime + i * 0.15);
            
            gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime + i * 0.15);
            gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + i * 0.15 + 0.5);
            
            oscillator.start(audioCtx.currentTime + i * 0.15);
            oscillator.stop(audioCtx.currentTime + i * 0.15 + 0.5);
        });
    } catch (err) {
        console.log('Lyd feilet:', err);
    }
}

// ==========================================
// MODALER & TOASTS
// ==========================================
function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

function showConfirm(text) {
    const toast = document.getElementById('confirm-toast');
    document.getElementById('confirm-text').textContent = text;
    toast.style.display = 'block';
    
    setTimeout(() => {
        toast.style.display = 'none';
    }, 2500);
}

// Lukk modal ved klikk utenfor
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.style.display = 'none';
    }
});

// ==========================================
// SERVICE WORKER
// ==========================================
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        // Registrer caching service worker
        navigator.serviceWorker.register('sw.js')
            .then(reg => {
                console.log('[SW] Cache-worker registrert:', reg.scope);
            })
            .catch(err => {
                console.log('[SW] Cache-worker registrering feilet:', err);
            });
        
        // FCM service worker registreres separat i registerFCMToken()
    }
}

// ==========================================
// HJELPEFUNKSJONER
// ==========================================
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Hindre at skjermen slukker (Wake Lock API)
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            await navigator.wakeLock.request('screen');
            console.log('Wake Lock aktivert');
        }
    } catch (err) {
        console.log('Wake Lock ikke tilgjengelig:', err);
    }
}

// Kall wake lock når siden er synlig
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        requestWakeLock();
        
        // Re-sjekk om det er en ny dag
        if (currentUser) {
            const storedDate = localStorage.getItem('dagligHelse_lastDate');
            const today = getTodayString();
            if (storedDate && storedDate !== today) {
                // Ny dag – last data på nytt
                loadTodayData().then(() => updateDashboard());
            }
            localStorage.setItem('dagligHelse_lastDate', today);
        }
    }
});

// Dato-sjekk initialiseres via loadAllData
