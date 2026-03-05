/* =========================================
    DAGLIG HELSE – App Logic
     Versjon 3.0.1
   For besteforeldre / eldre brukere
   ========================================= */

const APP_VERSION = '3.0.1';
const ADMIN_EMAILS = ['halvor.thorsenh@gmail.com'];
let isAdmin = false;

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
    activeStartTime: '07:00',
    activeEndTime: '22:00',
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
let lastReminderShown = {
    water: 0,
    medicine: 0,
    movement: 0,
    checkin: 0,
    general: 0
};

// Firebase Cloud Messaging
let messaging = null;
let fcmToken = null;
const FCM_TOKEN_STORAGE_KEY = 'dagligHelse_fcmToken';
const FCM_TOKEN_UPDATED_STORAGE_KEY = 'dagligHelse_fcmTokenUpdatedAt';

// ==========================================
// INITIALISERING
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

function initApp() {
    // Bruk sist kjente token ved oppstart for å unngå lokal + sky samtidig.
    const cachedToken = localStorage.getItem(FCM_TOKEN_STORAGE_KEY);
    if (cachedToken) {
        fcmToken = cachedToken;
    }

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
async function handleAuthStateChanged(user) {
    if (user) {
        const loadStart = Date.now();
        currentUser = user;
        const userEmail = (user.email || '').trim().toLowerCase();
        isAdmin = ADMIN_EMAILS.includes(userEmail);
        document.getElementById('login-view').style.display = 'none';
        document.getElementById('app-container').style.display = 'none';
        
        // Vis/skjul admin-knapp
        const adminBtn = document.getElementById('btn-admin');
        if (adminBtn) adminBtn.style.display = isAdmin ? 'block' : 'none';
        
        // Lagre innloggingsmetadata
        updateLastLogin(user);
        
        // Last brukerdata (vent til dette er ferdig)
        await loadAllData();

        // Sikre minst 2 sekunder loading for å unngå at gamle/null verdier blinker
        const elapsed = Date.now() - loadStart;
        if (elapsed < 2000) {
            await new Promise(resolve => setTimeout(resolve, 2000 - elapsed));
        }

        hideLoading();
        document.getElementById('app-container').style.display = 'block';
        
        // Start påminnelser
        setupReminders();
        
        // Be om varslingstillatelse
        requestNotificationPermission();
        
        // Oppdater header
        updateGreeting();
        
        showView('home');
    } else {
        hideLoading();
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
        case 'admin':
            updateAdminView();
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
            loadTodayData(),
            loadFriendsData()
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
    
    // Innsjekk – vis kun hvis påminnelse er aktivert og ikke sjekket inn i dag
    const checkinCard = document.getElementById('checkin-card');
    if (settings.checkinReminder && !todayData.checkedIn) {
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
        let nextWaterTime = new Date(lastWaterReminder + settings.waterInterval * 60000);
        // Hopp til neste aktive vindu hvis tidspunktet faller utenfor
        const startMin = timeToMinutesLocal(settings.activeStartTime || '07:00');
        const endMin = timeToMinutesLocal(settings.activeEndTime || '22:00');
        const nextMin = nextWaterTime.getHours() * 60 + nextWaterTime.getMinutes();
        if (startMin < endMin && (nextMin < startMin || nextMin >= endMin)) {
            // Sett til neste dag kl. start
            const tomorrow = new Date(nextWaterTime);
            if (nextMin >= endMin) tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
            nextWaterTime = tomorrow;
        }
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

    await saveMedicineTakenLog();
    
    updateMedicineView();
    updateDashboard();
    showConfirm(`✅ ${medicine.name} registrert som tatt!`);
}

async function saveMedicineTakenLog() {
    const ref = getUserRef();
    if (!ref) return;
    
    await ref.collection('medicineLogs').doc(getTodayString()).set({
        taken: todayData.medicineTaken,
        updated: firebase.firestore.FieldValue.serverTimestamp()
    });
}

async function takeAllMedicinesAtTime(scheduledTime) {
    const pendingMeds = medicines
        .filter(med => med.active !== false && (med.times || []).includes(scheduledTime))
        .filter(med => !todayData.medicineTaken.some(
            t => t.medicineId === med.id && t.scheduledTime === scheduledTime
        ));

    if (pendingMeds.length === 0) {
        showConfirm(`ℹ️ Alle doser for kl. ${scheduledTime} er allerede registrert`);
        return;
    }

    const takenTime = getTimeString();
    pendingMeds.forEach(med => {
        todayData.medicineTaken.push({
            medicineId: med.id,
            name: med.name,
            dosage: med.dosage,
            scheduledTime: scheduledTime,
            takenTime: takenTime
        });
    });

    await saveMedicineTakenLog();
    updateMedicineView();
    updateDashboard();
    showConfirm(`✅ Registrerte ${pendingMeds.length} medisiner for kl. ${scheduledTime}`);
}

function updateMedicineView() {
    const todayList = document.getElementById('medicine-today-list');
    const takenList = document.getElementById('medicine-taken-list');
    const batchActions = document.getElementById('medicine-batch-actions');

    const activeMeds = medicines.filter(med => med.active !== false);
    const uniqueTimes = [...new Set(activeMeds.flatMap(med => med.times || []))].sort();
    if (batchActions) {
        const batchButtons = uniqueTimes.map(time => {
            const pendingCount = activeMeds.filter(med =>
                (med.times || []).includes(time) &&
                !todayData.medicineTaken.some(t => t.medicineId === med.id && t.scheduledTime === time)
            ).length;

            if (pendingCount === 0) {
                return `<button class="btn btn-batch-medicine" disabled>✅ Kl. ${time} tatt</button>`;
            }

            return `
                <button class="btn btn-batch-medicine" onclick="takeAllMedicinesAtTime('${time}')">
                    💊 Ta alle kl. ${time} (${pendingCount})
                </button>
            `;
        });

        batchActions.innerHTML = batchButtons.length > 0
            ? batchButtons.join('')
            : '<p class="empty-state">Ingen klokkeslett satt ennå</p>';
    }
    
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

function dismissCheckIn() {
    document.getElementById('checkin-card').style.display = 'none';
}

// ==========================================
// ADMIN – Brukeradministrasjon
// ==========================================
async function updateLastLogin(user) {
    if (!db || !user) return;
    try {
        await db.collection('users').doc(user.uid).set({
            _meta: {
                email: user.email,
                displayName: user.displayName || '',
                photoURL: user.photoURL || '',
                lastLogin: firebase.firestore.FieldValue.serverTimestamp(),
                lastLoginDevice: navigator.userAgent.substring(0, 150)
            }
        }, { merge: true });
    } catch (err) {
        console.warn('Kunne ikke oppdatere innloggingsmetadata:', err);
    }
}

async function updateAdminView() {
    if (!isAdmin) {
        showConfirm('❌ Ingen tilgang');
        showView('home');
        return;
    }
    
    const container = document.getElementById('admin-users-list');
    if (!container) return;
    container.innerHTML = '<p>Laster brukere...</p>';
    
    try {
        const usersSnapshot = await db.collection('users').get();
        
        if (usersSnapshot.empty) {
            container.innerHTML = '<p class="empty-state">Ingen brukere funnet</p>';
            return;
        }
        
        const users = [];
        usersSnapshot.forEach(doc => {
            const data = doc.data();
            users.push({
                uid: doc.id,
                email: data._meta?.email || 'Ukjent',
                displayName: data._meta?.displayName || 'Ukjent navn',
                photoURL: data._meta?.photoURL || '',
                lastLogin: data._meta?.lastLogin,
                lastLoginDevice: data._meta?.lastLoginDevice || '',
                settings: data.settings || {},
                reminderConfig: data.reminderConfig || {}
            });
        });
        
        // Sorter: seneste innlogging først
        users.sort((a, b) => {
            const aTime = a.lastLogin?.toDate?.() || new Date(0);
            const bTime = b.lastLogin?.toDate?.() || new Date(0);
            return bTime - aTime;
        });
        
        container.innerHTML = users.map(u => {
            const lastLoginStr = u.lastLogin?.toDate?.() 
                ? formatRelativeTime(u.lastLogin.toDate()) 
                : 'Aldri';
            const lastLoginFull = u.lastLogin?.toDate?.() 
                ? u.lastLogin.toDate().toLocaleString('no-NO') 
                : '';
            const deviceStr = u.lastLoginDevice 
                ? (u.lastLoginDevice.includes('iPhone') ? '📱 iPhone' 
                   : u.lastLoginDevice.includes('Android') ? '📱 Android' 
                   : '💻 PC/Nettbrett')
                : '';
            const name = u.settings?.name || u.displayName;
            const isCurrentUser = u.uid === currentUser?.uid;
            
            const remindersActive = [
                u.reminderConfig?.waterReminder ? '💧' : '',
                u.reminderConfig?.medicineReminder ? '💊' : '',
                u.reminderConfig?.movementReminder ? '🚶' : '',
                u.reminderConfig?.checkinReminder ? '🌅' : ''
            ].filter(Boolean).join(' ') || 'Ingen';
            
            return `
                <div class="admin-user-card ${isCurrentUser ? 'admin-user-you' : ''}">
                    <div class="admin-user-header">
                        <div class="admin-user-avatar">
                            ${u.photoURL ? `<img src="${escapeHtml(u.photoURL)}" alt="" class="admin-avatar-img">` : '👤'}
                        </div>
                        <div class="admin-user-info">
                            <div class="admin-user-name">${escapeHtml(name)}${isCurrentUser ? ' (deg)' : ''}</div>
                            <div class="admin-user-email">${escapeHtml(u.email)}</div>
                        </div>
                    </div>
                    <div class="admin-user-details">
                        <div class="admin-detail-row">
                            <span>🕐 Sist pålogget:</span>
                            <span title="${escapeHtml(lastLoginFull)}">${lastLoginStr}</span>
                        </div>
                        <div class="admin-detail-row">
                            <span>📱 Enhet:</span>
                            <span>${deviceStr}</span>
                        </div>
                        <div class="admin-detail-row">
                            <span>🔔 Aktive varsler:</span>
                            <span>${remindersActive}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        document.getElementById('admin-user-count').textContent = `${users.length} brukere registrert`;
        
    } catch (err) {
        console.error('Admin: Feil ved lasting av brukere:', err);
        container.innerHTML = '<p class="empty-state">❌ Kunne ikke laste brukere. Sjekk Firestore-regler.</p>';
    }
}

function formatRelativeTime(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMin < 1) return 'Akkurat nå';
    if (diffMin < 60) return `${diffMin} min siden`;
    if (diffHours < 24) return `${diffHours} timer siden`;
    if (diffDays === 1) return 'I går';
    if (diffDays < 7) return `${diffDays} dager siden`;
    return date.toLocaleDateString('no-NO');
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
    document.getElementById('settings-active-start').value = settings.activeStartTime || '07:00';
    document.getElementById('settings-active-end').value = settings.activeEndTime || '22:00';
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
            html += '<div class="push-status-item push-status-warning">⚠️ <strong>iPhone:</strong> Push-varsler virker kun når appen er lagt på hjemskjermen. Slik gjør du det: 1) Trykk <strong>Del</strong> i Safari, 2) Velg <strong>Legg til på Hjem-skjerm</strong>, 3) Åpne app-ikonet fra hjemskjermen.</div>';
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
    settings.waterInterval = Math.max(1, parseInt(document.getElementById('settings-water-interval').value) || 60);
    settings.medicineReminder = document.getElementById('settings-medicine-reminder').checked;
    settings.movementReminder = document.getElementById('settings-movement-reminder').checked;
    settings.movementInterval = parseInt(document.getElementById('settings-movement-interval').value) || 120;
    settings.checkinReminder = document.getElementById('settings-checkin-reminder').checked;
    settings.checkinTime = document.getElementById('settings-checkin-time').value || '09:00';
    settings.activeStartTime = document.getElementById('settings-active-start').value || '07:00';
    settings.activeEndTime = document.getElementById('settings-active-end').value || '22:00';
    settings.soundEnabled = document.getElementById('settings-sound').checked;
    
    await saveSettingsToFirebase();
    
    // Synkroniser påminnelser til skyen (for push-varsler)
    await syncReminderSettingsToCloud();
    
    // Oppdater lokale påminnelser (backup)
    setupReminders();
    
    // Hvis påminnelser er aktivert, sørg for at vi har FCM-token
    if (settings.waterReminder || settings.medicineReminder || 
        settings.movementReminder || settings.checkinReminder) {
        if ('Notification' in window && Notification.permission === 'default') {
            const permission = await Notification.requestPermission();
            console.log('[FCM] Varslingstillatelse (fra innstillinger):', permission);
        }
        await registerFCMToken();
        updatePushStatus();
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
const VAPID_KEY = 'BMdx0GGDk_mPsEJuOlYAoM6vJy7a4LlYg2fOZA5CGxEca1dt8n05xDzxo2k43XXpvCIavM4uHx9AlpoFbQAOBOA';

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

                if (shouldSuppressDuplicateReminder(type)) {
                    console.log('[FCM] Hopper over duplikat-varsling i forgrunn:', type);
                    return;
                }
                
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
        const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
        if (Notification.permission === 'default') {
            if (isIOS) {
                console.log('[FCM] iOS: Tillatelse må gis via brukerhandling (f.eks. "Lagre innstillinger" eller "Test varslinger").');
                return;
            }
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

    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

    if (isIOS && !isStandalone) {
        console.warn('[FCM] iOS krever at appen er installert på hjemskjermen før push-varsler kan aktiveres.');
        return;
    }
    
    // Sjekk at VAPID-nøkkel er satt
    if (!VAPID_KEY || VAPID_KEY === '__VAPID_KEY_HER__') {
        console.warn('[FCM] VAPID_KEY er ikke konfigurert! Push-varsler er deaktivert.');
        console.warn('[FCM] Gå til Firebase Console → Prosjektinnstillinger → Cloud Messaging → Web Push-sertifikater');
        return;
    }
    
    try {
        // Registrer FCM service worker
        const swRegistration = await navigator.serviceWorker.register('firebase-messaging-sw.js?v=3.0.1', {
            scope: './firebase-cloud-messaging-push-scope',
            updateViaCache: 'none'
        });
        await swRegistration.update();
        
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
    
    const tokenId = token.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
    await ref.collection('fcmTokens').doc(tokenId).set(deviceInfo);
    localStorage.setItem(FCM_TOKEN_STORAGE_KEY, token);
    localStorage.setItem(FCM_TOKEN_UPDATED_STORAGE_KEY, String(Date.now()));
    console.log('[FCM] Token lagret i Firestore');
}

// Synkroniser påminnelsesinnstillinger til Firestore
// slik at Cloud Functions vet NÅR det skal sendes varsler
async function syncReminderSettingsToCloud() {
    const ref = getUserRef();
    if (!ref) return;
    
    const activeStartTime = settings.activeStartTime || '07:00';
    const activeEndTime = settings.activeEndTime || '22:00';
    const activeHoursStart = parseInt(activeStartTime.split(':')[0], 10);
    const activeHoursEnd = parseInt(activeEndTime.split(':')[0], 10);
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
        activeStartTime: activeStartTime,
        activeEndTime: activeEndTime,
        activeHoursStart: Number.isNaN(activeHoursStart) ? 7 : activeHoursStart,
        activeHoursEnd: Number.isNaN(activeHoursEnd) ? 22 : activeHoursEnd,
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

function timeToMinutesLocal(timeStr) {
    if (!timeStr || !timeStr.includes(':')) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return (h * 60) + m;
}

function isWithinActiveReminderWindow() {
    const start = settings.activeStartTime || '07:00';
    const end = settings.activeEndTime || '22:00';
    const now = new Date();
    const nowMinutes = (now.getHours() * 60) + now.getMinutes();
    const startMinutes = timeToMinutesLocal(start);
    const endMinutes = timeToMinutesLocal(end);

    if (startMinutes === endMinutes) return true;
    if (startMinutes < endMinutes) {
        return nowMinutes >= startMinutes && nowMinutes < endMinutes;
    }
    return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

function shouldSuppressDuplicateReminder(type, windowMs = 90000) {
    const key = type || 'general';
    const now = Date.now();
    const last = lastReminderShown[key] || 0;
    if ((now - last) < windowMs) return true;
    lastReminderShown[key] = now;
    return false;
}

function shouldUseLocalNotificationFallback() {
    const hasGrantedPermission = typeof Notification !== 'undefined' && Notification.permission === 'granted';
    const lastTokenUpdatedAt = Number(localStorage.getItem(FCM_TOKEN_UPDATED_STORAGE_KEY) || 0);
    const hasRecentCachedFcm = (Date.now() - lastTokenUpdatedAt) < (48 * 60 * 60 * 1000);

    // Når FCM er aktivt (eller nylig bekreftet), lar vi sky-varsler være primær kanal.
    if (hasGrantedPermission && (fcmToken || hasRecentCachedFcm)) {
        return false;
    }

    return true;
}

function checkWaterReminder() {
    if (!isWithinActiveReminderWindow()) return;
    if (todayData.water.count >= settings.waterGoal) return;
    
    const now = Date.now();
    const intervalMs = (settings.waterInterval || 60) * 60 * 1000;
    
    if (now - lastWaterReminder >= intervalMs) {
        if (shouldSuppressDuplicateReminder('water')) return;
        showReminderToast('💧', 'På tide å drikke et glass vann!', 'water');
        if (shouldUseLocalNotificationFallback()) {
            sendNotification('💧 Vannpåminnelse', 'Husk å drikke et glass vann!', 'water');
        }
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
                    if (shouldSuppressDuplicateReminder('medicine')) return;
                    showReminderToast('💊', `Tid for ${med.name}! (${med.dosage || ''})`, 'medicine');
                    if (shouldUseLocalNotificationFallback()) {
                        sendNotification('💊 Medisinpåminnelse', `Tid for ${med.name}!`, 'medicine');
                    }
                }
            }
        });
    });
}

function checkMovementReminder() {
    if (!isWithinActiveReminderWindow()) return;
    const now = Date.now();
    const intervalMs = (settings.movementInterval || 120) * 60 * 1000;
    
    if (now - lastMovementReminder >= intervalMs) {
        if (shouldSuppressDuplicateReminder('movement')) return;
        showReminderToast('🚶', 'Tid for litt bevegelse! Rør litt på deg.', 'movement');
        if (shouldUseLocalNotificationFallback()) {
            sendNotification('🚶 Bevegelsespåminnelse', 'Tid for å røre litt på deg!', 'movement');
        }
        lastMovementReminder = now;
    }
}

function checkCheckinReminder() {
    if (!isWithinActiveReminderWindow()) return;
    if (todayData.checkedIn) return;
    
    const currentTime = getTimeString();
    const checkinTime = settings.checkinTime || '09:00';
    
    if (currentTime === checkinTime) {
        if (shouldSuppressDuplicateReminder('checkin')) return;
        showReminderToast('🌅', 'God morgen! Husk å sjekke inn.', 'checkin');
        if (shouldUseLocalNotificationFallback()) {
            sendNotification('🌅 God morgen!', 'Husk å gjøre din daglige innsjekk.', 'checkin');
        }
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

function sendNotification(title, body, type = 'general') {
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
                        tag: `daglig-helse-local-${type}`,
                        renotify: false,
                        vibrate: [200, 100, 200],
                        requireInteraction: true
                    });
                });
            } else {
                new Notification(title, {
                    body: body,
                    icon: 'icons/icon-192.png',
                    badge: 'icons/icon-192.png',
                    tag: `daglig-helse-${type}`,
                    renotify: false
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
// VENNER
// ==========================================
let friendsList = [];
let friendRequests = [];
let sentRequests = [];
let currentFriendDashboardUid = null;
let editingPermissionsFriendUid = null;

// --- Send venneforespørsel ---
async function sendFriendRequest() {
    const emailInput = document.getElementById('friend-email-input');
    const email = (emailInput.value || '').trim().toLowerCase();
    
    if (!email || !email.includes('@')) {
        showConfirm('❌ Skriv inn en gyldig e-postadresse');
        return;
    }
    
    if (email === (currentUser.email || '').toLowerCase()) {
        showConfirm('❌ Du kan ikke sende forespørsel til deg selv');
        return;
    }
    
    // Sjekk om allerede venn
    const existingFriend = friendsList.find(f => f.friendEmail === email);
    if (existingFriend) {
        showConfirm('ℹ️ Dere er allerede venner!');
        return;
    }
    
    // Sjekk om forespørsel allerede finnes
    const existing = await db.collection('friendRequests')
        .where('fromUid', '==', currentUser.uid)
        .where('toEmail', '==', email)
        .where('status', '==', 'pending')
        .get();
    
    if (!existing.empty) {
        showConfirm('ℹ️ Du har allerede sendt en forespørsel til denne personen');
        return;
    }
    
    await db.collection('friendRequests').add({
        fromUid: currentUser.uid,
        fromEmail: currentUser.email,
        fromName: settings.name || currentUser.displayName || currentUser.email,
        toEmail: email,
        status: 'pending',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    emailInput.value = '';
    showConfirm('✅ Venneforespørsel sendt!');
    loadFriendsData();
}

// --- Last all vennedata ---
async function loadFriendsData() {
    if (!currentUser || !db) return;
    
    await Promise.all([
        loadFriendsList(),
        loadFriendRequests(),
        loadSentRequests()
    ]);
    
    if (currentView === 'friends') {
        renderFriendsView();
    }
}

async function loadFriendsList() {
    const ref = getUserRef();
    if (!ref) return;
    
    const snapshot = await ref.collection('friends').get();
    friendsList = [];
    snapshot.forEach(doc => {
        friendsList.push({ friendUid: doc.id, ...doc.data() });
    });
}

async function loadFriendRequests() {
    if (!currentUser) return;
    
    const snapshot = await db.collection('friendRequests')
        .where('toEmail', '==', currentUser.email.toLowerCase())
        .where('status', '==', 'pending')
        .get();
    
    friendRequests = [];
    snapshot.forEach(doc => {
        friendRequests.push({ id: doc.id, ...doc.data() });
    });
}

async function loadSentRequests() {
    if (!currentUser) return;
    
    const snapshot = await db.collection('friendRequests')
        .where('fromUid', '==', currentUser.uid)
        .where('status', '==', 'pending')
        .get();
    
    sentRequests = [];
    snapshot.forEach(doc => {
        sentRequests.push({ id: doc.id, ...doc.data() });
    });
}

// --- Aksepter venneforespørsel ---
async function acceptFriendRequest(requestId) {
    const request = friendRequests.find(r => r.id === requestId);
    if (!request) return;
    
    // Oppdater forespørsel-status
    await db.collection('friendRequests').doc(requestId).update({
        status: 'accepted',
        acceptedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    const myName = settings.name || currentUser.displayName || currentUser.email;
    
    // Legg til venn hos meg (med standard tillatelser: alt av)
    const defaultPermissions = {
        water: false, medicine: false, bathroom: false, health: false,
        sleep: false, movement: false, diary: false, checkin: false,
        sendReminder: false
    };
    
    await getUserRef().collection('friends').doc(request.fromUid).set({
        friendEmail: request.fromEmail,
        friendName: request.fromName || request.fromEmail,
        permissions: defaultPermissions,
        addedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    // Legg til meg hos avsenderen
    await db.collection('users').doc(request.fromUid).collection('friends').doc(currentUser.uid).set({
        friendEmail: currentUser.email,
        friendName: myName,
        permissions: defaultPermissions,
        addedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    showConfirm('✅ Dere er nå venner!');
    loadFriendsData();
}

// --- Avslå venneforespørsel ---
async function rejectFriendRequest(requestId) {
    await db.collection('friendRequests').doc(requestId).update({
        status: 'rejected'
    });
    showConfirm('Forespørsel avslått');
    loadFriendsData();
}

// --- Kanseller sendt forespørsel ---
async function cancelFriendRequest(requestId) {
    await db.collection('friendRequests').doc(requestId).delete();
    showConfirm('Forespørsel trukket tilbake');
    loadFriendsData();
}

// --- Fjern venn ---
async function removeFriend(friendUid) {
    if (!confirm('Er du sikker på at du vil fjerne denne vennen?')) return;
    
    await getUserRef().collection('friends').doc(friendUid).delete();
    
    // Fjern meg fra vennens liste også
    try {
        await db.collection('users').doc(friendUid).collection('friends').doc(currentUser.uid).delete();
    } catch (e) {
        console.warn('Kunne ikke fjerne fra vennens liste:', e);
    }
    
    showConfirm('Venn fjernet');
    loadFriendsData();
}

// --- Render venner-view ---
function renderFriendsView() {
    // Innkommende forespørsler
    const requestsContainer = document.getElementById('friend-requests-list');
    if (friendRequests.length === 0) {
        requestsContainer.innerHTML = '<p class="empty-state">Ingen ventende forespørsler</p>';
    } else {
        requestsContainer.innerHTML = friendRequests.map(r => `
            <div class="friend-request-card">
                <div class="friend-request-info">
                    <div class="friend-request-name">${escapeHtml(r.fromName || r.fromEmail)}</div>
                    <div class="friend-request-email">${escapeHtml(r.fromEmail)}</div>
                </div>
                <div class="friend-request-actions">
                    <button class="btn btn-accept-friend" onclick="acceptFriendRequest('${r.id}')">✅ Godta</button>
                    <button class="btn btn-reject-friend" onclick="rejectFriendRequest('${r.id}')">❌ Avslå</button>
                </div>
            </div>
        `).join('');
    }
    
    // Mine venner
    const friendsContainer = document.getElementById('friends-list');
    if (friendsList.length === 0) {
        friendsContainer.innerHTML = '<p class="empty-state">Du har ingen venner ennå. Send en venneforespørsel over!</p>';
    } else {
        friendsContainer.innerHTML = friendsList.map(f => `
            <div class="friend-card">
                <div class="friend-card-info" onclick="openFriendDashboard('${f.friendUid}')">
                    <div class="friend-card-name">${escapeHtml(f.friendName || f.friendEmail)}</div>
                    <div class="friend-card-email">${escapeHtml(f.friendEmail)}</div>
                </div>
                <div class="friend-card-actions">
                    <button class="btn btn-small" onclick="openPermissionsModal('${f.friendUid}')" title="Tillatelser">🔒</button>
                    <button class="btn btn-small btn-danger-small" onclick="removeFriend('${f.friendUid}')" title="Fjern venn">🗑️</button>
                </div>
            </div>
        `).join('');
    }
    
    // Sendte forespørsler
    const sentContainer = document.getElementById('sent-requests-list');
    if (sentRequests.length === 0) {
        sentContainer.innerHTML = '<p class="empty-state">Ingen sendte forespørsler</p>';
    } else {
        sentContainer.innerHTML = sentRequests.map(r => `
            <div class="friend-request-card">
                <div class="friend-request-info">
                    <div class="friend-request-name">Til: ${escapeHtml(r.toEmail)}</div>
                    <div class="friend-request-email">Venter på svar...</div>
                </div>
                <div class="friend-request-actions">
                    <button class="btn btn-small btn-danger-small" onclick="cancelFriendRequest('${r.id}')">❌ Avbryt</button>
                </div>
            </div>
        `).join('');
    }
}

// --- Tillatelser-modal ---
function openPermissionsModal(friendUid) {
    editingPermissionsFriendUid = friendUid;
    const friend = friendsList.find(f => f.friendUid === friendUid);
    if (!friend) return;
    
    document.getElementById('perm-friend-name').textContent = friend.friendName || friend.friendEmail;
    
    const perms = friend.permissions || {};
    document.getElementById('perm-water').checked = !!perms.water;
    document.getElementById('perm-medicine').checked = !!perms.medicine;
    document.getElementById('perm-bathroom').checked = !!perms.bathroom;
    document.getElementById('perm-health').checked = !!perms.health;
    document.getElementById('perm-sleep').checked = !!perms.sleep;
    document.getElementById('perm-movement').checked = !!perms.movement;
    document.getElementById('perm-diary').checked = !!perms.diary;
    document.getElementById('perm-checkin').checked = !!perms.checkin;
    document.getElementById('perm-sendReminder').checked = !!perms.sendReminder;
    
    document.getElementById('modal-friend-permissions').style.display = 'flex';
}

async function saveFriendPermissions() {
    if (!editingPermissionsFriendUid) return;
    
    const permissions = {
        water: document.getElementById('perm-water').checked,
        medicine: document.getElementById('perm-medicine').checked,
        bathroom: document.getElementById('perm-bathroom').checked,
        health: document.getElementById('perm-health').checked,
        sleep: document.getElementById('perm-sleep').checked,
        movement: document.getElementById('perm-movement').checked,
        diary: document.getElementById('perm-diary').checked,
        checkin: document.getElementById('perm-checkin').checked,
        sendReminder: document.getElementById('perm-sendReminder').checked
    };
    
    await getUserRef().collection('friends').doc(editingPermissionsFriendUid).update({
        permissions: permissions
    });
    
    // Oppdater lokal liste
    const friend = friendsList.find(f => f.friendUid === editingPermissionsFriendUid);
    if (friend) friend.permissions = permissions;
    
    closeModal('modal-friend-permissions');
    showConfirm('✅ Tillatelser lagret!');
    renderFriendsView();
}

// --- Vennens dashboard ---
async function openFriendDashboard(friendUid) {
    currentFriendDashboardUid = friendUid;
    const friend = friendsList.find(f => f.friendUid === friendUid);
    if (!friend) return;
    
    document.getElementById('friend-dashboard-title').textContent = `👤 ${friend.friendName || friend.friendEmail}`;
    document.getElementById('friend-dashboard-content').innerHTML = '<p class="empty-state">Laster data...</p>';
    
    showView('friend-dashboard');
    
    // Hent hva vennen har gitt OSS tillatelse til å se
    let theirPermissions = {};
    try {
        const theirFriendDoc = await db.collection('users').doc(friendUid)
            .collection('friends').doc(currentUser.uid).get();
        if (theirFriendDoc.exists) {
            theirPermissions = theirFriendDoc.data().permissions || {};
        }
    } catch (e) {
        console.warn('Kunne ikke lese vennens tillatelser:', e);
    }
    
    const today = getTodayString();
    let html = '';
    
    // Sjekk om vennen har gitt oss noen tillatelser
    const hasAnyPermission = Object.values(theirPermissions).some(v => v === true);
    
    if (!hasAnyPermission) {
        html = '<div class="friend-no-access"><p>🔒 Denne vennen har ikke delt noen data med deg ennå.</p></div>';
    } else {
        const friendRef = db.collection('users').doc(friendUid);
        
        // Vanninntak
        if (theirPermissions.water) {
            try {
                const waterDoc = await friendRef.collection('waterLogs').doc(today).get();
                const waterCount = waterDoc.exists ? (waterDoc.data().count || 0) : 0;
                const friendSettings = (await friendRef.get()).data()?.settings || {};
                const waterGoal = friendSettings.waterGoal || 8;
                const pct = Math.min(100, Math.round((waterCount / waterGoal) * 100));
                html += `
                    <div class="friend-data-card">
                        <h3>💧 Vanninntak</h3>
                        <div class="friend-data-value">${waterCount} av ${waterGoal} glass</div>
                        <div class="progress-bar-large"><div class="progress-fill" style="width:${pct}%"></div></div>
                    </div>`;
            } catch (e) { console.warn('Ingen tilgang til vanndata:', e); }
        }
        
        // Medisin
        if (theirPermissions.medicine) {
            try {
                const medLogDoc = await friendRef.collection('medicineLogs').doc(today).get();
                const taken = medLogDoc.exists ? (medLogDoc.data().taken || []) : [];
                const medSnap = await friendRef.collection('medicines').get();
                let totalMeds = 0;
                let totalDoses = 0;
                medSnap.forEach(doc => {
                    const m = doc.data();
                    if (m.active !== false) totalDoses += (m.times || []).length;
                    totalMeds++;
                });
                html += `
                    <div class="friend-data-card">
                        <h3>💊 Medisin</h3>
                        <div class="friend-data-value">${taken.length} av ${totalDoses} doser tatt i dag</div>
                    </div>`;
            } catch (e) { console.warn('Ingen tilgang til medisindata:', e); }
        }
        
        // Toalettlogg
        if (theirPermissions.bathroom) {
            try {
                const bathDoc = await friendRef.collection('bathroomLogs').doc(today).get();
                const logs = bathDoc.exists ? (bathDoc.data().logs || []) : [];
                const lastTime = logs.length > 0 ? logs[logs.length - 1].time : 'Ingen i dag';
                html += `
                    <div class="friend-data-card">
                        <h3>🚽 Toalettlogg</h3>
                        <div class="friend-data-value">${logs.length} besøk i dag</div>
                        <div class="friend-data-detail">Siste: ${lastTime}</div>
                    </div>`;
            } catch (e) { console.warn('Ingen tilgang til toalettdata:', e); }
        }
        
        // Helse
        if (theirPermissions.health) {
            try {
                const healthDoc = await friendRef.collection('healthLogs').doc(today).get();
                if (healthDoc.exists) {
                    const d = healthDoc.data();
                    const moodLabels = { 'veldig_bra': '😄 Veldig bra', 'bra': '🙂 Bra', 'ok': '😐 OK', 'darlig': '😟 Dårlig', 'veldig_darlig': '😢 Veldig dårlig' };
                    html += `
                        <div class="friend-data-card">
                            <h3>❤️ Helse</h3>
                            ${d.mood ? `<div class="friend-data-detail">Humør: ${moodLabels[d.mood] || d.mood}</div>` : ''}
                            ${d.pain != null ? `<div class="friend-data-detail">Smerte: ${d.pain}/10</div>` : ''}
                            ${d.bpSys ? `<div class="friend-data-detail">Blodtrykk: ${d.bpSys}/${d.bpDia}</div>` : ''}
                            ${d.pulse ? `<div class="friend-data-detail">Puls: ${d.pulse} bpm</div>` : ''}
                        </div>`;
                } else {
                    html += '<div class="friend-data-card"><h3>❤️ Helse</h3><div class="friend-data-detail">Ikke registrert i dag</div></div>';
                }
            } catch (e) { console.warn('Ingen tilgang til helsedata:', e); }
        }
        
        // Søvn
        if (theirPermissions.sleep) {
            try {
                const sleepDoc = await friendRef.collection('sleepLogs').doc(today).get();
                if (sleepDoc.exists) {
                    const d = sleepDoc.data();
                    html += `
                        <div class="friend-data-card">
                            <h3>😴 Søvn</h3>
                            <div class="friend-data-detail">Leggetid: ${d.bedtime || '?'} → Våknetid: ${d.waketime || '?'}</div>
                        </div>`;
                } else {
                    html += '<div class="friend-data-card"><h3>😴 Søvn</h3><div class="friend-data-detail">Ikke registrert i dag</div></div>';
                }
            } catch (e) { console.warn('Ingen tilgang til søvndata:', e); }
        }
        
        // Bevegelse
        if (theirPermissions.movement) {
            try {
                const moveDoc = await friendRef.collection('movementLogs').doc(today).get();
                if (moveDoc.exists) {
                    const activities = moveDoc.data().activities || [];
                    html += `
                        <div class="friend-data-card">
                            <h3>🚶 Bevegelse</h3>
                            ${activities.length > 0
                                ? activities.map(a => `<div class="friend-data-detail">${escapeHtml(a.name)}: ${a.duration} min</div>`).join('')
                                : '<div class="friend-data-detail">Ingen aktiviteter i dag</div>'
                            }
                        </div>`;
                } else {
                    html += '<div class="friend-data-card"><h3>🚶 Bevegelse</h3><div class="friend-data-detail">Ikke registrert i dag</div></div>';
                }
            } catch (e) { console.warn('Ingen tilgang til bevegelsesdata:', e); }
        }
        
        // Dagbok
        if (theirPermissions.diary) {
            try {
                const diaryDoc = await friendRef.collection('diaryLogs').doc(today).get();
                if (diaryDoc.exists && diaryDoc.data().text) {
                    html += `
                        <div class="friend-data-card">
                            <h3>📝 Dagbok</h3>
                            <div class="friend-data-detail" style="white-space:pre-wrap;">${escapeHtml(diaryDoc.data().text)}</div>
                        </div>`;
                } else {
                    html += '<div class="friend-data-card"><h3>📝 Dagbok</h3><div class="friend-data-detail">Ingen innlegg i dag</div></div>';
                }
            } catch (e) { console.warn('Ingen tilgang til dagbokdata:', e); }
        }
        
        // Innsjekk
        if (theirPermissions.checkin) {
            try {
                const checkinDoc = await friendRef.collection('checkins').doc(today).get();
                html += `
                    <div class="friend-data-card">
                        <h3>✅ Daglig innsjekk</h3>
                        <div class="friend-data-value">${checkinDoc.exists ? `Sjekket inn kl. ${checkinDoc.data().time}` : '❌ Ikke sjekket inn ennå i dag'}</div>
                    </div>`;
            } catch (e) { console.warn('Ingen tilgang til innsjekkdata:', e); }
        }
    }
    
    document.getElementById('friend-dashboard-content').innerHTML = html || '<p class="empty-state">Ingen delt data tilgjengelig</p>';
    
    // Vis/skjul påminnelsesknapper basert på om vi har lov
    const reminderSection = document.getElementById('friend-reminder-buttons');
    if (reminderSection) {
        reminderSection.style.display = theirPermissions.sendReminder ? 'flex' : 'none';
        document.getElementById('friend-custom-reminder').style.display = theirPermissions.sendReminder ? 'block' : 'none';
        // Skjul send-knappen også
        const sendBtn = document.querySelector('#friend-dashboard-view .btn-save-health');
        if (sendBtn) sendBtn.style.display = theirPermissions.sendReminder ? 'block' : 'none';
    }
}

// --- Send påminnelse til venn ---
async function sendFriendReminder(type) {
    if (!currentFriendDashboardUid) return;
    
    const friend = friendsList.find(f => f.friendUid === currentFriendDashboardUid);
    if (!friend) return;
    
    let title = '';
    let body = '';
    const myName = settings.name || currentUser.displayName || currentUser.email;
    
    switch (type) {
        case 'water':
            title = '💧 Påminnelse fra ' + myName;
            body = 'Husk å drikke et glass vann!';
            break;
        case 'medicine':
            title = '💊 Påminnelse fra ' + myName;
            body = 'Husk å ta medisinen din!';
            break;
        case 'movement':
            title = '🚶 Påminnelse fra ' + myName;
            body = 'Tid for litt bevegelse! Rør litt på deg.';
            break;
        case 'checkin':
            title = '🌅 Påminnelse fra ' + myName;
            body = 'Husk å sjekke inn i dag!';
            break;
        case 'custom':
            const customMsg = document.getElementById('friend-custom-reminder').value.trim();
            if (!customMsg) {
                showConfirm('❌ Skriv en melding først');
                return;
            }
            title = '💬 Melding fra ' + myName;
            body = customMsg;
            break;
        default:
            return;
    }
    
    await db.collection('friendReminders').add({
        fromUid: currentUser.uid,
        fromEmail: currentUser.email,
        fromName: myName,
        toUid: currentFriendDashboardUid,
        toEmail: friend.friendEmail,
        title: title,
        body: body,
        type: type,
        processed: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    if (type === 'custom') {
        document.getElementById('friend-custom-reminder').value = '';
    }
    
    showConfirm('✅ Påminnelse sendt!');
}

// Legg friends-view i showView switch
const _originalShowView = showView;
showView = function(viewName) {
    _originalShowView(viewName);
    if (viewName === 'friends') {
        loadFriendsData();
    }
};

// ==========================================
// SERVICE WORKER
// ==========================================
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        // Registrer caching service worker
        navigator.serviceWorker.register('sw.js?v=3.0.1', { updateViaCache: 'none' })
            .then(reg => {
                console.log('[SW] Cache-worker registrert:', reg.scope);
                reg.update();
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
