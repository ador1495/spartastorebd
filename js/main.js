// Import Firebase SDKs
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-analytics.js";
import {
  getFirestore,
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  Timestamp
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";

// Your Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAHXCpR5DKvzpyQgpTzu5EqrIbO-ZjIlS4",
  authDomain: "estore-94927.firebaseapp.com",
  projectId: "estore-94927",
  storageBucket: "estore-94927.firebasestorage.app",
  messagingSenderId: "1043667761238",
  appId: "1:1043667761238:web:a4ba940ccd846f925763f7",
  measurementId: "G-R4YV7D8BR2"
};

// Initialize Firebase Services
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getFirestore(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// Current signed-in user reference
let currentUser = null;

// Helper to escape HTML and prevent XSS
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Parse star rating string or number into a 1 - 5 number
function parseRatingValue(rating) {
  if (typeof rating === "number") return Math.min(5, Math.max(1, rating));
  if (!rating) return 5;
  const str = String(rating);
  const starCount = (str.match(/⭐/g) || []).length;
  if (starCount > 0) return starCount;
  const numMatch = str.match(/[1-5]/);
  if (numMatch) return parseInt(numMatch[0], 10);
  return 5;
}

// Update Google Play style rating summary and progress bars
function updateRatingSummaryUI(totalReviews, totalScore, starCounts) {
  const scoreEl = document.getElementById("ratingAverageScore");
  const countEl = document.getElementById("ratingTotalCount");
  const starsFillEl = document.getElementById("ratingStarsFill");

  if (totalReviews === 0) {
    if (scoreEl) scoreEl.textContent = "0.0";
    if (countEl) countEl.textContent = "0 reviews";
    if (starsFillEl) starsFillEl.style.width = "0%";
    for (let i = 1; i <= 5; i++) {
      const bar = document.getElementById(`bar${i}`);
      if (bar) bar.style.width = "0%";
    }
    return;
  }

  const average = (totalScore / totalReviews).toFixed(1);
  const fillPercentage = Math.min(100, Math.max(0, (totalScore / (totalReviews * 5)) * 100));

  if (scoreEl) scoreEl.textContent = average;
  if (countEl) {
    countEl.textContent = `${totalReviews.toLocaleString()} review${totalReviews === 1 ? "" : "s"}`;
  }
  if (starsFillEl) {
    starsFillEl.style.width = `${fillPercentage}%`;
  }

  // Update breakdown bars for 5, 4, 3, 2, 1
  for (let i = 1; i <= 5; i++) {
    const bar = document.getElementById(`bar${i}`);
    if (bar) {
      const count = starCounts[i] || 0;
      const pct = (count / totalReviews) * 100;
      bar.style.width = `${pct}%`;
      bar.title = `${i} stars: ${count} review${count === 1 ? "" : "s"} (${pct.toFixed(0)}%)`;
    }
  }
}

// Generate fallback SVG avatar Data URL
function getInitialAvatar(name) {
  const initial = (name || "U").charAt(0).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="100%" height="100%" fill="#2563eb"/><text x="50%" y="54%" font-family="system-ui, -apple-system, sans-serif" font-size="28" font-weight="bold" fill="#ffffff" dominant-baseline="middle" text-anchor="middle">${initial}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// Helper to safely set avatar src with graceful fallback
function setAvatarSrc(imgElem, photoURL, name) {
  if (!imgElem) return;
  const fallback = getInitialAvatar(name);
  if (photoURL) {
    imgElem.src = photoURL;
    imgElem.onerror = () => {
      imgElem.src = fallback;
    };
  } else {
    imgElem.src = fallback;
  }
}

// Display or clear friendly auth alerts
function showAuthAlert(message, isError = true) {
  const alertEl = document.getElementById("authAlert");
  if (!alertEl) return;
  alertEl.textContent = message;
  alertEl.style.display = "block";
  alertEl.style.backgroundColor = isError ? "#fef2f2" : "#f0fdf4";
  alertEl.style.borderColor = isError ? "#fecaca" : "#bbf7d0";
  alertEl.style.color = isError ? "#991b1b" : "#166534";
}

function clearAuthAlert() {
  const alertEl = document.getElementById("authAlert");
  if (alertEl) {
    alertEl.style.display = "none";
    alertEl.textContent = "";
  }
}

// Google Sign-In with Popup
async function loginWithGoogle() {
  clearAuthAlert();
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.error("Google Sign-In failed:", error);
    if (error.code === "auth/popup-closed-by-user" || error.code === "auth/cancelled-popup-request") {
      return null;
    }
    if (error.code === "auth/unauthorized-domain") {
      showAuthAlert("Domain not authorized. In Firebase Console > Authentication > Settings > Authorized Domains, make sure your host (e.g. localhost) is authorized.");
    } else {
      showAuthAlert("Sign-in error: " + (error.message || error.code));
    }
    return null;
  }
}

// Google Sign-Out
async function logoutGoogle() {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Google Sign-Out failed:", error);
    showAuthAlert("Sign-out error: " + error.message);
  }
}

