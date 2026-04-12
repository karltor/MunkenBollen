/**
 * Shared live lock check — reads matches/_settings.tipsLocked directly
 * from Firestore to prevent users from saving tips after admin has locked.
 *
 * Kept in its own module to avoid circular imports (wizard/bracket/special
 * would otherwise have to import from admin.js which already imports them).
 */
import { db } from './config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

export async function isTipsLockedLive() {
    try {
        const snap = await getDoc(doc(db, "matches", "_settings"));
        return snap.exists() && snap.data().tipsLocked === true;
    } catch {
        // Offline or network error: err on the safe side? No — that would
        // block legitimate saves when connection blips. Allow the save to
        // proceed; the updateDoc itself will either succeed or fail.
        return false;
    }
}
