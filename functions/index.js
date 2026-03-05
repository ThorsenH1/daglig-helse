/**
 * Cloud Functions for Daglig Helse
 * Sender push-varsler til brukere basert på påminnelsesinnstillinger.
 * 
 * Disse funksjonene kjører på Firebase sine servere og sender varsler
 * selv når appen er lukket – noe som er kritisk for eldre brukere.
 */

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

// Initialiser Firebase Admin
initializeApp();
const db = getFirestore();
const APP_URL = "https://thorsenh1.github.io/daglig-helse/";

// Begrens kostnader
setGlobalOptions({ maxInstances: 5, region: "europe-west1" });

// =============================================
// HJELPE-FUNKSJONER
// =============================================

/**
 * Hent nåværende tid i brukerens tidssone
 */
function getCurrentTimeInTimezone(timezone) {
    try {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('no-NO', {
            timeZone: timezone || 'Europe/Oslo',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
        return formatter.format(now);
    } catch {
        const now = new Date();
        // Fallback: UTC+1 (CET)
        const cetTime = new Date(now.getTime() + 1 * 60 * 60 * 1000);
        return `${String(cetTime.getUTCHours()).padStart(2, '0')}:${String(cetTime.getUTCMinutes()).padStart(2, '0')}`;
    }
}

/**
 * Hent dagens dato-streng i brukerens tidssone
 */
function getTodayString(timezone) {
    try {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone || 'Europe/Oslo',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        return formatter.format(now); // YYYY-MM-DD
    } catch {
        return new Date().toISOString().split('T')[0];
    }
}

/**
 * Hent gjeldende time (0-23) i brukerens tidssone
 */
function getCurrentHour(timezone) {
    try {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone || 'Europe/Oslo',
            hour: 'numeric',
            hour12: false
        });
        return parseInt(formatter.format(now));
    } catch {
        return new Date().getHours();
    }
}

function getCurrentMinutesInTimezone(timezone) {
    try {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone || 'Europe/Oslo',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
        const parts = formatter.format(now).split(':').map(Number);
        return (parts[0] * 60) + parts[1];
    } catch {
        const now = new Date();
        return (now.getHours() * 60) + now.getMinutes();
    }
}

function timeStringToMinutes(value, fallbackMinutes) {
    if (!value || !value.includes(':')) return fallbackMinutes;
    const [h, m] = value.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return fallbackMinutes;
    return (h * 60) + m;
}