// Update UI elements based on authentication state
function updateAuthStateUI(user) {
  // Review Section elements
  const loggedOutBox = document.getElementById("reviewLoggedOutBox");
  const loggedInBox = document.getElementById("reviewLoggedInBox");
  const accountNameEl = document.getElementById("googleAccountName");
  const accountEmailEl = document.getElementById("googleAccountEmail");
  const reviewAvatarEl = document.getElementById("reviewUserAvatar");
  const gNameInput = document.getElementById("gName");
  const submitBtn = document.getElementById("submitReviewBtn");

  // Header elements
  const headerSignInBtn = document.getElementById("headerGoogleSignInBtn");
  const headerUserProfile = document.getElementById("headerUserProfile");
  const headerUserName = document.getElementById("headerUserName");
  const headerUserAvatar = document.getElementById("headerUserAvatar");

  if (user) {
    const displayName = user.displayName || user.email || "Google User";
    const email = user.email || "";

    // Review form: show pop-up account badge instead of raw input
    if (loggedOutBox) loggedOutBox.style.display = "none";
    if (loggedInBox) loggedInBox.style.display = "flex";
    if (accountNameEl) accountNameEl.textContent = displayName;
    if (accountEmailEl) accountEmailEl.textContent = email;
    if (gNameInput) gNameInput.value = displayName;
    setAvatarSrc(reviewAvatarEl, user.photoURL, displayName);

    if (submitBtn) {
      submitBtn.innerHTML = `Post Review as <strong>${escapeHtml(displayName)}</strong>`;
      submitBtn.style.backgroundColor = "#2563eb";
    }

    // Header: show user avatar and first name
    if (headerSignInBtn) headerSignInBtn.style.display = "none";
    if (headerUserProfile) headerUserProfile.style.display = "flex";
    if (headerUserName) headerUserName.textContent = displayName.split(" ")[0];
    setAvatarSrc(headerUserAvatar, user.photoURL, displayName);
  } else {
    // Review form: show Google Sign In button
    if (loggedOutBox) loggedOutBox.style.display = "block";
    if (loggedInBox) loggedInBox.style.display = "none";
    if (gNameInput) gNameInput.value = "";

    if (submitBtn) {
      submitBtn.innerHTML = "Sign in with Google to Post Review";
      submitBtn.style.backgroundColor = "#2563eb";
    }

    // Header: show Sign in button
    if (headerSignInBtn) headerSignInBtn.style.display = "inline-flex";
    if (headerUserProfile) headerUserProfile.style.display = "none";
  }
}

// Listen to Firebase Auth state changes
onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => updateAuthStateUI(user), { once: true });
  } else {
    updateAuthStateUI(user);
  }
});

// Snipcart Event Listener
document.addEventListener('snipcart.ready', () => {
  console.log('Snipcart is ready!');
  if (window.Snipcart && Snipcart.events) {
    Snipcart.events.on('item.added', (cartItem) => {
      console.log(`Added product: ${cartItem.name}`);
    });
  }
});

