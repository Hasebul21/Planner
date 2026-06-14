# Firebase setup checklist

This planner uses **Firebase Auth + Firestore** for cloud sync. The free Spark plan is plenty for personal use.

## 1. Auth — enable sign-in methods

Firebase Console → **Build → Authentication → Sign-in method**, enable:

- **Google** — one-click sign-in (recommended)
- **Email link (passwordless)** — magic-link email

Both work out of the box in the app's avatar → sign-in modal.

## 2. Firestore — create the database

Firebase Console → **Build → Firestore Database → Create database**

- Choose **production mode**
- Pick a region near you (e.g. `asia-south1`)

## 3. Firestore security rules

Open the **Rules** tab in Firestore and paste the contents of `firestore.rules`, then **Publish**.

This guarantees each user can only read/write their own data at `users/{their-uid}/...`.

## 4. Authorize your domains

Firebase Console → **Authentication → Settings → Authorized domains**, add:

- `localhost`
- `127.0.0.1`
- `planner-green-seven.vercel.app` (and any Vercel preview domain you use)

## 5. Data model

A single doc per user:

```
users/{uid}/data/state
{
  tasks: [...],        // same shape as before
  notes: "...",
  tweaks: { ... },
  updatedAt: 1718000000000
}
```

Existing `localStorage` data automatically migrates to the cloud the first time a user signs in on a device.

## How it behaves

- **Signed out** — purely local (`localStorage`), exactly as before
- **Signed in** — every write is mirrored to Firestore (debounced 400 ms)
- **Multi-device** — `onSnapshot` keeps tabs and devices in sync
- **Offline** — Firestore's IndexedDB cache makes the app work offline; changes sync when back online