function isWithinActiveWindow(config, timezone) {
    const fallbackStart = (config.activeHoursStart ?? 7) * 60;
    const fallbackEnd = (config.activeHoursEnd ?? 22) * 60;
    const startMinutes = timeStringToMinutes(config.activeStartTime, fallbackStart);
    const endMinutes = timeStringToMinutes(config.activeEndTime, fallbackEnd);
    const nowMinutes = getCurrentMinutesInTimezone(timezone);

    if (startMinutes === endMinutes) return true;
    if (startMinutes < endMinutes) {
        return nowMinutes >= startMinutes && nowMinutes < endMinutes;
    }
    return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

/**
 * Send FCM-melding til alle brukerens enheter
 */
async function sendPushToUser(userId, title, body, type) {
    // Hent alle FCM-tokens for brukeren
    const tokensSnapshot = await db
        .collection('users')
        .doc(userId)
        .collection('fcmTokens')
        .get();

    if (tokensSnapshot.empty) {
        return { success: 0, failures: 0 };
    }

    const tokens = tokensSnapshot.docs.map(doc => doc.data().token).filter(Boolean);
    if (tokens.length === 0) return { success: 0, failures: 0 };

    let successCount = 0;
    let failureCount = 0;
    const invalidTokens = [];

    const messaging = getMessaging();

    for (const token of tokens) {
        try {
            await messaging.send({
                token: token,
                data: {
                    type: type,
                    title: title,
                    body: body,
                    tag: `daglig-helse-${type}-${Date.now()}`,
                    url: APP_URL
                }
            });
            successCount++;
        } catch (err) {
            failureCount++;
            // Fjern ugyldige tokens
            if (
                err.code === 'messaging/registration-token-not-registered' ||
                err.code === 'messaging/invalid-registration-token'
            ) {
                invalidTokens.push(token);
            }
            console.warn(`FCM send feilet for bruker ${userId}:`, err.code || err.message);
        }
    }

    // Rydd opp ugyldige tokens
    for (const badToken of invalidTokens) {
        const tokenDocs = tokensSnapshot.docs.filter(d => d.data().token === badToken);
        for (const doc of tokenDocs) {
            await doc.ref.delete();
            console.log(`Slettet ugyldig token for bruker ${userId}`);
        }
    }

    return { success: successCount, failures: failureCount };
}


// =============================================
// VANNPÅMINNELSER – Kjører hvert minutt
// =============================================
exports.waterReminder = onSchedule(
    {
        schedule: "every 1 minutes",
        timeZone: "Europe/Oslo",
        retryCount: 0,
        memory: "256MiB"
    },
    async () => {
        console.log("[waterReminder] Starter sjekk...");

        // Hent alle brukere med aktive vannpåminnelser
        const usersSnapshot = await db.collection('users')
            .where('reminderConfig.waterReminder', '==', true)
            .get();

        if (usersSnapshot.empty) {
            console.log("[waterReminder] Ingen brukere med vannpåminnelser");
            return;
        }

        let totalSent = 0;

        for (const userDoc of usersSnapshot.docs) {
            const userId = userDoc.id;
            const config = userDoc.data().reminderConfig || {};

            const tz = config.timezone || 'Europe/Oslo';
            if (!isWithinActiveWindow(config, tz)) continue;

            // Sjekk om brukeren allerede har nådd vannmålet i dag
            const today = getTodayString(tz);
            const waterDoc = await db.collection('users').doc(userId)
                .collection('waterLogs').doc(today).get();

            const currentCount = waterDoc.exists ? (waterDoc.data().count || 0) : 0;
            const goal = config.waterGoal || 8;

            if (currentCount >= goal) continue; // Målet er nådd!

            // Sjekk intervall – ikke send for ofte
            const interval = config.waterInterval || 60; // minutter
            const lastSentDoc = await db.collection('users').doc(userId)
                .collection('_pushLog').doc('lastWaterPush').get();

            if (lastSentDoc.exists) {
                const lastSent = lastSentDoc.data().sentAt?.toDate();
                const lastSentMs = lastSentDoc.data().sentAtMs || (lastSent ? lastSent.getTime() : 0);
                if (lastSentMs) {
                    const minutesSinceLast = (Date.now() - lastSentMs) / 60000;
                    if (minutesSinceLast < interval) continue; // For tidlig
                }
            }

            // Send varselet!
            const remaining = goal - currentCount;
            const result = await sendPushToUser(
                userId,
                '💧 Husk å drikke vann!',
                `Du har drukket ${currentCount} av ${goal} glass i dag. ${remaining} glass igjen!`,
                'water'
            );

            if (result.success > 0) {
                // Logg når vi sendte
                await db.collection('users').doc(userId)
                    .collection('_pushLog').doc('lastWaterPush').set({
                        sentAt: FieldValue.serverTimestamp(),
                        sentAtMs: Date.now(),
                        count: currentCount,
                        goal: goal
                    });
                totalSent++;
            }
        }

        console.log(`[waterReminder] Ferdig. Sendt til ${totalSent} brukere.`);
    }
);


// =============================================
// MEDISINPÅMINNELSER – Kjører hvert 5. minutt
// =============================================
exports.medicineReminder = onSchedule(
    {
        schedule: "every 5 minutes",
        timeZone: "Europe/Oslo",
        retryCount: 0,
        memory: "256MiB"
    },
    async () => {
        console.log("[medicineReminder] Starter sjekk...");

        const usersSnapshot = await db.collection('users')
            .where('reminderConfig.medicineReminder', '==', true)
            .get();

        if (usersSnapshot.empty) {
            console.log("[medicineReminder] Ingen brukere med medisinpåminnelser");
            return;
        }

        let totalSent = 0;

        for (const userDoc of usersSnapshot.docs) {
            const userId = userDoc.id;
            const config = userDoc.data().reminderConfig || {};

            const tz = config.timezone || 'Europe/Oslo';
            if (!isWithinActiveWindow(config, tz)) continue;
            const currentTime = getCurrentTimeInTimezone(tz);
            const today = getTodayString(tz);

            const medicines = config.medicines || [];
            if (medicines.length === 0) continue;

            // Hent dagens medisinlogg
            const medLogDoc = await db.collection('users').doc(userId)
                .collection('medicineLogs').doc(today).get();

            const takenMeds = medLogDoc.exists ? (medLogDoc.data().taken || []) : [];

            for (const med of medicines) {
                for (const scheduledTime of (med.times || [])) {
                    // Sjekk om tiden matcher (innenfor 5-minutters vindu)
                    const [schedH, schedM] = scheduledTime.split(':').map(Number);
                    const [currH, currM] = currentTime.split(':').map(Number);
                    const schedMinutes = schedH * 60 + schedM;
                    const currMinutes = currH * 60 + currM;
                    const diff = currMinutes - schedMinutes;

                    // Send varsel fra 0 til 4 minutter etter planlagt tid
                    if (diff < 0 || diff > 4) continue;

                    // Sjekk om allerede tatt
                    const alreadyTaken = takenMeds.some(
                        t => t.medicineId === med.id && t.scheduledTime === scheduledTime
                    );
                    if (alreadyTaken) continue;

                    // Sjekk om vi allerede har sendt varsel for denne dosen
                    const pushLogId = `med_${med.id}_${scheduledTime.replace(':', '')}`;
                    const pushLogDoc = await db.collection('users').doc(userId)
                        .collection('_pushLog').doc(pushLogId).get();

                    if (pushLogDoc.exists) {
                        const lastSent = pushLogDoc.data().sentAt?.toDate();
                        if (lastSent) {
                            const sentDate = lastSent.toISOString().split('T')[0];
                            if (sentDate === today) continue; // Allerede sendt i dag
                        }
                    }

                    // Send!
                    const result = await sendPushToUser(
                        userId,
                        `💊 Tid for ${med.name}!`,
                        `${med.dosage || 'Ta medisinen din'} – planlagt kl. ${scheduledTime}`,
                        'medicine'
                    );

                    if (result.success > 0) {
                        await db.collection('users').doc(userId)
                            .collection('_pushLog').doc(pushLogId).set({
                                sentAt: FieldValue.serverTimestamp(),
                                medicineName: med.name
                            });
                        totalSent++;
                    }
                }
            }
        }

        console.log(`[medicineReminder] Ferdig. Sendt ${totalSent} varsler.`);
    }
);


// =============================================
// BEVEGELSESPÅMINNELSER – Kjører hvert 30. minutt
// =============================================
exports.movementReminder = onSchedule(
    {
        schedule: "every 30 minutes",
        timeZone: "Europe/Oslo",
        retryCount: 0,
        memory: "256MiB"
    },
    async () => {
        console.log("[movementReminder] Starter sjekk...");

        const usersSnapshot = await db.collection('users')
            .where('reminderConfig.movementReminder', '==', true)
            .get();

        if (usersSnapshot.empty) return;

        let totalSent = 0;

        for (const userDoc of usersSnapshot.docs) {
            const userId = userDoc.id;
            const config = userDoc.data().reminderConfig || {};

            const tz = config.timezone || 'Europe/Oslo';
            if (!isWithinActiveWindow(config, tz)) continue;

            // Sjekk intervall
            const interval = config.movementInterval || 120;
            const lastSentDoc = await db.collection('users').doc(userId)
                .collection('_pushLog').doc('lastMovementPush').get();

            if (lastSentDoc.exists) {
                const lastSent = lastSentDoc.data().sentAt?.toDate();
                const lastSentMs = lastSentDoc.data().sentAtMs || (lastSent ? lastSent.getTime() : 0);
                if (lastSentMs) {
                    const minutesSinceLast = (Date.now() - lastSentMs) / 60000;
                    if (minutesSinceLast < interval) continue;
                }
            }

            // Send!
            const result = await sendPushToUser(
                userId,
                '🚶 Tid for litt bevegelse!',
                'Rør litt på deg – en kort gåtur eller noen tøyeøvelser gjør godt!',
                'movement'
            );

            if (result.success > 0) {
                await db.collection('users').doc(userId)
                    .collection('_pushLog').doc('lastMovementPush').set({
                        sentAt: FieldValue.serverTimestamp(),
                        sentAtMs: Date.now()
                    });
                totalSent++;
            }
        }

        console.log(`[movementReminder] Ferdig. Sendt til ${totalSent} brukere.`);
    }
);


// =============================================
// DAGLIG INNSJEKK-PÅMINNELSE – Kjører kl. 09:00 og 10:00
// =============================================
exports.checkinReminder = onSchedule(
    {
        schedule: "0 9,10 * * *",  // kl. 09:00 og 10:00 hver dag
        timeZone: "Europe/Oslo",
        retryCount: 0,
        memory: "256MiB"
    },
    async () => {
        console.log("[checkinReminder] Starter sjekk...");

        const usersSnapshot = await db.collection('users')
            .where('reminderConfig.checkinReminder', '==', true)
            .get();

        if (usersSnapshot.empty) return;

        let totalSent = 0;

        for (const userDoc of usersSnapshot.docs) {
            const userId = userDoc.id;
            const config = userDoc.data().reminderConfig || {};

            const tz = config.timezone || 'Europe/Oslo';
            if (!isWithinActiveWindow(config, tz)) continue;
            const currentTime = getCurrentTimeInTimezone(tz);
            const checkinTime = config.checkinTime || '09:00';
            const today = getTodayString(tz);

            // Sjekk om tiden passer (innenfor 10 minutter)
            const [schedH, schedM] = checkinTime.split(':').map(Number);
            const [currH, currM] = currentTime.split(':').map(Number);
            const diff = Math.abs((currH * 60 + currM) - (schedH * 60 + schedM));
            if (diff > 10) continue;

            // Sjekk om allerede sjekket inn
            const checkinDoc = await db.collection('users').doc(userId)
                .collection('checkins').doc(today).get();

            if (checkinDoc.exists) continue; // Allerede sjekket inn

            // Sjekk om vi allerede sendte i dag
            const pushLogDoc = await db.collection('users').doc(userId)
                .collection('_pushLog').doc('lastCheckinPush').get();

            if (pushLogDoc.exists) {
                const lastSent = pushLogDoc.data().sentAt?.toDate();
                if (lastSent) {
                    const sentDate = lastSent.toISOString().split('T')[0];
                    if (sentDate === today) continue;
                }
            }

            // Send!
            const result = await sendPushToUser(
                userId,
                '🌅 God morgen!',
                'Husk å sjekke inn i dag. Hvordan har du det?',
                'checkin'
            );

            if (result.success > 0) {
                await db.collection('users').doc(userId)
                    .collection('_pushLog').doc('lastCheckinPush').set({
                        sentAt: FieldValue.serverTimestamp(),
                        sentAtMs: Date.now()
                    });
                totalSent++;
            }
        }

        console.log(`[checkinReminder] Ferdig. Sendt til ${totalSent} brukere.`);
    }
);


// =============================================
// VENNEVARSEL – Trigges når noen skriver til friendReminders
// =============================================
exports.sendFriendReminder = onDocumentCreated(
    {
        document: "friendReminders/{reminderId}",
        region: "europe-west1",
        memory: "256MiB"
    },
    async (event) => {
        const data = event.data?.data();
        if (!data) return;

        const { toUid, fromUid, fromName, title, body, type } = data;

        if (!toUid || !title || !body) {
            console.warn("[friendReminder] Mangler toUid, title eller body");
            return;
        }

        // Sjekk at avsender faktisk har tillatelse
        const friendDoc = await db.collection('users').doc(toUid)
            .collection('friends').doc(fromUid).get();

        if (!friendDoc.exists) {
            console.warn(`[friendReminder] ${fromUid} er ikke venn av ${toUid}`);
            return;
        }

        const perms = friendDoc.data().permissions || {};
        if (!perms.sendReminder) {
            console.warn(`[friendReminder] ${fromUid} har ikke tillatelse til å sende varsler til ${toUid}`);
            return;
        }

        // Send push-varsel
        const result = await sendPushToUser(toUid, title, body, 'friendReminder');
        console.log(`[friendReminder] Sendt fra ${fromName || fromUid} til ${toUid}: ${result.success} suksess, ${result.failures} feil`);

        // Marker som prosessert
        await event.data.ref.update({
            processed: true,
            processedAt: FieldValue.serverTimestamp()
        });
    }
);