// DOM Interactive Logic
document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("globalReviewForm");
  const container = document.getElementById("globalReviewsContainer");

  // Attach Google Auth triggers
  const googleSignInBtn = document.getElementById("googleSignInBtn");
  const googleSignOutBtn = document.getElementById("googleSignOutBtn");
  const headerGoogleSignInBtn = document.getElementById("headerGoogleSignInBtn");
  const headerSignOutBtn = document.getElementById("headerSignOutBtn");

  if (googleSignInBtn) googleSignInBtn.addEventListener("click", loginWithGoogle);
  if (googleSignOutBtn) googleSignOutBtn.addEventListener("click", logoutGoogle);
  if (headerGoogleSignInBtn) headerGoogleSignInBtn.addEventListener("click", loginWithGoogle);
  if (headerSignOutBtn) headerSignOutBtn.addEventListener("click", logoutGoogle);

  // Sync initial auth state UI once DOM is loaded
  updateAuthStateUI(currentUser);

  if (!form || !container) return;

  // 1. Fetch and display reviews in real-time
  const q = query(collection(db, "reviews"), orderBy("date", "desc"));

  onSnapshot(q, (snapshot) => {
    if (snapshot.empty) {
      container.innerHTML = "<p style='color: #6b7280; font-size: 14px;'>No reviews yet. Be the first to post!</p>";
      updateRatingSummaryUI(0, 0, { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 });
      return;
    }

    const starCounts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    let totalScore = 0;
    const totalReviews = snapshot.size;

    container.innerHTML = "";
    snapshot.forEach((docSnap) => {
      const rev = docSnap.data();

      // Aggregate statistics for rating breakdown
      const val = parseRatingValue(rev.rating);
      const roundedVal = Math.min(5, Math.max(1, Math.round(val)));
      starCounts[roundedVal] = (starCounts[roundedVal] || 0) + 1;
      totalScore += val;

      const card = document.createElement("div");
      card.style.cssText = "background: #f9fafb; padding: 16px; border-radius: 10px; margin-bottom: 14px; border: 1px solid #e5e7eb; transition: transform 0.15s ease, box-shadow 0.15s ease;";

      let dateString = "Recent";
      if (rev.date && rev.date.toDate) {
        dateString = rev.date.toDate().toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric"
        });
      }

      const displayName = escapeHtml(rev.name || "Anonymous");
      const reviewText = escapeHtml(rev.text || "");
      const rating = escapeHtml(rev.rating || "⭐⭐⭐⭐⭐");
      const isGoogleReviewer = Boolean(rev.userId || rev.photoURL);
      const avatarSrc = rev.photoURL || getInitialAvatar(displayName);

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <img src="${avatarSrc}" alt="${displayName}" style="width: 38px; height: 38px; border-radius: 50%; object-fit: cover; border: 1.5px solid #d1d5db; background: #ffffff;" onerror="this.src='${getInitialAvatar(displayName)}'" />
            <div>
              <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                <strong style="color: #111827; font-size: 15px;">${displayName}</strong>
                ${isGoogleReviewer ? '<span class="verified-review-badge">✓ Google Reviewer</span>' : ''}
              </div>
              <div style="color: #f59e0b; font-size: 13px; margin-top: 2px;">${rating}</div>
            </div>
          </div>
          <span style="color: #6b7280; font-size: 12px; white-space: nowrap;">${dateString}</span>
        </div>
        <p style="color: #374151; font-size: 14px; margin: 0; line-height: 1.5;">${reviewText}</p>
      `;
      container.appendChild(card);
    });

    // Update the Google Play style summary breakdown widget
    updateRatingSummaryUI(totalReviews, totalScore, starCounts);
  });

  // 2. Send new review to cloud database when submitted
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    // If user is not yet signed in with Google, trigger Google Sign-In first
    if (!currentUser) {
      showAuthAlert("Please sign in with your Google account first to submit a review.", false);
      const user = await loginWithGoogle();
      if (!user) {
        return; // Closed or cancelled
      }
    }

    const reviewText = document.getElementById("gText").value.trim();
    if (!reviewText) return;

    const authorName = currentUser?.displayName || currentUser?.email || document.getElementById("gName").value || "Google User";
    const rating = document.getElementById("gRating").value;
    const submitBtn = document.getElementById("submitReviewBtn");
    const originalBtnText = submitBtn.innerHTML;

    submitBtn.disabled = true;
    submitBtn.innerHTML = "Posting review...";

    try {
      await addDoc(collection(db, "reviews"), {
        name: authorName,
        rating: rating,
        text: reviewText,
        photoURL: currentUser?.photoURL || "",
        userId: currentUser?.uid || "",
        date: Timestamp.now()
      });

      document.getElementById("gText").value = "";
      clearAuthAlert();
    } catch (error) {
      console.error("Error adding review: ", error);
      showAuthAlert("Error posting review: " + error.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnText;
    }
  });
});